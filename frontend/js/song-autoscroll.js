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
  const safeSeconds = clamp(Math.round(totalSeconds), 0, MAX_AUTOSCROLL_DURATION_SEC);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function normalizeDurationInputValues(rawMinutes, rawSeconds) {
  let minutes = Number.parseInt(String(rawMinutes ?? '0'), 10);
  let seconds = Number.parseInt(String(rawSeconds ?? '0'), 10);

  minutes = Number.isFinite(minutes) ? minutes : 0;
  seconds = Number.isFinite(seconds) ? seconds : 0;

  if (seconds >= 60) {
    const carryMinutes = Math.floor(seconds / 60);
    if (minutes >= MAX_AUTOSCROLL_MINUTES) {
      minutes = MAX_AUTOSCROLL_MINUTES;
      seconds = 59;
    } else {
      minutes += carryMinutes;
      seconds %= 60;
    }
  } else if (seconds < 0) {
    if (minutes > 0) {
      minutes -= 1;
      seconds = 59;
    } else {
      minutes = 0;
      seconds = 0;
    }
  }

  if (minutes > MAX_AUTOSCROLL_MINUTES) {
    minutes = MAX_AUTOSCROLL_MINUTES;
    seconds = 59;
  }

  minutes = clamp(minutes, 0, MAX_AUTOSCROLL_MINUTES);
  seconds = clamp(seconds, 0, 59);

  return {
    minutes,
    seconds,
    durationSec: Math.min(MAX_AUTOSCROLL_DURATION_SEC, (minutes * 60) + seconds)
  };
}

function getDisplayedDurationSec() {
  const normalized = normalizeDurationInputValues(
    document.getElementById('autoscroll-minutes')?.value ?? '0',
    document.getElementById('autoscroll-seconds')?.value ?? '0'
  );
  return normalized.durationSec;
}

function isDefaultDurationRange(seconds = getDisplayedDurationSec()) {
  const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  return safeSeconds >= DEFAULT_DURATION_ESTIMATE_MIN_SEC && safeSeconds <= DEFAULT_DURATION_ESTIMATE_MAX_SEC;
}

function stripParenthesizedTitleText(value) {
  const original = String(value || '').trim();
  if (!original) {
    return '';
  }

  const stripped = original
    .replace(/\s*（[^）]*）\s*/g, ' ')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*【[^】]*】\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/[\s\u3000]+/g, ' ')
    .trim();

  return stripped || original;
}

function applyEstimatedDurationBias(seconds) {
  const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  if (!safeSeconds) {
    return 0;
  }

  return Math.max(30, Math.round(safeSeconds * AUTO_SCROLL_ESTIMATE_RATIO));
}

async function maybeEstimateAutoScrollDuration(song, displayTitle = '', displayArtist = '') {
  if (autoScrollEstimateState.attempted || autoScrollEstimateState.inFlight) {
    return;
  }

  if (!isDefaultDurationRange(autoScrollState.durationSec) || !isDefaultDurationRange()) {
    return;
  }

  const rawTitle = String(song?.title || '').trim();
  const title = stripParenthesizedTitleText(rawTitle);
  const artist = String(song?.artist || '').trim();
  if (!title || !artist) {
    return;
  }

  autoScrollEstimateState.attempted = true;
  autoScrollEstimateState.inFlight = true;

  try {
    const endpoint = buildApiUrl(`/api/youtube/search-duration?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`);
    const response = await fetch(endpoint, { credentials: 'include' });
    if (!response.ok) {
      return;
    }

    const payload = await response.json().catch(() => null);
    const rawDurationSec = Number(payload?.durationSec);
    if (!payload?.found || !Number.isFinite(rawDurationSec) || rawDurationSec <= 0) {
      return;
    }

    if (!isDefaultDurationRange(autoScrollState.durationSec) || !isDefaultDurationRange()) {
      return;
    }

    const estimatedSec = applyEstimatedDurationBias(rawDurationSec);
    if (!estimatedSec) {
      return;
    }

    autoScrollState.durationSec = estimatedSec;
    setDurationInputs(estimatedSec);
    saveAutoScrollState({ notify: false });
    setStatus(`Estimated · ${formatDuration(estimatedSec)} · YouTube参考値`, 'success');
  } catch (error) {
    console.warn('Failed to estimate auto-scroll duration:', error);
  } finally {
    autoScrollEstimateState.inFlight = false;
  }
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

  const lines = sheetEl.querySelectorAll('p.line:not(.blank), p.comment');
  const endMarkerOffset = Math.max(0, Number(AUTO_SCROLL_END_MARKER_EXTRA_PX) || 0);
  const firstLyricLine = sheetEl.querySelector('p.line:not(.blank)');
  const defaults = !lines.length
    ? { startY: bounds.top, endY: bounds.bottom + endMarkerOffset }
    : {
        startY: (firstLyricLine ?? lines[0]).getBoundingClientRect().top + window.scrollY,
        endY: lines[lines.length - 1].getBoundingClientRect().bottom + window.scrollY + endMarkerOffset
      };

  autoScrollState.defaultStartY = defaults.startY;
  autoScrollState.defaultEndY = defaults.endY;
  return defaults;
}

function clampMarkerToSheet(y, fallbackY = 0, markerName = 'start') {
  const bounds = getSheetBoundsDoc();
  if (!bounds) {
    return fallbackY;
  }

  const candidate = Number.isFinite(y) ? y : fallbackY;
  const extraBottom = markerName === 'end'
    ? Math.max(0, Number(AUTO_SCROLL_END_MARKER_EXTRA_PX) || 0)
    : 0;
  return clamp(candidate, bounds.top, bounds.bottom + extraBottom);
}

function getRangeDistancePx() {
  if (!Number.isFinite(autoScrollState.startY) || !Number.isFinite(autoScrollState.endY)) {
    return 0;
  }

  return Math.max(0, Math.round(autoScrollState.endY - autoScrollState.startY));
}

function formatSpeedMultiplier(multiplier = autoScrollState.speedMultiplier) {
  const safeMultiplier = Number.isFinite(multiplier) ? multiplier : 1;
  return `${safeMultiplier.toFixed(2)}x`;
}

function updateAutoScrollSpeedUi() {
  const displayEl = document.getElementById('autoscroll-speed-display');
  const resetButton = document.getElementById('autoscroll-speed-reset');
  const multiplier = Number.isFinite(autoScrollState.speedMultiplier) ? autoScrollState.speedMultiplier : 1;

  if (displayEl) {
    displayEl.textContent = formatSpeedMultiplier(multiplier);

    let speedState = 'normal';
    if (multiplier > 1.001) {
      speedState = 'fast';
    } else if (multiplier < 0.999) {
      speedState = 'slow';
    }

    displayEl.dataset.speedState = speedState;
  }

  if (resetButton) {
    resetButton.disabled = Math.abs(multiplier - 1) < 0.001;
  }
}

