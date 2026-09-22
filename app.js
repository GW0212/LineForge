const $ = (selector) => document.querySelector(selector);

const fileInput = $('#fileInput');
const dropzone = $('#dropzone');
const sourceStage = $('#sourceStage');
const sourceImage = $('#sourceImage');
const sourceMeta = $('#sourceMeta');
const resultStage = $('#resultStage');
const resultImage = $('#resultImage');
const loadingOverlay = $('#loadingOverlay');
const generateBtn = $('#generateBtn');
const resetBtn = $('#resetBtn');
const cropBtn = $('#cropBtn');
const compareBtn = $('#compareBtn');
const downloadBtn = $('#downloadBtn');
const statusBadge = $('#statusBadge');
const actionHintTitle = $('#actionHintTitle');
const actionHintText = $('#actionHintText');
const themeBtn = $('#themeBtn');
const helpBtn = $('#helpBtn');
const helpDialog = $('#helpDialog');
const cropDialog = $('#cropDialog');
const cropPreviewImage = $('#cropPreviewImage');
const cropStageInner = $('#cropStageInner');
const selectionLayer = $('#selectionLayer');
const selectionBox = $('#selectionBox');
const selectionSize = $('#selectionSize');
const cropCloseBtn = $('#cropCloseBtn');
const cancelCropBtn = $('#cancelCropBtn');
const selectAllBtn = $('#selectAllBtn');
const applyCropBtn = $('#applyCropBtn');
const lineWeight = $('#lineWeight');
const detailLevel = $('#detailLevel');
const styleSelect = $('#styleSelect');
const preserveDetails = $('#preserveDetails');
const lineWeightValue = $('#lineWeightValue');
const detailValue = $('#detailValue');
const toast = $('#toast');
const apiBadge = $('#apiBadge');

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MIN_SELECTION = 0.08;
const weightLabels = ['매우 얇게', '얇게', '보통', '굵게', '매우 굵게'];
const detailLabels = ['매우 단순', '단순', '균형', '정밀', '매우 정밀'];

const state = {
  originalName: '',
  originalSize: 0,
  fullCanvas: null,
  selectedCanvas: null,
  resultCanvas: null,
  sourceUrl: '',
  resultUrl: '',
  compareMode: false,
  processing: false,
  selection: { x: 0, y: 0, w: 1, h: 1 },
  drag: null
};

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('lineforge-theme', theme);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#10110f' : '#f5f5f3');
}

function toastMessage(message, duration = 2400) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastMessage.t);
  toastMessage.t = setTimeout(() => toast.classList.remove('show'), duration);
}

function setStatus(type, text) {
  statusBadge.className = `status-badge ${type}`;
  statusBadge.textContent = text;
}

function updateActionHint() {
  if (!state.fullCanvas) {
    actionHintTitle.textContent = '이미지를 먼저 업로드해 주세요.';
    actionHintText.textContent = 'API 없이 브라우저 안에서 선화 변환이 진행됩니다.';
    return;
  }
  const { width, height } = state.selectedCanvas || state.fullCanvas;
  actionHintTitle.textContent = '선택한 영역을 브라우저에서 바로 선화로 변환합니다.';
  actionHintText.textContent = `현재 선택 영역: ${width} × ${height} · 외부 API 없이 무료로 처리됩니다.`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isFullSelection() {
  const { x, y, w, h } = state.selection;
  return Math.abs(x) < 0.001 && Math.abs(y) < 0.001 && Math.abs(w - 1) < 0.001 && Math.abs(h - 1) < 0.001;
}

function dataUrlFromCanvas(canvas, type = 'image/png', quality = 0.96) {
  return canvas.toDataURL(type, quality);
}

function canvasToBlob(canvas, type = 'image/png', quality = 0.96) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('canvas blob 생성 실패')), type, quality);
  });
}

