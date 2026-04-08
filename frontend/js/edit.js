const formEl = document.getElementById('song-form');
const pageTitleEl = document.getElementById('page-title');
const pageDescriptionEl = document.getElementById('page-description');
const loadingEl = document.getElementById('loading');
const messageEl = document.getElementById('message');
const submitButton = document.getElementById('submit-button');
const deleteButton = document.getElementById('delete-button');
const cancelButton = document.getElementById('cancel-button');
const backLinkEl = document.getElementById('back-link');

const idInput = document.getElementById('song-id');
const titleInput = document.getElementById('title');
const slugInput = document.getElementById('slug');
const artistInput = document.getElementById('artist');
const tagsInput = document.getElementById('tags');
const youtubeInput = document.getElementById('youtube');
const chordProInput = document.getElementById('chordPro');

const params = new URLSearchParams(window.location.search);
const requestedMode = (params.get('mode') || 'add').toLowerCase();

const state = {
  mode: requestedMode === 'edit' ? 'edit' : 'add',
  originalArtist: params.get('artist') || '',
  originalId: params.get('id') || '',
  currentId: '',
  slugEdited: false,
  isSubmitting: false
};

function normalizeNewlines(text) {
  return String(text || '').replace(/\r\n|\n\r|\r/g, '\n');
}

function generateUuid() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function buildSongUrl(artist, id) {
  return `/song.html?artist=${encodeURIComponent(artist)}&id=${encodeURIComponent(id)}`;
}

function buildSongApiUrl(artist, id) {
  const query = new URLSearchParams({
    artist: String(artist || '').trim(),
    id: String(id || '').trim()
  });
  return `/api/song?${query.toString()}`;
}

function buildEditSongApiUrl(artist, id) {
  const query = new URLSearchParams({
    artist: String(artist || '').trim(),
    id: String(id || '').trim()
  });
  return `/api/edit/song?${query.toString()}`;
}

function showMessage(text, type = '') {
  messageEl.textContent = text || '';
  messageEl.className = `message${type ? ` ${type}` : ''}`;
}

function setLoading(isLoading, text = '') {
  loadingEl.hidden = !isLoading;
  loadingEl.textContent = text || '';
}

function setFormVisible(visible) {
  formEl.hidden = !visible;
}

function setFormDisabled(disabled) {
  for (const el of formEl.querySelectorAll('input, textarea, button')) {
    if (el.id === 'song-id') {
      el.readOnly = true;
      continue;
    }

    el.disabled = disabled;
  }

  submitButton.disabled = disabled;
  cancelButton.disabled = disabled;
}

function normalizeTags(text) {
  const normalized = normalizeNewlines(text).trim();
  if (!normalized) {
    return [];
  }

  return normalized
    .split('\n')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeYoutubeStart(value) {
  const parsed = Number.parseInt(String(value || '0'), 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
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
  return normalizeYoutubeStart(match?.[1]);
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
  return normalizeNewlines(text)
    .split('\n')
    .map((line) => parseYoutubeLine(line))
    .filter(Boolean);
}

function formatYoutubeEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return '';
  }

  return entries
    .map((entry) => {
      const id = String(entry?.id || '').trim();
      const start = normalizeYoutubeStart(entry?.start);

      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
        return '';
      }

      return start > 0 ? `${id}?t=${start}` : id;
    })
    .filter(Boolean)
    .join('\n');
}

function updatePageMeta() {
  const isEdit = state.mode === 'edit';

  document.title = isEdit ? 'ChordWiki - Edit Song' : 'ChordWiki - Add Song';
  pageTitleEl.textContent = isEdit ? 'コード譜編集' : 'コード譜の新規追加';
  pageDescriptionEl.textContent = isEdit
    ? '既存の曲データを読み込み、内容を更新します。ID は固定です。'
    : '新しい曲データを登録します。タグは空欄でも保存できます。';
  submitButton.textContent = isEdit ? '更新' : '登録';
  deleteButton.hidden = !isEdit;

  if (isEdit && state.originalArtist && state.originalId) {
    backLinkEl.href = buildSongUrl(state.originalArtist, state.originalId);
  } else {
    backLinkEl.href = '/';
  }
}

function populateForm(song) {
  state.currentId = song.id || state.currentId || generateUuid();
  idInput.value = state.currentId;
  titleInput.value = song.title || '';
  slugInput.value = song.slug || '';
  artistInput.value = song.artist || '';
  tagsInput.value = Array.isArray(song.tags) ? song.tags.join('\n') : '';
  youtubeInput.value = formatYoutubeEntries(song.youtube);
  chordProInput.value = normalizeNewlines(song.chordPro || '');
}

function initializeAddMode() {
  state.currentId = generateUuid();
  idInput.value = state.currentId;
  setFormVisible(true);
  setLoading(false);
  showMessage('add モードです。必要事項を入力してください。');
}