function setAutoScrollSpeedMultiplier(value, { persist = true, notify = true } = {}) {
  const roundedValue = Math.round((Number(value) || 1) * 100) / 100;
  const nextMultiplier = clamp(roundedValue, AUTO_SCROLL_SPEED_MIN_MULTIPLIER, AUTO_SCROLL_SPEED_MAX_MULTIPLIER);
  autoScrollState.speedMultiplier = nextMultiplier;
  updateAutoScrollSpeedUi();

  if (persist && autoScrollState.storageKey) {
    saveAutoScrollState({ notify: false });
  } else if (!autoScrollState.isPlaying) {
    updateStoppedStatus(false);
  }

  if (autoScrollState.isPlaying && !recalculateAutoScrollSpeed()) {
    return;
  }

  if (notify) {
    if (autoScrollState.isPlaying) {
      updatePlayingStatus({ force: true });
    } else {
      setStatus(`Stopped · ${formatDuration(autoScrollState.durationSec)} · Speed ${formatSpeedMultiplier(nextMultiplier)}`, 'info');
    }
  }
}

function nudgeAutoScrollSpeed(direction, { steps = 1, notify = true } = {}) {
  if (!Number.isFinite(direction) || direction === 0) {
    return;
  }

  const safeSteps = Math.max(1, Math.round(Number(steps) || 1));
  const delta = AUTO_SCROLL_SPEED_STEP * safeSteps * (direction > 0 ? 1 : -1);
  setAutoScrollSpeedMultiplier((autoScrollState.speedMultiplier || 1) + delta, { persist: true, notify });
}

function setStatus(message, tone = 'info') {
  const statusEl = document.getElementById('autoscroll-status');
  if (!statusEl) {
    return;
  }

  statusEl.textContent = message || '';
  statusEl.dataset.tone = tone;
}

function getAutoScrollRemainingSec() {
  const durationSec = Math.max(0, Number(autoScrollState.durationSec) || 0);
  const elapsedSec = Math.max(0, Number(autoScrollState.playbackElapsedSec) || 0);
  return Math.max(0, durationSec - elapsedSec);
}

function getAutoScrollRemainingDisplaySec() {
  const remainingSec = getAutoScrollRemainingSec();
  if (remainingSec <= 0) {
    return 0;
  }

  return Math.max(0, Math.ceil(remainingSec - 0.001));
}

function getPlayingStatusPayload() {
  const remainingDisplaySec = getAutoScrollRemainingDisplaySec();
  const baseMessage = `${formatDuration(remainingDisplaySec)} · ${formatSpeedMultiplier()}`;
  if (!autoScrollState.hasScrollStarted) {
    return {
      message: `Playing · 遅延開始中 · ${baseMessage}`,
      tone: 'lead-in',
      remainingDisplaySec
    };
  }

  return {
    message: `Playing · ${baseMessage}`,
    tone: 'info',
    remainingDisplaySec
  };
}

function updatePlayingStatus({ force = false } = {}) {
  if (!autoScrollState.isPlaying) {
    return;
  }

  const payload = getPlayingStatusPayload();
  const currentSpeed = Number.isFinite(autoScrollState.speedMultiplier) ? autoScrollState.speedMultiplier : 1;
  const shouldSkip = !force
    && autoScrollState.lastStatusRemainingSec === payload.remainingDisplaySec
    && autoScrollState.lastStatusTone === payload.tone
    && Math.abs((autoScrollState.lastStatusSpeed ?? currentSpeed) - currentSpeed) < 0.0001;

  if (shouldSkip) {
    return;
  }

  autoScrollState.lastStatusRemainingSec = payload.remainingDisplaySec;
  autoScrollState.lastStatusTone = payload.tone;
  autoScrollState.lastStatusSpeed = currentSpeed;
  setStatus(payload.message, payload.tone);
}

function updateAutoScrollControls() {
  const toggleButton = document.getElementById('autoscroll-toggle');
  if (!toggleButton) {
    return;
  }

  toggleButton.textContent = autoScrollState.isPlaying ? 'Stop' : 'Start';
  toggleButton.classList.toggle('is-playing', autoScrollState.isPlaying);
  syncVariableScrollToggleUi();
  updateAutoScrollSpeedUi();
}

function syncVariableScrollToggleUi() {
  const toggleInput = document.getElementById('autoscroll-variable-toggle');
  if (!toggleInput) {
    return;
  }

  toggleInput.checked = autoScrollState.variableScrollEnabled !== false;
}

function setAutoScrollVariableScrollEnabled(enabled, { persist = true, notify = true } = {}) {
  const nextEnabled = enabled !== false;
  const changed = autoScrollState.variableScrollEnabled !== nextEnabled;
  autoScrollState.variableScrollEnabled = nextEnabled;
  syncVariableScrollToggleUi();

  if (autoScrollState.isPlaying && changed) {
    stopAutoScroll('Stopped · スクロールモードを切り替えました', 'info');
  }

  if (persist) {
    saveAutoScrollState({ notify: false });
  }

  if (notify) {
    const modeLabel = nextEnabled ? '可変スクロール ON' : '等速モード ON';
    setStatus(`Stopped · ${modeLabel}`, 'info');
  }
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
  setStatus(`${prefix} · ${formatDuration(autoScrollState.durationSec)} · ${getRangeDistancePx()}px · ${formatSpeedMultiplier()}`, saved ? 'success' : 'info');
}

function setDurationInputs(durationSec) {
  const minutesInput = document.getElementById('autoscroll-minutes');
  const secondsInput = document.getElementById('autoscroll-seconds');
  const safeDuration = clamp(Math.round(durationSec), 0, MAX_AUTOSCROLL_DURATION_SEC);

  if (minutesInput) {
    minutesInput.value = String(Math.floor(safeDuration / 60)).padStart(2, '0');
  }

  if (secondsInput) {
    secondsInput.value = String(safeDuration % 60).padStart(2, '0');
  }
}

function applyDurationPreset(minutes, seconds) {
  const minutesInput = document.getElementById('autoscroll-minutes');
  const secondsInput = document.getElementById('autoscroll-seconds');

  if (minutesInput) {
    minutesInput.value = String(Math.max(0, Number.parseInt(minutes, 10) || 0));
  }

  if (secondsInput) {
    secondsInput.value = String(clamp(Number.parseInt(seconds, 10) || 0, 0, 59));
  }

  syncDurationFromInputs({ notify: true });
}