async function fileToImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function flattenImageToCanvas(file) {
  const img = await fileToImage(file);
  const maxSide = 2200;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

function updateSourceMeta() {
  if (!state.fullCanvas || !state.selectedCanvas) {
    sourceMeta.textContent = '';
    return;
  }
  const full = `${state.fullCanvas.width} × ${state.fullCanvas.height}`;
  const selected = `${state.selectedCanvas.width} × ${state.selectedCanvas.height}`;
  const selectionLabel = isFullSelection() ? '전체 이미지' : `선택 ${selected}`;
  sourceMeta.textContent = `${selectionLabel} · 원본 ${full} · ${formatBytes(state.originalSize)}`;
}

function updateSourcePreview() {
  if (!state.selectedCanvas) return;
  state.sourceUrl = dataUrlFromCanvas(state.selectedCanvas);
  sourceImage.src = state.sourceUrl;
  cropPreviewImage.src = dataUrlFromCanvas(state.fullCanvas);
  sourceStage.classList.remove('empty');
  updateSourceMeta();
  cropBtn.disabled = false;
  resetBtn.disabled = false;
  generateBtn.disabled = false;
  updateActionHint();
}

function clearResult() {
  state.resultCanvas = null;
  state.resultUrl = '';
  state.compareMode = false;
  resultImage.removeAttribute('src');
  resultStage.classList.add('empty');
  downloadBtn.disabled = true;
  compareBtn.disabled = true;
  compareBtn.querySelector('span').textContent = '원본 보기';
}

function resetAll(showMessage = true) {
  state.originalName = '';
  state.originalSize = 0;
  state.fullCanvas = null;
  state.selectedCanvas = null;
  state.resultCanvas = null;
  state.sourceUrl = '';
  state.resultUrl = '';
  state.compareMode = false;
  state.selection = { x: 0, y: 0, w: 1, h: 1 };
  state.drag = null;
  fileInput.value = '';
  sourceImage.removeAttribute('src');
  cropPreviewImage.removeAttribute('src');
  sourceMeta.textContent = '';
  sourceStage.classList.add('empty');
  clearResult();
  cropBtn.disabled = true;
  resetBtn.disabled = true;
  generateBtn.disabled = true;
  setStatus('idle', '대기 중');
  updateActionHint();
  if (showMessage) toastMessage('작업을 초기화했습니다.');
}

function renderSelection() {
  const s = state.selection;
  selectionBox.style.left = `${s.x * 100}%`;
  selectionBox.style.top = `${s.y * 100}%`;
  selectionBox.style.width = `${s.w * 100}%`;
  selectionBox.style.height = `${s.h * 100}%`;
  if (state.fullCanvas) {
    selectionSize.textContent = `${Math.max(1, Math.round(state.fullCanvas.width * s.w))} × ${Math.max(1, Math.round(state.fullCanvas.height * s.h))}`;
  }
}

function setFullSelection() {
  state.selection = { x: 0, y: 0, w: 1, h: 1 };
  renderSelection();
}

function getCroppedCanvas() {
  const source = state.fullCanvas;
  const { x, y, w, h } = state.selection;
  const sx = Math.max(0, Math.round(source.width * x));
  const sy = Math.max(0, Math.round(source.height * y));
  const sw = Math.max(1, Math.round(source.width * w));
  const sh = Math.max(1, Math.round(source.height * h));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

function enterCropMode() {
  if (!state.fullCanvas) return;
  cropPreviewImage.src = dataUrlFromCanvas(state.fullCanvas);
  renderSelection();
  if (!cropDialog.open) cropDialog.showModal();
}

function exitCropMode() {
  if (cropDialog.open) cropDialog.close();
}

async function applyCropSelection() {
  if (!state.fullCanvas) return;
  applyCropBtn.disabled = true;
  try {
    state.selectedCanvas = getCroppedCanvas();
    updateSourcePreview();
    clearResult();
    setStatus('idle', '변환 가능');
    exitCropMode();
    toastMessage(isFullSelection() ? '전체 이미지를 선택했습니다.' : '선택 영역을 적용했습니다.');
  } catch (error) {
    console.error(error);
    toastMessage('선택 영역을 적용하지 못했습니다.');
  } finally {
    applyCropBtn.disabled = false;
  }
}

function getPointerPoint(event) {
  const rect = selectionLayer.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
  };
}

function onSelectionPointerDown(event) {
  event.preventDefault();
  const handle = event.target.closest('[data-handle]')?.dataset.handle || 'move';
  const point = getPointerPoint(event);
  state.drag = {
    pointerId: event.pointerId,
    handle,
    start: point,
    initial: { ...state.selection }
  };
  selectionBox.setPointerCapture(event.pointerId);
}

function onSelectionPointerMove(event) {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  const point = getPointerPoint(event);
  const dx = point.x - state.drag.start.x;
  const dy = point.y - state.drag.start.y;
  const initial = state.drag.initial;

  if (state.drag.handle === 'move') {
    state.selection.x = clamp(initial.x + dx, 0, 1 - initial.w);
    state.selection.y = clamp(initial.y + dy, 0, 1 - initial.h);
  } else {
    let left = initial.x;
    let top = initial.y;
    let right = initial.x + initial.w;
    let bottom = initial.y + initial.h;

    if (state.drag.handle.includes('w')) left = clamp(initial.x + dx, 0, right - MIN_SELECTION);
    if (state.drag.handle.includes('e')) right = clamp(initial.x + initial.w + dx, left + MIN_SELECTION, 1);
    if (state.drag.handle.includes('n')) top = clamp(initial.y + dy, 0, bottom - MIN_SELECTION);
    if (state.drag.handle.includes('s')) bottom = clamp(initial.y + initial.h + dy, top + MIN_SELECTION, 1);

    state.selection.x = left;
    state.selection.y = top;
    state.selection.w = right - left;
    state.selection.h = bottom - top;
  }
  renderSelection();
}

function onSelectionPointerEnd(event) {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  try { selectionBox.releasePointerCapture(event.pointerId); } catch {}
  state.drag = null;
}

function downscaleCanvas(sourceCanvas, maxSide = 1600) {
  const { width, height } = sourceCanvas;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  if (scale >= 1) return sourceCanvas;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function buildSettings() {
  return {
    lineWeight: Number(lineWeight.value),
    detail: Number(detailLevel.value),
    style: styleSelect.value,
    preserveDetails: preserveDetails.checked
  };
}

function boxBlur(data, width, height, radius) {
  if (radius <= 0) return data.slice();
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let ix = -radius; ix <= radius; ix++) {
      sum += data[y * width + clamp(ix, 0, width - 1)];
    }
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / (radius * 2 + 1);
      const removeIndex = clamp(x - radius, 0, width - 1);
      const addIndex = clamp(x + radius + 1, 0, width - 1);
      sum += data[y * width + addIndex] - data[y * width + removeIndex];
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let iy = -radius; iy <= radius; iy++) {
      sum += tmp[clamp(iy, 0, height - 1) * width + x];
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / (radius * 2 + 1);
      const removeIndex = clamp(y - radius, 0, height - 1);
      const addIndex = clamp(y + radius + 1, 0, height - 1);
      sum += tmp[addIndex * width + x] - tmp[removeIndex * width + x];
    }
  }
  return out;
}

