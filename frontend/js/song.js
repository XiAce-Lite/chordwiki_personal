/*
 * 動作確認メモ
 * - 曲ページを開き、譜面左側に Start / End ピンが表示されることを確認する。
 * - 分・秒を変更すると即保存され、状態表示が Saved になることを確認する。
 * - Start で自動スクロールを開始し、再生中にマーカーを動かしても止まらず再計算されることを確認する。
 * - End マーカーが画面内に入った時点で自動停止することを確認する。
 */
let originalChordPro = '';
let transposeSemitones = 0;
let accidentalMode = 'none';
let songPrefsStorageKey = null;
let currentSongKey = '';
let currentSongEstimatedKey = '';
let currentSongEstimatedKeyMode = 'sharp';
let currentSongData = null;

const MIN_TRANSPOSE = -6;
const MAX_TRANSPOSE = 6;
const DEFAULT_DURATION_SEC = 4 * 60;
const DEFAULT_DURATION_ESTIMATE_MIN_SEC = (3 * 60) + 55;
const DEFAULT_DURATION_ESTIMATE_MAX_SEC = (4 * 60) + 5;
const AUTO_SCROLL_ESTIMATE_RATIO = 0.97;
const START_SCROLL_TOLERANCE_PX = 10;
const END_MARKER_STOP_RATIO = 2 / 3;
const MARKER_EDGE_SCROLL_ZONE_PX = 64;
const MARKER_EDGE_SCROLL_BASE_SPEED = 180;
const MARKER_EDGE_SCROLL_MAX_SPEED = 1600;
const MARKER_EDGE_SCROLL_POINTER_SPEED_FACTOR = 0.35;
const AUTO_SCROLL_STORAGE_PREFIX = 'autoscroll:v1';
const SONG_PREFS_STORAGE_PREFIX = 'prefs:v1';
const AUTO_SCROLL_COLLAPSED_STORAGE_KEY = 'autoscrollCollapsed';
const SONG_EXTRAS_COLLAPSED_STORAGE_KEY = 'songExtrasCollapsed';
const DISPLAY_PREFS_STORAGE_KEY = 'displayPrefs:v1';
const DISPLAY_PREFS_COLLAPSED_STORAGE_KEY = 'displayPrefsCollapsed';
const CHORD_ALLOWED_PATTERN = /^[A-G](#|b)?((?:m|M|maj|min|sus[0-9]*|add[0-9]*|dim|aug)*[0-9]*(?:-[0-9]+)?)(?:\([^)]+\)|\{[^}]+\})*(?:\/[A-G](#|b)?(?:\([^)]+\)|\{[^}]+\})*)?$/i;
const NARROW_SYMBOL_PATTERN = /^(?:[\-=≫≧＞>!~]+|n\.c\.?)$/i;
const LOCAL_TEST_SONG_SCRIPT_PATH = './.local/local-test-song.js';
const LOCAL_TEST_SONG_GLOBAL_KEY = '__LOCAL_TEST_SONG__';
const VOICE_MARKER_PATTERN = /[♠♣♥♦]/u;
const VOICE_MARKER_CLASS_MAP = Object.freeze({
  '♠': 'male',
  '♣': 'male2',
  '♥': 'female',
  '♦': 'female2'
});

const DEFAULT_DISPLAY_PREFS = Object.freeze({
  enabled: false,
  adjustChordPos: true,
  mnotoEnabled: false,
  chordFontSize: 14,
  chordOffsetPx: 7,
  lyricLineGapPx: 15,
  commentLineGapPx: 16,
  lyricFontWeight: 'normal',
  commentFontWeight: 'bold'
});

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
  isPlaying: false,
  frameId: null,
  startedAtMs: 0,
  lastFrameMs: 0,
  speedPxPerSec: 0,
  virtualScrollY: 0,
  dragging: null,
  hasLoadedSavedState: false
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

function buildSongApiUrl(artist, id) {
  const params = new URLSearchParams();
  params.set('artist', String(artist || '').trim());
  params.set('id', String(id || '').trim());
  return `/api/song?${params.toString()}`;
}

function buildEditSongApiUrl(artist, id) {
  const params = new URLSearchParams();
  params.set('artist', String(artist || '').trim());
  params.set('id', String(id || '').trim());
  return `/api/edit/song?${params.toString()}`;
}

function isLocalFilePreview() {
  return window.location.protocol === 'file:';
}

function normalizeAccidentalModeValue(mode) {
  return mode === 'sharp' || mode === 'flat' ? mode : 'none';
}

function getErrorDetail(payload, fallback = '処理に失敗しました。') {
  return payload?.error?.detail || payload?.detail || payload?.error || fallback;
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

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
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
    displayPrefsState.mnotoEnabled = storedPrefs.mnotoEnabled === true;
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
    displayPrefsState.lyricLineGapPx = clampDisplayPreferenceNumber(
      storedPrefs.lyricLineGapPx,
      8,
      32,
      DEFAULT_DISPLAY_PREFS.lyricLineGapPx
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
    window.localStorage.setItem(DISPLAY_PREFS_STORAGE_KEY, JSON.stringify(displayPrefsState));
  } catch (error) {
    console.warn('Failed to save display preferences:', error);
  }
}

function syncDisplayPreferenceUi() {
  const enabledInput = document.getElementById('display-custom-enabled');
  const adjustInput = document.getElementById('display-adjust-chordpos');
  const mnotoInput = document.getElementById('display-mnoto-enabled');
  const fontSizeInput = document.getElementById('display-chord-font-size');
  const offsetInput = document.getElementById('display-chord-offset');
  const lyricGapInput = document.getElementById('display-lyric-gap');
  const commentGapInput = document.getElementById('display-comment-gap');
  const lyricWeightInput = document.getElementById('display-lyric-weight');
  const commentWeightInput = document.getElementById('display-comment-weight');
  const detailEl = document.getElementById('display-custom-detail');

  if (enabledInput) {
    enabledInput.checked = displayPrefsState.enabled;
  }

  if (adjustInput) {
    adjustInput.checked = displayPrefsState.adjustChordPos;
    adjustInput.disabled = !displayPrefsState.enabled;
  }

  if (mnotoInput) {
    mnotoInput.checked = displayPrefsState.mnotoEnabled;
    mnotoInput.disabled = !displayPrefsState.enabled;
  }

  if (fontSizeInput) {
    fontSizeInput.value = String(displayPrefsState.chordFontSize);
    fontSizeInput.disabled = !displayPrefsState.enabled;
  }

  if (offsetInput) {
    offsetInput.value = String(displayPrefsState.chordOffsetPx);
    offsetInput.disabled = !displayPrefsState.enabled;
  }

  if (lyricGapInput) {
    lyricGapInput.value = String(displayPrefsState.lyricLineGapPx);
    lyricGapInput.disabled = !displayPrefsState.enabled;
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

function mergeOverflowTextIntoLine(lineEl, previousWord, overflowText) {
  if (!lineEl || !overflowText) {
    return false;
  }

  const wordSpans = Array.from(lineEl.querySelectorAll('span.word'));
  const lyricSpans = Array.from(lineEl.children).filter((child) => isLyricSpanElement(child));
  let targetSpan = wordSpans[wordSpans.length - 1] || null;

  if (!targetSpan && isLyricSpanElement(previousWord)) {
    targetSpan = previousWord;
  }

  if (!targetSpan && lyricSpans.length > 0) {
    targetSpan = lyricSpans[lyricSpans.length - 1];
  }

  if (!targetSpan) {
    targetSpan = document.createElement('span');
    targetSpan.className = lyricSpans.length === 0 ? 'wordtop' : 'word';
    lineEl.appendChild(targetSpan);
  }

  const existingText = String(targetSpan.textContent || '');
  const trimmedText = existingText.replace(/\s+$/, '');

  if (/\|$/.test(trimmedText)) {
    const textWithoutBar = trimmedText.replace(/\|+$/, '').replace(/\s+$/, '');
    const separator = textWithoutBar ? ' ' : '';
    targetSpan.textContent = `${textWithoutBar}${separator}${overflowText} | `;
    return true;
  }

  const separator = trimmedText ? ' ' : '';
  targetSpan.textContent = `${trimmedText}${separator}${overflowText}`;
  return true;
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

function moveOverflowWordtopsToPreviousLine() {
  const sheetEl = getSheetEl();
  if (!sheetEl) {
    return;
  }

  Array.from(sheetEl.querySelectorAll('span.wordtop')).forEach((wordtop) => {
    const cleanedText = cleanDisplayText(wordtop.textContent);
    if (cleanedText === '|') {
      wordtop.textContent = '| ';
      return;
    }

    if (!(cleanedText.length > 1 && cleanedText.endsWith('|') && /[^|]/.test(cleanedText) && !cleanedText.startsWith('|'))) {
      return;
    }

    if (containsVoiceMarkerSymbol(cleanedText)) {
      return;
    }

    const overflowText = cleanedText.replace(/\|+\s*$/, '').trim();
    if (!overflowText || isRhythmMarkerOnlyText(overflowText) || startsWithRhythmMarker(overflowText) || containsVoiceMarkerSymbol(overflowText)) {
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

    if (!mergeOverflowTextIntoLine(parentLine, previousWord, overflowText)) {
      return;
    }

    wordtop.textContent = '| ';
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

  Array.from(sheetEl.querySelectorAll('span.chord')).forEach((span) => {
    let nextText = String(span.textContent || '').replace(/maj/gi, 'M');

    if (displayPrefsState.mnotoEnabled) {
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

  if (!(displayPrefsState.enabled && displayPrefsState.adjustChordPos)) {
    return;
  }

  sheetEl.querySelectorAll('p.line').forEach((lineEl) => {
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

  rootEl.dataset.displayCustom = displayPrefsState.enabled ? 'on' : 'off';
  rootEl.dataset.mnoto = displayPrefsState.enabled && displayPrefsState.mnotoEnabled ? 'on' : 'off';
  rootEl.dataset.adjustChordPos = displayPrefsState.enabled && displayPrefsState.adjustChordPos ? 'on' : 'off';
  rootEl.style.setProperty('--user-chord-size', `${displayPrefsState.chordFontSize}px`);
  rootEl.style.setProperty('--user-chord-offset', `${displayPrefsState.chordOffsetPx}px`);
  rootEl.style.setProperty('--user-lyric-gap', `${displayPrefsState.lyricLineGapPx}px`);
  rootEl.style.setProperty('--user-comment-gap', `${displayPrefsState.commentLineGapPx}px`);
  rootEl.dataset.lyricWeight = displayPrefsState.lyricFontWeight;
  rootEl.dataset.commentWeight = displayPrefsState.commentFontWeight;

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
  artistEl.textContent = displayArtist;
  updateSongKeyDisplay(renderResult, currentSongKey, currentSongEstimatedKey, currentSongEstimatedKeyMode);
  renderSongSideRail(currentSongData, displayTitle, displayArtist);
  applyChordLayoutAdjustments();
  refreshAutoScrollAfterRender({ restoreSavedState: true });
  void maybeEstimateAutoScrollDuration(currentSongData, displayTitle, displayArtist);
  return true;
}

async function loadLocalTestSongData() {
  if (!isLocalFilePreview()) {
    return null;
  }

  const existingSong = window[LOCAL_TEST_SONG_GLOBAL_KEY];
  if (existingSong && typeof existingSong === 'object') {
    return existingSong;
  }

  if (!localTestSongState.scriptPromise) {
    localTestSongState.scriptPromise = new Promise((resolve) => {
      const scriptEl = document.createElement('script');
      scriptEl.src = LOCAL_TEST_SONG_SCRIPT_PATH;
      scriptEl.async = true;
      scriptEl.dataset.localTestSong = 'true';
      scriptEl.onload = () => resolve(window[LOCAL_TEST_SONG_GLOBAL_KEY] || null);
      scriptEl.onerror = () => resolve(null);
      document.head.appendChild(scriptEl);
    });
  }

  const localSong = await localTestSongState.scriptPromise;
  return localSong && typeof localSong === 'object' ? localSong : null;
}

async function tryRenderLocalTestSong(artist = '', id = '') {
  const localSong = await loadLocalTestSongData();
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

  fetch(`/api/songs/${encodeURIComponent(id)}/view`, {
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

function normalizeSongTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .map((tag) => String(tag || '').trim())
    .filter(Boolean);
}

function normalizeSongYoutubeEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => {
      const id = String(entry?.id || '').trim();
      const start = Number.parseInt(String(entry?.start ?? 0), 10);

      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
        return null;
      }

      return {
        id,
        start: Number.isFinite(start) ? Math.max(0, Math.trunc(start)) : 0
      };
    })
    .filter(Boolean);
}

function isEditorEnabled() {
  return document.documentElement.classList.contains('editor-enabled');
}

function normalizeTextBlock(text) {
  return String(text || '').replace(/\r\n|\n\r|\r/g, '\n');
}

function extractYoutubeId(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return '';
  }

  const directMatch = raw.match(/^([A-Za-z0-9_-]{11})(?=$|[?&#\s])/);
  if (directMatch) {
    return directMatch[1];
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const hostname = url.hostname.toLowerCase();

      if (hostname.includes('youtu.be')) {
        return (url.pathname.split('/').filter(Boolean)[0] || '').trim();
      }

      if (hostname.includes('youtube.com')) {
        const fromQuery = (url.searchParams.get('v') || '').trim();
        if (fromQuery) {
          return fromQuery;
        }

        const parts = url.pathname.split('/').filter(Boolean);
        const markerIndex = parts.findIndex((part) => part === 'embed' || part === 'shorts');
        if (markerIndex !== -1 && parts[markerIndex + 1]) {
          return parts[markerIndex + 1].trim();
        }
      }
    } catch {
      return '';
    }
  }

  const embeddedMatch = raw.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/i);
  return embeddedMatch ? embeddedMatch[1] : '';
}

function extractYoutubeStart(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/(?:[?&\s]|^)(?:t|start)\s*=\s*(\d+)(?:s)?(?=$|[&#\s])/i);
  const parsed = Number.parseInt(String(match?.[1] || '0'), 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function parseYoutubeLine(line) {
  const raw = String(line || '').trim();
  if (!raw) {
    return null;
  }

  const id = extractYoutubeId(raw);
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return null;
  }

  return {
    id,
    start: extractYoutubeStart(raw)
  };
}

function parseYoutubeTextarea(text) {
  return normalizeTextBlock(text)
    .split('\n')
    .map((line) => parseYoutubeLine(line))
    .filter(Boolean);
}

function formatYoutubeEntriesForEdit(entries) {
  return normalizeSongYoutubeEntries(entries)
    .map((entry) => (entry.start > 0 ? `${entry.id}?t=${entry.start}` : entry.id))
    .join('\n');
}

function formatYouTubeTimeLabel(totalSeconds) {
  const safeSeconds = Math.max(0, Math.trunc(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getCachedYouTubeTitle(videoId) {
  return String(youtubeTitleCache.get(videoId) || '').trim();
}

function buildYouTubeWatchUrl(videoId, start = 0) {
  const safeStart = Math.max(0, Math.trunc(Number(start) || 0));
  return safeStart > 0
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${safeStart}s`
    : `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function buildYouTubeItemLabel(entry) {
  const title = getCachedYouTubeTitle(entry.id);
  const suffix = entry.start > 0 ? ` (${formatYouTubeTimeLabel(entry.start)})` : '';
  return title ? `▶ ${title}${suffix}` : `▶ 再生${suffix}`;
}

function refreshYouTubeItemLabels() {
  const isOpen = !document.getElementById('youtube-player-shell')?.hidden;

  document.querySelectorAll('.song-youtube-item').forEach((button) => {
    const id = String(button.dataset.videoId || '').trim();
    const start = Math.max(0, Number.parseInt(button.dataset.start || '0', 10) || 0);

    button.textContent = buildYouTubeItemLabel({ id, start });
    button.classList.toggle('is-active', isOpen && youtubePlayerState.currentVideoId === id);
  });
}

function updateYouTubePlayerTitle(videoId, start = 0, title = '') {
  const titleEl = document.getElementById('youtube-player-title');
  const safeStart = Math.max(0, Math.trunc(Number(start) || 0));
  const displayTitle = String(title || getCachedYouTubeTitle(videoId) || videoId).trim();
  const suffix = safeStart > 0 ? ` @${formatYouTubeTimeLabel(safeStart)}` : '';

  if (titleEl) {
    titleEl.textContent = `Now Playing: ${displayTitle}${suffix}`;
  }
}

function storeYouTubeTitle(videoId, title) {
  const safeId = String(videoId || '').trim();
  const safeTitle = String(title || '').trim();

  if (!/^[A-Za-z0-9_-]{11}$/.test(safeId) || !safeTitle) {
    return;
  }

  youtubeTitleCache.set(safeId, safeTitle);
  refreshYouTubeItemLabels();

  if (youtubePlayerState.currentVideoId === safeId) {
    updateYouTubePlayerTitle(safeId, youtubePlayerState.currentStart, safeTitle);
  }
}

function loadYouTubeIframeApi() {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youtubePlayerState.apiPromise) {
    return youtubePlayerState.apiPromise;
  }

  youtubePlayerState.apiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousReady === 'function') {
        previousReady();
      }
      resolve(window.YT);
    };

    let scriptEl = document.querySelector('script[data-youtube-iframe-api="true"]');
    if (!scriptEl) {
      scriptEl = document.createElement('script');
      scriptEl.src = 'https://www.youtube.com/iframe_api';
      scriptEl.async = true;
      scriptEl.dataset.youtubeIframeApi = 'true';
      scriptEl.onerror = () => reject(new Error('Failed to load YouTube IFrame API.'));
      document.head.appendChild(scriptEl);
    }
  });

  return youtubePlayerState.apiPromise;
}

function handleYouTubePlayerStateChange(event) {
  const playerState = Number(event?.data);
  const YT = window.YT;

  if (!YT || !youtubePlayerState.currentVideoId) {
    return;
  }

  if (playerState === YT.PlayerState.PLAYING || playerState === YT.PlayerState.CUED) {
    const videoTitle = String(event.target?.getVideoData?.().title || '').trim();
    if (videoTitle) {
      storeYouTubeTitle(youtubePlayerState.currentVideoId, videoTitle);
    } else {
      updateYouTubePlayerTitle(youtubePlayerState.currentVideoId, youtubePlayerState.currentStart);
    }
  }
}

function handleYouTubePlayerError(event) {
  console.warn('YouTube player error:', event?.data);
  updateYouTubePlayerTitle(youtubePlayerState.currentVideoId, youtubePlayerState.currentStart);
}

async function ensureYouTubePlayer() {
  if (youtubePlayerState.player) {
    return youtubePlayerState.player;
  }

  if (youtubePlayerState.playerPromise) {
    return youtubePlayerState.playerPromise;
  }

  youtubePlayerState.playerPromise = loadYouTubeIframeApi()
    .then((YT) => new Promise((resolve) => {
      youtubePlayerState.player = new YT.Player('youtube-player-host', {
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin
        },
        events: {
          onReady: (playerEvent) => resolve(playerEvent.target),
          onStateChange: handleYouTubePlayerStateChange,
          onError: handleYouTubePlayerError
        }
      });
    }))
    .catch((error) => {
      youtubePlayerState.playerPromise = null;
      throw error;
    });

  return youtubePlayerState.playerPromise;
}

function closeYouTubePlayer() {
  const shell = document.getElementById('youtube-player-shell');

  youtubePlayerState.currentVideoId = '';
  youtubePlayerState.currentStart = 0;

  if (youtubePlayerState.player?.stopVideo) {
    youtubePlayerState.player.stopVideo();
  }

  if (shell) {
    shell.hidden = true;
  }

  refreshYouTubeItemLabels();
}

async function playYouTubeVideo(videoId, start = 0) {
  const shell = document.getElementById('youtube-player-shell');
  const openLinkEl = document.getElementById('youtube-player-open');

  if (!shell || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return;
  }

  const safeStart = Math.max(0, Math.trunc(Number(start) || 0));
  youtubePlayerState.currentVideoId = videoId;
  youtubePlayerState.currentStart = safeStart;

  if (openLinkEl) {
    openLinkEl.href = buildYouTubeWatchUrl(videoId, safeStart);
  }

  shell.hidden = false;
  updateYouTubePlayerTitle(videoId, safeStart);
  refreshYouTubeItemLabels();

  try {
    const player = await ensureYouTubePlayer();
    player.loadVideoById({ videoId, startSeconds: safeStart });

    window.setTimeout(() => {
      const liveTitle = String(player.getVideoData?.().title || '').trim();
      if (liveTitle) {
        storeYouTubeTitle(videoId, liveTitle);
      }
    }, 250);
  } catch (error) {
    console.warn('Failed to start YouTube mini player:', error);
    window.open(buildYouTubeWatchUrl(videoId, safeStart), '_blank', 'noopener');
  }
}

function renderSongSideRail(song = {}, displayTitle = '', displayArtist = '') {
  const extrasUi = document.getElementById('song-extras-ui');
  const tagsBlock = document.getElementById('song-tags-block');
  const tagsEl = document.getElementById('song-tags');
  const youtubeBlock = document.getElementById('song-youtube-block');
  const youtubeListEl = document.getElementById('song-youtube-list');
  const youtubeSearchButton = document.getElementById('youtube-search-button');
  const editorEnabled = isEditorEnabled();

  const tags = normalizeSongTags(song?.tags);
  if (tagsBlock) {
    tagsBlock.hidden = tags.length === 0 && !editorEnabled;
  }

  if (tagsEl) {
    tagsEl.innerHTML = '';

    if (!tags.length) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'song-tags-empty';
      emptyEl.textContent = editorEnabled ? '未登録（Editボタンで編集できます）' : '登録なし';
      tagsEl.appendChild(emptyEl);
    } else {
      tags.forEach((tag) => {
        const tagButton = document.createElement('button');
        tagButton.type = 'button';
        tagButton.className = 'song-tag';
        tagButton.textContent = tag;
        tagButton.addEventListener('click', () => {
          window.location.href = `/?q=${encodeURIComponent(tag)}&target=tag`;
        });
        tagsEl.appendChild(tagButton);
      });
    }
  }

  const youtubeEntries = normalizeSongYoutubeEntries(song?.youtube);
  if (youtubeListEl) {
    youtubeListEl.innerHTML = '';

    if (!youtubeEntries.length) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'song-youtube-empty';
      emptyEl.textContent = editorEnabled ? '未登録（Editボタンで編集できます）' : '登録なし';
      youtubeListEl.appendChild(emptyEl);
    } else {
      youtubeEntries.forEach((entry) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'song-youtube-item';
        button.dataset.videoId = entry.id;
        button.dataset.start = String(entry.start);
        button.textContent = buildYouTubeItemLabel(entry);
        button.addEventListener('click', () => {
          playYouTubeVideo(entry.id, entry.start);
        });
        youtubeListEl.appendChild(button);
      });

      refreshYouTubeItemLabels();
    }
  }

  const searchQuery = String(displayTitle || song?.title || '').trim();

  if (youtubeSearchButton) {
    youtubeSearchButton.hidden = !searchQuery;
    youtubeSearchButton.onclick = () => {
      if (!searchQuery) {
        return;
      }

      window.open(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`,
        '_blank',
        'noopener'
      );
    };
  }

  if (youtubeBlock) {
    youtubeBlock.hidden = !searchQuery && youtubeEntries.length === 0 && !editorEnabled;
  }

  if (extrasUi) {
    extrasUi.hidden = !(editorEnabled || tags.length > 0 || youtubeEntries.length > 0 || searchQuery);
  }
}

function getAutoScrollUiEl() {
  return document.getElementById('autoscroll-ui');
}

function setAutoScrollCollapsed(collapsed) {
  const uiEl = getAutoScrollUiEl();
  const toggleButton = document.getElementById('autoscroll-collapse-toggle');
  const isCollapsed = Boolean(collapsed);

  if (uiEl) {
    uiEl.classList.toggle('is-collapsed', isCollapsed);
  }

  if (toggleButton) {
    toggleButton.textContent = isCollapsed ? '≪' : '≫';
    toggleButton.setAttribute('aria-expanded', String(!isCollapsed));
    toggleButton.setAttribute('aria-label', isCollapsed ? 'Expand song controls' : 'Collapse song controls');
  }

  window.requestAnimationFrame(() => {
    updateAutoScrollSafeTop();
    renderMarkerPositions();
  });

  try {
    window.localStorage.setItem(AUTO_SCROLL_COLLAPSED_STORAGE_KEY, isCollapsed ? '1' : '0');
  } catch (error) {
    console.warn('Failed to save collapse state:', error);
  }
}

function restoreAutoScrollCollapsedState() {
  try {
    const raw = window.localStorage.getItem(AUTO_SCROLL_COLLAPSED_STORAGE_KEY);
    setAutoScrollCollapsed(raw === '1');
  } catch (error) {
    console.warn('Failed to restore collapse state:', error);
    setAutoScrollCollapsed(false);
  }
}

function toggleAutoScrollCollapsed() {
  const uiEl = getAutoScrollUiEl();
  setAutoScrollCollapsed(!uiEl?.classList.contains('is-collapsed'));
}

function getSongExtrasUiEl() {
  return document.getElementById('song-extras-ui');
}

function setSongExtrasCollapsed(collapsed) {
  const uiEl = getSongExtrasUiEl();
  const toggleButton = document.getElementById('song-extras-collapse-toggle');
  const isCollapsed = Boolean(collapsed);

  if (uiEl) {
    uiEl.classList.toggle('is-collapsed', isCollapsed);
  }

  if (toggleButton) {
    toggleButton.textContent = isCollapsed ? '≪' : '≫';
    toggleButton.setAttribute('aria-expanded', String(!isCollapsed));
    toggleButton.setAttribute('aria-label', isCollapsed ? 'Expand song extras' : 'Collapse song extras');
  }

  window.requestAnimationFrame(() => {
    updateAutoScrollSafeTop();
    renderMarkerPositions();
  });

  try {
    window.localStorage.setItem(SONG_EXTRAS_COLLAPSED_STORAGE_KEY, isCollapsed ? '1' : '0');
  } catch (error) {
    console.warn('Failed to save extras collapse state:', error);
  }
}

function restoreSongExtrasCollapsedState() {
  try {
    const raw = window.localStorage.getItem(SONG_EXTRAS_COLLAPSED_STORAGE_KEY);
    setSongExtrasCollapsed(raw === '1');
  } catch (error) {
    console.warn('Failed to restore extras collapse state:', error);
    setSongExtrasCollapsed(false);
  }
}

function toggleSongExtrasCollapsed() {
  const uiEl = getSongExtrasUiEl();
  setSongExtrasCollapsed(!uiEl?.classList.contains('is-collapsed'));
  window.requestAnimationFrame(updateAutoScrollSafeTop);
}

function updateAutoScrollSafeTop() {
  const rootStyle = document.documentElement?.style;
  if (!rootStyle) {
    return;
  }

  const adminActionsEl = document.getElementById('song-admin-actions');
  const autoScrollEl = getAutoScrollUiEl();
  let safeTop = 64;
  let extrasTop = 64;

  if (adminActionsEl && !adminActionsEl.hidden) {
    const computedStyle = window.getComputedStyle(adminActionsEl);
    if (computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden') {
      const rect = adminActionsEl.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        safeTop = Math.max(safeTop, Math.round(rect.bottom + 8));
        extrasTop = Math.max(extrasTop, Math.round(rect.bottom + 8));
      }
    }
  }

  if (autoScrollEl) {
    const computedStyle = window.getComputedStyle(autoScrollEl);
    if (computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden') {
      const rect = autoScrollEl.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        extrasTop = Math.max(extrasTop, Math.round(rect.bottom + 12));
      }
    }
  }

  rootStyle.setProperty('--autoscroll-safe-top', `${safeTop}px`);
  rootStyle.setProperty('--song-extras-safe-top', `${extrasTop}px`);
}

function updateEditorActions(artist, id) {
  const adminActionsEl = document.getElementById('song-admin-actions');
  const editLinkEl = document.getElementById('edit-link');
  const deleteButtonEl = document.getElementById('delete-button');

  if (!editLinkEl || !deleteButtonEl) {
    return;
  }

  if (!artist || !id) {
    if (adminActionsEl) {
      adminActionsEl.hidden = true;
    }
    deleteButtonEl.disabled = true;
    updateAutoScrollSafeTop();
    return;
  }

  if (adminActionsEl) {
    adminActionsEl.hidden = false;
  }

  deleteButtonEl.disabled = false;
  editLinkEl.href = `/edit.html?mode=edit&artist=${encodeURIComponent(artist)}&id=${encodeURIComponent(id)}`;
  updateAutoScrollSafeTop();
}

function setSongMetaModalMessage(text = '', type = '') {
  const messageEl = document.getElementById('song-meta-modal-message');
  if (!messageEl) {
    return;
  }

  messageEl.textContent = text;
  messageEl.className = `song-meta-modal-message${type ? ` ${type}` : ''}`;
}

function openSongMetaModal(mode) {
  const modalEl = document.getElementById('song-meta-modal');
  const titleEl = document.getElementById('song-meta-modal-title');
  const helpEl = document.getElementById('song-meta-modal-help');
  const inputEl = document.getElementById('song-meta-modal-input');

  if (!modalEl || !titleEl || !helpEl || !inputEl) {
    return;
  }

  const normalizedMode = mode === 'youtube' ? 'youtube' : 'tags';
  const editorEnabled = isEditorEnabled();
  const song = currentSongData || {};
  songMetaModalState.mode = normalizedMode;

  if (normalizedMode === 'tags') {
    titleEl.textContent = 'Tags の編集';
    helpEl.textContent = editorEnabled
      ? '1行に1タグで入力します。空行は無視されます。'
      : '現在のタグ一覧を表示しています。編集は editor ロールで利用できます。';
    inputEl.value = normalizeSongTags(song.tags).join('\n');
  } else {
    titleEl.textContent = 'YouTube の編集';
    helpEl.textContent = editorEnabled
      ? '1行に1動画です。id / id?t=42 / URL を入力できます。'
      : '現在の YouTube 一覧を表示しています。編集は editor ロールで利用できます。';
    inputEl.value = formatYoutubeEntriesForEdit(song.youtube);
  }

  inputEl.readOnly = !editorEnabled;
  inputEl.disabled = false;
  modalEl.hidden = false;
  setSongMetaModalMessage(currentSongData ? '' : '曲データを読み込み中です。読み込み後に再度確認してください。');
  window.requestAnimationFrame(() => inputEl.focus());
}

function closeSongMetaModal() {
  if (songMetaModalState.isSaving) {
    return;
  }

  const modalEl = document.getElementById('song-meta-modal');
  if (modalEl) {
    modalEl.hidden = true;
  }

  setSongMetaModalMessage('');
}

async function saveSongMetaModal() {
  if (songMetaModalState.isSaving) {
    return;
  }
  const inputEl = document.getElementById('song-meta-modal-input');
  const saveButton = document.getElementById('song-meta-modal-save');
  const cancelButton = document.getElementById('song-meta-modal-cancel');
  const closeButton = document.getElementById('song-meta-modal-close');

  if (!inputEl || !currentSongData?.id || !currentSongData?.artist) {
    setSongMetaModalMessage('曲データの読み込み後に操作してください。', 'error');
    return;
  }

  if (!isEditorEnabled()) {
    setSongMetaModalMessage('この操作には editor ロールが必要です。', 'error');
    return;
  }

  const nextTags = songMetaModalState.mode === 'tags'
    ? normalizeTextBlock(inputEl.value)
      .split('\n')
      .map((tag) => tag.trim())
      .filter(Boolean)
    : normalizeSongTags(currentSongData?.tags);

  const nextYoutube = songMetaModalState.mode === 'youtube'
    ? parseYoutubeTextarea(inputEl.value)
    : normalizeSongYoutubeEntries(currentSongData?.youtube);

  const payload = {
    id: String(currentSongData.id || '').trim(),
    title: String(currentSongData.title || document.getElementById('title')?.textContent || '').trim(),
    slug: String(currentSongData.slug || '').trim(),
    artist: String(currentSongData.artist || getQueryParam('artist') || '').trim(),
    tags: nextTags,
    youtube: nextYoutube,
    chordPro: String(currentSongData.chordPro || originalChordPro || '').trim(),
    createdAt: String(currentSongData.createdAt || '').trim(),
    updatedAt: new Date().toISOString()
  };

  if (!payload.title || !payload.slug || !payload.artist || !payload.chordPro) {
    setSongMetaModalMessage('保存に必要な曲情報が不足しています。', 'error');
    return;
  }

  songMetaModalState.isSaving = true;
  inputEl.disabled = true;
  saveButton && (saveButton.disabled = true);
  cancelButton && (cancelButton.disabled = true);
  closeButton && (closeButton.disabled = true);
  setSongMetaModalMessage('保存しています...');

  try {
    const response = await fetch(
      buildEditSongApiUrl(currentSongData.artist, currentSongData.id),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      }
    );

    const body = await parseJsonResponse(response);
    if (!response.ok) {
      const detail = getErrorDetail(body, `HTTP ${response.status}`);
      setSongMetaModalMessage(detail, 'error');
      return;
    }

    currentSongData = {
      ...(currentSongData || {}),
      ...payload,
      ...(body && typeof body === 'object' ? body : {})
    };
    currentSongData.tags = normalizeSongTags(currentSongData.tags);
    currentSongData.youtube = normalizeSongYoutubeEntries(currentSongData.youtube);

    renderSongSideRail(
      currentSongData,
      String(document.getElementById('title')?.textContent || currentSongData.title || '').trim(),
      String(document.getElementById('artist')?.textContent || currentSongData.artist || '').trim()
    );

    setSongMetaModalMessage('保存しました。', 'success');
    window.setTimeout(() => {
      closeSongMetaModal();
    }, 300);
  } catch (error) {
    console.error('Failed to save song extras:', error);
    setSongMetaModalMessage('保存中に通信エラーが発生しました。', 'error');
  } finally {
    songMetaModalState.isSaving = false;
    inputEl.disabled = false;
    inputEl.readOnly = !isEditorEnabled();
    saveButton && (saveButton.disabled = false);
    cancelButton && (cancelButton.disabled = false);
    closeButton && (closeButton.disabled = false);
  }
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

function getDisplayedDurationSec() {
  const minutes = Math.max(0, Number.parseInt(document.getElementById('autoscroll-minutes')?.value ?? '0', 10) || 0);
  const seconds = clamp(Number.parseInt(document.getElementById('autoscroll-seconds')?.value ?? '0', 10) || 0, 0, 59);
  return (minutes * 60) + seconds;
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

  const rawTitle = String(displayTitle || song?.title || '').trim();
  const title = stripParenthesizedTitleText(rawTitle);
  const artist = String(displayArtist || song?.artist || '').trim();
  if (!title || !artist) {
    return;
  }

  autoScrollEstimateState.attempted = true;
  autoScrollEstimateState.inFlight = true;

  try {
    const endpoint = `/api/youtube/search-duration?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`;
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

  const lines = sheetEl.querySelectorAll('p.line, p.comment');
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

function getMarkerViewportLeft() {
  const sheetEl = getSheetEl();
  if (!sheetEl) {
    return 8;
  }

  const sheetRect = sheetEl.getBoundingClientRect();
  return Math.max(8, Math.round(sheetRect.left - 82));
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

function setMarkerY(markerName, docY, { persist = true, notify = true } = {}) {
  const defaults = getDefaultMarkerPositions();
  const fallbackY = markerName === 'start' ? defaults.startY : defaults.endY;
  const nextY = clampMarkerToSheet(docY, fallbackY);

  if (markerName === 'start') {
    const maxStartY = clampMarkerToSheet(
      Number.isFinite(autoScrollState.endY) ? autoScrollState.endY : defaults.endY,
      defaults.endY
    );
    autoScrollState.startY = Math.min(nextY, maxStartY);
  } else {
    const minEndY = clampMarkerToSheet(
      Number.isFinite(autoScrollState.startY) ? autoScrollState.startY : defaults.startY,
      defaults.startY
    );
    autoScrollState.endY = Math.max(nextY, minEndY);
  }

  renderMarkerPositions();

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

function hasEndMarkerReachedStopLine() {
  const endMarkerEl = getEndMarkerEl();
  if (!endMarkerEl) {
    return false;
  }

  const stopLineY = window.innerHeight * END_MARKER_STOP_RATIO;
  return endMarkerEl.getBoundingClientRect().top <= stopLineY;
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

  if (hasEndMarkerReachedStopLine()) {
    stopAutoScroll('Stopped · End が停止ラインに到達', 'success');
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

  if (hasEndMarkerReachedStopLine()) {
    stopAutoScroll('Stopped · End が画面の 2/3 ラインに到達', 'success');
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

function resetAutoScrollMarkers() {
  const defaults = getDefaultMarkerPositions();
  autoScrollState.startY = defaults.startY;
  autoScrollState.endY = defaults.endY;

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

  currentSongKey = '';
  currentSongEstimatedKey = '';
  currentSongEstimatedKeyMode = 'sharp';
  currentSongData = null;
  originalChordPro = '';
  autoScrollEstimateState.attempted = false;
  autoScrollEstimateState.inFlight = false;

  const titleEl = document.getElementById('title');
  const artistEl = document.getElementById('artist');
  const keyEl = document.getElementById('key');
  const sheetEl = getSheetEl();

  updateEditorActions(artist, id);

  if (!artist || !id) {
    if (await tryRenderLocalTestSong(artist, id)) {
      return;
    }

    titleEl.textContent = 'Invalid parameters';
    artistEl.textContent = '';
    if (keyEl) {
      keyEl.textContent = '';
      keyEl.hidden = true;
    }
    sheetEl.textContent = 'artist または id が指定されていません。';
    setStatus('Stopped · URL パラメータ不足', 'warn');
    return;
  }

  autoScrollState.storageKey = getSongStorageKey(artist, id);
  songPrefsStorageKey = getSongPrefsStorageKey(artist, id);
  loadSongPreferences();
  updateTransposeDisplay();

  try {
    const response = await fetch(
      buildSongApiUrl(artist, id),
      { credentials: 'include' }
    );

    const payload = await parseJsonResponse(response);

    if (response.status === 404) {
      if (await tryRenderLocalTestSong(artist, id)) {
        return;
      }

      titleEl.textContent = 'Song not found';
      artistEl.textContent = '';
      if (keyEl) {
        keyEl.textContent = '';
        keyEl.hidden = true;
      }
      sheetEl.textContent = '指定された曲が見つかりませんでした。';
      setStatus('Stopped · 曲が見つかりません', 'warn');
      return;
    }

    if (!response.ok) {
      throw new Error(getErrorDetail(payload, `HTTP ${response.status}`));
    }

    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid song response payload.');
    }

    const song = payload;
    if (!renderLoadedSong(song, artist, id)) {
      throw new Error('Failed to render loaded song.');
    }

    trackSongView(artist, id);
  } catch (error) {
    console.error('Error loading song:', error);

    if (await tryRenderLocalTestSong(artist, id)) {
      return;
    }

    titleEl.textContent = 'Error loading song';
    artistEl.textContent = '';
    if (keyEl) {
      keyEl.textContent = '';
      keyEl.hidden = true;
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

  syncAccidentalModeUi();
}

function reRender() {
  const sheetEl = getSheetEl();
  if (!sheetEl) {
    return;
  }

  const renderResult = renderChordWikiLike(originalChordPro, sheetEl, transposeSemitones, accidentalMode);
  updateSongKeyDisplay(renderResult, currentSongKey, currentSongEstimatedKey, currentSongEstimatedKeyMode);
  updateTransposeDisplay();
  saveSongPreferences();
  applyChordLayoutAdjustments();
  refreshAutoScrollAfterRender({ restoreSavedState: false });
}

function initializeAutoScrollUi() {
  document.getElementById('autoscroll-toggle')?.addEventListener('click', toggleAutoScroll);
  document.getElementById('autoscroll-duration-reset')?.addEventListener('click', resetAutoScrollDuration);
  document.getElementById('autoscroll-markers-reset')?.addEventListener('click', resetAutoScrollMarkers);
  document.getElementById('delete-button')?.addEventListener('click', handleDeleteSong);
  document.getElementById('autoscroll-collapse-toggle')?.addEventListener('click', toggleAutoScrollCollapsed);
  document.getElementById('youtube-player-close')?.addEventListener('click', closeYouTubePlayer);

  const onDurationInput = () => syncDurationFromInputs({ notify: true });
  document.getElementById('autoscroll-minutes')?.addEventListener('input', onDurationInput);
  document.getElementById('autoscroll-seconds')?.addEventListener('input', onDurationInput);

  document.querySelectorAll('.autoscroll-preset').forEach((button) => {
    button.addEventListener('click', () => {
      applyDurationPreset(button.dataset.minutes, button.dataset.seconds);
    });
  });

  document.querySelector('.sheet-stage')?.addEventListener('click', handleSheetPrimaryClick);

  ensureMarkerElements();
  setDurationInputs(DEFAULT_DURATION_SEC);
  updateAutoScrollControls();
  setStatus('Stopped', 'info');
  restoreAutoScrollCollapsedState();
  updateAutoScrollSafeTop();

  window.addEventListener('scroll', () => {
    renderMarkerPositions();

    if (autoScrollState.isPlaying && Math.abs(window.scrollY - autoScrollState.virtualScrollY) > 3) {
      autoScrollState.virtualScrollY = window.scrollY;
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    updateAutoScrollSafeTop();
    renderMarkerPositions();

    if (autoScrollState.isPlaying) {
      recalculateAutoScrollSpeed();
    } else {
      updateStoppedStatus(false);
    }
  });

  window.addEventListener('beforeunload', () => {
    saveAutoScrollState({ notify: false });
    saveSongPreferences();
  });
}

function initializeSongExtrasUi() {
  closeSongMetaModal();

  document.getElementById('song-extras-collapse-toggle')?.addEventListener('click', toggleSongExtrasCollapsed);
  document.getElementById('song-tags-header')?.addEventListener('click', () => openSongMetaModal('tags'));
  document.getElementById('song-youtube-header')?.addEventListener('click', () => openSongMetaModal('youtube'));
  document.getElementById('song-meta-modal-close')?.addEventListener('click', closeSongMetaModal);
  document.getElementById('song-meta-modal-cancel')?.addEventListener('click', closeSongMetaModal);
  document.getElementById('song-meta-modal-save')?.addEventListener('click', saveSongMetaModal);
  document.getElementById('song-meta-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'song-meta-modal') {
      closeSongMetaModal();
    }
  });
  document.getElementById('song-meta-modal-input')?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSongMetaModal();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && isEditorEnabled()) {
      event.preventDefault();
      saveSongMetaModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.getElementById('song-meta-modal')?.hidden) {
      closeSongMetaModal();
    }
  });

  restoreSongExtrasCollapsedState();
}

function initializeDisplayPreferencesUi() {
  loadDisplayPreferences();
  applyDisplayPreferences({ refreshLayout: false });

  const enabledInput = document.getElementById('display-custom-enabled');
  const adjustInput = document.getElementById('display-adjust-chordpos');
  const mnotoInput = document.getElementById('display-mnoto-enabled');
  const fontSizeInput = document.getElementById('display-chord-font-size');
  const offsetInput = document.getElementById('display-chord-offset');
  const lyricGapInput = document.getElementById('display-lyric-gap');
  const commentGapInput = document.getElementById('display-comment-gap');
  const lyricWeightInput = document.getElementById('display-lyric-weight');
  const commentWeightInput = document.getElementById('display-comment-weight');

  document.getElementById('display-custom-collapse-toggle')?.addEventListener('click', toggleDisplayPreferencesCollapsed);
  restoreDisplayPreferencesCollapsedState();

  const updateNumericSettings = () => {
    displayPrefsState.chordFontSize = clampDisplayPreferenceNumber(
      fontSizeInput?.value,
      6,
      18,
      DEFAULT_DISPLAY_PREFS.chordFontSize
    );
    displayPrefsState.chordOffsetPx = clampDisplayPreferenceNumber(
      offsetInput?.value,
      -3,
      10,
      DEFAULT_DISPLAY_PREFS.chordOffsetPx
    );
    displayPrefsState.lyricLineGapPx = clampDisplayPreferenceNumber(
      lyricGapInput?.value,
      8,
      32,
      DEFAULT_DISPLAY_PREFS.lyricLineGapPx
    );
    displayPrefsState.commentLineGapPx = clampDisplayPreferenceNumber(
      commentGapInput?.value,
      8,
      32,
      DEFAULT_DISPLAY_PREFS.commentLineGapPx
    );
    displayPrefsState.lyricFontWeight = lyricWeightInput?.checked ? 'bold' : 'normal';
    displayPrefsState.commentFontWeight = commentWeightInput?.checked ? 'bold' : 'normal';
  };

  const commitDisplayPreferences = () => {
    updateNumericSettings();
    saveDisplayPreferences();
    applyDisplayPreferences({ refreshLayout: true });
  };

  enabledInput?.addEventListener('change', () => {
    displayPrefsState.enabled = enabledInput.checked;
    commitDisplayPreferences();
  });

  adjustInput?.addEventListener('change', () => {
    displayPrefsState.adjustChordPos = adjustInput.checked;
    commitDisplayPreferences();
  });

  mnotoInput?.addEventListener('change', () => {
    displayPrefsState.mnotoEnabled = mnotoInput.checked;
    commitDisplayPreferences();
  });

  fontSizeInput?.addEventListener('change', commitDisplayPreferences);
  offsetInput?.addEventListener('change', commitDisplayPreferences);
  lyricGapInput?.addEventListener('change', commitDisplayPreferences);
  commentGapInput?.addEventListener('change', commitDisplayPreferences);
  lyricWeightInput?.addEventListener('change', commitDisplayPreferences);
  commentWeightInput?.addEventListener('change', commitDisplayPreferences);
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

  document.querySelectorAll('input[name="accidental-mode"]').forEach((input) => {
    input.addEventListener('change', (event) => {
      accidentalMode = normalizeAccidentalModeValue(event.target.value);
      reRender();
    });
  });

  window.ChordWikiAuth?.applyRoleVisibility();
  initializeAutoScrollUi();
  initializeSongExtrasUi();
  initializeDisplayPreferencesUi();
  updateTransposeDisplay();
  updateAutoScrollSafeTop();
  window.requestAnimationFrame(updateAutoScrollSafeTop);
  loadSong();
});