function saveAutoScrollState({ notify = true } = {}) {
  if (!autoScrollState.storageKey) {
    return;
  }

  if (!Number.isFinite(autoScrollState.startY) || !Number.isFinite(autoScrollState.endY)) {
    return;
  }

  try {
    const defaultStartY = Number.isFinite(autoScrollState.defaultStartY)
      ? autoScrollState.defaultStartY
      : autoScrollState.startY;
    const defaultEndY = Number.isFinite(autoScrollState.defaultEndY)
      ? autoScrollState.defaultEndY
      : autoScrollState.endY;

    const payload = {
      startY: Math.round(autoScrollState.startY),
      endY: Math.round(autoScrollState.endY),
      startOffsetPx: Math.round(autoScrollState.startY - defaultStartY),
      endOffsetPx: Math.round(autoScrollState.endY - defaultEndY),
      durationSec: Math.max(0, Math.round(autoScrollState.durationSec)),
      speedMultiplier: Math.round((Number(autoScrollState.speedMultiplier) || 1) * 100) / 100,
      variableScrollEnabled: autoScrollState.variableScrollEnabled !== false
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

  const normalized = normalizeDurationInputValues(
    minutesInput?.value ?? '0',
    secondsInput?.value ?? '0'
  );

  if (minutesInput) {
    minutesInput.value = String(normalized.minutes).padStart(2, '0');
  }

  if (secondsInput) {
    secondsInput.value = String(normalized.seconds).padStart(2, '0');
  }

  autoScrollState.durationSec = normalized.durationSec;
  refreshAutoScrollTimelineFromCurrentSettings();

  if (autoScrollState.isPlaying) {
    if (!recalculateAutoScrollSpeed()) {
      return;
    }
  }

  saveAutoScrollState({ notify });
}

function syncCompactMarkerMode() {
  const bodyEl = document.body;
  if (!bodyEl) {
    return false;
  }

  const viewportWidth = Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0);
  const stageWidth = Math.round(document.querySelector('.sheet-stage')?.getBoundingClientRect().width || 0);
  const shouldCompact = (viewportWidth > 0 && viewportWidth <= 720) || (stageWidth > 0 && stageWidth <= 520);
  const shouldTight = shouldCompact && (
    (viewportWidth > 0 && viewportWidth <= 420)
    || (stageWidth > 0 && stageWidth <= 360)
  );

  bodyEl.classList.toggle('compact-autoscroll-markers', shouldCompact);
  bodyEl.classList.toggle('compact-autoscroll-markers-tight', shouldTight);
  return shouldCompact;
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
    markerEl.setAttribute('aria-label', config.label);
    markerEl.title = config.label;
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

function getMarkerViewportLeft() {
  const sheetEl = getSheetEl();
  if (!sheetEl) {
    return 8;
  }

  syncCompactMarkerMode();

  const sheetRect = sheetEl.getBoundingClientRect();
  const rootStyles = getComputedStyle(document.body || document.documentElement);
  const markerOffset = Number.parseFloat(rootStyles.getPropertyValue('--marker-left-offset')) || 82;
  return Math.max(4, Math.round(sheetRect.left - markerOffset));
}

function renderMarkerPositions() {
  const layerEl = getMarkerLayerEl();
  if (!layerEl) {
    return;
  }

  const markerLeft = getMarkerViewportLeft();
  layerEl.style.setProperty('--marker-left', `${markerLeft}px`);

  for (const markerName of ['start', 'end']) {
    const markerEl = layerEl.querySelector(`[data-marker="${markerName}"]`);
    const markerY = markerName === 'start' ? autoScrollState.startY : autoScrollState.endY;

    if (!markerEl || !Number.isFinite(markerY)) {
      continue;
    }

    markerEl.style.left = `${markerLeft}px`;
    markerEl.style.top = `${Math.round(markerY - window.scrollY)}px`;
  }
}

function applyMarkerStateToRenderedSheet({ resetInvalidRange = false } = {}) {
  const previousDefaultStartY = autoScrollState.defaultStartY;
  const previousDefaultEndY = autoScrollState.defaultEndY;
  const defaults = getDefaultMarkerPositions();

  if (Number.isFinite(previousDefaultStartY) && Number.isFinite(autoScrollState.startY)) {
    autoScrollState.startY += (defaults.startY - previousDefaultStartY);
  }

  if (Number.isFinite(previousDefaultEndY) && Number.isFinite(autoScrollState.endY)) {
    autoScrollState.endY += (defaults.endY - previousDefaultEndY);
  }

  autoScrollState.startY = clampMarkerToSheet(autoScrollState.startY, defaults.startY, 'start');
  autoScrollState.endY = clampMarkerToSheet(autoScrollState.endY, defaults.endY, 'end');

  if (resetInvalidRange && autoScrollState.endY <= autoScrollState.startY) {
    autoScrollState.startY = defaults.startY;
    autoScrollState.endY = defaults.endY;
  }

  renderMarkerPositions();
  refreshAutoScrollTimelineFromCurrentSettings();

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
  autoScrollState.speedMultiplier = 1;
  autoScrollState.variableScrollEnabled = true;

  if (autoScrollState.storageKey) {
    try {
      const raw = window.localStorage.getItem(autoScrollState.storageKey);
      savedState = raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn('Failed to restore auto-scroll state:', error);
    }
  }

  if (savedState) {
    if (Number.isFinite(savedState.startOffsetPx)) {
      autoScrollState.startY = defaults.startY + savedState.startOffsetPx;
    } else if (Number.isFinite(savedState.startY)) {
      autoScrollState.startY = savedState.startY;
    }

    if (Number.isFinite(savedState.endOffsetPx)) {
      autoScrollState.endY = defaults.endY + savedState.endOffsetPx;
    } else if (Number.isFinite(savedState.endY)) {
      autoScrollState.endY = savedState.endY;
    }

    if (Number.isFinite(savedState.durationSec)) {
      autoScrollState.durationSec = Math.max(0, savedState.durationSec);
    }

    if (Number.isFinite(savedState.speedMultiplier)) {
      autoScrollState.speedMultiplier = clamp(
        Number(savedState.speedMultiplier),
        AUTO_SCROLL_SPEED_MIN_MULTIPLIER,
        AUTO_SCROLL_SPEED_MAX_MULTIPLIER
      );
    }

    if (typeof savedState.variableScrollEnabled === 'boolean') {
      autoScrollState.variableScrollEnabled = savedState.variableScrollEnabled;
    }
  }

  setDurationInputs(autoScrollState.durationSec);
  syncVariableScrollToggleUi();
  updateAutoScrollSpeedUi();
  applyMarkerStateToRenderedSheet({ resetInvalidRange: true });

  autoScrollState.rewindToStartPending = false;
  autoScrollState.startFromMarkerPending = Number.isFinite(autoScrollState.startY)
    && Number.isFinite(autoScrollState.defaultStartY)
    && Math.abs(autoScrollState.startY - autoScrollState.defaultStartY) > START_SCROLL_TOLERANCE_PX;

  if (savedState) {
    updateStoppedStatus(true);
  } else {
    saveAutoScrollState({ notify: true });
  }
}

function setMarkerY(markerName, docY, { persist = true, notify = true } = {}) {
  const defaults = getDefaultMarkerPositions();
  const fallbackY = markerName === 'start' ? defaults.startY : defaults.endY;
  const nextY = clampMarkerToSheet(docY, fallbackY, markerName);

  if (markerName === 'start') {
    const maxStartY = clampMarkerToSheet(
      Number.isFinite(autoScrollState.endY) ? autoScrollState.endY : defaults.endY,
      defaults.endY,
      'start'
    );
    autoScrollState.startY = Math.min(nextY, maxStartY);
    autoScrollState.startFromMarkerPending = true;
  } else {
    const minEndY = clampMarkerToSheet(
      Number.isFinite(autoScrollState.startY) ? autoScrollState.startY : defaults.startY,
      defaults.startY,
      'end'
    );
    autoScrollState.endY = Math.max(nextY, minEndY);
  }

  autoScrollState.rewindToStartPending = false;
  renderMarkerPositions();
  refreshAutoScrollTimelineFromCurrentSettings();

  if (autoScrollState.isPlaying && !recalculateAutoScrollSpeed()) {
    return;
  }

  if (persist) {
    saveAutoScrollState({ notify });
  } else if (!autoScrollState.isPlaying) {
    updateStoppedStatus(false);
  }
}

function stopMarkerDragEdgeAutoScroll() {
  const dragging = autoScrollState.dragging;
  if (!dragging) {
    return;
  }

  if (dragging.frameId) {
    window.cancelAnimationFrame(dragging.frameId);
    window.clearTimeout(dragging.frameId);
    dragging.frameId = null;
  }

  dragging.edgeScrollSpeedPxPerSec = 0;
  dragging.lastFrameMs = 0;
}

function getMarkerDragEdgeScrollSpeed(clientY, pointerSpeedPxPerSec = 0) {
  const edgeZone = Math.max(24, MARKER_EDGE_SCROLL_ZONE_PX);
  let direction = 0;
  let edgeRatio = 0;

  if (clientY < edgeZone) {
    direction = -1;
    edgeRatio = (edgeZone - clientY) / edgeZone;
  } else if (clientY > window.innerHeight - edgeZone) {
    direction = 1;
    edgeRatio = (clientY - (window.innerHeight - edgeZone)) / edgeZone;
  }

  edgeRatio = clamp(edgeRatio, 0, 1);
  if (!direction || edgeRatio <= 0) {
    return 0;
  }

  const pointerBoost = Math.min(Math.abs(pointerSpeedPxPerSec || 0), 1400) * MARKER_EDGE_SCROLL_POINTER_SPEED_FACTOR;
  const rampedSpeed = MARKER_EDGE_SCROLL_BASE_SPEED
    + ((MARKER_EDGE_SCROLL_MAX_SPEED - MARKER_EDGE_SCROLL_BASE_SPEED) * edgeRatio * edgeRatio)
    + pointerBoost;

  return direction * Math.min(MARKER_EDGE_SCROLL_MAX_SPEED, rampedSpeed);
}

function updateMarkerDragTracking(clientY, timeStamp = performance.now()) {
  const dragging = autoScrollState.dragging;
  if (!dragging) {
    return;
  }

  let pointerSpeedPxPerSec = dragging.pointerSpeedPxPerSec || 0;
  if (Number.isFinite(dragging.lastClientY) && Number.isFinite(dragging.lastClientTime) && timeStamp > dragging.lastClientTime) {
    pointerSpeedPxPerSec = Math.abs(clientY - dragging.lastClientY) / ((timeStamp - dragging.lastClientTime) / 1000);
  }

  dragging.currentClientY = clientY;
  dragging.pointerSpeedPxPerSec = pointerSpeedPxPerSec;
  dragging.lastClientY = clientY;
  dragging.lastClientTime = timeStamp;
  dragging.edgeScrollSpeedPxPerSec = getMarkerDragEdgeScrollSpeed(clientY, pointerSpeedPxPerSec);

  if (Math.abs(dragging.edgeScrollSpeedPxPerSec) > 0.5) {
    if (!dragging.frameId) {
      dragging.lastFrameMs = Number.isFinite(timeStamp) ? timeStamp : performance.now();
      dragging.frameId = window.setTimeout(() => {
        runMarkerDragEdgeAutoScrollFrame(performance.now());
      }, 16);
    }
    return;
  }

  stopMarkerDragEdgeAutoScroll();
}

function runMarkerDragEdgeAutoScrollFrame(nowMs) {
  const dragging = autoScrollState.dragging;
  if (!dragging) {
    return;
  }

  dragging.frameId = null;

  if (!Number.isFinite(dragging.edgeScrollSpeedPxPerSec) || Math.abs(dragging.edgeScrollSpeedPxPerSec) <= 0.5) {
    dragging.lastFrameMs = 0;
    return;
  }

  const previousFrameMs = Number.isFinite(dragging.lastFrameMs) && dragging.lastFrameMs > 0
    ? dragging.lastFrameMs
    : nowMs;
  const deltaSec = Math.max(0, (nowMs - previousFrameMs) / 1000);
  dragging.lastFrameMs = nowMs;

  const previousScrollY = window.scrollY;
  const maxScrollY = getMaxWindowScrollY();
  const nextScrollY = clamp(
    previousScrollY + (dragging.edgeScrollSpeedPxPerSec * deltaSec),
    0,
    maxScrollY
  );
  const scrollDelta = Math.abs(nextScrollY - previousScrollY);

  if (scrollDelta > 0.1) {
    window.scrollTo(0, nextScrollY);
  }

  const nextMarkerY = (dragging.currentClientY + window.scrollY) - dragging.offsetY;
  setMarkerY(dragging.markerName, nextMarkerY, { persist: false, notify: false });

  if (!autoScrollState.dragging || Math.abs(dragging.edgeScrollSpeedPxPerSec) <= 0.5) {
    dragging.lastFrameMs = 0;
    return;
  }

  const atScrollLimit = nextScrollY <= 0.1 || Math.abs(nextScrollY - maxScrollY) <= 0.1;
  if (scrollDelta <= 0.1 && atScrollLimit) {
    dragging.lastFrameMs = 0;
    return;
  }

  dragging.frameId = window.setTimeout(() => {
    runMarkerDragEdgeAutoScrollFrame(performance.now());
  }, 16);
}

function onMarkerPointerDown(event) {
  const markerName = event.currentTarget.dataset.marker;
  const currentY = markerName === 'start' ? autoScrollState.startY : autoScrollState.endY;
  const nowMs = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();

  autoScrollState.dragging = {
    pointerId: event.pointerId,
    markerName,
    offsetY: (event.clientY + window.scrollY) - (Number.isFinite(currentY) ? currentY : 0),
    currentClientY: event.clientY,
    lastClientY: event.clientY,
    lastClientTime: nowMs,
    pointerSpeedPxPerSec: 0,
    edgeScrollSpeedPxPerSec: 0,
    frameId: null,
    lastFrameMs: 0
  };

  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.classList.add('is-dragging');
  document.body.classList.add('is-dragging-marker');
  updateMarkerDragTracking(event.clientY, nowMs);
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
  setMarkerY(autoScrollState.dragging.markerName, nextY, { persist: false, notify: false });
  updateMarkerDragTracking(event.clientY, Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now());
  event.preventDefault();
}

function onMarkerPointerUp(event) {
  if (!autoScrollState.dragging || autoScrollState.dragging.pointerId !== event.pointerId) {
    return;
  }

  stopMarkerDragEdgeAutoScroll();
  event.currentTarget.classList.remove('is-dragging');
  document.body.classList.remove('is-dragging-marker');

  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  autoScrollState.dragging = null;
  saveAutoScrollState({ notify: true });
}

function easeInOutCubic(t) {
  const safeT = clamp(Number(t) || 0, 0, 1);
  return safeT < 0.5
    ? 4 * safeT * safeT * safeT
    : 1 - (Math.pow(-2 * safeT + 2, 3) / 2);
}

function setAutoScrollScrollY(targetY) {
  const safeY = getReachableScrollY(targetY);
  autoScrollState.isProgrammaticScroll = true;
  window.scrollTo(0, safeY);
  autoScrollState.virtualScrollY = safeY;
  window.requestAnimationFrame(() => {
    autoScrollState.isProgrammaticScroll = false;
  });
}

function getAutoScrollLeadInStartScrollY() {
  if (!Number.isFinite(autoScrollState.startY)) {
    return 0;
  }

  return clamp(
    autoScrollState.startY - (window.innerHeight * AUTO_SCROLL_FOCUS_RATIO_START),
    0,
    getMaxWindowScrollY()
  );
}

function getLineLyricLength(lineEl) {
  if (!(lineEl instanceof Element) || !lineEl.matches('p.line:not(.blank)')) {
    return 0;
  }

  let totalLength = 0;
  const textNodes = lineEl.querySelectorAll('span:not(.chord)');
  textNodes.forEach((node) => {
    const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
    totalLength += text.length;
  });

  return totalLength;
}

function normalizeWeights(rawWeights, { floor = AUTO_SCROLL_WEIGHT_FLOOR } = {}) {
  if (!Array.isArray(rawWeights) || rawWeights.length === 0) {
    return [];
  }

  const safeFloor = clamp(Number(floor) || 0, 0, 0.9);
  const minValue = Math.min(...rawWeights);
  const maxValue = Math.max(...rawWeights);

  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || Math.abs(maxValue - minValue) < 0.0001) {
    return rawWeights.map(() => Math.max(safeFloor, 1));
  }

  return rawWeights.map((value) => {
    const normalized = clamp((value - minValue) / (maxValue - minValue), 0, 1);
    return safeFloor + (normalized * (1 - safeFloor));
  });
}

function collectAutoScrollLineEntries() {
  const sheetEl = getSheetEl();
  if (!sheetEl || !Number.isFinite(autoScrollState.startY) || !Number.isFinite(autoScrollState.endY)) {
    return [];
  }

  const lines = Array.from(sheetEl.querySelectorAll('p.line:not(.blank), p.comment'));
  const entries = [];

  lines.forEach((lineEl) => {
    const rect = lineEl.getBoundingClientRect();
    const topY = rect.top + window.scrollY;
    const bottomY = rect.bottom + window.scrollY;

    if (bottomY < autoScrollState.startY || topY > autoScrollState.endY) {
      return;
    }

    entries.push({
      el: lineEl,
      type: lineEl.matches('p.comment') ? 'comment' : 'line',
      topY,
      bottomY,
      centerY: (topY + bottomY) / 2,
      heightPx: Math.max(1, rect.height),
      lyricLength: lineEl.matches('p.comment') ? 0 : getLineLyricLength(lineEl)
    });
  });

  return entries;
}

function buildAutoScrollTimeline() {
  const entries = collectAutoScrollLineEntries();
  if (!entries.length) {
    autoScrollState.timeline = null;
    autoScrollState.timelineReady = false;
    return false;
  }

  const lyricValues = entries.map((entry) => entry.lyricLength);
  const heightValues = entries.map((entry) => entry.heightPx);
  const lyricNormalized = normalizeWeights(lyricValues, { floor: 0 });
  const heightNormalized = normalizeWeights(heightValues, { floor: 0 });

  entries.forEach((entry, index) => {
    if (entry.type === 'comment') {
      entry.weight = AUTO_SCROLL_COMMENT_WEIGHT;
      return;
    }

    const rawWeight = (lyricNormalized[index] * 0.65) + (heightNormalized[index] * 0.35);
    entry.weight = rawWeight;
  });

  const finalizedWeights = normalizeWeights(entries.map((entry) => entry.weight), {
    floor: AUTO_SCROLL_WEIGHT_FLOOR
  });

  entries.forEach((entry, index) => {
    entry.weight = finalizedWeights[index];
  });

  const segmentCount = Math.max(1, entries.length - 1);
  const segments = [];

  if (entries.length === 1) {
    segments.push({
      startY: entries[0].centerY,
      endY: entries[0].centerY,
      startSec: 0,
      durationSec: Math.max(1, autoScrollState.mainDurationSec || 0),
      endSec: Math.max(1, autoScrollState.mainDurationSec || 0),
      index: 0
    });
  } else {
    const segmentWeights = entries.slice(0, -1).map((entry) => entry.weight);
    const totalWeight = Math.max(0.0001, segmentWeights.reduce((sum, value) => sum + value, 0));
    const totalDurationSec = Math.max(1, autoScrollState.mainDurationSec || 0);
    let elapsedSec = 0;

    for (let i = 0; i < segmentCount; i += 1) {
      const ratio = segmentWeights[i] / totalWeight;
      const durationSec = i === segmentCount - 1
        ? Math.max(0.0001, totalDurationSec - elapsedSec)
        : Math.max(0.0001, totalDurationSec * ratio);
      const startSec = elapsedSec;
      const endSec = startSec + durationSec;
      elapsedSec = endSec;

      segments.push({
        startY: entries[i].centerY,
        endY: entries[i + 1].centerY,
        startSec,
        durationSec,
        endSec,
        index: i
      });
    }
  }

  autoScrollState.timeline = {
    entries,
    segments,
    durationSec: Math.max(1, autoScrollState.mainDurationSec || 0),
    startFocusY: entries[0].centerY,
    endFocusY: entries[entries.length - 1].centerY
  };
  autoScrollState.timelineReady = true;
  return true;
}

function refreshAutoScrollTimelineFromCurrentSettings() {
  if (autoScrollState.variableScrollEnabled === false) {
    autoScrollState.leadInSec = 0;
    autoScrollState.mainDurationSec = Math.max(1, autoScrollState.durationSec);
    autoScrollState.timeline = null;
    autoScrollState.timelineReady = false;
    return true;
  }

  autoScrollState.leadInSec = Math.max(0, Math.min(AUTO_SCROLL_LEAD_IN_SEC, autoScrollState.durationSec - 1));
  autoScrollState.mainDurationSec = Math.max(1, autoScrollState.durationSec - autoScrollState.leadInSec);
  return buildAutoScrollTimeline();
}

function getTimelineFocusYAtProgress(progressSec) {
  const timeline = autoScrollState.timeline;
  if (!timeline || !timeline.segments?.length) {
    return Number.isFinite(autoScrollState.startY) ? autoScrollState.startY : 0;
  }

  const safeProgress = clamp(Number(progressSec) || 0, 0, timeline.durationSec);
  const segment = timeline.segments.find((item) => safeProgress <= item.endSec + 0.0001)
    || timeline.segments[timeline.segments.length - 1];

  const localRatio = segment.durationSec > 0.0001
    ? clamp((safeProgress - segment.startSec) / segment.durationSec, 0, 1)
    : 1;
  return segment.startY + ((segment.endY - segment.startY) * localRatio);
}

function estimateProgressSecFromFocusY(focusY) {
  const timeline = autoScrollState.timeline;
  if (!timeline || !timeline.segments?.length) {
    return 0;
  }

  let bestProgressSec = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  timeline.segments.forEach((segment) => {
    const deltaY = segment.endY - segment.startY;
    let ratio = 0;

    if (Math.abs(deltaY) > 0.0001) {
      ratio = (focusY - segment.startY) / deltaY;
      ratio = clamp(ratio, 0, 1);
    }

    const projectedY = segment.startY + (deltaY * ratio);
    const distance = Math.abs(projectedY - focusY);
    const progressSec = segment.startSec + (segment.durationSec * ratio);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestProgressSec = progressSec;
    }
  });

  return clamp(bestProgressSec, 0, timeline.durationSec);
}

