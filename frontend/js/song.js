/*
 * 動作確認メモ
 * - 曲ページを開き、譜面左側に Start / End ピンが出ることを確認する。
 * - 分・秒を設定して Start を押し、Start 位置へ移動後に滑らかに自動スクロールすることを確認する。
 * - 再生中にマーカーや時間を変更しても停止せず、速度だけが即時更新されることを確認する。
 * - Save / Reset 後にページを再読み込みし、曲ごとの設定が復元されることを確認する。
 */
let originalChordPro = '';
let transposeSemitones = 0;

const MIN_TRANSPOSE = -6;
const MAX_TRANSPOSE = 6;
const DEFAULT_DURATION_SEC = 4 * 60;
const AUTO_SCROLL_PRESETS_SEC = [210, 240, 300];
const AUTO_SCROLL_STORAGE_PREFIX = 'autoscroll:v1';

const autoScrollState = {
  storageKey: null,
  startY: null,
  endY: null,
  durationSec: DEFAULT_DURATION_SEC,
  lastKnownScrollPosition: 0,
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
    return { startY: 0, endY: 0 };
  }

  const lines = sheetEl.querySelectorAll('.cw-line');
  if (!lines.length) {
    return { startY: bounds.top, endY: bounds.bottom };
  }

  const firstRect = lines[0].getBoundingClientRect();
  const lastRect = lines[lines.length - 1].getBoundingClientRect();

  return {
    startY: firstRect.top + window.scrollY,
    endY: lastRect.bottom + window.scrollY
  };
}

function clampMarkerToSheet(y, fallbackY = 0) {
  const bounds = getSheetBoundsDoc();
  if (!bounds) {
    return fallbackY;
  }

  const candidate = Number.isFinite(y) ? y : fallbackY;
  return clamp(candidate, bounds.top, bounds.bottom);
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
  if (toggleButton) {
    toggleButton.textContent = autoScrollState.isPlaying ? 'Stop' : 'Start';
    toggleButton.classList.toggle('is-playing', autoScrollState.isPlaying);
  }
}

function updateReadyStatus() {
  if (autoScrollState.isPlaying) {
    return;
  }

  if (!Number.isFinite(autoScrollState.startY) || !Number.isFinite(autoScrollState.endY)) {
    setStatus('譜面レンダリング後にマーカーが有効になります。', 'info');
    return;
  }

  if (autoScrollState.endY <= autoScrollState.startY) {
    setStatus('End マーカーを Start より下に置いてください。', 'warn');
    return;
  }

  if (autoScrollState.durationSec <= 0) {
    setStatus('再生時間は 1 秒以上にしてください。', 'warn');
    return;
  }

  const distancePx = Math.round(autoScrollState.endY - autoScrollState.startY);
  setStatus(`Ready: ${formatDuration(autoScrollState.durationSec)} / ${distancePx}px`, 'info');
}

function updatePresetButtons() {
  const presetButtons = document.querySelectorAll('.autoscroll-preset');

  for (const button of presetButtons) {
    const presetSec = Number.parseInt(button.dataset.durationSec || '', 10);
    button.classList.toggle('is-active', presetSec === autoScrollState.durationSec);
  }
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

  updatePresetButtons();
}

function applyDurationPreset(durationSec) {
  autoScrollState.durationSec = Math.max(0, Math.round(durationSec));
  setDurationInputs(autoScrollState.durationSec);

  if (autoScrollState.isPlaying) {
    if (recalculateAutoScrollSpeed()) {
      setStatus(`プリセット ${formatDuration(autoScrollState.durationSec)} を適用しました。`, 'info');
    }
  } else {
    updateReadyStatus();
  }

  saveAutoScrollState(false);
}

function syncDurationFromInputs({ announce = false } = {}) {
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
    if (recalculateAutoScrollSpeed()) {
      setStatus(`再生時間を ${formatDuration(autoScrollState.durationSec)} に更新しました。`, 'info');
    }
  } else if (announce) {
    updateReadyStatus();
  }

  saveAutoScrollState(false);
}