function computeSobel(gray, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = gray[i - width - 1];
      const tc = gray[i - width];
      const tr = gray[i - width + 1];
      const ml = gray[i - 1];
      const mr = gray[i + 1];
      const bl = gray[i + width - 1];
      const bc = gray[i + width];
      const br = gray[i + width + 1];
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

function removeSpeckles(mask, width, height, passes = 1) {
  let current = mask;
  for (let pass = 0; pass < passes; pass++) {
    const next = current.slice();
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (!current[i]) continue;
        let neighbors = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            if (current[(y + oy) * width + (x + ox)]) neighbors++;
          }
        }
        if (neighbors <= 1) next[i] = 0;
      }
    }
    current = next;
  }
  return current;
}

function dilate(mask, width, height, passes = 1) {
  let current = mask;
  for (let pass = 0; pass < passes; pass++) {
    const next = current.slice();
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (current[i]) continue;
        let neighbors = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            if (current[(y + oy) * width + (x + ox)]) neighbors++;
          }
        }
        if (neighbors >= 2) next[i] = 1;
      }
    }
    current = next;
  }
  return current;
}

function convertToLineArt(sourceCanvas, options) {
  const stylePresets = {
    tattoo: { edgeBase: 76, detailBase: 18, blurBase: 2.2, cleanup: 2, extraThick: 1 },
    contour: { edgeBase: 66, detailBase: 15, blurBase: 1.8, cleanup: 1, extraThick: 0 },
    technical: { edgeBase: 58, detailBase: 12, blurBase: 1.2, cleanup: 0, extraThick: 0 },
    minimal: { edgeBase: 85, detailBase: 20, blurBase: 2.9, cleanup: 2, extraThick: -1 }
  };
  const preset = stylePresets[options.style] || stylePresets.tattoo;

  const working = downscaleCanvas(sourceCanvas, 1600);
  const width = working.width;
  const height = working.height;
  const ctx = working.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, width, height);
  const src = imageData.data;
  const gray = new Float32Array(width * height);

  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    const r = src[i], g = src[i + 1], b = src[i + 2];
    gray[p] = r * 0.299 + g * 0.587 + b * 0.114;
  }

  const blurRadius = Math.max(1, Math.round(preset.blurBase + (5 - options.detail) * 0.6));
  const blurred = boxBlur(gray, width, height, blurRadius);
  const edges = computeSobel(blurred, width, height);
  const largeBlur = boxBlur(gray, width, height, blurRadius + 2);

  let maxEdge = 0;
  for (let i = 0; i < edges.length; i++) if (edges[i] > maxEdge) maxEdge = edges[i];
  maxEdge = Math.max(maxEdge, 1);

  const edgeThreshold = preset.edgeBase + (5 - options.detail) * 6;
  const detailThreshold = preset.detailBase + (5 - options.detail) * 1.4;
  const contrastThreshold = 9 + (5 - options.detail) * 1.2;
  const mask = new Uint8Array(width * height);

  for (let i = 0; i < gray.length; i++) {
    const edgeNorm = (edges[i] / maxEdge) * 255;
    const localContrast = Math.abs(gray[i] - blurred[i]);
    const shapeContrast = Math.abs(gray[i] - largeBlur[i]);
    let ink = edgeNorm > edgeThreshold;

    if (options.preserveDetails && edgeNorm > edgeThreshold * 0.45 && localContrast > detailThreshold) ink = true;
    if (options.style === 'tattoo' && shapeContrast > contrastThreshold + 10 && edgeNorm > edgeThreshold * 0.55) ink = true;
    if (options.style === 'technical' && localContrast > detailThreshold - 2 && edgeNorm > edgeThreshold * 0.35) ink = true;
    if (options.style === 'minimal' && edgeNorm < edgeThreshold + 12) ink = false;
    if (options.style === 'contour' && shapeContrast > contrastThreshold + 4 && edgeNorm > edgeThreshold * 0.5) ink = true;

    mask[i] = ink ? 1 : 0;
  }

  const cleanupPasses = preset.cleanup + (options.detail <= 2 ? 1 : 0);
  let processed = removeSpeckles(mask, width, height, cleanupPasses);
  const dilationPasses = Math.max(0, options.lineWeight - 2 + preset.extraThick);
  if (dilationPasses > 0) processed = dilate(processed, width, height, dilationPasses);
  processed = removeSpeckles(processed, width, height, 1);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  const outImage = outCtx.createImageData(width, height);
  const out = outImage.data;

  for (let i = 0, p = 0; p < processed.length; p++, i += 4) {
    const value = processed[p] ? 0 : 255;
    out[i] = value;
    out[i + 1] = value;
    out[i + 2] = value;
    out[i + 3] = 255;
  }
  outCtx.putImageData(outImage, 0, 0);
  return outCanvas;
}