function syncAutoScrollProgressFromScrollY(scrollY) {
  if (!autoScrollState.isPlaying || !autoScrollState.timelineReady || !autoScrollState.timeline) {
    return;
  }

  const effectiveScrollY = Number.isFinite(scrollY) ? scrollY : window.scrollY;
  const focusRatio = Number.isFinite(autoScrollState.focusRatioCurrent)
    ? autoScrollState.focusRatioCurrent
    : AUTO_SCROLL_FOCUS_RATIO_FINAL;
  const focusY = effectiveScrollY + (window.innerHeight * focusRatio);

  autoScrollState.progressSec = estimateProgressSecFromFocusY(focusY);
  autoScrollState.phase = 'main';
  autoScrollState.hasScrollStarted = true;
  autoScrollState.phaseElapsedSec = autoScrollState.leadInSec;
  autoScrollState.focusRatioCurrent = AUTO_SCROLL_FOCUS_RATIO_FINAL;
  autoScrollState.lastFrameMs = performance.now();

  if (autoScrollState.isPlaying) {
    updatePlayingStatus({ force: true });
  }
}

function syncAutoScrollPlaybackFromScrollY(scrollY, { fromUserScroll = false } = {}) {
  if (!autoScrollState.isPlaying) {
    return;
  }

  const effectiveScrollY = Number.isFinite(scrollY) ? scrollY : window.scrollY;
  autoScrollState.virtualScrollY = effectiveScrollY;

  if (fromUserScroll) {
    autoScrollState.userScrollOverrideUntilMs = performance.now() + AUTO_SCROLL_USER_SCROLL_OVERRIDE_MS;
  }

  if (autoScrollState.variableScrollEnabled === false) {
    const startScrollY = getAutoScrollStartScrollY();
    const stopScrollY = getAutoScrollStopScrollY();
    const range = Math.max(1, stopScrollY - startScrollY);
    const ratio = clamp((effectiveScrollY - startScrollY) / range, 0, 1);
    const duration = Math.max(0, Number(autoScrollState.durationSec) || 0);
    autoScrollState.playbackElapsedSec = clamp(duration * ratio, 0, duration);
    autoScrollState.phase = 'main';
    autoScrollState.hasScrollStarted = ratio > 0.001;
    autoScrollState.phaseElapsedSec = autoScrollState.playbackElapsedSec;
    autoScrollState.focusRatioCurrent = AUTO_SCROLL_FOCUS_RATIO_FINAL;
    autoScrollState.lastFrameMs = performance.now();
    updatePlayingStatus({ force: true });
    return;
  }

  if (!autoScrollState.timelineReady || !autoScrollState.timeline) {
    return;
  }

  syncAutoScrollProgressFromScrollY(effectiveScrollY);
  autoScrollState.playbackElapsedSec = clamp(
    autoScrollState.leadInSec + autoScrollState.progressSec,
    0,
    Math.max(0, Number(autoScrollState.durationSec) || 0)
  );
}