function saveAutoScrollState(announce = false) {
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
      durationSec: Math.max(0, Math.round(autoScrollState.durationSec)),
      lastKnownScrollPosition: Math.round(window.scrollY)
    };

    window.localStorage.setItem(autoScrollState.storageKey, JSON.stringify(payload));

    if (announce) {
      setStatus('この曲の自動スクロール設定を保存しました。', 'success');
    }
  } catch (error) {
    console.warn('Failed to save auto-scroll state:', error);
    if (announce) {
      setStatus('保存に失敗しました。', 'warn');
    }
  }
}

function ensureMarkerElements() {
  const layerEl = getMarkerLayerEl();
  if (!layerEl) {
    return;
  }

  if (layerEl.querySelector('.autoscroll-marker')) {
    return;
  }

  const markerConfigs = [
    { name: 'start', label: 'Start' },
    { name: 'end', label: 'End' }
  ];

  for (const config of markerConfigs) {
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
    updateReadyStatus();
  }
}

function restoreAutoScrollState() {
  const defaults = getDefaultMarkerPositions();
  let savedState = null;

  autoScrollState.startY = defaults.startY;
  autoScrollState.endY = defaults.endY;
  autoScrollState.durationSec = DEFAULT_DURATION_SEC;
  autoScrollState.lastKnownScrollPosition = window.scrollY;

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

    if (Number.isFinite(savedState.lastKnownScrollPosition)) {
      autoScrollState.lastKnownScrollPosition = savedState.lastKnownScrollPosition;
    }
  }

  setDurationInputs(autoScrollState.durationSec);
  applyMarkerStateToRenderedSheet({ resetInvalidRange: true });

  if (savedState) {
    setStatus('保存済みの自動スクロール設定を復元しました。', 'success');
  }
}

function setMarkerY(markerName, docY, { save = false, announce = false } = {}) {
  const defaults = getDefaultMarkerPositions();
  const fallbackY = markerName === 'start' ? defaults.startY : defaults.endY;
  const nextY = clampMarkerToSheet(docY, fallbackY);

  if (markerName === 'start') {
    autoScrollState.startY = nextY;
  } else {
    autoScrollState.endY = nextY;
  }

  renderMarkerPositions();

  if (autoScrollState.isPlaying) {
    recalculateAutoScrollSpeed();
  } else {
    updateReadyStatus();
  }

  if (save) {
    saveAutoScrollState(false);
  }

  if (announce && autoScrollState.isPlaying) {
    setStatus('マーカー位置を更新し、速度を再計算しました。', 'info');
  }
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
  setMarkerY(autoScrollState.dragging.markerName, nextY, { save: false, announce: false });
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
  saveAutoScrollState(false);

  if (autoScrollState.isPlaying) {
    setStatus('マーカー位置を更新し、速度を再計算しました。', 'info');
  } else {
    updateReadyStatus();
  }
}

function stopAutoScroll(message = '自動スクロールを停止しました。', tone = 'info') {
  if (autoScrollState.frameId) {
    window.cancelAnimationFrame(autoScrollState.frameId);
    autoScrollState.frameId = null;
  }

  autoScrollState.isPlaying = false;
  autoScrollState.speedPxPerSec = 0;
  autoScrollState.lastKnownScrollPosition = window.scrollY;

  updateAutoScrollControls();
  saveAutoScrollState(false);
  setStatus(message, tone);
}

