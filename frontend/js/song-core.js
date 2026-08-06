/*
 * 動作確認メモ
 * - 曲ページを開き、譜面左側に Start / End ピンが表示されることを確認する。
 * - 分・秒を変更すると即保存され、状態表示が Saved になることを確認する。
 * - Start で自動スクロールを開始し、再生中にマーカーを動かしても止まらず再計算されることを確認する。
 * - End マーカーが画面内に入った時点で自動停止することを確認する。
 * - 移調ボタン(-/+)を操作しても、上付き表示・MNoto表示が破綻しないことを確認する。
 */
const {
  buildApiUrl,
  buildSongApiUrl,
  buildEditSongApiUrl,
  getErrorDetail,
  parseJsonResponse
} = window.ChordWikiApiUtils;
const {
  normalizeTextBlock,
  normalizeSongTags,
  normalizeSongYoutubeEntries,
  extractYoutubeId,
  extractYoutubeStart,
  parseYoutubeLine,
  parseYoutubeTextarea,
  formatYoutubeEntriesForEdit
} = window.ChordWikiSongUtils;
const {
  AUTO_SCROLL_STORAGE_PREFIX = 'autoscroll:v1',
  SONG_PREFS_STORAGE_PREFIX = 'prefs:v1',
  METRO_BEATS_STORAGE_PREFIX = 'metroBeats:v1',
  AUTO_SCROLL_COLLAPSED_STORAGE_KEY = 'autoscrollCollapsed',
  SONG_EXTRAS_COLLAPSED_STORAGE_KEY = 'songExtrasCollapsed',
  DISPLAY_PREFS_STORAGE_KEY = 'displayPrefs:v1',
  DISPLAY_PREFS_COLLAPSED_STORAGE_KEY = 'displayPrefsCollapsed'
} = window.ChordWikiStorageKeys || {};

let originalChordPro = '';
let transposeSemitones = 0;
let accidentalMode = 'none';
let songPrefsStorageKey = null;
let metroBeatsStorageKey = null;
let currentSongKey = '';
let currentSongEstimatedKey = '';
let currentSongEstimatedKeyMode = 'sharp';
let currentSongData = null;

const MIN_TRANSPOSE = -6;
const MAX_TRANSPOSE = 6;
const METRO_BPM_MIN = 30;
const METRO_BPM_MAX = 300;
const METRO_BEATS_MIN = 2;
const METRO_BEATS_MAX = 6;
const METRO_ACCENT_RATIO = 0.22;
const MAX_AUTOSCROLL_MINUTES = 99;
const MAX_AUTOSCROLL_DURATION_SEC = (MAX_AUTOSCROLL_MINUTES * 60) + 59;
const DEFAULT_DURATION_SEC = 4 * 60;
const DEFAULT_DURATION_ESTIMATE_MIN_SEC = (3 * 60) + 55;
const DEFAULT_DURATION_ESTIMATE_MAX_SEC = (4 * 60) + 5;
const AUTO_SCROLL_ESTIMATE_RATIO = 0.97;
const START_SCROLL_TOLERANCE_PX = 10;
const AUTO_SCROLL_STOP_VIEWPORT_RATIO = 1;
const AUTO_SCROLL_FOCUS_VIEWPORT_RATIO = 0.54;
const AUTO_SCROLL_FOCUS_RATIO_START = 0.2;
const AUTO_SCROLL_FOCUS_RATIO_FINAL = 0.4;
const AUTO_SCROLL_LEAD_IN_SEC = 1;
const AUTO_SCROLL_WEIGHT_FLOOR = 0.22;
const AUTO_SCROLL_WEIGHT_LYRIC_RATIO = 0.55;
const AUTO_SCROLL_WEIGHT_CHORD_RATIO = 0.25;
const AUTO_SCROLL_WEIGHT_VISUAL_RATIO = 0.15;
const AUTO_SCROLL_WEIGHT_BAR_HINT_RATIO = 0.05;
const AUTO_SCROLL_PERFORMANCE_LINE_LYRIC_MAX = 2;
const AUTO_SCROLL_PERFORMANCE_LINE_CHORD_MIN = 4;
const AUTO_SCROLL_PERFORMANCE_LINE_MIN_WEIGHT = 0.45;
const AUTO_SCROLL_SEGMENT_MIN_AVG_RATIO = 0.45;
const AUTO_SCROLL_SEGMENT_MAX_AVG_RATIO = 2.2;
const AUTO_SCROLL_START_MARKER_OFFSET_LINES = 1;
const AUTO_SCROLL_SPEED_STEP = 0.05;
const AUTO_SCROLL_SPEED_MIN_MULTIPLIER = 0.5;
const AUTO_SCROLL_SPEED_MAX_MULTIPLIER = 3;
const AUTO_SCROLL_WHEEL_STEP_PX = 72;
const AUTO_SCROLL_SPEED_SMOOTHING = 0.18;
const AUTO_SCROLL_END_MARKER_EXTRA_PX = 20;
const AUTO_SCROLL_END_STOP_BUFFER_PX = 100;
const AUTO_SCROLL_END_COUNTDOWN_TICK_MS = 120;
const AUTO_SCROLL_OVERLAY_END_MIN_DURATION_SEC = 0.4;
const AUTO_SCROLL_OVERLAY_RELEASE_DELAY_MS = 2000;
const AUTO_SCROLL_FOCUS_OVERLAY_MIN_LINES = 4;
const AUTO_SCROLL_FOCUS_CONTEXT_LINES = 4;
const AUTO_SCROLL_FOCUS_CONTEXT_LINES_MIN = 2;
const AUTO_SCROLL_FOCUS_CONTEXT_LINES_MAX = 6;
const AUTO_SCROLL_FOCUS_OVERLAY_MIN_SCROLL_PX = 72;
const AUTO_SCROLL_USER_SCROLL_OVERRIDE_MS = 260;
const MARKER_EDGE_SCROLL_ZONE_PX = 64;
const MARKER_EDGE_SCROLL_BASE_SPEED = 180;
const MARKER_EDGE_SCROLL_MAX_SPEED = 1600;
const MARKER_EDGE_SCROLL_POINTER_SPEED_FACTOR = 0.35;
const LYRIC_SYMBOL_RE = /[\s\u0000-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u00BF\u30FB\u30FC\u2010-\u2027\u2030-\u205E\u2060-\u206F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]/g;
const CHORD_ALLOWED_PATTERN = /^[A-G](#|b)?((?:m|M|maj|min|sus[0-9]*|add[0-9]*|dim|aug)*[0-9]*(?:-[0-9]+)?)(?:\([^)]+\)|\{[^}]+\})*(?:\/[A-G](#|b)?(?:\([^)]+\)|\{[^}]+\})*)?$/i;
const NARROW_SYMBOL_PATTERN = /^(?:[\-=≫≧＞>!~]+|n\.c\.?)$/i;
const LOCAL_TEST_SONG_SCRIPT_PATH = './.local/local-test-song.js';
const LOCAL_TEST_SONG_GLOBAL_KEY = '__LOCAL_TEST_SONG__';
const LOCAL_TEST_SONG_LIBRARY_GLOBAL_KEY = '__LOCAL_TEST_SONG_LIBRARY__';
// VOICE_MARKER_PATTERN と VOICE_MARKER_CLASS_MAP は chordwiki-render.js で定義済み
const MNOTO_FONT_CANDIDATES = Object.freeze([
  '"MNoto Sans alpha V2"',
  '"MNoto Sans alpha"',
  '"MNoto Sans"',
  '"MNotoSans-alpha-ExtraBold"'
]);

const mnotoAvailabilityState = {
  checked: false,
  available: false,
  family: ''
};

const DEFAULT_DISPLAY_PREFS = Object.freeze({
  enabled: false,
  adjustChordPos: true,
  extendBarUpward: false,
  alignMeasureBars: false,
  chordStyle: 'none',
  mnotoEnabled: false,
  superscriptEnabled: false,
  chordFontSize: 14,
  chordOffsetPx: 7,
  chordLineOffsetPx: 0,
  lyricLineGapPx: 15,
  blankLineHeightPx: 14,
  commentLineGapPx: 16,
  lyricFontWeight: 'normal',
  commentFontWeight: 'bold'
});

const SCORE_LINE_SELECTOR = 'p.line:not(.blank)';
const LYRICS_SPAN_SELECTOR = 'span.word, span.wordtop';
const VOICE_PART_SELECTOR = '.male, .male2, .female, .female2';
const RC_BAR_EXTEND_CLASS = 'rc-bar-extend';
const RC_BAR_EXTEND_GLYPH_CLASS = 'rc-bar-extend-glyph';
const RC_MEASURE_CLASS = 'rc-measure';
const RC_MEASURE_BAR_CLASS = 'rc-measure-bar';
const RC_BEAT_CLASS = 'rc-beat';
const MEASURE_BAR_SELECTOR = `span.${RC_BAR_EXTEND_GLYPH_CLASS}, span.${RC_MEASURE_BAR_CLASS}`;
const BLOCK_BOUNDARY_SELECTOR = 'p.line.blank, p.comment';

const displayPrefsState = {
  ...DEFAULT_DISPLAY_PREFS
};

const songMetaModalState = {
  mode: 'tags',
  isSaving: false
};

const autoScrollEstimateState = {
  attempted: false,
  inFlight: false
};

const autoScrollState = {
  storageKey: null,
  defaultStartY: null,
  defaultEndY: null,
  startY: null,
  endY: null,
  durationSec: DEFAULT_DURATION_SEC,
  variableScrollEnabled: true,
  isPlaying: false,
  frameId: null,
  startedAtMs: 0,
  lastFrameMs: 0,
  playStartScrollY: 0,
  speedPxPerSec: 0,
  speedMultiplier: 1,
  virtualScrollY: 0,
  progressSec: 0,
  mainDurationSec: 0,
  leadInSec: 0,
  playbackElapsedSec: 0,
  phase: 'main',
  hasScrollStarted: false,
  phaseElapsedSec: 0,
  focusRatioCurrent: AUTO_SCROLL_FOCUS_RATIO_FINAL,
  lastStatusRemainingSec: null,
  lastStatusTone: '',
  lastStatusSpeed: null,
  timeline: null,
  timelineReady: false,
  isProgrammaticScroll: false,
  userScrollOverrideUntilMs: 0,
  dragging: null,
  hasLoadedSavedState: false,
  rewindToStartPending: false,
  startFromMarkerPending: false,
  highlightEnabled: true,
  focusContextLines: AUTO_SCROLL_FOCUS_CONTEXT_LINES,
  overlayScreenY: null,
  overlayHighlightHeight: 140,
  overlayEndAnimId: null,
  overlayReleaseTimerId: 0,
  overlayPhase: 'center',
  overlayPrevScrollY: 0,
  endCountdownTimerId: 0
};

const youtubeTitleCache = new Map();
const localTestSongState = {
  scriptPromise: null
};
const youtubePlayerState = {
  apiPromise: null,
  playerPromise: null,
  player: null,
  currentVideoId: '',
  currentStart: 0
};

const metroState = {
  enabled: false,
  bpm: null,
  beatsPerMeasure: 4,
  isRunning: false,
  rafId: null,
  startedAtMs: 0,
  lastBeatIndex: -1
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

function getSongPrefsStorageKey(artist, id) {
  return `${SONG_PREFS_STORAGE_PREFIX}:${artist}:${id}`;
}

function getMetroBeatsStorageKey(artist, id) {
  return `${METRO_BEATS_STORAGE_PREFIX}:${artist}:${id}`;
}

function clampMetroBeats(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return 4;
  }
  return clamp(parsed, METRO_BEATS_MIN, METRO_BEATS_MAX);
}

function parseBpmFromText(text = '') {
  const s = String(text || '');
  const rangeMatch = s.match(
    /BPM\s*[=≒≈＝]\s*(\d{1,3})\s*[～〜~\-\u2013\u2014\u2212]\s*(\d{1,3})/i,
  );
  if (rangeMatch) {
    const a = Number.parseInt(rangeMatch[1], 10);
    const b = Number.parseInt(rangeMatch[2], 10);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return null;
    }
    if (a < METRO_BPM_MIN || a > METRO_BPM_MAX || b < METRO_BPM_MIN || b > METRO_BPM_MAX) {
      return null;
    }
    return clamp(Math.round((a + b) / 2), METRO_BPM_MIN, METRO_BPM_MAX);
  }

  const singleMatch = s.match(/BPM\s*[=≒≈＝]\s*(\d{1,3})/i);
  if (!singleMatch || !singleMatch[1]) {
    return null;
  }

  const bpm = Number.parseInt(singleMatch[1], 10);
  if (!Number.isFinite(bpm) || bpm < METRO_BPM_MIN || bpm > METRO_BPM_MAX) {
    return null;
  }

  return bpm;
}