function getAutoScrollStartScrollY() {
  if (!Number.isFinite(autoScrollState.startY)) {
    return 0;
  }

  const preferredViewportY = window.innerHeight * AUTO_SCROLL_FOCUS_VIEWPORT_RATIO;
  return clamp(autoScrollState.startY - preferredViewportY, 0, getMaxWindowScrollY());
}

function getAutoScrollStopScrollY() {
  if (!Number.isFinite(autoScrollState.endY)) {
    return 0;
  }

  const stopViewportY = (window.innerHeight * AUTO_SCROLL_STOP_VIEWPORT_RATIO) - AUTO_SCROLL_END_STOP_BUFFER_PX;
  return clamp(autoScrollState.endY - stopViewportY, 0, getMaxWindowScrollY());
}

function isEndMarkerVisibleInViewport() {
  const endMarkerEl = getEndMarkerEl();
  if (!endMarkerEl) {
    return false;
  }

  const rect = endMarkerEl.getBoundingClientRect();
  // End がビューポート内へ100px入ったら true を返す
  return rect.top <= window.innerHeight - AUTO_SCROLL_END_STOP_BUFFER_PX;
}

function stopAutoScroll(message = 'Stopped', tone = 'info', { reachedEnd = false } = {}) {
  if (autoScrollState.frameId) {
    window.cancelAnimationFrame(autoScrollState.frameId);
    autoScrollState.frameId = null;
  }

  autoScrollState.isPlaying = false;
  autoScrollState.speedPxPerSec = 0;
  autoScrollState.playbackElapsedSec = 0;
  autoScrollState.playStartScrollY = 0;
  autoScrollState.phase = 'main';
  autoScrollState.hasScrollStarted = false;
  autoScrollState.phaseElapsedSec = 0;
  autoScrollState.focusRatioCurrent = AUTO_SCROLL_FOCUS_RATIO_FINAL;
  autoScrollState.lastStatusRemainingSec = null;
  autoScrollState.lastStatusTone = '';
  autoScrollState.lastStatusSpeed = null;
  autoScrollState.mainDurationSec = 0;
  autoScrollState.leadInSec = 0;
  autoScrollState.timelineReady = false;
  autoScrollState.userScrollOverrideUntilMs = 0;

  if (reachedEnd) {
    autoScrollState.rewindToStartPending = true;
    autoScrollState.startFromMarkerPending = true;
  }

  updateAutoScrollControls();
  saveAutoScrollState({ notify: false });
  setStatus(message, tone);
}