function recalculateAutoScrollSpeed() {
  if (!autoScrollState.isPlaying) {
    return true;
  }

  const elapsedSec = Math.max(0, (performance.now() - autoScrollState.startedAtMs) / 1000);
  const remainingTimeSec = autoScrollState.durationSec - elapsedSec;
  const reachableEndY = getReachableScrollY(autoScrollState.endY);
  const remainingDistancePx = reachableEndY - window.scrollY;

  if (remainingDistancePx <= 0.5) {
    stopAutoScroll('End に到達したため停止しました。', 'success');
    return false;
  }

  if (remainingTimeSec <= 0) {
    stopAutoScroll('残り時間が 0 秒になりました。時間を調整してください。', 'warn');
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

  const reachableEndY = getReachableScrollY(autoScrollState.endY);
  autoScrollState.virtualScrollY = Math.min(
    reachableEndY,
    autoScrollState.virtualScrollY + (autoScrollState.speedPxPerSec * deltaSec)
  );

  window.scrollTo(0, autoScrollState.virtualScrollY);

  if ((reachableEndY - autoScrollState.virtualScrollY) <= 0.5) {
    window.scrollTo(0, reachableEndY);
    stopAutoScroll('自動スクロールが完了しました。', 'success');
    return;
  }

  autoScrollState.frameId = window.requestAnimationFrame(runAutoScrollFrame);
}

function startAutoScroll() {
  syncDurationFromInputs({ announce: false });
  applyMarkerStateToRenderedSheet({ resetInvalidRange: false });

  if (!Number.isFinite(autoScrollState.startY) || !Number.isFinite(autoScrollState.endY)) {
    setStatus('譜面の描画完了後に開始してください。', 'warn');
    return;
  }

  if (autoScrollState.endY <= autoScrollState.startY) {
    setStatus('End マーカーを Start より下に置いてください。', 'warn');
    return;
  }

  if (autoScrollState.durationSec <= 0) {
    setStatus('再生時間は 1 秒以上にしてください。', 'warn');
    return;
  }

  const reachableStartY = getReachableScrollY(autoScrollState.startY);
  const reachableEndY = getReachableScrollY(autoScrollState.endY);

  if (reachableEndY <= reachableStartY) {
    setStatus('スクロール可能な距離が不足しています。End を下げてください。', 'warn');
    return;
  }

  window.scrollTo(0, reachableStartY);

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
  setStatus('自動スクロールを開始しました。譜面を左クリックするか Stop で停止できます。', 'info');
}

function toggleAutoScroll() {
  if (autoScrollState.isPlaying) {
    stopAutoScroll('自動スクロールを停止しました。', 'info');
  } else {
    startAutoScroll();
  }
}

function handleSheetPrimaryClick(event) {
  if (event.defaultPrevented || event.button !== 0) {
    return;
  }

  if (autoScrollState.dragging) {
    return;
  }

  if (event.target.closest('.autoscroll-marker')) {
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
  saveAutoScrollState(false);

  if (autoScrollState.isPlaying) {
    recalculateAutoScrollSpeed();
    setStatus('Start / End と時間を初期値へ戻しました。', 'info');
  } else {
    setStatus('Start / End と時間を初期値へ戻しました。', 'success');
  }
}

function refreshAutoScrollAfterRender({ restoreSavedState = false } = {}) {
  ensureMarkerElements();

  if (restoreSavedState || !autoScrollState.hasLoadedSavedState) {
    restoreAutoScrollState();
    autoScrollState.hasLoadedSavedState = true;
  } else {
    applyMarkerStateToRenderedSheet({ resetInvalidRange: false });
    saveAutoScrollState(false);
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
    setStatus('URL パラメータが不足しています。', 'warn');
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
      setStatus('曲データが見つかりません。', 'warn');
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
    setStatus('曲の読み込み中にエラーが発生しました。', 'warn');
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
  document.getElementById('autoscroll-save')?.addEventListener('click', () => saveAutoScrollState(true));

  const onDurationInput = () => syncDurationFromInputs({ announce: true });
  document.getElementById('autoscroll-minutes')?.addEventListener('input', onDurationInput);
  document.getElementById('autoscroll-seconds')?.addEventListener('input', onDurationInput);

  for (const durationSec of AUTO_SCROLL_PRESETS_SEC) {
    document
      .querySelector(`.autoscroll-preset[data-duration-sec="${durationSec}"]`)
      ?.addEventListener('click', () => applyDurationPreset(durationSec));
  }

  document.querySelector('.sheet-stage')?.addEventListener('click', handleSheetPrimaryClick);

  ensureMarkerElements();
  setDurationInputs(DEFAULT_DURATION_SEC);
  updateAutoScrollControls();
  setStatus('譜面の左クリック、または Start ボタンで開始できます。', 'info');

  window.addEventListener('scroll', () => {
    autoScrollState.lastKnownScrollPosition = window.scrollY;

    if (autoScrollState.isPlaying && Math.abs(window.scrollY - autoScrollState.virtualScrollY) > 3) {
      autoScrollState.virtualScrollY = window.scrollY;
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    renderMarkerPositions();

    if (autoScrollState.isPlaying) {
      recalculateAutoScrollSpeed();
    }
  });

  window.addEventListener('beforeunload', () => {
    saveAutoScrollState(false);
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