function normalizeChordProLines(chordProText = '') {
  return String(chordProText || '').replace(/\r\n|\n\r|\r/g, '\n').split('\n');
}

function collectBpmCandidatesFromChordPro(chordProText = '') {
  const lines = normalizeChordProLines(chordProText);
  const bpmCandidates = [];
  const renderedSourceIndices = [];

  lines.forEach((rawLine, sourceIndex) => {
    const directive = rawLine.match(/^\{\s*([^:}]+)\s*:\s*(.*)\}\s*$/);
    if (directive) {
      const key = String(directive[1] || '').trim().toLowerCase();
      const value = String(directive[2] || '').trim();

      const bpm = parseBpmFromText(value);
      if (bpm && (key === 'comment' || key === 'c' || key === 'comment_italic' || key === 'ci')) {
        bpmCandidates.push({ bpm, sourceIndex });
      }

      if (key === 'comment' || key === 'c' || key === 'comment_italic' || key === 'ci') {
        renderedSourceIndices.push(sourceIndex);
      }
      return;
    }

    if (String(rawLine || '').trim() !== '') {
      renderedSourceIndices.push(sourceIndex);
    }
  });

  return { bpmCandidates, renderedSourceIndices };
}

function getNearestSourceIndexFromStartMarker(renderedSourceIndices) {
  const sheetEl = getSheetEl();
  const markerY = Number(autoScrollState?.startY);
  if (!sheetEl || !Number.isFinite(markerY) || !Array.isArray(renderedSourceIndices) || renderedSourceIndices.length === 0) {
    return null;
  }

  const renderedEls = Array.from(sheetEl.querySelectorAll('p.line:not(.blank), p.comment'));
  if (!renderedEls.length) {
    return null;
  }

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  renderedEls.forEach((lineEl, index) => {
    const rect = lineEl.getBoundingClientRect();
    const centerY = rect.top + window.scrollY + (rect.height / 2);
    const distance = Math.abs(centerY - markerY);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return renderedSourceIndices[Math.min(nearestIndex, renderedSourceIndices.length - 1)] ?? null;
}

function resolveBpmForCurrentStartMarker(chordProText = '') {
  const { bpmCandidates, renderedSourceIndices } = collectBpmCandidatesFromChordPro(chordProText);
  if (!bpmCandidates.length) {
    return null;
  }

  const startSourceIndex = getNearestSourceIndexFromStartMarker(renderedSourceIndices);
  if (!Number.isFinite(startSourceIndex)) {
    return bpmCandidates[0].bpm;
  }

  let winner = bpmCandidates[0];
  let bestDistance = Math.abs(winner.sourceIndex - startSourceIndex);
  for (let index = 1; index < bpmCandidates.length; index += 1) {
    const candidate = bpmCandidates[index];
    const distance = Math.abs(candidate.sourceIndex - startSourceIndex);
    if (distance < bestDistance) {
      winner = candidate;
      bestDistance = distance;
    }
  }

  return winner.bpm;
}

function getMetroRowEl() {
  return document.getElementById('cw-metro-row');
}

function getMetroBarEl() {
  return document.getElementById('cw-metro-bar');
}

function getMetroFaderEl() {
  return document.getElementById('cw-metro-fader');
}

function getMetroDotsEl() {
  return document.getElementById('cw-metro-dots');
}

function getMetroBeatsSelectEl() {
  return document.getElementById('cw-metro-beats');
}

function getMetroToggleButtonEl() {
  return document.getElementById('cw-metro-toggle');
}

function buildMetroDots(count = 4) {
  const dotsEl = getMetroDotsEl();
  if (!dotsEl) {
    return;
  }

  dotsEl.textContent = '';
  for (let index = 0; index < count; index += 1) {
    const dotEl = document.createElement('span');
    dotEl.className = 'cw-metro-dot';
    dotsEl.appendChild(dotEl);
  }
}

function setMetroToggleLabel() {
  const buttonEl = getMetroToggleButtonEl();
  if (!buttonEl) {
    return;
  }
  buttonEl.textContent = metroState.isRunning ? '停止' : '再開';
}

function setMetroUiEnabled(enabled) {
  const rowEl = getMetroRowEl();
  const beatsEl = getMetroBeatsSelectEl();
  const toggleEl = getMetroToggleButtonEl();
  const isEnabled = Boolean(enabled);

  rowEl?.classList.toggle('is-disabled', !isEnabled);
  beatsEl && (beatsEl.disabled = !isEnabled);
  toggleEl && (toggleEl.disabled = !isEnabled);
  setMetroToggleLabel();
}

function resetMetroVisuals() {
  const rowEl = getMetroRowEl();
  const barEl = getMetroBarEl();
  const faderEl = getMetroFaderEl();
  const dots = Array.from(getMetroDotsEl()?.querySelectorAll('.cw-metro-dot') || []);
  const barWidth = barEl?.clientWidth || 0;
  const faderWidth = faderEl?.offsetWidth || 16;
  const range = Math.max(0, barWidth - faderWidth);

  if (faderEl) {
    faderEl.style.transform = `translate(${range}px, -50%)`;
  }

  rowEl?.classList.remove('is-accent');
  dots.forEach((dot, index) => {
    dot.classList.toggle('is-active', index === 0);
    dot.classList.toggle('is-accent', index === 0);
  });
}

function saveMetroBeatsPreference() {
  if (!metroBeatsStorageKey) {
    return;
  }

  try {
    window.localStorage.setItem(metroBeatsStorageKey, String(metroState.beatsPerMeasure));
  } catch (error) {
    console.warn('Failed to save metronome beats preference:', error);
  }
}

function restoreMetroBeatsPreference() {
  metroState.beatsPerMeasure = 4;
  const beatsEl = getMetroBeatsSelectEl();

  if (!metroBeatsStorageKey) {
    if (beatsEl) {
      beatsEl.value = String(metroState.beatsPerMeasure);
    }
    buildMetroDots(metroState.beatsPerMeasure);
    resetMetroVisuals();
    return;
  }

  try {
    const raw = window.localStorage.getItem(metroBeatsStorageKey);
    metroState.beatsPerMeasure = clampMetroBeats(raw);
  } catch (error) {
    console.warn('Failed to restore metronome beats preference:', error);
    metroState.beatsPerMeasure = 4;
  }

  if (beatsEl) {
    beatsEl.value = String(metroState.beatsPerMeasure);
  }
  buildMetroDots(metroState.beatsPerMeasure);
  resetMetroVisuals();
}

function updateMetroFrame(frameNowMs) {
  if (!metroState.isRunning || !metroState.enabled) {
    return;
  }

  const beatDurationMs = 60000 / metroState.bpm;
  if (!Number.isFinite(beatDurationMs) || beatDurationMs <= 0) {
    return;
  }

  const elapsedMs = Math.max(0, frameNowMs - metroState.startedAtMs);
  const beatFloat = elapsedMs / beatDurationMs;
  const beatStep = Math.floor(beatFloat);
  const beatProgress = beatFloat - beatStep;
  const activeBeatIndex = beatStep % metroState.beatsPerMeasure;
  const isAccentBeat = activeBeatIndex === 0;
  const shouldAccentBlink = isAccentBeat && beatProgress < METRO_ACCENT_RATIO;

  const rowEl = getMetroRowEl();
  const barEl = getMetroBarEl();
  const faderEl = getMetroFaderEl();
  const dots = Array.from(getMetroDotsEl()?.querySelectorAll('.cw-metro-dot') || []);

  const directionForward = (beatStep % 2) === 0;
  const phase = directionForward ? beatProgress : (1 - beatProgress);
  const barWidth = barEl?.clientWidth || 0;
  const faderWidth = faderEl?.offsetWidth || 16;
  const range = Math.max(0, barWidth - faderWidth);
  const positionX = Math.max(0, Math.min(range, range * phase));

  if (faderEl) {
    faderEl.style.transform = `translate(${positionX}px, -50%)`;
  }

  if (metroState.lastBeatIndex !== activeBeatIndex) {
    metroState.lastBeatIndex = activeBeatIndex;
  }

  rowEl?.classList.toggle('is-accent', shouldAccentBlink);
  dots.forEach((dotEl, index) => {
    dotEl.classList.toggle('is-active', index === activeBeatIndex);
    dotEl.classList.toggle('is-accent', index === 0 && shouldAccentBlink);
  });

  metroState.rafId = window.requestAnimationFrame(updateMetroFrame);
}

function stopVisualMetronome() {
  if (metroState.rafId) {
    window.cancelAnimationFrame(metroState.rafId);
  }
  metroState.rafId = null;
  metroState.isRunning = false;
  metroState.lastBeatIndex = -1;
  setMetroToggleLabel();
}

function startVisualMetronomeFromFirstBeat() {
  if (!metroState.enabled || !Number.isFinite(metroState.bpm)) {
    return;
  }

  stopVisualMetronome();
  metroState.isRunning = true;
  metroState.startedAtMs = performance.now();
  metroState.lastBeatIndex = -1;
  resetMetroVisuals();
  setMetroToggleLabel();
  metroState.rafId = window.requestAnimationFrame(updateMetroFrame);
}

function toggleVisualMetronome() {
  if (!metroState.enabled) {
    return;
  }

  if (metroState.isRunning) {
    stopVisualMetronome();
    return;
  }

  startVisualMetronomeFromFirstBeat();
}

function setupVisualMetronomeForSong(chordProText = '', artist = '', id = '') {
  metroBeatsStorageKey = getMetroBeatsStorageKey(artist, id);
  restoreMetroBeatsPreference();

  const bpm = resolveBpmForCurrentStartMarker(chordProText);

  metroState.bpm = bpm;
  metroState.enabled = Number.isFinite(bpm);
  setMetroUiEnabled(metroState.enabled);

  if (!metroState.enabled) {
    stopVisualMetronome();
    resetMetroVisuals();
    return;
  }

  startVisualMetronomeFromFirstBeat();
}

function syncVisualMetronomeBpmFromStartMarker() {
  if (!originalChordPro) {
    return;
  }

  const wasRunning = metroState.isRunning;
  const nextBpm = resolveBpmForCurrentStartMarker(originalChordPro);
  const enabled = Number.isFinite(nextBpm);

  metroState.bpm = nextBpm;
  metroState.enabled = enabled;
  setMetroUiEnabled(enabled);

  if (!enabled) {
    stopVisualMetronome();
    resetMetroVisuals();
    return;
  }

  if (wasRunning) {
    startVisualMetronomeFromFirstBeat();
    return;
  }

  stopVisualMetronome();
  resetMetroVisuals();
}

function restartVisualMetronomeFromFirstBeat() {
  if (!metroState.enabled || !Number.isFinite(metroState.bpm)) {
    return;
  }

  startVisualMetronomeFromFirstBeat();
}

function restartVisualMetronomeFromFirstBeatIfRunning() {
  if (!metroState.isRunning) {
    return;
  }

  restartVisualMetronomeFromFirstBeat();
}

function initializeVisualMetronomeUi() {
  const beatsEl = getMetroBeatsSelectEl();
  const toggleEl = getMetroToggleButtonEl();

  beatsEl?.addEventListener('change', (event) => {
    metroState.beatsPerMeasure = clampMetroBeats(event.target.value);
    event.target.value = String(metroState.beatsPerMeasure);
    buildMetroDots(metroState.beatsPerMeasure);
    saveMetroBeatsPreference();
    if (metroState.enabled) {
      startVisualMetronomeFromFirstBeat();
    } else {
      resetMetroVisuals();
    }
  });

  toggleEl?.addEventListener('click', toggleVisualMetronome);
  buildMetroDots(metroState.beatsPerMeasure);
  resetMetroVisuals();
  setMetroUiEnabled(false);
}

if (typeof window !== 'undefined') {
  window.syncVisualMetronomeBpmFromStartMarker = syncVisualMetronomeBpmFromStartMarker;
  window.restartVisualMetronomeFromFirstBeat = restartVisualMetronomeFromFirstBeat;
  window.restartVisualMetronomeFromFirstBeatIfRunning = restartVisualMetronomeFromFirstBeatIfRunning;
}

function isLocalFilePreview() {
  if (window.ChordWikiRuntime?.isLocalPreview) {
    return window.ChordWikiRuntime.isLocalPreview(window.location);
  }

  return window.location.protocol === 'file:';
}

function normalizeAccidentalModeValue(mode) {
  return mode === 'sharp' || mode === 'flat' ? mode : 'none';
}

function normalizeEstimatedChordQuality(suffix = '') {
  const normalized = String(suffix || '').trim().toLowerCase();
  if (!normalized) {
    return 'major';
  }

  if (normalized.includes('dim') || normalized.includes('m7b5') || normalized.includes('ø')) {
    return 'diminished';
  }

  if (normalized === 'm' || normalized.startsWith('min') || (normalized.startsWith('m') && !normalized.startsWith('maj'))) {
    return 'minor';
  }

  if (normalized.includes('sus') || normalized.startsWith('5') || normalized.includes('aug')) {
    return 'major';
  }

  return 'major';
}

function analyzeChordForKeyEstimate(chordText = '') {
  const trimmed = String(chordText || '').trim();
  if (!trimmed || isNoChordToken(trimmed) || isBarToken(trimmed)) {
    return null;
  }

  const chordHead = trimmed.split('/')[0].trim();
  const match = chordHead.match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!match) {
    return null;
  }

  const root = match[1].toUpperCase() + (match[2] || '');
  const semitone = typeof noteToSemitone === 'function' ? noteToSemitone(root) : null;
  if (semitone === null) {
    return null;
  }

  return {
    text: trimmed,
    root,
    semitone,
    quality: normalizeEstimatedChordQuality(match[3] || '')
  };
}

function collectChordCandidatesFromChordPro(chordProText = '') {
  const parsed = typeof parseChordPro === 'function' ? parseChordPro(chordProText) : null;
  const chords = [];

  if (Array.isArray(parsed?.lines)) {
    parsed.lines.forEach((line, lineIndex) => {
      if (line.type !== 'lyrics') {
        return;
      }

      const tokens = Array.isArray(line.tokens)
        ? line.tokens
        : (typeof tokenizeLyricsLine === 'function' ? tokenizeLyricsLine(line.text || '') : []);
      const lineChords = tokens
        .filter((token) => token?.kind === 'chord')
        .map((token) => analyzeChordForKeyEstimate(token.text || ''))
        .filter(Boolean);

      if (lineChords.length === 0) {
        return;
      }

      const nextLine = parsed.lines[lineIndex + 1] || null;
      const isPhraseBoundary = !nextLine || nextLine.type === 'blank' || nextLine.type === 'comment' || nextLine.type === 'comment_italic';

      lineChords.forEach((chord, chordIndex) => {
        chords.push({
          ...chord,
          lineIndex,
          chordIndex,
          isLineStart: chordIndex === 0,
          isLineEnd: chordIndex === lineChords.length - 1,
          isPhraseEnd: isPhraseBoundary && chordIndex === lineChords.length - 1
        });
      });
    });
  } else {
    const chordMatches = String(chordProText || '').match(/\[([^\]]+)\]/g) || [];
    chordMatches.forEach((match, index) => {
      const analyzed = analyzeChordForKeyEstimate(match.slice(1, -1));
      if (!analyzed) {
        return;
      }

      chords.push({
        ...analyzed,
        lineIndex: 0,
        chordIndex: index,
        isLineStart: index === 0,
        isLineEnd: index === chordMatches.length - 1,
        isPhraseEnd: index === chordMatches.length - 1
      });
    });
  }

  return {
    parsed,
    chords
  };
}