function recalculateLegacyAutoScrollSpeed() {
  const remainingTimeSec = getAutoScrollRemainingSec();
  const remainingDistancePx = getAutoScrollStopScrollY() - window.scrollY;

  if (remainingDistancePx <= 0.5) {
    stopAutoScroll('Stopped · End が見えたため停止', 'success', { reachedEnd: true });
    return false;
  }

  if (remainingTimeSec <= 0) {
    stopAutoScroll('Stopped · 残り時間が 0 秒です', 'warn');
    return false;
  }

  const baseSpeedPxPerSec = remainingDistancePx / remainingTimeSec;
  const targetSpeedPxPerSec = baseSpeedPxPerSec * (Number.isFinite(autoScrollState.speedMultiplier) ? autoScrollState.speedMultiplier : 1);

  if (Number.isFinite(autoScrollState.speedPxPerSec) && autoScrollState.speedPxPerSec > 0) {
    autoScrollState.speedPxPerSec += (targetSpeedPxPerSec - autoScrollState.speedPxPerSec) * AUTO_SCROLL_SPEED_SMOOTHING;
  } else {
    autoScrollState.speedPxPerSec = targetSpeedPxPerSec;
  }

  return true;
}

function recalculateAutoScrollSpeed() {
  if (!autoScrollState.isPlaying) {
    return true;
  }

  if (isEndMarkerVisibleInViewport()) {
    stopAutoScroll('Stopped · End が見えたため停止', 'success', { reachedEnd: true });
    return false;
  }

  if (autoScrollState.variableScrollEnabled === false) {
    return recalculateLegacyAutoScrollSpeed();
  }

  if (!Number.isFinite(autoScrollState.mainDurationSec) || autoScrollState.mainDurationSec <= 0) {
    stopAutoScroll('Stopped · 本編時間が 1 秒未満です', 'warn');
    return false;
  }

  const currentFocusRatio = Number.isFinite(autoScrollState.focusRatioCurrent)
    ? autoScrollState.focusRatioCurrent
    : AUTO_SCROLL_FOCUS_RATIO_FINAL;
  const currentFocusY = window.scrollY + (window.innerHeight * currentFocusRatio);
  const currentProgressSec = autoScrollState.timelineReady
    ? estimateProgressSecFromFocusY(currentFocusY)
    : clamp(Number(autoScrollState.progressSec) || 0, 0, autoScrollState.mainDurationSec);

  if (!refreshAutoScrollTimelineFromCurrentSettings()) {
    stopAutoScroll('Stopped · 行タイムラインを作成できません', 'warn');
    return false;
  }

  autoScrollState.progressSec = clamp(currentProgressSec, 0, autoScrollState.timeline.durationSec);

  return true;
}

