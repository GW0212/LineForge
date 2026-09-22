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
const selectionHint = $('#selectionHint');
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
const MIN_SELECTION = 0.05;
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
  selection: null,
  cropViewport: null,
  drag: null,
  apiConfigured: false,
  apiModel: ''
};

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('lineforge-theme', theme);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#10110f' : '#f5f5f3');
}

function toastMessage(message, duration = 2600) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastMessage.t);
  toastMessage.t = setTimeout(() => toast.classList.remove('show'), duration);
}

function setStatus(type, text) {
  statusBadge.className = `status-badge ${type}`;
  statusBadge.textContent = text;
}

function updateApiBadge(configured, model = '') {
  state.apiConfigured = configured;
  state.apiModel = model || '';
  apiBadge.classList.remove('ready', 'warning');
  if (configured) {
    apiBadge.classList.add('ready');
    apiBadge.innerHTML = '<i></i><span>API 연결됨</span>';
  } else {
    apiBadge.classList.add('warning');
    apiBadge.innerHTML = '<i></i><span>API 미연결</span>';
  }
}

function updateActionHint() {
  if (!state.fullCanvas) {
    actionHintTitle.textContent = '이미지를 먼저 업로드해 주세요.';
    actionHintText.textContent = state.apiConfigured
      ? 'Gemini API로 선택한 영역을 라인아트로 변환합니다.'
      : 'Render 환경변수의 GEMINI_API_KEY 연결 여부를 먼저 확인해 주세요.';
    return;
  }
  const activeCanvas = state.selectedCanvas || state.fullCanvas;
  const { width, height } = activeCanvas;
  const selectionText = state.selection ? `선택 영역 ${width} × ${height}` : `전체 이미지 ${width} × ${height}`;
  actionHintTitle.textContent = '선택한 영역만 Gemini API로 변환합니다.';
  actionHintText.textContent = `${selectionText} · ${state.apiModel || 'Gemini 이미지 모델'} · 흰 배경 + 검은 선 중심으로 정리합니다.`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hasSelection() {
  return !!state.selection && state.selection.w > 0 && state.selection.h > 0;
}

function isFullSelection() {
  if (!hasSelection()) return true;
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

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function imageBase64FromCanvas(canvas) {
  const blob = await canvasToBlob(canvas, 'image/png', 0.96);
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fileToImage(file) {
  const url = URL.createObjectURL(file);
  try {
    return await loadImage(url);
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
  const selectionLabel = !hasSelection() || isFullSelection() ? '전체 이미지' : `선택 ${selected}`;
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
  generateBtn.disabled = !state.apiConfigured;
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
  state.selection = null;
  state.cropViewport = null;
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
  renderSelection();
  if (showMessage) toastMessage('작업을 초기화했습니다.');
}

function updateCropViewport() {
  if (!state.fullCanvas) return;
  const stageRect = cropStageInner.getBoundingClientRect();
  const stageW = stageRect.width;
  const stageH = stageRect.height;
  const imgW = state.fullCanvas.width;
  const imgH = state.fullCanvas.height;
  const scale = Math.min(stageW / imgW, stageH / imgH);
  const width = imgW * scale;
  const height = imgH * scale;
  const left = (stageW - width) / 2;
  const top = (stageH - height) / 2;
  state.cropViewport = { left, top, width, height };
  selectionLayer.style.left = `${left}px`;
  selectionLayer.style.top = `${top}px`;
  selectionLayer.style.width = `${width}px`;
  selectionLayer.style.height = `${height}px`;
  renderSelection();
}

function renderSelection() {
  if (!hasSelection()) {
    selectionBox.style.display = 'none';
    selectionHint.hidden = false;
    return;
  }
  const s = state.selection;
  selectionBox.style.display = 'block';
  selectionHint.hidden = true;
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

function getActiveSelectionOrFull() {
  return hasSelection() ? state.selection : { x: 0, y: 0, w: 1, h: 1 };
}

function getCroppedCanvas() {
  const source = state.fullCanvas;
  const { x, y, w, h } = getActiveSelectionOrFull();
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
  if (!cropDialog.open) cropDialog.showModal();
  requestAnimationFrame(updateCropViewport);
  renderSelection();
}

function exitCropMode() {
  if (cropDialog.open) cropDialog.close();
}

async function applyCropSelection() {
  if (!state.fullCanvas) return;
  applyCropBtn.disabled = true;
  try {
    if (!hasSelection()) {
      toastMessage('이미지 위를 드래그해서 영역을 먼저 선택해 주세요.');
      return;
    }
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

function startSelectionDrag(event) {
  if (!state.fullCanvas) return;
  const point = getPointerPoint(event);
  const handle = event.target.closest('[data-handle]')?.dataset.handle;
  const onExistingBox = event.target === selectionBox || event.target.closest('#selectionBox');

  if (handle && hasSelection()) {
    state.drag = { pointerId: event.pointerId, mode: 'resize', handle, start: point, initial: { ...state.selection } };
  } else if (onExistingBox && hasSelection()) {
    state.drag = { pointerId: event.pointerId, mode: 'move', start: point, initial: { ...state.selection } };
  } else {
    state.selection = { x: point.x, y: point.y, w: 0, h: 0 };
    state.drag = { pointerId: event.pointerId, mode: 'create', start: point };
    renderSelection();
  }

  selectionLayer.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onSelectionPointerMove(event) {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  const point = getPointerPoint(event);
  const initial = state.drag.initial;

  if (state.drag.mode === 'create') {
    const left = Math.min(state.drag.start.x, point.x);
    const top = Math.min(state.drag.start.y, point.y);
    const right = Math.max(state.drag.start.x, point.x);
    const bottom = Math.max(state.drag.start.y, point.y);
    state.selection = { x: left, y: top, w: right - left, h: bottom - top };
  } else if (state.drag.mode === 'move' && initial) {
    const dx = point.x - state.drag.start.x;
    const dy = point.y - state.drag.start.y;
    state.selection.x = clamp(initial.x + dx, 0, 1 - initial.w);
    state.selection.y = clamp(initial.y + dy, 0, 1 - initial.h);
    state.selection.w = initial.w;
    state.selection.h = initial.h;
  } else if (state.drag.mode === 'resize' && initial) {
    let left = initial.x;
    let top = initial.y;
    let right = initial.x + initial.w;
    let bottom = initial.y + initial.h;
    if (state.drag.handle.includes('w')) left = clamp(point.x, 0, right - MIN_SELECTION);
    if (state.drag.handle.includes('e')) right = clamp(point.x, left + MIN_SELECTION, 1);
    if (state.drag.handle.includes('n')) top = clamp(point.y, 0, bottom - MIN_SELECTION);
    if (state.drag.handle.includes('s')) bottom = clamp(point.y, top + MIN_SELECTION, 1);
    state.selection = { x: left, y: top, w: right - left, h: bottom - top };
  }

  renderSelection();
  event.preventDefault();
}

function onSelectionPointerEnd(event) {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  try { selectionLayer.releasePointerCapture(event.pointerId); } catch {}
  if (state.drag.mode === 'create' && state.selection) {
    if (state.selection.w < 0.01 || state.selection.h < 0.01) {
      state.selection = null;
      toastMessage('드래그해서 선택 박스를 만들어 주세요.');
    } else {
      state.selection.w = Math.max(state.selection.w, MIN_SELECTION);
      state.selection.h = Math.max(state.selection.h, MIN_SELECTION);
      state.selection.x = clamp(state.selection.x, 0, 1 - state.selection.w);
      state.selection.y = clamp(state.selection.y, 0, 1 - state.selection.h);
    }
  }
  state.drag = null;
  renderSelection();
}

function buildSettings() {
  return {
    lineWeight: Number(lineWeight.value),
    detail: Number(detailLevel.value),
    style: styleSelect.value,
    preserveDetails: preserveDetails.checked
  };
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
    state.selection = null;
    state.selectedCanvas = canvas;
    updateSourcePreview();
    clearResult();
    setStatus('idle', state.apiConfigured ? '변환 가능' : 'API 확인 필요');
    enterCropMode();
    toastMessage('이미지를 불러왔습니다. 드래그해서 변환할 영역을 선택해 주세요.');
  } catch (error) {
    console.error(error);
    toastMessage('이미지를 읽는 중 오류가 발생했습니다.');
    setStatus('error', '오류');
  }
}

async function renderCanvasFromBase64(imageBase64, mimeType = 'image/jpeg') {
  const image = await loadImage(`data:${mimeType};base64,${imageBase64}`);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  return canvas;
}

async function generateLineArt() {
  if (!state.selectedCanvas || state.processing) return;
  if (!state.apiConfigured) {
    toastMessage('Gemini API가 연결되지 않았습니다. Render의 GEMINI_API_KEY를 확인해 주세요.');
    return;
  }

  state.processing = true;
  generateBtn.disabled = true;
  loadingOverlay.classList.add('active');
  loadingOverlay.setAttribute('aria-hidden', 'false');
  setStatus('working', '변환 중');

  try {
    const imageBase64 = await imageBase64FromCanvas(state.selectedCanvas);
    const response = await fetch('/api/lineart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64,
        mimeType: 'image/png',
        width: state.selectedCanvas.width,
        height: state.selectedCanvas.height,
        settings: buildSettings()
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Gemini API 변환에 실패했습니다.');
    if (!data.imageBase64) throw new Error('Gemini 응답에서 이미지 데이터를 찾지 못했습니다.');

    const outputCanvas = await renderCanvasFromBase64(data.imageBase64, data.mimeType || 'image/jpeg');
    state.resultCanvas = outputCanvas;
    state.resultUrl = dataUrlFromCanvas(outputCanvas);
    resultImage.src = state.resultUrl;
    resultStage.classList.remove('empty');
    state.compareMode = false;
    compareBtn.querySelector('span').textContent = '원본 보기';
    compareBtn.disabled = false;
    downloadBtn.disabled = false;
    setStatus('ready', '완료');
    toastMessage('Gemini 라인아트 변환이 완료되었습니다.');
  } catch (error) {
    console.error(error);
    clearResult();
    setStatus('error', '오류');
    toastMessage(error.message || '선화 변환 중 오류가 발생했습니다.', 3400);
  } finally {
    loadingOverlay.classList.remove('active');
    loadingOverlay.setAttribute('aria-hidden', 'true');
    generateBtn.disabled = !state.selectedCanvas || !state.apiConfigured;
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

async function fetchStatus() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    const data = await response.json();
    updateApiBadge(Boolean(data.configured), data.model || '');
    updateActionHint();
    if (!data.configured) setStatus('error', 'API 확인 필요');
  } catch {
    updateApiBadge(false);
    updateActionHint();
    setStatus('error', '서버 확인 필요');
  }
}

setTheme(localStorage.getItem('lineforge-theme') || 'light');
lineWeightValue.textContent = weightLabels[Number(lineWeight.value) - 1];
detailValue.textContent = detailLabels[Number(detailLevel.value) - 1];
renderSelection();
fetchStatus();

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

selectionLayer.addEventListener('pointerdown', startSelectionDrag);
selectionLayer.addEventListener('pointermove', onSelectionPointerMove);
selectionLayer.addEventListener('pointerup', onSelectionPointerEnd);
selectionLayer.addEventListener('pointercancel', onSelectionPointerEnd);
window.addEventListener('resize', () => { if (cropDialog.open) updateCropViewport(); });

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
selectAllBtn.addEventListener('click', () => { setFullSelection(); toastMessage('전체 영역을 선택했습니다.'); });
applyCropBtn.addEventListener('click', applyCropSelection);
generateBtn.addEventListener('click', generateLineArt);
compareBtn.addEventListener('click', toggleCompare);
downloadBtn.addEventListener('click', downloadResult);