function scoreEstimatedKeyCandidate(chords, tonicSemitone, isMinorKey = false) {
  if (!Array.isArray(chords) || chords.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const profile = isMinorKey
    ? {
        0: { minor: 4.6, major: 1.9, diminished: 1.0, default: 2.0 },
        2: { diminished: 1.8, minor: 1.2, major: 0.6, default: 0.7 },
        3: { major: 2.7, minor: 1.2, diminished: 0.8, default: 1.3 },
        5: { minor: 3.1, major: 1.4, diminished: 0.8, default: 1.5 },
        7: { major: 4.2, minor: 2.6, diminished: 0.9, default: 1.8 },
        8: { major: 3.0, minor: 1.2, diminished: 0.7, default: 1.6 },
        10: { major: 2.4, minor: 1.1, diminished: 0.7, default: 1.2 }
      }
    : {
        0: { major: 4.6, minor: 1.8, diminished: 1.1, default: 2.0 },
        2: { minor: 2.8, major: 0.8, diminished: 1.2, default: 1.0 },
        4: { minor: 2.1, major: 0.7, diminished: 0.6, default: 0.8 },
        5: { major: 3.0, minor: 1.7, diminished: 0.8, default: 1.4 },
        7: { major: 4.1, minor: 1.6, diminished: 0.7, default: 2.0 },
        9: { minor: 3.0, major: 1.0, diminished: 0.8, default: 1.5 },
        11: { diminished: 1.8, minor: 1.0, major: 0.6, default: 0.6 }
      };
  const tonicQuality = isMinorKey ? 'minor' : 'major';
  const diatonicDegrees = isMinorKey ? new Set([0, 2, 3, 5, 7, 8, 10]) : new Set([0, 2, 4, 5, 7, 9, 11]);

  let score = 0;
  const tonicMatches = chords.filter((chord) => chord.semitone === tonicSemitone).length;
  const dominantSemitone = (tonicSemitone + 7) % 12;
  const subdominantSemitone = (tonicSemitone + 5) % 12;
  const dominantMatches = chords.filter((chord) => chord.semitone === dominantSemitone).length;

  chords.forEach((chord, index) => {
    const degree = ((chord.semitone - tonicSemitone) % 12 + 12) % 12;
    const bucket = profile[degree];
    score += bucket?.[chord.quality] ?? bucket?.default ?? -0.9;

    if (!diatonicDegrees.has(degree)) {
      score -= chord.quality === 'diminished' ? 0.15 : 0.55;
    }

    if (index === 0 && chord.semitone === tonicSemitone) {
      score += chord.quality === tonicQuality ? 1.25 : 0.75;
    }

    if (chord.isLineStart && chord.semitone === tonicSemitone) {
      score += 0.45;
    }

    if (chord.isLineEnd) {
      if (chord.semitone === tonicSemitone) {
        score += chord.quality === tonicQuality ? 1.1 : 0.6;
      } else if (chord.semitone === dominantSemitone) {
        score += 0.4;
      }
    }

    if (chord.isPhraseEnd) {
      if (chord.semitone === tonicSemitone) {
        score += chord.quality === tonicQuality ? 1.7 : 0.85;
      } else if (chord.semitone === dominantSemitone || chord.semitone === subdominantSemitone) {
        score += 0.5;
      }
    }

    if (index === chords.length - 1) {
      if (chord.semitone === tonicSemitone) {
        score += chord.quality === tonicQuality ? 2.3 : 1.2;
      } else if (chord.semitone === dominantSemitone) {
        score += 0.85;
      }
    }
  });

  for (let index = 0; index < chords.length - 1; index += 1) {
    const current = chords[index];
    const next = chords[index + 1];
    const currentDegree = ((current.semitone - tonicSemitone) % 12 + 12) % 12;
    const nextDegree = ((next.semitone - tonicSemitone) % 12 + 12) % 12;

    if (currentDegree === 7 && nextDegree === 0) {
      score += current.quality === 'major' ? 2.2 : 1.4;
      if (next.quality === tonicQuality) {
        score += 0.5;
      }
      continue;
    }

    if (currentDegree === 5 && nextDegree === 0) {
      score += 0.9;
      continue;
    }

    if (currentDegree === 2 && nextDegree === 7) {
      score += isMinorKey && current.quality === 'diminished' ? 1.1 : 0.75;
      continue;
    }

    if (!isMinorKey && currentDegree === 7 && nextDegree === 9) {
      score += 0.7;
      continue;
    }

    if (!isMinorKey && currentDegree === 9 && nextDegree === 5) {
      score += 0.45;
      continue;
    }

    if (isMinorKey && currentDegree === 7 && nextDegree === 8) {
      score += 0.55;
      continue;
    }

    if (currentDegree === 11 && nextDegree === 0) {
      score += 1.0;
    }
  }

  score += tonicMatches * 0.35;
  score += dominantMatches * 0.12;
  return score;
}

function inferChordAccidentalModeFromChordPro(chordProText = '') {
  const parsed = typeof parseChordPro === 'function' ? parseChordPro(chordProText) : null;
  if (!Array.isArray(parsed?.lines) || typeof inferAccidentalPreferenceFromLines !== 'function') {
    return 'sharp';
  }

  return inferAccidentalPreferenceFromLines(parsed.lines) === 'flat' ? 'flat' : 'sharp';
}

function estimateKeyFromChordPro(chordProText = '') {
  const { parsed, chords } = collectChordCandidatesFromChordPro(chordProText);
  if (chords.length < 3) {
    return '';
  }

  const uniqueRoots = new Set(chords.map((chord) => chord.semitone));
  if (uniqueRoots.size < 2) {
    return '';
  }

  const candidates = [];
  for (let semitone = 0; semitone < 12; semitone += 1) {
    candidates.push({ semitone, isMinor: false, score: scoreEstimatedKeyCandidate(chords, semitone, false) });
    candidates.push({ semitone, isMinor: true, score: scoreEstimatedKeyCandidate(chords, semitone, true) });
  }

  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const next = candidates[1];
  const confidenceGap = best && next ? best.score - next.score : 99;

  if (!best || best.score < 7.5 || confidenceGap < 1.35) {
    return '';
  }

  const preferredMode = Array.isArray(parsed?.lines) && typeof inferAccidentalPreferenceFromLines === 'function'
    ? inferAccidentalPreferenceFromLines(parsed.lines)
    : 'sharp';
  const noteName = typeof semitoneToNote === 'function'
    ? semitoneToNote(best.semitone, preferredMode === 'flat' ? 'flat' : 'sharp')
    : '';

  return noteName ? `${noteName}${best.isMinor ? 'm' : ''}` : '';
}

function loadSongPreferences() {
  transposeSemitones = 0;
  accidentalMode = 'none';

  if (!songPrefsStorageKey) {
    return;
  }

  try {
    const raw = window.localStorage.getItem(songPrefsStorageKey);
    const storedPrefs = raw ? JSON.parse(raw) : null;
    if (!storedPrefs) {
      return;
    }

    const storedTranspose = Number(storedPrefs.transposeSemitones);
    if (Number.isFinite(storedTranspose)) {
      transposeSemitones = clampTranspose(storedTranspose);
    }

    accidentalMode = normalizeAccidentalModeValue(storedPrefs.accidentalMode);
  } catch (error) {
    console.warn('Failed to restore song preferences:', error);
  }
}

function saveSongPreferences() {
  if (!songPrefsStorageKey) {
    return;
  }

  try {
    window.localStorage.setItem(songPrefsStorageKey, JSON.stringify({
      transposeSemitones,
      accidentalMode
    }));
  } catch (error) {
    console.warn('Failed to save song preferences:', error);
  }
}

function syncAccidentalModeUi() {
  document.querySelectorAll('input[name="accidental-mode"]').forEach((input) => {
    input.checked = input.value === accidentalMode;
  });
}

function clampDisplayPreferenceNumber(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
}

function normalizeChordStyle(style) {
  return ['none', 'mnoto', 'superscript'].includes(style) ? style : 'none';
}

function syncChordStyleFlags() {
  displayPrefsState.chordStyle = normalizeChordStyle(displayPrefsState.chordStyle);
  displayPrefsState.mnotoEnabled = displayPrefsState.chordStyle === 'mnoto';
  displayPrefsState.superscriptEnabled = displayPrefsState.chordStyle === 'superscript';
}

function loadDisplayPreferences() {
  Object.assign(displayPrefsState, DEFAULT_DISPLAY_PREFS);

  try {
    const raw = window.localStorage.getItem(DISPLAY_PREFS_STORAGE_KEY);
    const storedPrefs = raw ? JSON.parse(raw) : null;
    if (!storedPrefs) {
      return;
    }

    displayPrefsState.enabled = storedPrefs.enabled === true;
    displayPrefsState.adjustChordPos = storedPrefs.adjustChordPos !== false;
    displayPrefsState.extendBarUpward = storedPrefs.extendBarUpward === true;
    displayPrefsState.alignMeasureBars = storedPrefs.alignMeasureBars === true;
    if (typeof storedPrefs.chordStyle === 'string') {
      displayPrefsState.chordStyle = normalizeChordStyle(storedPrefs.chordStyle);
    } else if (storedPrefs.superscriptEnabled === true) {
      displayPrefsState.chordStyle = 'superscript';
    } else if (storedPrefs.mnotoEnabled === true) {
      displayPrefsState.chordStyle = 'mnoto';
    } else {
      displayPrefsState.chordStyle = 'none';
    }
    syncChordStyleFlags();
    displayPrefsState.chordFontSize = clampDisplayPreferenceNumber(
      storedPrefs.chordFontSize,
      6,
      18,
      DEFAULT_DISPLAY_PREFS.chordFontSize
    );
    displayPrefsState.chordOffsetPx = clampDisplayPreferenceNumber(
      storedPrefs.chordOffsetPx,
      -3,
      10,
      DEFAULT_DISPLAY_PREFS.chordOffsetPx
    );
    displayPrefsState.chordLineOffsetPx = clampDisplayPreferenceNumber(
      storedPrefs.chordLineOffsetPx,
      -16,
      16,
      DEFAULT_DISPLAY_PREFS.chordLineOffsetPx
    );
    displayPrefsState.lyricLineGapPx = clampDisplayPreferenceNumber(
      storedPrefs.lyricLineGapPx,
      8,
      32,
      DEFAULT_DISPLAY_PREFS.lyricLineGapPx
    );
    displayPrefsState.blankLineHeightPx = clampDisplayPreferenceNumber(
      storedPrefs.blankLineHeightPx,
      4,
      32,
      DEFAULT_DISPLAY_PREFS.blankLineHeightPx
    );
    displayPrefsState.commentLineGapPx = clampDisplayPreferenceNumber(
      storedPrefs.commentLineGapPx,
      8,
      32,
      DEFAULT_DISPLAY_PREFS.commentLineGapPx
    );
    displayPrefsState.lyricFontWeight = storedPrefs.lyricFontWeight === 'bold' ? 'bold' : 'normal';
    displayPrefsState.commentFontWeight = storedPrefs.commentFontWeight === 'normal' ? 'normal' : 'bold';
  } catch (error) {
    console.warn('Failed to restore display preferences:', error);
  }
}

function saveDisplayPreferences() {
  try {
    syncChordStyleFlags();
    window.localStorage.setItem(DISPLAY_PREFS_STORAGE_KEY, JSON.stringify(displayPrefsState));
  } catch (error) {
    console.warn('Failed to save display preferences:', error);
  }
}

function measureTextWidthForFont(fontFamily, sampleText) {
  const canvas = measureTextWidthForFont.canvas || (measureTextWidthForFont.canvas = document.createElement('canvas'));
  const context = canvas.getContext('2d');
  if (!context) {
    return Number.NaN;
  }

  context.font = `600 32px ${fontFamily}`;
  return context.measureText(sampleText).width;
}

function updateMnotoFontAvailability() {
  const fontSet = document.fonts;
  const sampleText = 'C#M7(b9) F#m7-5 Bbadd9 N.C.';
  const fallbackWidths = [
    measureTextWidthForFont('sans-serif', sampleText),
    measureTextWidthForFont('serif', sampleText),
    measureTextWidthForFont('monospace', sampleText)
  ].filter((width) => Number.isFinite(width));
  let detectedFamily = '';

  if (fontSet && typeof fontSet.check === 'function') {
    detectedFamily = MNOTO_FONT_CANDIDATES.find((candidate) => {
      try {
        if (!fontSet.check(`16px ${candidate}`)) {
          return false;
        }

        const candidateWidth = measureTextWidthForFont(`${candidate}, sans-serif`, sampleText);
        if (!Number.isFinite(candidateWidth) || fallbackWidths.length === 0) {
          return true;
        }

        return fallbackWidths.every((width) => Math.abs(width - candidateWidth) > 0.5);
      } catch {
        return false;
      }
    }) || '';
  }

  mnotoAvailabilityState.checked = true;
  mnotoAvailabilityState.available = detectedFamily !== '';
  mnotoAvailabilityState.family = detectedFamily;
  return mnotoAvailabilityState.available;
}

function isMnotoFontAvailable() {
  if (!mnotoAvailabilityState.checked) {
    return updateMnotoFontAvailability();
  }

  return mnotoAvailabilityState.available;
}

function syncDisplayPreferenceUi() {
  const enabledInput = document.getElementById('display-custom-enabled');
  const adjustInput = document.getElementById('display-adjust-chordpos');
  const chordStyleSelect = document.getElementById('display-chord-style');
  const mnotoStatusEl = document.getElementById('display-mnoto-status');
  const fontSizeInput = document.getElementById('display-chord-font-size');
  const offsetInput = document.getElementById('display-chord-offset');
  const lineOffsetInput = document.getElementById('display-chord-line-offset');
  const lyricGapInput = document.getElementById('display-lyric-gap');
  const blankLineHeightInput = document.getElementById('display-blank-line-height');
  const commentGapInput = document.getElementById('display-comment-gap');
  const lyricWeightInput = document.getElementById('display-lyric-weight');
  const commentWeightInput = document.getElementById('display-comment-weight');
  const detailEl = document.getElementById('display-custom-detail');
  const mnotoAvailable = isMnotoFontAvailable();

  if (enabledInput) {
    enabledInput.checked = displayPrefsState.enabled;
  }

  if (adjustInput) {
    adjustInput.checked = displayPrefsState.adjustChordPos;
    adjustInput.disabled = !displayPrefsState.enabled;
  }

  const extendBarInput = document.getElementById('display-extend-bar');
  if (extendBarInput) {
    extendBarInput.checked = displayPrefsState.extendBarUpward === true;
    extendBarInput.disabled = !displayPrefsState.enabled;
  }

  const alignMeasureInput = document.getElementById('display-align-measure-bars');
  if (alignMeasureInput) {
    alignMeasureInput.checked = displayPrefsState.alignMeasureBars === true;
    alignMeasureInput.disabled = !displayPrefsState.enabled;
  }

  if (chordStyleSelect) {
    chordStyleSelect.value = displayPrefsState.chordStyle;
    chordStyleSelect.disabled = !displayPrefsState.enabled;
  }

  if (mnotoStatusEl) {
    if (mnotoAvailable) {
      const familyLabel = mnotoAvailabilityState.family.replace(/"/g, '');
      mnotoStatusEl.textContent = `利用可能: ${familyLabel}`;
      mnotoStatusEl.classList.remove('is-warning');
    } else {
      mnotoStatusEl.textContent = '未検出: このブラウザでは通常フォント表示になります';
      mnotoStatusEl.classList.add('is-warning');
    }
  }

  if (fontSizeInput) {
    fontSizeInput.value = String(displayPrefsState.chordFontSize);
    fontSizeInput.disabled = !displayPrefsState.enabled;
  }

  if (offsetInput) {
    offsetInput.value = String(displayPrefsState.chordOffsetPx);
    offsetInput.disabled = !displayPrefsState.enabled;
  }

  if (lineOffsetInput) {
    lineOffsetInput.value = String(displayPrefsState.chordLineOffsetPx);
    lineOffsetInput.disabled = !displayPrefsState.enabled;
  }

  if (lyricGapInput) {
    lyricGapInput.value = String(displayPrefsState.lyricLineGapPx);
    lyricGapInput.disabled = !displayPrefsState.enabled;
  }

  if (blankLineHeightInput) {
    blankLineHeightInput.value = String(displayPrefsState.blankLineHeightPx);
    blankLineHeightInput.disabled = !displayPrefsState.enabled;
  }

  if (commentGapInput) {
    commentGapInput.value = String(displayPrefsState.commentLineGapPx);
    commentGapInput.disabled = !displayPrefsState.enabled;
  }

  if (lyricWeightInput) {
    lyricWeightInput.checked = displayPrefsState.lyricFontWeight === 'bold';
    lyricWeightInput.disabled = !displayPrefsState.enabled;
  }

  if (commentWeightInput) {
    commentWeightInput.checked = displayPrefsState.commentFontWeight === 'bold';
    commentWeightInput.disabled = !displayPrefsState.enabled;
  }

  detailEl?.classList.toggle('is-disabled', !displayPrefsState.enabled);
}

function isLyricSpanElement(element) {
  return Boolean(
    element?.classList
    && (element.classList.contains('word') || element.classList.contains('wordtop'))
  );
}

function cleanDisplayText(text) {
  return String(text || '').replace(/　/g, '').trim();
}

function containsVoiceMarkerSymbol(text) {
  return VOICE_MARKER_PATTERN.test(String(text || ''));
}

function applyVoiceMarkerSymbolClasses() {
  const sheetEl = getSheetEl();
  if (!sheetEl) {
    return;
  }

  sheetEl.querySelectorAll('span.word, span.wordtop, p.comment .comment-body').forEach((span) => {
    const rawText = String(span.textContent || '');
    if (!containsVoiceMarkerSymbol(rawText)) {
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const character of rawText) {
      const className = VOICE_MARKER_CLASS_MAP[character];
      if (className) {
        const markerSpan = document.createElement('span');
        markerSpan.className = className;
        markerSpan.textContent = character;
        fragment.appendChild(markerSpan);
        continue;
      }

      fragment.appendChild(document.createTextNode(character));
    }

    span.textContent = '';
    span.appendChild(fragment);
  });
}

function isRhythmMarkerOnlyText(text) {
  const normalized = cleanDisplayText(text)
    .replace(/ /g, '')
    .replace(/[|｜]/g, '')
    .replace(/ /g, '')
    .trim();

  return Boolean(normalized) && /^[\-=>!~≫≧＞○●ー－\s]+$/u.test(normalized);
}

function startsWithRhythmMarker(text) {
  return /^[\-=~>!≫≧＞○●ー－\s]+/u.test(cleanDisplayText(text));
}

function isChordTextAllowed(text) {
  const normalized = cleanDisplayText(text).replace(/\s+/g, '');
  return Boolean(normalized) && CHORD_ALLOWED_PATTERN.test(normalized);
}

function removeEmptyLyricSpans() {
  const sheetEl = getSheetEl();
  if (!sheetEl) {
    return;
  }

  sheetEl.querySelectorAll('span.word, span.wordtop').forEach((span) => {
    if (!cleanDisplayText(span.textContent)) {
      span.remove();
    }
  });
}

function normalizeFirstLyricSpans() {
  const sheetEl = getSheetEl();
  if (!sheetEl) {
    return;
  }

  sheetEl.querySelectorAll('p.line').forEach((lineEl) => {
    const lyricSpans = Array.from(lineEl.children).filter((child) => isLyricSpanElement(child));

    lyricSpans.forEach((span, index) => {
      span.classList.toggle('wordtop', index === 0);
      span.classList.toggle('word', index !== 0);

      if (index === 0 && typeof span.textContent === 'string') {
        const normalizedText = span.textContent.replace(/^\s+/, '');
        span.textContent = cleanDisplayText(normalizedText) === '|' ? '| ' : normalizedText;
      }
    });
  });
}

function findPreviousLyricElement(wordtop) {
  let previous = wordtop.previousElementSibling;
  while (previous) {
    if (isLyricSpanElement(previous)) {
      return previous;
    }
    previous = previous.previousElementSibling;
  }

  let parentLine = wordtop.parentElement;
  while (parentLine && !parentLine.matches('p.line')) {
    parentLine = parentLine.parentElement;
  }
  if (!parentLine) {
    return null;
  }

  let previousLine = parentLine.previousElementSibling;
  while (previousLine) {
    if (!previousLine.matches('p.line') || previousLine.matches('p.comment')) {
      previousLine = previousLine.previousElementSibling;
      continue;
    }

    const lyricSpans = Array.from(previousLine.children).filter((child) => isLyricSpanElement(child));
    if (lyricSpans.length > 0) {
      return lyricSpans[lyricSpans.length - 1];
    }

    previousLine = previousLine.previousElementSibling;
  }

  return null;
}

function isOverflowLyricsText(cleanedText) {
  return (
    cleanedText.length > 1
    && cleanedText.endsWith('|')
    && /[^|]/.test(cleanedText)
    && !cleanedText.startsWith('|')
  );
}

// 行頭が chord より先の wordtop（コード行に | が残る場合のはみ出し典型）
function isLineLeadingWordtop(wordtop) {
  const line = wordtop.parentElement;
  if (!line || !line.matches?.('p.line') || line.classList.contains('blank')) {
    return false;
  }

  for (const child of line.children) {
    if (child === wordtop) {
      return true;
    }
    if (child.classList?.contains('chord') || isLyricSpanElement(child)) {
      return false;
    }
  }
  return false;
}

function isOverflowWordtopCandidate(wordtop) {
  const cleanedText = cleanDisplayText(wordtop.textContent);
  if (!cleanedText || cleanedText === '|') {
    return false;
  }
  if (cleanedText.startsWith('|')) {
    return false;
  }
  if (isOverflowLyricsText(cleanedText)) {
    return true;
  }
  return isLineLeadingWordtop(wordtop) && /[^|]/.test(cleanedText);
}

function stripTrailingBarFromLyricElement(el) {
  if (!el) {
    return;
  }

  if (el.querySelector(VOICE_PART_SELECTOR) || el.children.length > 0) {
    for (let node = el.lastChild; node; node = node.previousSibling) {
      if (node.nodeType !== Node.TEXT_NODE) {
        continue;
      }
      const next = String(node.nodeValue || '').replace(/\|\s*$/, '');
      if (next !== node.nodeValue) {
        if (next) {
          node.nodeValue = next;
        } else {
          node.remove();
        }
      }
      break;
    }
    return;
  }

  el.textContent = String(el.textContent || '').replace(/\|\s*$/, '');
}

function normalizeChordBarSpans() {
  const sheetEl = getSheetEl();
  if (!sheetEl) {
    return;
  }

  Array.from(sheetEl.querySelectorAll('span.chord')).forEach((span) => {
    const text = cleanDisplayText(span.textContent);
    if (!/^[|｜]+$/.test(text)) {
      return;
    }

    const replacement = document.createElement('span');
    replacement.className = span.parentElement?.firstElementChild === span ? 'wordtop' : 'word';
    replacement.textContent = replacement.className === 'wordtop' ? '| ' : ' | ';
    span.replaceWith(replacement);
  });

  Array.from(sheetEl.querySelectorAll('span.word, span.wordtop')).forEach((element) => {
    if (cleanDisplayText(element.textContent) !== '|') {
      return;
    }

    const previous = element.previousElementSibling;
    if (isLyricSpanElement(previous)) {
      previous.textContent = `${String(previous.textContent || '').replace(/\s*$/, '')}| `;
      element.remove();
      return;
    }

    element.textContent = element.classList.contains('wordtop') ? '| ' : ' | ';
  });
}

// 前行末尾へはみ出し歌詞を載せる（生テキストノードは使わず | を lyrics span 内に残す）
function appendOverflowLyricsToLine(parentP, overflowText, options = {}) {
  if (!parentP || !overflowText) {
    return false;
  }

  const appendBar = options.appendBar === true;
  const lastElem = parentP.lastElementChild;
  let hadTrailingBarOnLyric = false;

  if (
    lastElem
    && isLyricSpanElement(lastElem)
    && lastElem.textContent
    && /\|\s*$/.test(lastElem.textContent)
  ) {
    hadTrailingBarOnLyric = true;
    stripTrailingBarFromLyricElement(lastElem);
  }

  let suffix;
  if (appendBar || hadTrailingBarOnLyric) {
    suffix = hadTrailingBarOnLyric
      ? ` ${overflowText} |`
      : ` ${overflowText} | `;
  } else {
    suffix = ` ${overflowText}`;
  }

  if (
    lastElem
    && lastElem.isConnected
    && isLyricSpanElement(lastElem)
    && !lastElem.querySelector(VOICE_PART_SELECTOR)
    && lastElem.children.length === 0
  ) {
    lastElem.appendChild(document.createTextNode(suffix));
    return true;
  }

  const word = document.createElement('span');
  word.className = 'word';
  word.textContent = suffix;
  parentP.appendChild(word);
  return true;
}

function moveOverflowWordtopsToPreviousLine() {
  const sheetEl = getSheetEl();
  if (!sheetEl) {
    return;
  }

  Array.from(sheetEl.querySelectorAll('span.wordtop')).forEach((wordtop) => {
    if (!wordtop.isConnected) {
      return;
    }
    if (wordtop.querySelector(VOICE_PART_SELECTOR)) {
      return;
    }

    const cleanedText = cleanDisplayText(wordtop.textContent);
    if (cleanedText === '|') {
      wordtop.textContent = '| ';
      return;
    }

    if (!isOverflowWordtopCandidate(wordtop)) {
      return;
    }

    if (containsVoiceMarkerSymbol(cleanedText)) {
      return;
    }

    const hadTrailingBar = /\|+\s*$/.test(String(wordtop.textContent || ''));
    const overflowText = cleanedText.replace(/\|+\s*$/, '').replace(/　/g, '').trim();
    if (
      !overflowText
      || isRhythmMarkerOnlyText(overflowText)
      || startsWithRhythmMarker(overflowText)
      || containsVoiceMarkerSymbol(overflowText)
    ) {
      return;
    }

    const previousWord = findPreviousLyricElement(wordtop);
    if (!previousWord || containsVoiceMarkerSymbol(previousWord.textContent)) {
      return;
    }

    const parentLine = previousWord.closest('p.line');
    if (!parentLine || containsVoiceMarkerSymbol(parentLine.textContent)) {
      return;
    }

    if (!appendOverflowLyricsToLine(parentLine, overflowText, { appendBar: hadTrailingBar })) {
      return;
    }

    // 延伸・小節揃えが後段で効くよう、| は必ず span.word / wordtop 内に残す
    if (hadTrailingBar) {
      while (wordtop.firstChild) {
        wordtop.removeChild(wordtop.firstChild);
      }
      wordtop.appendChild(document.createTextNode('| '));
    } else {
      wordtop.remove();
    }
  });
}

function splitMixedChordSymbolSpans() {
  const sheetEl = getSheetEl();
  if (!sheetEl || !displayPrefsState.enabled) {
    return;
  }

  const symbolPattern = /([\-=≫≧＞>!~]+|n\.c\.?)/gi;

  Array.from(sheetEl.querySelectorAll('span.chord')).forEach((span) => {
    if (span.childElementCount > 0) {
      return;
    }

    const originalText = String(span.textContent || '');
    const trimmed = cleanDisplayText(originalText);
    if (!trimmed || isChordTextAllowed(trimmed) || !/[>\-=≫≧＞!~]|n\.c/i.test(originalText)) {
      return;
    }

    const parts = [];
    let lastIndex = 0;
    let match;
    symbolPattern.lastIndex = 0;

    while ((match = symbolPattern.exec(originalText)) !== null) {
      if (match.index > lastIndex) {
        parts.push(originalText.slice(lastIndex, match.index));
      }
      parts.push(match[0]);
      lastIndex = symbolPattern.lastIndex;
    }

    if (!parts.length) {
      return;
    }

    if (lastIndex < originalText.length) {
      parts.push(originalText.slice(lastIndex));
    }

    const fragment = document.createDocumentFragment();
    parts.forEach((part) => {
      if (!part) {
        return;
      }

      const trimmedPart = part.trim();
      if (!trimmedPart) {
        fragment.appendChild(document.createTextNode(part));
        return;
      }

      const partSpan = document.createElement('span');
      partSpan.className = 'chord';
      partSpan.textContent = trimmedPart;
      if (NARROW_SYMBOL_PATTERN.test(trimmedPart) && !isChordTextAllowed(trimmedPart)) {
        partSpan.classList.add('cw-narrow-symbol');
      }
      fragment.appendChild(partSpan);
    });

    span.replaceWith(fragment);
  });
}

function applyChordDisplayTextTransforms() {
  const sheetEl = getSheetEl();
  if (!sheetEl || !displayPrefsState.enabled) {
    return;
  }

  removeEmptyLyricSpans();
  normalizeChordBarSpans();
  normalizeFirstLyricSpans();
  moveOverflowWordtopsToPreviousLine();
  removeEmptyLyricSpans();
  normalizeFirstLyricSpans();

  Array.from(sheetEl.querySelectorAll('span.chord')).forEach((span) => {
    span.classList.remove('cw-narrow-symbol', 'cw-mnoto-chord');
  });

  splitMixedChordSymbolSpans();

  const shouldUseMnoto = displayPrefsState.mnotoEnabled && isMnotoFontAvailable();

  Array.from(sheetEl.querySelectorAll('span.chord')).forEach((span) => {
    let nextText = String(span.textContent || '').replace(/maj/gi, 'M');

    if (displayPrefsState.superscriptEnabled) {
      if (typeof convertChordToSuperscriptHtml === 'function') {
        span.innerHTML = convertChordToSuperscriptHtml(nextText);
      } else {
        span.textContent = nextText;
      }

      if (shouldUseMnoto) {
        span.classList.add('cw-mnoto-chord');
      }

      const cleanedText = cleanDisplayText(nextText);
      if (/^[~\s]+$/.test(nextText) || (NARROW_SYMBOL_PATTERN.test(cleanedText) && !isChordTextAllowed(cleanedText))) {
        span.classList.add('cw-narrow-symbol');
      }
      return;
    }

    if (shouldUseMnoto) {
      nextText = nextText.replace(/\((?:[#b+\-]?\d+(?:[,.][#b+\-]?\d+)*)\)/g, (match) => {
        const inner = match.slice(1, -1);
        return `{${/7/.test(inner) ? inner.replace(/7/g, "'") : inner}}`;
      });
      span.classList.add('cw-mnoto-chord');
    }

    span.textContent = nextText;

    const cleanedText = cleanDisplayText(nextText);
    if (/^[~\s]+$/.test(nextText) || (NARROW_SYMBOL_PATTERN.test(cleanedText) && !isChordTextAllowed(cleanedText))) {
      span.classList.add('cw-narrow-symbol');
    }
  });
}

function unwrapMeasureLayout(line) {
  line.querySelectorAll(`span.${RC_BEAT_CLASS}`).forEach((beat) => {
    const parent = beat.parentNode;
    if (!parent) {
      return;
    }
    while (beat.firstChild) {
      parent.insertBefore(beat.firstChild, beat);
    }
    beat.remove();
  });
  line.querySelectorAll(`span.${RC_MEASURE_CLASS}`).forEach((measure) => {
    const parent = measure.parentNode;
    if (!parent) {
      return;
    }
    while (measure.firstChild) {
      parent.insertBefore(measure.firstChild, measure);
    }
    measure.remove();
  });
}

function clearLyricBarExtendMarks(sheetEl) {
  const root = sheetEl || getSheetEl();
  if (!root) {
    return;
  }

  root.querySelectorAll(SCORE_LINE_SELECTOR).forEach((line) => {
    unwrapMeasureLayout(line);
    line.classList.remove('rc-measure-align');
  });
  root.querySelectorAll(`span.${RC_BAR_EXTEND_GLYPH_CLASS}`).forEach((glyph) => {
    glyph.replaceWith(document.createTextNode('|'));
  });
  root.querySelectorAll(`span.${RC_MEASURE_BAR_CLASS}`).forEach((glyph) => {
    glyph.replaceWith(document.createTextNode(glyph.textContent || '|'));
  });
  root.querySelectorAll(`span.${RC_BAR_EXTEND_CLASS}`).forEach((span) => {
    span.classList.remove(RC_BAR_EXTEND_CLASS);
  });
}

function wrapPipesInTextNode(textNode, createGlyph) {
  const text = textNode.nodeValue;
  if (!text || !text.includes('|') || !textNode.parentNode) {
    return false;
  }

  const fragment = document.createDocumentFragment();
  let remaining = text;
  while (remaining.length) {
    const idx = remaining.indexOf('|');
    if (idx === -1) {
      fragment.appendChild(document.createTextNode(remaining));
      break;
    }
    if (idx > 0) {
      fragment.appendChild(document.createTextNode(remaining.slice(0, idx)));
    }
    fragment.appendChild(createGlyph());
    remaining = remaining.slice(idx + 1);
  }
  textNode.parentNode.replaceChild(fragment, textNode);
  return true;
}

function createExtendBarGlyph() {
  const glyph = document.createElement('span');
  glyph.className = RC_BAR_EXTEND_GLYPH_CLASS;
  glyph.setAttribute('aria-hidden', 'true');
  return glyph;
}

function createPlainMeasureBarGlyph() {
  const glyph = document.createElement('span');
  glyph.className = RC_MEASURE_BAR_CLASS;
  glyph.textContent = '|';
  return glyph;
}

function wrapAllPipesInLyricSpan(span, createGlyph) {
  if (!span.textContent.includes('|')) {
    return;
  }

  const factory = createGlyph || createExtendBarGlyph;
  const textNodes = [];
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.classList.contains(RC_BAR_EXTEND_GLYPH_CLASS)) {
      continue;
    }
    if (node.parentElement?.classList.contains(RC_MEASURE_BAR_CLASS)) {
      continue;
    }
    textNodes.push(node);
  }

  let wrapped = false;
  textNodes.forEach((textNode) => {
    if (!textNode.isConnected) {
      return;
    }
    if (wrapPipesInTextNode(textNode, factory)) {
      wrapped = true;
    }
  });
  if (wrapped) {
    span.classList.add(RC_BAR_EXTEND_CLASS);
  }
}

function snapLyricBarExtendGlyphs(sheetEl) {
  const root = sheetEl || getSheetEl();
  if (!root) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const hairW = 1 / dpr;
  root.querySelectorAll(`span.${RC_BAR_EXTEND_GLYPH_CLASS}`).forEach((glyph) => {
    glyph.style.setProperty('--rc-bar-hair-w', `${hairW}px`);
    glyph.style.removeProperty('--rc-bar-snap-x');
    const left = glyph.getBoundingClientRect().left;
    const snapped = Math.round(left * dpr) / dpr;
    glyph.style.setProperty('--rc-bar-snap-x', `${snapped - left}px`);
  });
}

function scheduleSnapLyricBarExtendGlyphs(sheetEl) {
  snapLyricBarExtendGlyphs(sheetEl);
  requestAnimationFrame(() => {
    snapLyricBarExtendGlyphs(sheetEl);
    requestAnimationFrame(() => snapLyricBarExtendGlyphs(sheetEl));
  });
}

let barExtendSnapListening = false;
function ensureBarExtendSnapListeners() {
  if (barExtendSnapListening) {
    return;
  }
  barExtendSnapListening = true;
  window.addEventListener('resize', () => scheduleSnapLyricBarExtendGlyphs());
}

function markLyricBarExtendSpans(enabled, sheetEl) {
  const root = sheetEl || getSheetEl();
  if (!root) {
    return;
  }

  clearLyricBarExtendMarks(root);
  if (!enabled) {
    return;
  }

  root.querySelectorAll(LYRICS_SPAN_SELECTOR).forEach((span) => {
    if (span.textContent.includes('|')) {
      wrapAllPipesInLyricSpan(span, createExtendBarGlyph);
    }
  });
  ensureBarExtendSnapListeners();
  scheduleSnapLyricBarExtendGlyphs(root);
}

function markPlainMeasureBarSpans(sheetEl) {
  const root = sheetEl || getSheetEl();
  if (!root) {
    return;
  }

  root.querySelectorAll(LYRICS_SPAN_SELECTOR).forEach((span) => {
    if (!span.textContent.includes('|')) {
      return;
    }
    if (span.querySelector(MEASURE_BAR_SELECTOR)) {
      return;
    }
    wrapAllPipesInLyricSpan(span, createPlainMeasureBarGlyph);
  });
}

function isMeasureBarElement(el) {
  return Boolean(
    el
    && el.nodeType === Node.ELEMENT_NODE
    && el.classList
    && (el.classList.contains(RC_BAR_EXTEND_GLYPH_CLASS) || el.classList.contains(RC_MEASURE_BAR_CLASS))
  );
}

function wrapMeasureIntoBeats(measure) {
  Array.from(measure.querySelectorAll(`:scope > span.${RC_BEAT_CLASS}`)).forEach((beat) => {
    while (beat.firstChild) {
      measure.insertBefore(beat.firstChild, beat);
    }
    beat.remove();
  });

  const nodes = Array.from(measure.childNodes);
  if (!nodes.length) {
    return;
  }

  const groups = [];
  let current = [];
  const flush = () => {
    if (!current.length) {
      return;
    }
    groups.push(current);
    current = [];
  };
  const groupHasChord = () =>
    current.some((n) => n.nodeType === Node.ELEMENT_NODE && n.classList.contains('chord'));

  nodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!cleanDisplayText(node.textContent)) {
        if (current.length) {
          current.push(node);
        }
        return;
      }
      if (groupHasChord()) {
        current.push(node);
      } else {
        flush();
        current.push(node);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      if (current.length) {
        current.push(node);
      }
      return;
    }

    const isChord = node.classList.contains('chord');
    const isWord = node.classList.contains('word') || node.classList.contains('wordtop');

    if (isChord) {
      flush();
      current.push(node);
      return;
    }
    if (isWord) {
      if (groupHasChord() || (current.length && !groupHasChord())) {
        current.push(node);
      } else {
        flush();
        current.push(node);
      }
      return;
    }

    flush();
    current.push(node);
    flush();
  });
  flush();

  groups.forEach((group) => {
    if (!group.length) {
      return;
    }
    if (group.length === 1 && group[0].nodeType === Node.TEXT_NODE && !cleanDisplayText(group[0].textContent)) {
      return;
    }
    const beat = document.createElement('span');
    beat.className = RC_BEAT_CLASS;
    group[0].before(beat);
    group.forEach((n) => beat.appendChild(n));
  });
}

