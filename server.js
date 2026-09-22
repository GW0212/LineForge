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
    1: 'very thin, delicate lines around 0.5 to 0.8 px in appearance',
    2: 'thin clean lines',
    3: 'medium clean line weight suitable for a tattoo stencil',
    4: 'bold clear lines',
    5: 'very bold, strongly readable contour lines'
  };
  const details = {
    1: 'extremely simplified; keep only the most essential silhouette and a few defining contours',
    2: 'simplified; keep major internal structure but remove small texture',
    3: 'balanced detail; preserve defining facial/object features and major folds or patterns',
    4: 'detailed; preserve meaningful internal edges, anatomy, folds, and patterns while avoiding noise',
    5: 'highly detailed linework; preserve most meaningful structural details but never use grayscale shading or hatching noise'
  };
  const styles = {
    tattoo: 'professional tattoo stencil / tattoo transfer outline',
    contour: 'clean contour drawing with smooth continuous outlines',
    technical: 'precise black-and-white design drawing with controlled structural lines',
    minimal: 'minimalist single-ink line illustration with very clean negative space'
  };

  return `Transform the provided image into a clean ${styles[settings.style] || styles.tattoo}.

STRICT OUTPUT RULES:
- White background (#FFFFFF) only.
- Black linework (#000000) only. No color, no gray fills, no gradients, no shadows, no realistic rendering.
- Preserve the original subject's silhouette, proportions, pose, composition, important shapes and recognizable features.
- Use ${weights[settings.lineWeight] || weights[3]}.
- Detail level: ${details[settings.detail] || details[3]}.
- ${settings.preserveDetails ? 'Preserve important internal detail lines such as eyes, facial features, seams, folds, object boundaries, pattern-defining edges and essential texture boundaries.' : 'Remove most internal detail; prioritize silhouette and only indispensable interior contours.'}
- Do not invent decorations, text, symbols, borders, backgrounds, extra objects or missing anatomy.
- Do not crop the subject unless the source itself is cropped.
- Keep large white negative-space areas completely clean.
- The source image has already been composited onto white where it was transparent. Treat white/transparent-origin background as EMPTY SPACE: do not trace the rectangular image boundary and do not add outlines around the empty background.
- If the subject has detached transparent cut-out edges, trace only the visible subject edge, not any former background.
- Avoid dense cross-hatching, pencil texture, stippling and sketch construction lines.
- The result should be directly usable as a clean tattoo stencil / base tracing reference.

Return only the edited image.`;
}

async function handleLineart(req, res) {
  if (!process.env.GEMINI_API_KEY) {
    return json(res, 500, { error: 'GEMINI_API_KEY가 설정되지 않았습니다. .env 파일을 확인해 주세요.' });
  }

  try {
    const body = await readJson(req);
    const { imageBase64, mimeType = 'image/png', settings = {} } = body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') return json(res, 400, { error: '이미지 데이터가 없습니다.' });
    if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) return json(res, 400, { error: '지원하지 않는 이미지 형식입니다.' });

    const apiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'x-goog-api-key': process.env.GEMINI_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image',
        input: [
          { type: 'image', mime_type: mimeType, data: imageBase64 },
          { type: 'text', text: buildPrompt(settings) }
        ],
        response_format: {
          type: 'image',
          mime_type: 'image/jpeg',
          image_size: process.env.GEMINI_IMAGE_SIZE || '2K'
        }
      })
    });

    const data = await apiResponse.json().catch(() => ({}));
    if (!apiResponse.ok) {
      const message = data?.error?.message || data?.message || `Gemini API 오류 (${apiResponse.status})`;
      return json(res, apiResponse.status, { error: message });
    }

    let image = data?.output_image;
    if (!image?.data && Array.isArray(data?.steps)) {
      outer: for (const step of data.steps) {
        for (const content of step?.content || []) {
          if (content?.type === 'image' && content?.data) {
            image = content;
            break outer;
          }
        }
      }
    }

    if (!image?.data) return json(res, 502, { error: 'Gemini 응답에서 생성된 이미지를 찾지 못했습니다.' });
    return json(res, 200, { imageBase64: image.data, mimeType: image.mime_type || 'image/jpeg' });
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
    return json(res, 200, { configured: Boolean(process.env.GEMINI_API_KEY), model: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image' });
  }
  if (req.method === 'POST' && req.url === '/api/lineart') return handleLineart(req, res);
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`LINEFORGE running: http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) console.warn('⚠ GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.');
});