async function loadSongForEdit() {
  if (!state.originalArtist || !state.originalId) {
    setLoading(false);
    setFormVisible(false);
    showMessage('edit モードに必要な artist / id が指定されていません。', 'error');
    return;
  }

  setLoading(true, '曲データを読み込んでいます...');

  try {
    const response = await fetch(
      buildSongApiUrl(state.originalArtist, state.originalId),
      { credentials: 'include' }
    );

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = body?.detail || body?.error || '曲データを取得できませんでした。';
      setFormVisible(false);
      showMessage(detail, 'error');
      return;
    }

    populateForm(body || {});
    setFormVisible(true);
    showMessage('edit モードでデータを読み込みました。');
  } catch (error) {
    console.error('Failed to load song for edit:', error);
    setFormVisible(false);
    showMessage('曲データの読み込み中に通信エラーが発生しました。', 'error');
  } finally {
    setLoading(false);
  }
}

function handleTitleInput() {
  if (!state.slugEdited) {
    slugInput.value = titleInput.value;
  }
}

function handleSlugInput() {
  state.slugEdited = slugInput.value !== titleInput.value;
}

async function handleDelete() {
  if (state.mode !== 'edit' || !state.originalArtist || !state.originalId || state.isSubmitting) {
    return;
  }

  const confirmed = window.confirm(`「${titleInput.value.trim() || state.originalId}」を削除します。元に戻せません。`);
  if (!confirmed) {
    return;
  }

  state.isSubmitting = true;
  setFormDisabled(true);
  setLoading(true, '削除中です...');
  showMessage('');

  try {
    const response = await fetch(
      buildEditSongApiUrl(state.originalArtist, state.originalId),
      {
        method: 'DELETE',
        credentials: 'include'
      }
    );

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = body?.error?.detail || body?.detail || body?.error || '削除に失敗しました。';
      showMessage(detail, 'error');
      return;
    }

    showMessage('削除できました。トップページへ移動します...', 'success');
    window.setTimeout(() => {
      window.location.href = '/';
    }, 700);
  } catch (error) {
    console.error('Failed to delete song:', error);
    showMessage('削除中に通信エラーが発生しました。', 'error');
  } finally {
    state.isSubmitting = false;
    setFormDisabled(false);
    setLoading(false);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (state.isSubmitting) {
    return;
  }

  showMessage('');

  const title = titleInput.value.trim();
  const slug = slugInput.value.trim();
  const artist = artistInput.value.trim();
  const chordPro = normalizeNewlines(chordProInput.value).trim();
  const tags = normalizeTags(tagsInput.value);
  const youtube = parseYoutubeTextarea(youtubeInput.value);

  if (!title || !slug || !artist || !chordPro) {
    showMessage('曲名、URL用ID、アーティスト、本文を入力してください。', 'error');
    return;
  }

  const payload = {
    id: state.currentId || state.originalId || generateUuid(),
    title,
    slug,
    artist,
    tags,
    youtube,
    chordPro,
    updatedAt: new Date().toISOString()
  };

  const isEdit = state.mode === 'edit';
  const endpoint = isEdit
    ? buildEditSongApiUrl(state.originalArtist, state.originalId)
    : '/api/edit/song';

  state.isSubmitting = true;
  setFormDisabled(true);
  setLoading(true, isEdit ? '更新中です...' : '登録中です...');

  try {
    const response = await fetch(endpoint, {
      method: isEdit ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = body?.error?.detail || body?.detail || body?.error || '保存に失敗しました。';
      showMessage(detail, 'error');
      return;
    }

    const savedSong = body || payload;
    const nextArtist = savedSong.artist || artist;
    const nextId = savedSong.id || payload.id;

    state.currentId = nextId;
    state.originalArtist = nextArtist;
    state.originalId = nextId;
    idInput.value = nextId;
    backLinkEl.href = buildSongUrl(nextArtist, nextId);

    showMessage('保存できました。曲ページへ移動します...', 'success');
    window.setTimeout(() => {
      window.location.href = buildSongUrl(nextArtist, nextId);
    }, 700);
  } catch (error) {
    console.error('Failed to save song:', error);
    showMessage('通信エラーが発生しました。', 'error');
  } finally {
    state.isSubmitting = false;
    setFormDisabled(false);
    setLoading(false);
  }
}

function handleCancel() {
  if (state.mode === 'edit' && state.originalArtist && state.originalId) {
    window.location.href = buildSongUrl(state.originalArtist, state.originalId);
    return;
  }

  window.location.href = '/';
}

document.addEventListener('DOMContentLoaded', async () => {
  updatePageMeta();

  titleInput.addEventListener('input', handleTitleInput);
  slugInput.addEventListener('input', handleSlugInput);
  deleteButton.addEventListener('click', handleDelete);
  cancelButton.addEventListener('click', handleCancel);
  formEl.addEventListener('submit', handleSubmit);

  if (state.mode === 'edit') {
    await loadSongForEdit();
  } else {
    initializeAddMode();
  }
});