function promoteMeasureBars(line) {
  Array.from(line.querySelectorAll(MEASURE_BAR_SELECTOR)).forEach((bar) => {
    const parent = bar.parentElement;
    if (!parent || parent === line) {
      return;
    }
    if (!parent.classList.contains('word') && !parent.classList.contains('wordtop')) {
      return;
    }
    if (!parent.parentNode) {
      return;
    }

    if (bar.previousSibling) {
      const beforeSpan = parent.cloneNode(false);
      while (bar.previousSibling) {
        beforeSpan.insertBefore(bar.previousSibling, beforeSpan.firstChild);
      }
      const keepBefore = cleanDisplayText(beforeSpan.textContent)
        || beforeSpan.querySelector(VOICE_PART_SELECTOR)
        || beforeSpan.querySelector(MEASURE_BAR_SELECTOR);
      if (keepBefore) {
        parent.parentNode.insertBefore(beforeSpan, parent);
      }
    }

    if (!parent.parentNode) {
      return;
    }
    parent.parentNode.insertBefore(bar, parent);

    // 延伸グリフは textContent が空なので、残グリフ有無も見てから親を消す
    const parentStillUseful = cleanDisplayText(parent.textContent)
      || parent.querySelector(VOICE_PART_SELECTOR)
      || parent.querySelector(MEASURE_BAR_SELECTOR)
      || parent.querySelector('span.chord');
    if (!parent.firstChild || !parentStillUseful) {
      parent.remove();
    }
  });
}