async function handleFile(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    toastMessage('PNG, JPG, WEBP 이미지만 업로드할 수 있습니다.');
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    toastMessage('이미지 용량은 15MB 이하를 권장합니다.');
    return;
  }

  try {
    setStatus('working', '불러오는 중');
    const canvas = await flattenImageToCanvas(file);
    state.originalName = file.name || 'lineforge-image';
    state.originalSize = file.size;
    state.fullCanvas = canvas;
    state.selection = { x: 0, y: 0, w: 1, h: 1 };
    state.selectedCanvas = getCroppedCanvas();
    updateSourcePreview();
    clearResult();
    setStatus('idle', '변환 가능');
    enterCropMode();
    toastMessage('이미지를 불러왔습니다. 영역을 선택해 주세요.');
  } catch (error) {
    console.error(error);
    toastMessage('이미지를 읽는 중 오류가 발생했습니다.');
    setStatus('error', '오류');
  }
}

async function generateLineArt() {
  if (!state.selectedCanvas || state.processing) return;
  state.processing = true;
  generateBtn.disabled = true;
  loadingOverlay.classList.add('active');
  loadingOverlay.setAttribute('aria-hidden', 'false');
  setStatus('working', '변환 중');
  try {
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 20)));
    const outputCanvas = convertToLineArt(state.selectedCanvas, buildSettings());
    state.resultCanvas = outputCanvas;
    state.resultUrl = dataUrlFromCanvas(outputCanvas);
    resultImage.src = state.resultUrl;
    resultStage.classList.remove('empty');
    state.compareMode = false;
    compareBtn.querySelector('span').textContent = '원본 보기';
    compareBtn.disabled = false;
    downloadBtn.disabled = false;
    setStatus('ready', '완료');
    toastMessage('브라우저 선화 변환이 완료되었습니다.');
  } catch (error) {
    console.error(error);
    clearResult();
    setStatus('error', '오류');
    toastMessage('선화 변환 중 오류가 발생했습니다.');
  } finally {
    loadingOverlay.classList.remove('active');
    loadingOverlay.setAttribute('aria-hidden', 'true');
    generateBtn.disabled = !state.selectedCanvas;
    state.processing = false;
  }
}

