const $ = (sel) => document.querySelector(sel);
const fileInput = $('#fileInput');
const dropzone = $('#dropzone');
const sourceStage = $('#sourceStage');
const sourceStageInner = $('#sourceStageInner');
const sourceImage = $('#sourceImage');
const sourceMeta = $('#sourceMeta');
const resultStage = $('#resultStage');
const resultImage = $('#resultImage');
const loadingOverlay = $('#loadingOverlay');
const resetBtn = $('#resetBtn');
const cropBtn = $('#cropBtn');
const selectionLayer = $('#selectionLayer');
const selectionBox = $('#selectionBox');
const selectionSize = $('#selectionSize');
const selectionToolbar = $('#selectionToolbar');
const selectAllBtn = $('#selectAllBtn');
const cancelCropBtn = $('#cancelCropBtn');
const applyCropBtn = $('#applyCropBtn');
const generateBtn = $('#generateBtn');
const compareBtn = $('#compareBtn');
const downloadBtn = $('#downloadBtn');
const statusBadge = $('#statusBadge');
const apiBadge = $('#apiBadge');
const themeBtn = $('#themeBtn');
const helpBtn = $('#helpBtn');
const helpDialog = $('#helpDialog');
const lineWeight = $('#lineWeight');
const detailLevel = $('#detailLevel');
const lineWeightValue = $('#lineWeightValue');
const detailValue = $('#detailValue');
const styleSelect = $('#styleSelect');
const preserveDetails = $('#preserveDetails');
const actionHintTitle = $('#actionHintTitle');
const actionHintText = $('#actionHintText');
const toast = $('#toast');

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const MIN_SELECTION = 0.08;
const weightLabels = ['매우 얇게', '얇게', '보통', '굵게', '매우 굵게'];
const detailLabels = ['매우 단순', '단순', '균형', '정밀', '매우 정밀'];

let fullPreparedImage = null;
let preparedImage = null;
let sourceUrl = null;
let selectedPreviewUrl = null;
let resultUrl = null;
let resultBlob = null;
let apiConfigured = false;
let working = false;
let showingSourceInResult = false;
let cropEditing = false;
let selection = { x: 0, y: 0, w: 1, h: 1 };
let appliedSelection = { ...selection };
let dragState = null;
let originalFileSize = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('lineforge-theme', theme);
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#10110f' : '#f5f5f3';
}

function toastMessage(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastMessage.timer);
  toastMessage.timer = setTimeout(() => toast.classList.remove('show'), 2300);
}

function setStatus(type, text) {
  statusBadge.className = `status-badge ${type}`;
  statusBadge.textContent = text;
}

function isFullSelection(rect = appliedSelection) {
  return Math.abs(rect.x) < 0.001 && Math.abs(rect.y) < 0.001 && Math.abs(rect.w - 1) < 0.001 && Math.abs(rect.h - 1) < 0.001;
}

function updateActionHint() {
  if (!apiConfigured) {
    actionHintTitle.textContent = 'Gemini API 키 설정이 필요합니다.';
    actionHintText.textContent = '.env 파일에 GEMINI_API_KEY를 입력한 뒤 서버를 다시 실행하세요.';
    return;
  }
  if (!preparedImage) {
    actionHintTitle.textContent = '이미지를 먼저 업로드해 주세요.';
    actionHintText.textContent = '누끼 이미지는 투명 영역을 자동으로 흰색 처리합니다.';
    return;
  }
  actionHintTitle.textContent = isFullSelection() ? '전체 이미지를 변환합니다.' : '선택한 영역만 변환합니다.';
  actionHintText.textContent = isFullSelection()
    ? '필요하면 원본의 ‘영역 선택’에서 변환할 부분만 지정할 수 있습니다.'
    : `${preparedImage.width} × ${preparedImage.height}px 선택 영역이 적용되어 있습니다.`;
}