function wrapLineIntoMeasures(line) {
  unwrapMeasureLayout(line);
  promoteMeasureBars(line);

  const children = Array.from(line.children);
  const barIndexes = [];
  children.forEach((el, idx) => {
    if (isMeasureBarElement(el)) {
      barIndexes.push(idx);
    }
  });
  if (barIndexes.length < 2) {
    return null;
  }

  for (let b = barIndexes.length - 2; b >= 0; b -= 1) {
    const start = barIndexes[b];
    const end = barIndexes[b + 1];
    const nodes = children.slice(start + 1, end);
    const wrapper = document.createElement('span');
    wrapper.className = RC_MEASURE_CLASS;
    if (nodes.length) {
      nodes[0].before(wrapper);
      nodes.forEach((n) => wrapper.appendChild(n));
    } else {
      children[start].after(wrapper);
    }
    wrapMeasureIntoBeats(wrapper);
  }

  return {
    line,
    bars: Array.from(line.querySelectorAll(`:scope > ${MEASURE_BAR_SELECTOR}`)),
    measures: Array.from(line.querySelectorAll(`:scope > span.${RC_MEASURE_CLASS}`))
  };
}

function hasBlockBoundaryBetween(fromLine, toLine) {
  let el = fromLine.nextElementSibling;
  while (el && el !== toLine) {
    if (el.matches?.(BLOCK_BOUNDARY_SELECTOR)) {
      return true;
    }
    if (el.matches?.(SCORE_LINE_SELECTOR)) {
      return false;
    }
    el = el.nextElementSibling;
  }
  return el !== toLine;
}