function runAutoScrollFrame(nowMs) {
  if (!autoScrollState.isPlaying) {
    return;
  }

  const deltaSec = Math.max(0, (nowMs - autoScrollState.lastFrameMs) / 1000);
  autoScrollState.lastFrameMs = nowMs;

  if (autoScrollState.userScrollOverrideUntilMs > nowMs) {
    autoScrollState.virtualScrollY = window.scrollY;
    autoScrollState.frameId = window.requestAnimationFrame(runAutoScrollFrame);
    return;
  }

  if (isEndMarkerVisibleInViewport()) {
    stopAutoScroll('Stopped · End が見えたため停止', 'success', { reachedEnd: true });
    return;
  }

  const multiplier = Number.isFinite(autoScrollState.speedMultiplier) ? autoScrollState.speedMultiplier : 1;
  const effectiveDeltaSec = deltaSec * multiplier;
  let focusRatioCurrent = Number.isFinite(autoScrollState.focusRatioCurrent)
    ? autoScrollState.focusRatioCurrent
    : AUTO_SCROLL_FOCUS_RATIO_FINAL;

  autoScrollState.playbackElapsedSec = Math.min(
    Math.max(0, Number(autoScrollState.durationSec) || 0),
    autoScrollState.playbackElapsedSec + effectiveDeltaSec
  );

  if (autoScrollState.variableScrollEnabled === false) {
    autoScrollState.phase = 'main';
    autoScrollState.hasScrollStarted = true;

    if (!recalculateAutoScrollSpeed()) {
      return;
    }

    autoScrollState.virtualScrollY += autoScrollState.speedPxPerSec * deltaSec;
    setAutoScrollScrollY(autoScrollState.virtualScrollY);
    updatePlayingStatus();

    if (isEndMarkerVisibleInViewport()) {
      stopAutoScroll('Stopped · End が見えたため停止', 'success', { reachedEnd: true });
      return;
    }

    autoScrollState.frameId = window.requestAnimationFrame(runAutoScrollFrame);
    return;
  }

  if (autoScrollState.phase === 'lead-in') {
    autoScrollState.phaseElapsedSec += effectiveDeltaSec;

    const leadRatio = autoScrollState.leadInSec > 0
      ? clamp(autoScrollState.phaseElapsedSec / autoScrollState.leadInSec, 0, 1)
      : 1;
    const eased = easeInOutCubic(leadRatio);
    focusRatioCurrent = AUTO_SCROLL_FOCUS_RATIO_START
      + ((AUTO_SCROLL_FOCUS_RATIO_FINAL - AUTO_SCROLL_FOCUS_RATIO_START) * eased);

    if (leadRatio >= 1) {
      autoScrollState.phase = 'main';
      focusRatioCurrent = AUTO_SCROLL_FOCUS_RATIO_FINAL;
    }
  } else {
    autoScrollState.progressSec = clamp(
      autoScrollState.progressSec + effectiveDeltaSec,
      0,
      autoScrollState.timeline?.durationSec || autoScrollState.mainDurationSec
    );
    focusRatioCurrent = AUTO_SCROLL_FOCUS_RATIO_FINAL;
  }

  autoScrollState.focusRatioCurrent = focusRatioCurrent;

  const focusY = autoScrollState.phase === 'lead-in'
    ? (Number.isFinite(autoScrollState.timeline?.startFocusY) ? autoScrollState.timeline.startFocusY : autoScrollState.startY)
    : getTimelineFocusYAtProgress(autoScrollState.progressSec);
  const targetScrollY = focusY - (window.innerHeight * focusRatioCurrent);
  const reachableTargetScrollY = getReachableScrollY(targetScrollY);

  setAutoScrollScrollY(reachableTargetScrollY);

  if (!autoScrollState.hasScrollStarted && Math.abs(window.scrollY - autoScrollState.playStartScrollY) > 0.6) {
    autoScrollState.hasScrollStarted = true;
  }

  updatePlayingStatus();

  if (isEndMarkerVisibleInViewport()) {
    stopAutoScroll('Stopped · End が見えたため停止', 'success', { reachedEnd: true });
    return;
  }

  autoScrollState.frameId = window.requestAnimationFrame(runAutoScrollFrame);
}