async function checkApi() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    const data = await response.json();
    apiConfigured = Boolean(data.configured);
    apiBadge.className = `api-badge ${apiConfigured ? 'ready' : 'error'}`;
    apiBadge.querySelector('span').textContent = apiConfigured ? 'API 연결됨' : 'API 키 필요';
  } catch {
    apiConfigured = false;
    apiBadge.className = 'api-badge error';
    apiBadge.querySelector('span').textContent = '서버 연결 실패';
  }
  generateBtn.disabled = !preparedImage || !apiConfigured || cropEditing;
  updateActionHint();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function convertImageBlobToPng(blob) {
  if (blob.type === 'image/png') return blob;

  let bitmap;
  try {
    if ('createImageBitmap' in window) {
      bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      return await new Promise((resolve, reject) => {
        canvas.toBlob((png) => png ? resolve(png) : reject(new Error('PNG 변환에 실패했습니다.')), 'image/png');
      });
    }
  } catch (error) {
    bitmap?.close?.();
    console.warn('createImageBitmap PNG conversion fallback:', error);
  }

  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((png) => {
          URL.revokeObjectURL(url);
          png ? resolve(png) : reject(new Error('PNG 변환에 실패했습니다.'));
        }, 'image/png');
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('결과 이미지를 읽지 못했습니다.'));
    };
    img.src = url;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function flattenTransparency(file) {
  const bitmap = await createImageBitmap(file);
  const maxSide = 2048;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);

  let hadTransparency = false;
  if (file.type === 'image/png' || file.type === 'image/webp') {
    const sample = document.createElement('canvas');
    sample.width = Math.min(width, 500);
    sample.height = Math.max(1, Math.round(height * sample.width / width));
    const sctx = sample.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(bitmap, 0, 0, sample.width, sample.height);
    const pixels = sctx.getImageData(0, 0, sample.width, sample.height).data;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 250) { hadTransparency = true; break; }
    }
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('이미지 전처리에 실패했습니다.')), 'image/png', 0.95);
  });
  const base64 = await blobToBase64(blob);
  bitmap.close?.();
  return { blob, base64, mimeType: 'image/png', width, height, hadTransparency };
}

async function cropPreparedImage(source, rect) {
  if (isFullSelection(rect)) return source;
  const bitmap = await createImageBitmap(source.blob);
  const sx = Math.round(rect.x * source.width);
  const sy = Math.round(rect.y * source.height);
  const sw = Math.max(1, Math.round(rect.w * source.width));
  const sh = Math.max(1, Math.round(rect.h * source.height));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('선택 영역을 처리하지 못했습니다.')), 'image/png', 0.95);
  });
  const base64 = await blobToBase64(blob);
  bitmap.close?.();
  return {
    blob,
    base64,
    mimeType: 'image/png',
    width: sw,
    height: sh,
    hadTransparency: source.hadTransparency
  };
}

function updateSelectedPreview() {
  if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
  selectedPreviewUrl = preparedImage ? URL.createObjectURL(preparedImage.blob) : null;
}

function updateSourceMeta(fileSize) {
  if (!fullPreparedImage) return;
  const base = `${fullPreparedImage.width} × ${fullPreparedImage.height}`;
  const transparency = fullPreparedImage.hadTransparency ? ' · 투명 배경 감지' : '';
  const selectionText = !isFullSelection() && preparedImage
    ? ` · 선택 ${preparedImage.width} × ${preparedImage.height}`
    : '';
  const sizeText = fileSize ? ` · ${formatBytes(fileSize)}` : '';
  sourceMeta.textContent = `${base}${sizeText}${transparency}${selectionText}`;
}

function clearResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null;
  resultBlob = null;
  resultImage.removeAttribute('src');
  resultStage.classList.add('empty');
  compareBtn.disabled = true;
  downloadBtn.disabled = true;
  showingSourceInResult = false;
  compareBtn.querySelector('span').textContent = '원본 보기';
}

async function handleFile(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    toastMessage('PNG, JPG, WEBP 이미지만 사용할 수 있습니다.');
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    toastMessage('이미지는 12MB 이하를 권장합니다.');
    return;
  }

  try {
    fullPreparedImage = await flattenTransparency(file);
    originalFileSize = file.size;
    preparedImage = fullPreparedImage;
    selection = { x: 0, y: 0, w: 1, h: 1 };
    appliedSelection = { ...selection };
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = URL.createObjectURL(file);
    sourceImage.src = sourceUrl;
    sourceStage.classList.remove('empty');
    updateSelectedPreview();
    updateSourceMeta(originalFileSize);
    resetBtn.disabled = false;
    cropBtn.disabled = false;
    clearResult();
    setStatus('idle', '변환 가능');
    generateBtn.disabled = !apiConfigured;
    updateActionHint();
    requestAnimationFrame(updateSelectionLayerGeometry);
    toastMessage(fullPreparedImage.hadTransparency ? '투명 배경을 흰색으로 정리했습니다.' : '이미지를 불러왔습니다.');
  } catch (error) {
    console.error(error);
    toastMessage('이미지를 불러오지 못했습니다.');
  }
}