function collectScoreLineBlocks(sheetEl) {
  const root = sheetEl || getSheetEl();
  if (!root) {
    return [];
  }

  const lines = Array.from(root.querySelectorAll(SCORE_LINE_SELECTOR));
  const blocks = [];
  let current = [];

  lines.forEach((line) => {
    if (!current.length) {
      current.push(line);
      return;
    }
    const prev = current[current.length - 1];
    if (hasBlockBoundaryBetween(prev, line)) {
      blocks.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  });
  if (current.length) {
    blocks.push(current);
  }
  return blocks;
}

function applyMeasureColumnWidths(parsedLines) {
  const maxMeasures = Math.max(0, ...parsedLines.map((p) => p.measures.length));
  if (maxMeasures === 0) {
    return;
  }

  const colWidths = Array(maxMeasures).fill(0);
  parsedLines.forEach((p) => {
    p.measures.forEach((measure, i) => {
      measure.style.minWidth = '';
      measure.style.width = '';
      // 自然幅計測時は中身サイズで測る（伸長 flex だと余分に広がる）
      measure.querySelectorAll(`:scope > span.${RC_BEAT_CLASS}`).forEach((beat) => {
        beat.style.flex = '0 0 auto';
        beat.style.minWidth = '';
        beat.style.whiteSpace = 'nowrap';
      });
      const w = measure.getBoundingClientRect().width;
      if (w > colWidths[i]) {
        colWidths[i] = w;
      }
    });
  });

  parsedLines.forEach((p) => {
    p.line.classList.add('rc-measure-align');
    p.measures.forEach((measure, i) => {
      const w = Math.ceil(colWidths[i]);
      measure.style.boxSizing = 'border-box';
      measure.style.display = 'inline-flex';
      measure.style.justifyContent = 'flex-start';
      measure.style.alignItems = 'baseline';
      measure.style.verticalAlign = 'baseline';
      measure.style.minWidth = `${w}px`;
      measure.style.width = `${w}px`;

      // 余白だけ均等に伸ばす（縮めない／折り返さない）
      measure.querySelectorAll(`:scope > span.${RC_BEAT_CLASS}`).forEach((beat) => {
        beat.style.display = 'inline-flex';
        beat.style.alignItems = 'baseline';
        beat.style.justifyContent = 'flex-start';
        beat.style.flex = '1 0 auto';
        beat.style.minWidth = '';
        beat.style.whiteSpace = 'nowrap';
        beat.style.boxSizing = 'border-box';
      });
    });
  });
}

function stripIdeographicSpacesInLineLyrics(line) {
  line.querySelectorAll(LYRICS_SPAN_SELECTOR).forEach((span) => {
    const textNodes = [];
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }
    textNodes.forEach((tn) => {
      if (tn.nodeValue && tn.nodeValue.includes('　')) {
        tn.nodeValue = tn.nodeValue.replace(/　/g, '');
      }
    });
  });
}

