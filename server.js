'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 30 * 1024 * 1024;

loadDotEnv(path.join(ROOT, '.env'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('요청 이미지가 너무 큽니다.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('잘못된 요청 형식입니다.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function buildPrompt(settings = {}) {
  const weights = {
    1: 'very thin, delicate linework',
    2: 'thin clean linework',
    3: 'medium clean line weight suitable for a tattoo stencil',
    4: 'bold clear linework',
    5: 'very bold, strongly readable contour lines'
  };
  const details = {
    1: 'extremely simplified; keep only the essential silhouette and a few defining contours',
    2: 'simplified; keep major internal structure but remove small texture',
    3: 'balanced detail; preserve defining facial or object features and major folds or patterns',
    4: 'detailed; preserve meaningful internal edges, anatomy, folds, and patterns while avoiding noise',
    5: 'highly detailed structural linework while still avoiding noisy shading or sketch clutter'
  };
  const styles = {
    tattoo: 'professional tattoo stencil / tattoo transfer outline',
    contour: 'clean contour drawing with smooth continuous outlines',
    technical: 'precise black-and-white design drawing with controlled structural lines',
    minimal: 'minimalist single-ink line illustration with very clean negative space'
  };

  return `Convert the provided image into a clean ${styles[settings.style] || styles.tattoo}.

STRICT OUTPUT RULES:
- Output must be a pure white background with black linework only.
- No color, gray fills, gradients, shadows, realistic shading, textures, or background scenery.
- Preserve the selected source area's silhouette, proportions, pose, composition, important shapes, and recognizable features.
- Line weight: ${weights[settings.lineWeight] || weights[3]}.
- Detail level: ${details[settings.detail] || details[3]}.
- ${settings.preserveDetails ? 'Preserve important internal lines such as eyes, facial features, seams, folds, object boundaries, and pattern-defining edges.' : 'Remove most internal detail and prioritize the silhouette plus only indispensable interior contours.'}
- Do not invent text, symbols, borders, decorations, objects, anatomy, or scenery.
- Do not add an outline around the rectangular image canvas.
- Treat white areas as empty negative space whenever possible.
- Keep the subject centered within the composition already provided by the selected crop.
- The finished image should be directly usable as a clean tattoo stencil or tracing reference.

Return only the edited image.`;
}

function mapGeminiError(status, data) {
  const raw = data?.error?.message || data?.message || `Gemini API 오류 (${status})`;
  if (status === 400) return { status, code: 'GEMINI_BAD_REQUEST', error: raw };
  if (status === 401 || status === 403) {
    return { status, code: 'GEMINI_KEY_INVALID', error: 'Gemini API 키가 올바르지 않거나 해당 프로젝트에서 이미지 모델을 사용할 권한이 없습니다. Render의 GEMINI_API_KEY와 Google AI Studio/Cloud 설정을 확인해 주세요.' };
  }
  if (status === 429 && /free tier|billing|quota|rate limit|limit/i.test(raw)) {
    return { status, code: 'GEMINI_BILLING_REQUIRED', error: 'Gemini 이미지 API 사용 한도에 도달했거나 Billing 연결이 필요합니다. Google AI Studio 또는 Google Cloud 프로젝트의 과금/사용량 설정을 확인해 주세요.' };
  }
  if (status === 429) {
    return { status, code: 'GEMINI_RATE_LIMIT', error: 'Gemini API 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.' };
  }
  return { status, code: 'GEMINI_API_ERROR', error: raw };
}

function extractImagePart(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts || [];
    for (const part of parts) {
      const inline = part.inlineData || part.inline_data;
      if (inline?.data) return { imageBase64: inline.data, mimeType: inline.mimeType || inline.mime_type || 'image/jpeg' };
    }
  }
  return null;
}

async function handleLineart(req, res) {
  if (!process.env.GEMINI_API_KEY) {
    return json(res, 500, { code: 'GEMINI_KEY_MISSING', error: 'GEMINI_API_KEY가 설정되지 않았습니다. Render의 Environment에서 API 키를 입력해 주세요.' });
  }

  try {
    const body = await readJson(req);
    const { imageBase64, mimeType = 'image/png', settings = {} } = body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') return json(res, 400, { error: '이미지 데이터가 없습니다.' });
    if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) return json(res, 400, { error: '지원하지 않는 이미지 형식입니다.' });

    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash-preview-image-generation';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
    const payload = {
      contents: [{
        role: 'user',
        parts: [
          { text: buildPrompt(settings) },
          { inlineData: { mimeType, data: imageBase64 } }
        ]
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE']
      }
    };

    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await apiResponse.json().catch(() => ({}));
    if (!apiResponse.ok) {
      const mapped = mapGeminiError(apiResponse.status, data);
      return json(res, mapped.status, { code: mapped.code, error: mapped.error });
    }

    const image = extractImagePart(data);
    if (!image) return json(res, 502, { error: 'Gemini 응답에서 생성된 이미지를 찾지 못했습니다.' });
    return json(res, 200, { imageBase64: image.imageBase64, mimeType: image.mimeType, model });
  } catch (error) {
    console.error('[lineart]', error);
    return json(res, error.status || 500, { error: error.message || '서버 오류가 발생했습니다.' });
  }
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT, safePath);
  if (!filePath.startsWith(ROOT)) return json(res, 403, { error: 'Forbidden' });

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/status') {
    return json(res, 200, {
      configured: Boolean(process.env.GEMINI_API_KEY),
      provider: 'Gemini',
      model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash-preview-image-generation'
    });
  }
  if (req.method === 'POST' && req.url === '/api/lineart') return handleLineart(req, res);
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`LINEFORGE running: http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) console.warn('⚠ GEMINI_API_KEY is not set. Add it to Render Environment or .env.');
});
