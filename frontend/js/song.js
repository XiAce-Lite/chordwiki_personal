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
let currentSongData = null;

const MIN_TRANSPOSE = -6;
const MAX_TRANSPOSE = 6;
const DEFAULT_DURATION_SEC = 4 * 60;
const DEFAULT_DURATION_ESTIMATE_MIN_SEC = (3 * 60) + 55;
const DEFAULT_DURATION_ESTIMATE_MAX_SEC = (4 * 60) + 5;
const AUTO_SCROLL_ESTIMATE_RATIO = 0.97;
const START_SCROLL_TOLERANCE_PX = 10;
const END_MARKER_STOP_RATIO = 2 / 3;
const AUTO_SCROLL_STORAGE_PREFIX = 'autoscroll:v1';
const SONG_PREFS_STORAGE_PREFIX = 'prefs:v1';
const AUTO_SCROLL_COLLAPSED_STORAGE_KEY = 'autoscrollCollapsed';
const SONG_EXTRAS_COLLAPSED_STORAGE_KEY = 'songExtrasCollapsed';

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

function normalizeAccidentalModeValue(mode) {
  return mode === 'sharp' || mode === 'flat' ? mode : 'none';
}

function getErrorDetail(payload, fallback = '処理に失敗しました。') {
  return payload?.error?.detail || payload?.detail || payload?.error || fallback;
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

function updateSongKeyDisplay(renderResult, fallbackKey = '') {
  const keyEl = document.getElementById('key');
  if (!keyEl) {
    return;
  }

  const keyText = String(renderResult?.key || fallbackKey || '').trim();
  if (!keyText) {
    keyEl.textContent = '';
    return;
  }

  const formatKey = typeof window.transposeKeyText === 'function'
    ? window.transposeKeyText
    : ((value) => value);
  const playKey = formatKey(keyText, transposeSemitones, accidentalMode);

  keyEl.textContent = transposeSemitones !== 0
    ? `Original Key: ${keyText} / Play: ${playKey}`
    : `Key: ${playKey}`;
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
          window.location.href = `/?q=${encodeURIComponent(tag)}`;
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
      `/api/edit/song/${encodeURIComponent(currentSongData.artist)}/${encodeURIComponent(currentSongData.id)}`,
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
      `/api/edit/song/${encodeURIComponent(artist)}/${encodeURIComponent(id)}`,
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

  currentSongKey = '';
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
  songPrefsStorageKey = getSongPrefsStorageKey(artist, id);
  loadSongPreferences();
  updateTransposeDisplay();

  try {
    const response = await fetch(
      `/api/song/${encodeURIComponent(artist)}/${encodeURIComponent(id)}`,
      { credentials: 'include' }
    );

    const payload = await parseJsonResponse(response);

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

    if (!response.ok) {
      throw new Error(getErrorDetail(payload, `HTTP ${response.status}`));
    }

    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid song response payload.');
    }

    const song = payload;
    currentSongData = {
      ...song,
      artist: song.artist || artist,
      id: song.id || id,
      title: song.title || '',
      slug: song.slug || '',
      chordPro: song.chordPro || '',
      tags: normalizeSongTags(song.tags),
      youtube: normalizeSongYoutubeEntries(song.youtube)
    };
    currentSongKey = song.key || '';
    originalChordPro = song.chordPro || '';
    const renderResult = renderChordWikiLike(originalChordPro, sheetEl, transposeSemitones, accidentalMode);
    const displayTitle = renderResult.title || song.title || 'タイトルなし';
    const displayArtist = renderResult.subtitle || song.artist || '';

    titleEl.textContent = displayTitle;
    artistEl.textContent = displayArtist;
    updateSongKeyDisplay(renderResult, currentSongKey);
    renderSongSideRail(currentSongData, displayTitle, displayArtist);

    refreshAutoScrollAfterRender({ restoreSavedState: true });
    void maybeEstimateAutoScrollDuration(currentSongData, displayTitle, displayArtist);
    trackSongView(artist, id);
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

  syncAccidentalModeUi();
}

function reRender() {
  const sheetEl = getSheetEl();
  if (!sheetEl) {
    return;
  }

  const renderResult = renderChordWikiLike(originalChordPro, sheetEl, transposeSemitones, accidentalMode);
  updateSongKeyDisplay(renderResult, currentSongKey);
  updateTransposeDisplay();
  saveSongPreferences();
  refreshAutoScrollAfterRender({ restoreSavedState: false });
}

function initializeAutoScrollUi() {
  document.getElementById('autoscroll-toggle')?.addEventListener('click', toggleAutoScroll);
  document.getElementById('autoscroll-reset')?.addEventListener('click', resetAutoScrollSettings);
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
  updateTransposeDisplay();
  updateAutoScrollSafeTop();
  window.requestAnimationFrame(updateAutoScrollSafeTop);
  loadSong();
});