function alignMeasureBarsInBlocks(sheetEl) {
  const blocks = collectScoreLineBlocks(sheetEl);
  blocks.forEach((lines) => {
    const parsedLines = [];
    lines.forEach((line) => {
      stripIdeographicSpacesInLineLyrics(line);
      const parsed = wrapLineIntoMeasures(line);
      if (parsed && parsed.measures.length > 0) {
        parsedLines.push(parsed);
      }
    });
    if (parsedLines.length < 2) {
      return;
    }

    // 小節が少ない行は空小節で埋めず末尾も閉じない。先頭からの列幅だけ揃える
    applyMeasureColumnWidths(parsedLines);
  });
}

function applyMeasureBarDisplayFeatures(sheetEl) {
  const root = sheetEl || getSheetEl();
  if (!root || !displayPrefsState.enabled) {
    return;
  }

  const extendBarUpward = displayPrefsState.extendBarUpward === true;
  const alignMeasureBars = displayPrefsState.alignMeasureBars === true;
  if (!extendBarUpward && !alignMeasureBars) {
    clearLyricBarExtendMarks(root);
    return;
  }

  markLyricBarExtendSpans(extendBarUpward, root);
  if (alignMeasureBars && !extendBarUpward) {
    markPlainMeasureBarSpans(root);
  }
  if (alignMeasureBars) {
    alignMeasureBarsInBlocks(root);
    if (extendBarUpward) {
      scheduleSnapLyricBarExtendGlyphs(root);
    }
  }
}

function applyChordLayoutAdjustments() {
  const sheetEl = getSheetEl();
  if (!sheetEl) {
    return;
  }

  sheetEl.querySelectorAll('.cw-adjusted-lyric, .cw-shifted-lyric').forEach((span) => {
    span.classList.remove('cw-adjusted-lyric', 'cw-shifted-lyric');
    span.style.display = '';
    span.style.minWidth = '';
    span.style.marginLeft = '';
  });

  applyChordDisplayTextTransforms();
  applyVoiceMarkerSymbolClasses();

  if (displayPrefsState.enabled && displayPrefsState.adjustChordPos) {
    sheetEl.querySelectorAll('p.line:not(.blank)').forEach((lineEl) => {
      const spans = Array.from(lineEl.children);

      spans.forEach((spanEl, index) => {
        if (!spanEl.classList.contains('chord')) {
          return;
        }

        const lyricEl = spans.slice(index + 1).find((candidate) => isLyricSpanElement(candidate));
        if (!lyricEl) {
          return;
        }

        const trimmedLyric = cleanDisplayText(lyricEl.textContent);
        if (!trimmedLyric || /^([>\-]+)$/.test(trimmedLyric) || trimmedLyric.length === 1) {
          return;
        }

        const chordText = cleanDisplayText(spanEl.textContent);
        if (!isChordTextAllowed(chordText)) {
          return;
        }

        const chordWidth = Math.ceil(spanEl.getBoundingClientRect().width);
        const lyricWidth = Math.ceil(lyricEl.getBoundingClientRect().width);
        if ((chordWidth - lyricWidth) >= 8) {
          lyricEl.style.display = 'inline-block';
          lyricEl.style.minWidth = `${chordWidth + 2}px`;
          lyricEl.classList.add('cw-adjusted-lyric');
        }

        const chordLeft = spanEl.getBoundingClientRect().left;
        const lyricLeft = lyricEl.getBoundingClientRect().left;
        const diff = lyricLeft - chordLeft;
        if (diff <= 20) {
          return;
        }

        const nextChord = spans.slice(index + 1).find((candidate) => candidate.classList?.contains('chord'));
        const minChordGap = 24;
        let shift = -diff * 0.75;
        if (Math.abs(shift) > 20) {
          shift = shift < 0 ? -16 : 16;
        }

        if (nextChord) {
          const nextChordLeft = nextChord.getBoundingClientRect().left;
          const predictedLeft = lyricLeft + shift;
          if ((nextChordLeft - predictedLeft) < minChordGap) {
            return;
          }
        }

        const currentMargin = Number.parseFloat(window.getComputedStyle(lyricEl).marginLeft) || 0;
        lyricEl.style.marginLeft = `${currentMargin + shift}px`;
        lyricEl.classList.add('cw-shifted-lyric');
      });
    });
  }

  applyMeasureBarDisplayFeatures(sheetEl);
}