function handleAutoScrollWheelAdjust(event) {
  if (!autoScrollState.isPlaying || event.defaultPrevented || event.ctrlKey || event.metaKey) {
    return;
  }

  const deltaY = Number(event.deltaY) || 0;
  if (Math.abs(deltaY) < 4) {
    return;
  }

  const steps = Math.min(4, Math.max(1, Math.round(Math.abs(deltaY) / AUTO_SCROLL_WHEEL_STEP_PX)));

  if (deltaY < 0) {
    nudgeAutoScrollSpeed(-1, { steps, notify: true });
  } else {
    nudgeAutoScrollSpeed(1, { steps, notify: true });
  }
}

function scrollBackToAutoScrollStart({ notify = true } = {}) {
  const targetScrollY = getAutoScrollStartScrollY();
  setAutoScrollScrollY(targetScrollY);
  autoScrollState.rewindToStartPending = false;
  autoScrollState.startFromMarkerPending = true;

  if (notify) {
    setStatus(`Stopped · Start に戻りました。もう一度クリックで再生 · ${formatSpeedMultiplier()}`, 'warn');
  }
}

function shouldScrollToStart() {
  return Boolean(autoScrollState.startFromMarkerPending && Number.isFinite(autoScrollState.startY));
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

  const startScrollY = getAutoScrollStartScrollY();
  const shouldStartAtMarker = shouldScrollToStart();
  const shouldResumeFromCurrent = !shouldStartAtMarker
    && Math.abs(window.scrollY - startScrollY) > START_SCROLL_TOLERANCE_PX;

  if (autoScrollState.variableScrollEnabled !== false) {
    if (!refreshAutoScrollTimelineFromCurrentSettings()) {
      setStatus('Stopped · 行タイムラインを作成できません', 'warn');
      return;
    }

    const leadInStartScrollY = getAutoScrollLeadInStartScrollY();

    if (shouldStartAtMarker) {
      setAutoScrollScrollY(leadInStartScrollY);
    } else if (!shouldResumeFromCurrent && Math.abs(window.scrollY - leadInStartScrollY) > START_SCROLL_TOLERANCE_PX) {
      setAutoScrollScrollY(leadInStartScrollY);
    }
  } else if (shouldStartAtMarker) {
    setAutoScrollScrollY(startScrollY);
  }

  autoScrollState.rewindToStartPending = false;
  autoScrollState.startFromMarkerPending = false;
  autoScrollState.isPlaying = true;
  autoScrollState.startedAtMs = performance.now();
  autoScrollState.lastFrameMs = autoScrollState.startedAtMs;
  autoScrollState.virtualScrollY = window.scrollY;
  autoScrollState.playStartScrollY = window.scrollY;
  autoScrollState.userScrollOverrideUntilMs = 0;
  autoScrollState.progressSec = 0;
  autoScrollState.playbackElapsedSec = 0;
  autoScrollState.phase = (autoScrollState.variableScrollEnabled !== false && autoScrollState.leadInSec > 0) ? 'lead-in' : 'main';
  autoScrollState.hasScrollStarted = autoScrollState.variableScrollEnabled === false;
  autoScrollState.phaseElapsedSec = 0;
  autoScrollState.focusRatioCurrent = autoScrollState.phase === 'lead-in'
    ? AUTO_SCROLL_FOCUS_RATIO_START
    : AUTO_SCROLL_FOCUS_RATIO_FINAL;
  autoScrollState.lastStatusRemainingSec = null;
  autoScrollState.lastStatusTone = '';
  autoScrollState.lastStatusSpeed = null;

  if (shouldResumeFromCurrent) {
    autoScrollState.phase = 'main';
    autoScrollState.hasScrollStarted = true;
    autoScrollState.phaseElapsedSec = autoScrollState.leadInSec;
    autoScrollState.focusRatioCurrent = AUTO_SCROLL_FOCUS_RATIO_FINAL;
    syncAutoScrollPlaybackFromScrollY(window.scrollY, { fromUserScroll: false });
  }

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
  updatePlayingStatus({ force: true });
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

  const annotationTarget = event.target instanceof Element
    ? event.target.closest('.autoscroll-marker, .sticky-note, .sheet-annotation-root, .annotation-ink-layer')
    : null;
  const inkInteractionActive = typeof songAnnotationsState !== 'undefined'
    && Boolean(songAnnotationsState.inkModeEnabled || songAnnotationsState.drawingSession);

  if (autoScrollState.dragging || annotationTarget || inkInteractionActive) {
    return;
  }

  if (!autoScrollState.isPlaying && autoScrollState.rewindToStartPending) {
    scrollBackToAutoScrollStart({ notify: true });
    return;
  }

  toggleAutoScroll();
}

async function handleDeleteSong() {
  const artist = getQueryParam('artist');
  const id = getQueryParam('id');

  if (!artist || !id) {
    setStatus('Stopped · 削除対象を特定できません', 'warn');
    return;
  }

  const confirmed = window.confirm('この曲を削除します。元に戻せません。');
  if (!confirmed) {
    return;
  }

  setStatus('Deleting...', 'warn');

  try {
    const response = await fetch(
      buildEditSongApiUrl(artist, id),
      {
        method: 'DELETE',
        credentials: 'include'
      }
    );

    const body = await parseJsonResponse(response);
    if (!response.ok) {
      const detail = getErrorDetail(body, '削除に失敗しました。');
      setStatus(`Stopped · ${detail}`, 'warn');
      return;
    }

    window.location.href = '/';
  } catch (error) {
    console.error('Failed to delete song:', error);
    setStatus('Stopped · 削除中に通信エラー', 'warn');
  }
}

function resetAutoScrollDuration() {
  autoScrollState.durationSec = DEFAULT_DURATION_SEC;
  setDurationInputs(autoScrollState.durationSec);

  if (autoScrollState.isPlaying && !recalculateAutoScrollSpeed()) {
    return;
  }

  saveAutoScrollState({ notify: true });
}

function resetAutoScrollSpeed() {
  setAutoScrollSpeedMultiplier(1, { persist: true, notify: true });
}

function resetAutoScrollMarkers() {
  const defaults = getDefaultMarkerPositions();
  autoScrollState.startY = defaults.startY;
  autoScrollState.endY = defaults.endY;
  autoScrollState.rewindToStartPending = false;
  autoScrollState.startFromMarkerPending = true;

  renderMarkerPositions();
  refreshAutoScrollTimelineFromCurrentSettings();

  if (autoScrollState.isPlaying && !recalculateAutoScrollSpeed()) {
    return;
  }

  saveAutoScrollState({ notify: true });
}

function refreshAutoScrollAfterRender({ restoreSavedState = false } = {}) {
  syncCompactMarkerMode();
  ensureMarkerElements();

  if (restoreSavedState || !autoScrollState.hasLoadedSavedState) {
    restoreAutoScrollState();
    autoScrollState.hasLoadedSavedState = true;
  } else {
    applyMarkerStateToRenderedSheet({ resetInvalidRange: false });
  }

  updateAutoScrollControls();
}