function toggleCompare() {
  if (!state.resultCanvas || !state.selectedCanvas) return;
  state.compareMode = !state.compareMode;
  resultImage.src = state.compareMode ? state.sourceUrl : state.resultUrl;
  compareBtn.querySelector('span').textContent = state.compareMode ? '결과 보기' : '원본 보기';
}

async function downloadResult() {
  if (!state.resultCanvas) return;
  const blob = await canvasToBlob(state.resultCanvas, 'image/png', 0.96);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const baseName = (state.originalName || 'lineforge').replace(/\.[^.]+$/, '');
  a.href = url;
  a.download = `${baseName}-lineart.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// init
setTheme(localStorage.getItem('lineforge-theme') || 'light');
apiBadge.classList.add('ready');
apiBadge.querySelector('span').textContent = '브라우저 처리';
lineWeightValue.textContent = weightLabels[Number(lineWeight.value) - 1];
detailValue.textContent = detailLabels[Number(detailLevel.value) - 1];
updateActionHint();

// events
selectionBox.addEventListener('pointerdown', onSelectionPointerDown);
selectionBox.addEventListener('pointermove', onSelectionPointerMove);
selectionBox.addEventListener('pointerup', onSelectionPointerEnd);
selectionBox.addEventListener('pointercancel', onSelectionPointerEnd);

themeBtn.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
helpBtn.addEventListener('click', () => helpDialog.showModal());
helpDialog.addEventListener('click', (event) => {
  const rect = helpDialog.getBoundingClientRect();
  const inside = rect.top <= event.clientY && event.clientY <= rect.bottom && rect.left <= event.clientX && event.clientX <= rect.right;
  if (!inside) helpDialog.close();
});
cropDialog.addEventListener('click', (event) => {
  const rect = cropDialog.getBoundingClientRect();
  const inside = rect.top <= event.clientY && event.clientY <= rect.bottom && rect.left <= event.clientX && event.clientX <= rect.right;
  if (!inside) exitCropMode();
});
lineWeight.addEventListener('input', () => lineWeightValue.textContent = weightLabels[Number(lineWeight.value) - 1]);
detailLevel.addEventListener('input', () => detailValue.textContent = detailLabels[Number(detailLevel.value) - 1]);

['dragenter', 'dragover'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropzone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragging');
}));
dropzone.addEventListener('drop', (event) => {
  const file = event.dataTransfer.files?.[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
});

resetBtn.addEventListener('click', () => resetAll(true));
cropBtn.addEventListener('click', enterCropMode);
cropCloseBtn.addEventListener('click', exitCropMode);
cancelCropBtn.addEventListener('click', exitCropMode);
selectAllBtn.addEventListener('click', () => setFullSelection());
applyCropBtn.addEventListener('click', applyCropSelection);
generateBtn.addEventListener('click', generateLineArt);
compareBtn.addEventListener('click', toggleCompare);
downloadBtn.addEventListener('click', downloadResult);