function setDisplayPreferencesCollapsed(collapsed) {
  const sectionEl = document.getElementById('display-custom-section');
  const detailEl = document.getElementById('display-custom-detail');
  const toggleButton = document.getElementById('display-custom-collapse-toggle');
  const isCollapsed = Boolean(collapsed);

  sectionEl?.classList.toggle('is-collapsed', isCollapsed);
  if (detailEl) {
    detailEl.hidden = isCollapsed;
  }

  if (toggleButton) {
    toggleButton.textContent = isCollapsed ? '▶' : '▼';
    toggleButton.setAttribute('aria-expanded', String(!isCollapsed));
    toggleButton.setAttribute('aria-label', isCollapsed ? 'Expand display customization' : 'Collapse display customization');
  }

  window.requestAnimationFrame(() => {
    updateAutoScrollSafeTop();
    renderMarkerPositions();
    refreshSongExtrasLayout?.();
  });

  try {
    window.localStorage.setItem(DISPLAY_PREFS_COLLAPSED_STORAGE_KEY, isCollapsed ? '1' : '0');
  } catch (error) {
    console.warn('Failed to save display customization collapse state:', error);
  }
}

function restoreDisplayPreferencesCollapsedState() {
  try {
    const raw = window.localStorage.getItem(DISPLAY_PREFS_COLLAPSED_STORAGE_KEY);
    setDisplayPreferencesCollapsed(raw === '1');
  } catch (error) {
    console.warn('Failed to restore display customization collapse state:', error);
    setDisplayPreferencesCollapsed(false);
  }
}

function toggleDisplayPreferencesCollapsed() {
  const sectionEl = document.getElementById('display-custom-section');
  setDisplayPreferencesCollapsed(!sectionEl?.classList.contains('is-collapsed'));
}

function applyDisplayPreferences({ refreshLayout = true } = {}) {
  const rootEl = document.documentElement;
  if (!rootEl) {
    return;
  }

  syncChordStyleFlags();

  const mnotoAvailable = updateMnotoFontAvailability();
  const mnotoActive = displayPrefsState.enabled && displayPrefsState.mnotoEnabled && mnotoAvailable;
  const superscriptActive = displayPrefsState.enabled && displayPrefsState.superscriptEnabled;

  rootEl.dataset.displayCustom = displayPrefsState.enabled ? 'on' : 'off';
  rootEl.dataset.mnoto = mnotoActive ? 'on' : 'off';
  rootEl.dataset.superscript = superscriptActive ? 'on' : 'off';
  rootEl.dataset.adjustChordPos = displayPrefsState.enabled && displayPrefsState.adjustChordPos ? 'on' : 'off';
  rootEl.style.setProperty('--mnoto-font-family', mnotoAvailabilityState.family
    ? `${mnotoAvailabilityState.family}, "Noto Sans JP", "Segoe UI", sans-serif`
    : '"Noto Sans JP", "Segoe UI", sans-serif');
  rootEl.style.setProperty('--user-chord-size', `${displayPrefsState.chordFontSize}px`);
  rootEl.style.setProperty('--user-chord-offset', `${displayPrefsState.chordOffsetPx}px`);
  rootEl.style.setProperty('--user-chord-line-offset', `${displayPrefsState.chordLineOffsetPx}px`);
  rootEl.style.setProperty('--user-lyric-gap', `${displayPrefsState.lyricLineGapPx}px`);
  rootEl.style.setProperty('--user-blank-line-height', `${displayPrefsState.blankLineHeightPx}px`);
  rootEl.style.setProperty('--user-comment-gap', `${displayPrefsState.commentLineGapPx}px`);
  rootEl.style.setProperty(
    '--rc-bar-extend-up',
    `calc(1.5em - ${displayPrefsState.chordLineOffsetPx}px)`
  );
  rootEl.dataset.lyricWeight = displayPrefsState.lyricFontWeight;
  rootEl.dataset.commentWeight = displayPrefsState.commentFontWeight;
  rootEl.dataset.extendBar = displayPrefsState.enabled && displayPrefsState.extendBarUpward ? 'on' : 'off';
  rootEl.dataset.alignMeasureBars = displayPrefsState.enabled && displayPrefsState.alignMeasureBars ? 'on' : 'off';

  syncDisplayPreferenceUi();

  if (!refreshLayout) {
    return;
  }

  if (getSheetEl()?.childElementCount && originalChordPro) {
    reRender();
    return;
  }

  window.requestAnimationFrame(() => {
    applyChordLayoutAdjustments();

    if (getSheetEl()?.childElementCount) {
      refreshAutoScrollAfterRender({ restoreSavedState: false });
    }
  });
}

function updateSongKeyDisplay(renderResult, fallbackKey = '', estimatedKey = '', estimatedMode = 'sharp') {
  const keyEl = document.getElementById('key');
  if (!keyEl) {
    return;
  }

  const explicitKeyText = String(renderResult?.key || fallbackKey || '').trim();
  const estimatedKeyText = explicitKeyText ? '' : String(estimatedKey || '').trim();
  const keyText = explicitKeyText || estimatedKeyText;

  if (!keyText) {
    keyEl.textContent = '';
    keyEl.hidden = true;
    return;
  }

  keyEl.hidden = false;

  const isEstimated = !explicitKeyText && Boolean(estimatedKeyText);
  const formatKey = typeof window.transposeKeyText === 'function'
    ? window.transposeKeyText
    : ((value) => value);
  const effectiveMode = isEstimated && accidentalMode === 'none'
    ? (estimatedMode === 'flat' ? 'flat' : 'sharp')
    : accidentalMode;
  const playKey = formatKey(keyText, transposeSemitones, effectiveMode);

  if (transposeSemitones !== 0) {
    keyEl.textContent = isEstimated
      ? `予想Key: ${keyText} / 移調後: ${playKey}`
      : `原曲Key: ${keyText} / 移調後: ${playKey}`;
    return;
  }

  keyEl.textContent = isEstimated
    ? `予想Key: ${playKey}`
    : `Key: ${playKey}`;
}

function normalizeLoadedSong(song = {}, fallbackArtist = '', fallbackId = '') {
  return {
    ...song,
    artist: String(song?.artist || fallbackArtist || 'Local Sample Artist').trim(),
    id: String(song?.id || fallbackId || 'local-test-song').trim(),
    title: String(song?.title || '').trim(),
    slug: String(song?.slug || '').trim(),
    chordPro: String(song?.chordPro || '').trim(),
    tags: normalizeSongTags(song?.tags),
    youtube: normalizeSongYoutubeEntries(song?.youtube)
  };
}

function renderLoadedSong(song = {}, fallbackArtist = '', fallbackId = '') {
  const titleEl = document.getElementById('title');
  const artistEl = document.getElementById('artist');
  const sheetEl = getSheetEl();
  if (!titleEl || !artistEl || !sheetEl) {
    return false;
  }

  currentSongData = normalizeLoadedSong(song, fallbackArtist, fallbackId);
  currentSongKey = String(song?.key || '').trim();
  originalChordPro = currentSongData.chordPro;
  currentSongEstimatedKey = estimateKeyFromChordPro(originalChordPro);
  currentSongEstimatedKeyMode = inferChordAccidentalModeFromChordPro(originalChordPro);

  const renderResult = renderChordWikiLike(originalChordPro, sheetEl, transposeSemitones, accidentalMode);
  const displayTitle = renderResult.title || currentSongData.title || 'タイトルなし';
  const displayArtist = renderResult.subtitle || currentSongData.artist || '';

  titleEl.textContent = displayTitle;
  document.title = displayTitle;
  artistEl.textContent = displayArtist;
  updateSongKeyDisplay(renderResult, currentSongKey, currentSongEstimatedKey, currentSongEstimatedKeyMode);
  renderSongSideRail(currentSongData, displayTitle, displayArtist);
  applyChordLayoutAdjustments();
  refreshAutoScrollAfterRender({ restoreSavedState: true });
  setupVisualMetronomeForSong(originalChordPro, currentSongData.artist, currentSongData.id);
  refreshSongAnnotationsAfterRender({
    artist: currentSongData.artist,
    id: currentSongData.id,
    reloadFromStorage: true
  });
  void maybeEstimateAutoScrollDuration(currentSongData, displayTitle, displayArtist);
  return true;
}

function findMatchingLocalSong(source, artist = '', id = '') {
  const requestedArtist = String(artist || '').trim();
  const requestedId = String(id || '').trim();
  const candidates = [];

  if (Array.isArray(source?.songs)) {
    candidates.push(...source.songs);
  } else if (source && typeof source === 'object') {
    candidates.push(source);
  }

  const usableSongs = candidates.filter((song) => song && typeof song === 'object');
  if (usableSongs.length === 0) {
    return null;
  }

  if (!requestedArtist && !requestedId) {
    return usableSongs[0] || null;
  }

  return usableSongs.find((song) => {
    const songArtist = String(song.artist || '').trim();
    const songId = String(song.id || song.slug || '').trim();
    return (!requestedArtist || songArtist === requestedArtist)
      && (!requestedId || songId === requestedId);
  }) || usableSongs.find((song) => String(song.id || song.slug || '').trim() === requestedId) || null;
}

async function loadLocalTestSongData(artist = '', id = '') {
  if (!isLocalFilePreview()) {
    return null;
  }

  const existingLibrarySong = findMatchingLocalSong(window[LOCAL_TEST_SONG_LIBRARY_GLOBAL_KEY], artist, id);
  if (existingLibrarySong) {
    return existingLibrarySong;
  }

  const existingSong = findMatchingLocalSong(window[LOCAL_TEST_SONG_GLOBAL_KEY], artist, id);
  if (existingSong) {
    return existingSong;
  }

  if (!localTestSongState.scriptPromise) {
    localTestSongState.scriptPromise = new Promise((resolve) => {
      const scriptEl = document.createElement('script');
      scriptEl.src = LOCAL_TEST_SONG_SCRIPT_PATH;
      scriptEl.async = true;
      scriptEl.dataset.localTestSong = 'true';
      scriptEl.onload = () => resolve(true);
      scriptEl.onerror = () => resolve(false);
      document.head.appendChild(scriptEl);
    });
  }

  await localTestSongState.scriptPromise;

  return findMatchingLocalSong(window[LOCAL_TEST_SONG_LIBRARY_GLOBAL_KEY], artist, id)
    || findMatchingLocalSong(window[LOCAL_TEST_SONG_GLOBAL_KEY], artist, id)
    || null;
}

async function tryRenderLocalTestSong(artist = '', id = '') {
  const localSong = await loadLocalTestSongData(artist, id);
  if (!localSong) {
    return false;
  }

  const rendered = renderLoadedSong(localSong, artist, id);
  if (rendered) {
    setStatus('Local sample loaded', 'success');
  }
  return rendered;
}

function trackSongView(artist, id) {
  if (!artist || !id) {
    return;
  }

  fetch(buildApiUrl(`/api/songs/${encodeURIComponent(id)}/view`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ artist })
  })
    .then(async (response) => {
      if (response.ok) {
        return;
      }

      const body = await parseJsonResponse(response);
      const detail = getErrorDetail(body, `HTTP ${response.status}`);
      console.warn('Failed to update song view score:', detail);
    })
    .catch((error) => {
      console.warn('Failed to update song view score:', error);
    });
}

function isEditorEnabled() {
  return document.documentElement.classList.contains('editor-enabled');
}

