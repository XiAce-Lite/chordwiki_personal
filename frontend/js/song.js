/*
 * 動作確認メモ
 * - 曲ページを開き、譜面左側に Start / End ピンが表示されることを確認する。
 * - 分・秒を変更すると即保存され、状態表示が Saved になることを確認する。
 * - Start で自動スクロールを開始し、再生中にマーカーを動かしても止まらず再計算されることを確認する。
 * - End マーカーが画面内に入った時点で自動停止することを確認する。
 */
let originalChordPro = '';
let transposeSemitones = 0;

const MIN_TRANSPOSE = -6;
const MAX_TRANSPOSE = 6;
const DEFAULT_DURATION_SEC = 4 * 60;
const START_SCROLL_TOLERANCE_PX = 10;
const AUTO_SCROLL_STORAGE_PREFIX = 'autoscroll:v1';

const autoScrollState = {
  storageKey: null,
  defaultStartY: null,
  defaultEndY: null,
  startY: null,
  endY: null,
  durationSec: DEFAULT_DURATION_SEC,
  isPlaying: false,
  frameId: null,
  startedAtMs: 0,
  lastFrameMs: 0,
  speedPxPerSec: 0,
  virtualScrollY: 0,
  dragging: null,
  hasLoadedSavedState: false
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampTranspose(value) {
  return Math.max(MIN_TRANSPOSE, Math.min(MAX_TRANSPOSE, value));
}

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function getSongStorageKey(artist, id) {
  return `${AUTO_SCROLL_STORAGE_PREFIX}:${artist}:${id}`;
}

function updateEditLink(artist, id) {
  const editLinkEl = document.getElementById('edit-link');
  if (!editLinkEl) {
    return;
  }

  if (!artist || !id) {
    editLinkEl.hidden = true;
    return;
  }

  editLinkEl.hidden = false;
  editLinkEl.href = `/edit.html?mode=edit&artist=${encodeURIComponent(artist)}&id=${encodeURIComponent(id)}`;
}

function getSheetEl() {
  return document.getElementById('sheet');
}

function getMarkerLayerEl() {
  return document.getElementById('autoscroll-marker-layer');
}

function getEndMarkerEl() {
  return getMarkerLayerEl()?.querySelector('[data-marker="end"]') || null;
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getMaxWindowScrollY() {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

function getReachableScrollY(targetY) {
  if (!Number.isFinite(targetY)) {
    return 0;
  }

  return clamp(targetY, 0, getMaxWindowScrollY());
}

function getSheetBoundsDoc() {
  const sheetEl = getSheetEl();
  if (!sheetEl) {
    return null;
  }

  const rect = sheetEl.getBoundingClientRect();
  return {
    top: rect.top + window.scrollY,
    bottom: rect.bottom + window.scrollY,
    height: rect.height
  };
}

function getDefaultMarkerPositions() {
  const sheetEl = getSheetEl();
  const bounds = getSheetBoundsDoc();

  if (!sheetEl || !bounds) {
    autoScrollState.defaultStartY = 0;
    autoScrollState.defaultEndY = 0;
    return { startY: 0, endY: 0 };
  }

  const lines = sheetEl.querySelectorAll('.cw-line');
  const defaults = !lines.length
    ? { startY: bounds.top, endY: bounds.bottom }
    : {
        startY: lines[0].getBoundingClientRect().top + window.scrollY,
        endY: lines[lines.length - 1].getBoundingClientRect().bottom + window.scrollY
      };

  autoScrollState.defaultStartY = defaults.startY;
  autoScrollState.defaultEndY = defaults.endY;
  return defaults;
}

function clampMarkerToSheet(y, fallbackY = 0) {
  const bounds = getSheetBoundsDoc();
  if (!bounds) {
    return fallbackY;
  }

  const candidate = Number.isFinite(y) ? y : fallbackY;
  return clamp(candidate, bounds.top, bounds.bottom);
}

function getRangeDistancePx() {
  if (!Number.isFinite(autoScrollState.startY) || !Number.isFinite(autoScrollState.endY)) {
    return 0;
  }

  return Math.max(0, Math.round(autoScrollState.endY - autoScrollState.startY));
}

function setStatus(message, tone = 'info') {
  const statusEl = document.getElementById('autoscroll-status');
  if (!statusEl) {
    return;
  }

  statusEl.textContent = message || '';
  statusEl.dataset.tone = tone;
}

function updateAutoScrollControls() {
  const toggleButton = document.getElementById('autoscroll-toggle');
  if (!toggleButton) {
    return;
  }

  toggleButton.textContent = autoScrollState.isPlaying ? 'Stop' : 'Start';
  toggleButton.classList.toggle('is-playing', autoScrollState.isPlaying);
}

function updateStoppedStatus(saved = false) {
  if (autoScrollState.isPlaying) {
    return;
  }

  if (!Number.isFinite(autoScrollState.startY) || !Number.isFinite(autoScrollState.endY)) {
    setStatus('Stopped', 'info');
    return;
  }

  if (autoScrollState.endY <= autoScrollState.startY) {
    setStatus('Stopped · Start/End を調整してください', 'warn');
    return;
  }

  if (autoScrollState.durationSec <= 0) {
    setStatus('Stopped · 時間を 1 秒以上にしてください', 'warn');
    return;
  }

  const prefix = saved ? 'Saved' : 'Stopped';
  setStatus(`${prefix} · ${formatDuration(autoScrollState.durationSec)} · ${getRangeDistancePx()}px`, saved ? 'success' : 'info');
}

function setDurationInputs(durationSec) {
  const minutesInput = document.getElementById('autoscroll-minutes');
  const secondsInput = document.getElementById('autoscroll-seconds');
  const safeDuration = Math.max(0, Math.round(durationSec));

  if (minutesInput) {
    minutesInput.value = String(Math.floor(safeDuration / 60));
  }

  if (secondsInput) {
    secondsInput.value = String(safeDuration % 60);
  }
}

function saveAutoScrollState({ notify = true } = {}) {
  if (!autoScrollState.storageKey) {
    return;
  }

  if (!Number.isFinite(autoScrollState.startY) || !Number.isFinite(autoScrollState.endY)) {
    return;
  }

  try {
    const payload = {
      startY: Math.round(autoScrollState.startY),
      endY: Math.round(autoScrollState.endY),
      durationSec: Math.max(0, Math.round(autoScrollState.durationSec))
    };

    window.localStorage.setItem(autoScrollState.storageKey, JSON.stringify(payload));

    if (notify) {
      if (autoScrollState.isPlaying) {
        setStatus(`Playing · Saved · ${formatDuration(autoScrollState.durationSec)}`, 'success');
      } else {
        updateStoppedStatus(true);
      }
    }
  } catch (error) {
    console.warn('Failed to save auto-scroll state:', error);
    if (notify) {
      setStatus('Saved できませんでした', 'warn');
    }
  }
}

function syncDurationFromInputs({ notify = true } = {}) {
  const minutesInput = document.getElementById('autoscroll-minutes');
  const secondsInput = document.getElementById('autoscroll-seconds');

  const minutes = Math.max(0, Number.parseInt(minutesInput?.value ?? '0', 10) || 0);
  const seconds = clamp(Number.parseInt(secondsInput?.value ?? '0', 10) || 0, 0, 59);

  if (minutesInput) {
    minutesInput.value = String(minutes);
  }

  if (secondsInput) {
    secondsInput.value = String(seconds);
  }

  autoScrollState.durationSec = (minutes * 60) + seconds;

  if (autoScrollState.isPlaying) {
    if (!recalculateAutoScrollSpeed()) {
      return;
    }
  }

  saveAutoScrollState({ notify });
}

function ensureMarkerElements() {
  const layerEl = getMarkerLayerEl();
  if (!layerEl || layerEl.querySelector('.autoscroll-marker')) {
    return;
  }

  for (const config of [{ name: 'start', label: 'Start' }, { name: 'end', label: 'End' }]) {
    const markerEl = document.createElement('button');
    markerEl.type = 'button';
    markerEl.className = `autoscroll-marker autoscroll-marker-${config.name}`;
    markerEl.dataset.marker = config.name;
    markerEl.innerHTML = `
      <span class="autoscroll-marker-pin" aria-hidden="true"></span>
      <span class="autoscroll-marker-label">${config.label}</span>
    `;

    markerEl.addEventListener('pointerdown', onMarkerPointerDown);
    markerEl.addEventListener('pointermove', onMarkerPointerMove);
    markerEl.addEventListener('pointerup', onMarkerPointerUp);
    markerEl.addEventListener('pointercancel', onMarkerPointerUp);

    layerEl.appendChild(markerEl);
  }
}

function renderMarkerPositions() {
  const layerEl = getMarkerLayerEl();
  const sheetBounds = getSheetBoundsDoc();

  if (!layerEl || !sheetBounds) {
    return;
  }

  for (const markerName of ['start', 'end']) {
    const markerEl = layerEl.querySelector(`[data-marker="${markerName}"]`);
    const markerY = markerName === 'start' ? autoScrollState.startY : autoScrollState.endY;

    if (!markerEl || !Number.isFinite(markerY)) {
      continue;
    }

    markerEl.style.top = `${markerY - sheetBounds.top}px`;
  }
}

function applyMarkerStateToRenderedSheet({ resetInvalidRange = false } = {}) {
  const defaults = getDefaultMarkerPositions();

  autoScrollState.startY = clampMarkerToSheet(autoScrollState.startY, defaults.startY);
  autoScrollState.endY = clampMarkerToSheet(autoScrollState.endY, defaults.endY);

  if (resetInvalidRange && autoScrollState.endY <= autoScrollState.startY) {
    autoScrollState.startY = defaults.startY;
    autoScrollState.endY = defaults.endY;
  }

  renderMarkerPositions();

  if (autoScrollState.isPlaying) {
    recalculateAutoScrollSpeed();
  } else {
    updateStoppedStatus(false);
  }
}

function restoreAutoScrollState() {
  const defaults = getDefaultMarkerPositions();
  let savedState = null;

  autoScrollState.startY = defaults.startY;
  autoScrollState.endY = defaults.endY;
  autoScrollState.durationSec = DEFAULT_DURATION_SEC;

  if (autoScrollState.storageKey) {
    try {
      const raw = window.localStorage.getItem(autoScrollState.storageKey);
      savedState = raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn('Failed to restore auto-scroll state:', error);
    }
  }

  if (savedState) {
    if (Number.isFinite(savedState.startY)) {
      autoScrollState.startY = savedState.startY;
    }

    if (Number.isFinite(savedState.endY)) {
      autoScrollState.endY = savedState.endY;
    }

    if (Number.isFinite(savedState.durationSec)) {
      autoScrollState.durationSec = Math.max(0, savedState.durationSec);
    }
  }

  setDurationInputs(autoScrollState.durationSec);
  applyMarkerStateToRenderedSheet({ resetInvalidRange: true });

  if (savedState) {
    updateStoppedStatus(true);
  } else {
    saveAutoScrollState({ notify: true });
  }
}

function setMarkerY(markerName, docY) {
  const defaults = getDefaultMarkerPositions();
  const fallbackY = markerName === 'start' ? defaults.startY : defaults.endY;
  const nextY = clampMarkerToSheet(docY, fallbackY);

  if (markerName === 'start') {
    autoScrollState.startY = nextY;
  } else {
    autoScrollState.endY = nextY;
  }

  renderMarkerPositions();

  if (autoScrollState.isPlaying && !recalculateAutoScrollSpeed()) {
    return;
  }

  saveAutoScrollState({ notify: true });
}

function onMarkerPointerDown(event) {
  const markerName = event.currentTarget.dataset.marker;
  const currentY = markerName === 'start' ? autoScrollState.startY : autoScrollState.endY;

  autoScrollState.dragging = {
    pointerId: event.pointerId,
    markerName,
    offsetY: (event.clientY + window.scrollY) - (Number.isFinite(currentY) ? currentY : 0)
  };

  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.classList.add('is-dragging');
  document.body.classList.add('is-dragging-marker');
  event.preventDefault();
}

function onMarkerPointerMove(event) {
  if (!autoScrollState.dragging) {
    return;
  }

  if (autoScrollState.dragging.pointerId !== event.pointerId) {
    return;
  }

  if (autoScrollState.dragging.markerName !== event.currentTarget.dataset.marker) {
    return;
  }

  const nextY = (event.clientY + window.scrollY) - autoScrollState.dragging.offsetY;
  setMarkerY(autoScrollState.dragging.markerName, nextY);
  event.preventDefault();
}

function onMarkerPointerUp(event) {
  if (!autoScrollState.dragging || autoScrollState.dragging.pointerId !== event.pointerId) {
    return;
  }

  event.currentTarget.classList.remove('is-dragging');
  document.body.classList.remove('is-dragging-marker');

  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  autoScrollState.dragging = null;
}

function isEndMarkerVisible() {
  const endMarkerEl = getEndMarkerEl();
  if (!endMarkerEl) {
    return false;
  }

  return endMarkerEl.getBoundingClientRect().top <= window.innerHeight;
}

function stopAutoScroll(message = 'Stopped', tone = 'info') {
  if (autoScrollState.frameId) {
    window.cancelAnimationFrame(autoScrollState.frameId);
    autoScrollState.frameId = null;
  }

  autoScrollState.isPlaying = false;
  autoScrollState.speedPxPerSec = 0;
  updateAutoScrollControls();
  saveAutoScrollState({ notify: false });
  setStatus(message, tone);
}

function recalculateAutoScrollSpeed() {
  if (!autoScrollState.isPlaying) {
    return true;
  }

  if (isEndMarkerVisible()) {
    stopAutoScroll('Stopped · End が見えたので停止', 'success');
    return false;
  }

  const elapsedSec = Math.max(0, (performance.now() - autoScrollState.startedAtMs) / 1000);
  const remainingTimeSec = autoScrollState.durationSec - elapsedSec;
  const remainingDistancePx = getReachableScrollY(autoScrollState.endY) - window.scrollY;

  if (remainingDistancePx <= 0.5) {
    stopAutoScroll('Stopped · End に到達', 'success');
    return false;
  }

  if (remainingTimeSec <= 0) {
    stopAutoScroll('Stopped · 残り時間が 0 秒です', 'warn');
    return false;
  }

  autoScrollState.speedPxPerSec = remainingDistancePx / remainingTimeSec;
  return true;
}

function runAutoScrollFrame(nowMs) {
  if (!autoScrollState.isPlaying) {
    return;
  }

  const deltaSec = Math.max(0, (nowMs - autoScrollState.lastFrameMs) / 1000);
  autoScrollState.lastFrameMs = nowMs;

  if (!recalculateAutoScrollSpeed()) {
    return;
  }

  autoScrollState.virtualScrollY += autoScrollState.speedPxPerSec * deltaSec;
  window.scrollTo(0, autoScrollState.virtualScrollY);

  if (isEndMarkerVisible()) {
    stopAutoScroll('Stopped · End が画面内に入りました', 'success');
    return;
  }

  autoScrollState.frameId = window.requestAnimationFrame(runAutoScrollFrame);
}

function shouldScrollToStart() {
  if (!Number.isFinite(autoScrollState.startY) || !Number.isFinite(autoScrollState.defaultStartY)) {
    return true;
  }

  return Math.abs(autoScrollState.startY - autoScrollState.defaultStartY) > START_SCROLL_TOLERANCE_PX;
}

function startAutoScroll() {
  syncDurationFromInputs({ notify: false });
  applyMarkerStateToRenderedSheet({ resetInvalidRange: false });

  if (!Number.isFinite(autoScrollState.startY) || !Number.isFinite(autoScrollState.endY)) {
    setStatus('Stopped · 譜面の描画完了後に開始してください', 'warn');
    return;
  }

  if (autoScrollState.endY <= autoScrollState.startY) {
    setStatus('Stopped · End を Start より下に置いてください', 'warn');
    return;
  }

  if (autoScrollState.durationSec <= 0) {
    setStatus('Stopped · 時間を 1 秒以上にしてください', 'warn');
    return;
  }

  if (shouldScrollToStart()) {
    window.scrollTo(0, getReachableScrollY(autoScrollState.startY));
  }

  autoScrollState.isPlaying = true;
  autoScrollState.startedAtMs = performance.now();
  autoScrollState.lastFrameMs = autoScrollState.startedAtMs;
  autoScrollState.virtualScrollY = window.scrollY;

  if (!recalculateAutoScrollSpeed()) {
    autoScrollState.isPlaying = false;
    updateAutoScrollControls();
    return;
  }

  if (autoScrollState.frameId) {
    window.cancelAnimationFrame(autoScrollState.frameId);
  }

  autoScrollState.frameId = window.requestAnimationFrame(runAutoScrollFrame);
  updateAutoScrollControls();
  setStatus(`Playing · ${formatDuration(autoScrollState.durationSec)}`, 'info');
}

function toggleAutoScroll() {
  if (autoScrollState.isPlaying) {
    stopAutoScroll('Stopped', 'info');
  } else {
    startAutoScroll();
  }
}

function handleSheetPrimaryClick(event) {
  if (event.defaultPrevented || event.button !== 0) {
    return;
  }

  if (autoScrollState.dragging || event.target.closest('.autoscroll-marker')) {
    return;
  }

  toggleAutoScroll();
}

function resetAutoScrollSettings() {
  const defaults = getDefaultMarkerPositions();
  autoScrollState.startY = defaults.startY;
  autoScrollState.endY = defaults.endY;
  autoScrollState.durationSec = DEFAULT_DURATION_SEC;

  setDurationInputs(autoScrollState.durationSec);
  renderMarkerPositions();

  if (autoScrollState.isPlaying && !recalculateAutoScrollSpeed()) {
    return;
  }

  saveAutoScrollState({ notify: true });
}

function refreshAutoScrollAfterRender({ restoreSavedState = false } = {}) {
  ensureMarkerElements();

  if (restoreSavedState || !autoScrollState.hasLoadedSavedState) {
    restoreAutoScrollState();
    autoScrollState.hasLoadedSavedState = true;
  } else {
    applyMarkerStateToRenderedSheet({ resetInvalidRange: false });
  }

  updateAutoScrollControls();
}

async function loadSong() {
  const artist = getQueryParam('artist');
  const id = getQueryParam('id');

  const titleEl = document.getElementById('title');
  const artistEl = document.getElementById('artist');
  const keyEl = document.getElementById('key');
  const sheetEl = getSheetEl();

  updateEditLink(artist, id);

  if (!artist || !id) {
    titleEl.textContent = 'Invalid parameters';
    artistEl.textContent = '';
    if (keyEl) {
      keyEl.textContent = '';
    }
    sheetEl.textContent = 'artist または id が指定されていません。';
    setStatus('Stopped · URL パラメータ不足', 'warn');
    return;
  }

  autoScrollState.storageKey = getSongStorageKey(artist, id);

  try {
    const response = await fetch(
      `/api/song/${encodeURIComponent(artist)}/${encodeURIComponent(id)}`,
      { credentials: 'include' }
    );

    if (response.status === 404) {
      titleEl.textContent = 'Song not found';
      artistEl.textContent = '';
      if (keyEl) {
        keyEl.textContent = '';
      }
      sheetEl.textContent = '指定された曲が見つかりませんでした。';
      setStatus('Stopped · 曲が見つかりません', 'warn');
      return;
    }

    const song = await response.json();
    originalChordPro = song.chordPro || '';
    const renderResult = renderChordWikiLike(originalChordPro, sheetEl, transposeSemitones);

    titleEl.textContent = renderResult.title || song.title || 'タイトルなし';
    artistEl.textContent = renderResult.subtitle || song.artist || '';

    if (keyEl) {
      const keyText = renderResult.key || song.key || '';
      keyEl.textContent = keyText ? `Key: ${keyText}` : '';
    }

    refreshAutoScrollAfterRender({ restoreSavedState: true });
  } catch (error) {
    console.error('Error loading song:', error);
    titleEl.textContent = 'Error loading song';
    artistEl.textContent = '';
    if (keyEl) {
      keyEl.textContent = '';
    }
    sheetEl.textContent = '曲の読み込み中にエラーが発生しました。';
    setStatus('Stopped · 読み込みエラー', 'warn');
  }
}

function updateTransposeDisplay() {
  const displayEl = document.getElementById('transpose-display');
  if (displayEl) {
    displayEl.textContent = `Transpose: ${transposeSemitones}`;
  }

  const downButton = document.getElementById('transpose-down');
  const upButton = document.getElementById('transpose-up');

  if (downButton) {
    downButton.disabled = transposeSemitones <= MIN_TRANSPOSE;
  }

  if (upButton) {
    upButton.disabled = transposeSemitones >= MAX_TRANSPOSE;
  }
}

function reRender() {
  const sheetEl = getSheetEl();
  renderChordWikiLike(originalChordPro, sheetEl, transposeSemitones);
  updateTransposeDisplay();
  refreshAutoScrollAfterRender({ restoreSavedState: false });
}

function initializeAutoScrollUi() {
  document.getElementById('autoscroll-toggle')?.addEventListener('click', toggleAutoScroll);
  document.getElementById('autoscroll-reset')?.addEventListener('click', resetAutoScrollSettings);

  const onDurationInput = () => syncDurationFromInputs({ notify: true });
  document.getElementById('autoscroll-minutes')?.addEventListener('input', onDurationInput);
  document.getElementById('autoscroll-seconds')?.addEventListener('input', onDurationInput);

  document.querySelector('.sheet-stage')?.addEventListener('click', handleSheetPrimaryClick);

  ensureMarkerElements();
  setDurationInputs(DEFAULT_DURATION_SEC);
  updateAutoScrollControls();
  setStatus('Stopped', 'info');

  window.addEventListener('scroll', () => {
    if (autoScrollState.isPlaying && Math.abs(window.scrollY - autoScrollState.virtualScrollY) > 3) {
      autoScrollState.virtualScrollY = window.scrollY;
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    renderMarkerPositions();

    if (autoScrollState.isPlaying) {
      recalculateAutoScrollSpeed();
    } else {
      updateStoppedStatus(false);
    }
  });

  window.addEventListener('beforeunload', () => {
    saveAutoScrollState({ notify: false });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('transpose-down').addEventListener('click', () => {
    transposeSemitones = clampTranspose(transposeSemitones - 1);
    reRender();
  });

  document.getElementById('transpose-up').addEventListener('click', () => {
    transposeSemitones = clampTranspose(transposeSemitones + 1);
    reRender();
  });

  document.getElementById('transpose-reset').addEventListener('click', () => {
    transposeSemitones = 0;
    reRender();
  });

  initializeAutoScrollUi();
  updateTransposeDisplay();
  loadSong();
});