function resetAll() {
  exitCropMode(false);
  fullPreparedImage = null;
  preparedImage = null;
  originalFileSize = 0;
  fileInput.value = '';
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = null;
  if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
  selectedPreviewUrl = null;
  sourceImage.removeAttribute('src');
  sourceMeta.textContent = '';
  sourceStage.classList.add('empty');
  selectionLayer.classList.remove('visible', 'editing');
  clearResult();
  resetBtn.disabled = true;
  cropBtn.disabled = true;
  generateBtn.disabled = true;
  setStatus('idle', '대기 중');
  updateActionHint();
  toastMessage('초기화했습니다.');
}

function buildSettings() {
  return {
    lineWeight: Number(lineWeight.value),
    detail: Number(detailLevel.value),
    style: styleSelect.value,
    preserveDetails: preserveDetails.checked,
    sourceHadTransparency: Boolean(fullPreparedImage?.hadTransparency)
  };
}

function updateSelectionLayerGeometry() {
  if (!fullPreparedImage || sourceStage.classList.contains('empty')) return;
  const box = sourceStageInner.getBoundingClientRect();
  const iw = fullPreparedImage.width;
  const ih = fullPreparedImage.height;
  const scale = Math.min(box.width / iw, box.height / ih);
  const width = iw * scale;
  const height = ih * scale;
  const left = (box.width - width) / 2;
  const top = (box.height - height) / 2;
  Object.assign(selectionLayer.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`
  });
  renderSelection();
}

function renderSelection() {
  selectionBox.style.left = `${selection.x * 100}%`;
  selectionBox.style.top = `${selection.y * 100}%`;
  selectionBox.style.width = `${selection.w * 100}%`;
  selectionBox.style.height = `${selection.h * 100}%`;
  if (fullPreparedImage) {
    const pxW = Math.max(1, Math.round(selection.w * fullPreparedImage.width));
    const pxH = Math.max(1, Math.round(selection.h * fullPreparedImage.height));
    selectionSize.textContent = `${pxW} × ${pxH}`;
  }
}

function enterCropMode() {
  if (!fullPreparedImage || working) return;
  cropEditing = true;
  selection = { ...appliedSelection };
  updateSelectionLayerGeometry();
  selectionLayer.classList.add('visible', 'editing');
  selectionLayer.setAttribute('aria-hidden', 'false');
  selectionToolbar.classList.add('visible');
  selectionToolbar.setAttribute('aria-hidden', 'false');
  cropBtn.disabled = true;
  resetBtn.disabled = true;
  generateBtn.disabled = true;
  renderSelection();
}

function exitCropMode(restore = true) {
  if (!cropEditing && !selectionToolbar.classList.contains('visible')) return;
  cropEditing = false;
  if (restore) selection = { ...appliedSelection };
  selectionLayer.classList.remove('visible', 'editing');
  selectionLayer.setAttribute('aria-hidden', 'true');
  selectionToolbar.classList.remove('visible');
  selectionToolbar.setAttribute('aria-hidden', 'true');
  cropBtn.disabled = !fullPreparedImage;
  resetBtn.disabled = !fullPreparedImage;
  generateBtn.disabled = !preparedImage || !apiConfigured;
}

async function applySelection() {
  if (!fullPreparedImage) return;
  applyCropBtn.disabled = true;
  try {
    appliedSelection = { ...selection };
    preparedImage = await cropPreparedImage(fullPreparedImage, appliedSelection);
    updateSelectedPreview();
    updateSourceMeta(originalFileSize);
    clearResult();
    setStatus('idle', '변환 가능');
    exitCropMode(false);
    updateActionHint();
    toastMessage(isFullSelection() ? '전체 이미지를 선택했습니다.' : '선택 영역을 적용했습니다.');
  } catch (error) {
    console.error(error);
    toastMessage('선택 영역을 적용하지 못했습니다.');
  } finally {
    applyCropBtn.disabled = false;
  }
}

function getPointerInSelectionLayer(event) {
  const rect = selectionLayer.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
  };
}

selectionBox.addEventListener('pointerdown', (event) => {
  if (!cropEditing) return;
  event.preventDefault();
  const handle = event.target.closest('[data-handle]')?.dataset.handle || 'move';
  const point = getPointerInSelectionLayer(event);
  dragState = {
    pointerId: event.pointerId,
    handle,
    start: point,
    initial: { ...selection }
  };
  selectionBox.setPointerCapture(event.pointerId);
});

selectionBox.addEventListener('pointermove', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  event.preventDefault();
  const point = getPointerInSelectionLayer(event);
  const dx = point.x - dragState.start.x;
  const dy = point.y - dragState.start.y;
  const initial = dragState.initial;

  if (dragState.handle === 'move') {
    selection.x = clamp(initial.x + dx, 0, 1 - initial.w);
    selection.y = clamp(initial.y + dy, 0, 1 - initial.h);
  } else {
    let left = initial.x;
    let top = initial.y;
    let right = initial.x + initial.w;
    let bottom = initial.y + initial.h;

    if (dragState.handle.includes('w')) left = clamp(initial.x + dx, 0, right - MIN_SELECTION);
    if (dragState.handle.includes('e')) right = clamp(initial.x + initial.w + dx, left + MIN_SELECTION, 1);
    if (dragState.handle.includes('n')) top = clamp(initial.y + dy, 0, bottom - MIN_SELECTION);
    if (dragState.handle.includes('s')) bottom = clamp(initial.y + initial.h + dy, top + MIN_SELECTION, 1);

    selection.x = left;
    selection.y = top;
    selection.w = right - left;
    selection.h = bottom - top;
  }
  renderSelection();
});

function endPointer(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  try { selectionBox.releasePointerCapture(event.pointerId); } catch {}
  dragState = null;
}
selectionBox.addEventListener('pointerup', endPointer);
selectionBox.addEventListener('pointercancel', endPointer);

setTheme(localStorage.getItem('lineforge-theme') || 'light');
checkApi();
lineWeightValue.textContent = weightLabels[Number(lineWeight.value) - 1];
detailValue.textContent = detailLabels[Number(detailLevel.value) - 1];

themeBtn.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
helpBtn.addEventListener('click', () => helpDialog.showModal());
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

resetBtn.addEventListener('click', resetAll);
cropBtn.addEventListener('click', enterCropMode);
cancelCropBtn.addEventListener('click', () => exitCropMode(true));
selectAllBtn.addEventListener('click', () => {
  selection = { x: 0, y: 0, w: 1, h: 1 };
  renderSelection();
});
applyCropBtn.addEventListener('click', applySelection);

window.addEventListener('resize', () => {
  if (fullPreparedImage) requestAnimationFrame(updateSelectionLayerGeometry);
});
sourceImage.addEventListener('load', () => requestAnimationFrame(updateSelectionLayerGeometry));

generateBtn.addEventListener('click', async () => {
  if (!preparedImage || working || cropEditing) return;
  if (!apiConfigured) {
    toastMessage('Gemini API 키를 먼저 설정해 주세요.');
    return;
  }

  working = true;
  generateBtn.disabled = true;
  resetBtn.disabled = true;
  cropBtn.disabled = true;
  loadingOverlay.classList.add('active');
  loadingOverlay.setAttribute('aria-hidden', 'false');
  resultStage.classList.remove('empty');
  setStatus('working', '변환 중');

  try {
    const response = await fetch('/api/lineart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: preparedImage.base64,
        mimeType: preparedImage.mimeType,
        settings: buildSettings()
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (!payload.imageBase64) throw new Error('결과 이미지를 받지 못했습니다.');

    const bytes = Uint8Array.from(atob(payload.imageBase64), (c) => c.charCodeAt(0));
    const apiImageBlob = new Blob([bytes], { type: payload.mimeType || 'image/jpeg' });
    resultBlob = await convertImageBlobToPng(apiImageBlob);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(resultBlob);
    resultImage.src = resultUrl;
    showingSourceInResult = false;
    compareBtn.querySelector('span').textContent = '원본 보기';
    compareBtn.disabled = false;
    downloadBtn.disabled = false;
    setStatus('ready', '완료');
    toastMessage('라인아트 변환이 완료되었습니다.');
  } catch (error) {
    console.error(error);
    clearResult();
    setStatus('error', '오류');
    toastMessage(error.message || '변환 중 오류가 발생했습니다.');
  } finally {
    loadingOverlay.classList.remove('active');
    loadingOverlay.setAttribute('aria-hidden', 'true');
    working = false;
    generateBtn.disabled = !preparedImage || !apiConfigured;
    resetBtn.disabled = !preparedImage;
    cropBtn.disabled = !preparedImage;
  }
});

compareBtn.addEventListener('click', () => {
  if (!selectedPreviewUrl || !resultUrl) return;
  showingSourceInResult = !showingSourceInResult;
  resultImage.src = showingSourceInResult ? selectedPreviewUrl : resultUrl;
  compareBtn.querySelector('span').textContent = showingSourceInResult ? '결과 보기' : '원본 보기';
});

downloadBtn.addEventListener('click', () => {
  if (!resultUrl || !resultBlob) return;
  const link = document.createElement('a');
  link.href = resultUrl;
  link.download = `lineforge-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
});

window.addEventListener('beforeunload', () => {
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
  if (resultUrl) URL.revokeObjectURL(resultUrl);
});
