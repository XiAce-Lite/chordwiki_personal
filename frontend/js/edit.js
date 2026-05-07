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
const previewReserveEl = document.querySelector('.preview-reserve');
const previewPaneContentEl = document.getElementById('preview-pane-content');
let triggerChordProPreview = () => {};

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

const {
  buildApiUrl,
  buildSongApiUrl,
  buildEditSongApiUrl,
  buildSongUrl,
  handleUnauthorized
} = window.ChordWikiApiUtils;
const {
  normalizeTextBlock,
  normalizeTagsInput,
  parseYoutubeTextarea,
  validateYoutubeTextarea,
  formatYoutubeEntries
} = window.ChordWikiSongUtils;
const {
  generateUuid
} = window.ChordWikiIdUtils;

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
  // CM6 エディターの読み取り専用切替
  window.ChordProEditor?.setDisabled(disabled);
}

function updatePageMeta() {
  const isEdit = state.mode === 'edit';

  const appName = window.ChordWikiRuntime?.appName || 'ChordWiki';
  document.title = isEdit ? `${appName} - Edit Song` : `${appName} - Add Song`;
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
  // CM6 が存在する場合は API 経由で値を設定、なければ従来の textarea に設定
  const text = normalizeTextBlock(song.chordPro || '');
  if (window.ChordProEditor) {
    window.ChordProEditor.setValue(text);
  } else {
    chordProInput.value = text;
  }
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
    window.ChordWikiEditorHighlight?.render();
    triggerChordProPreview({ immediate: true });
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
  const chordPro = normalizeTextBlock(
    window.ChordProEditor ? window.ChordProEditor.getValue() : chordProInput.value
  ).trim();
  const tags = normalizeTagsInput(tagsInput.value);
  const youtubeErrors = validateYoutubeTextarea(youtubeInput.value);
  const youtube = parseYoutubeTextarea(youtubeInput.value);

  if (!title || !slug || !artist || !chordPro) {
    showMessage('曲名、URL用ID、アーティスト、本文を入力してください。', 'error');
    return;
  }

  if (youtubeErrors.length) {
    showMessage(youtubeErrors[0], 'error');
    youtubeInput.focus();
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
    : buildApiUrl('/api/edit/song');

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

// Live preview feature (independent from existing submit/delete flow)
function setupChordProLivePreview() {
  if (!previewPaneContentEl || typeof renderChordWikiLike !== 'function') {
    return;
  }
  // CM6 か従来の textarea どちらかが必要
  if (!window.ChordProEditor && !chordProInput) {
    return;
  }

  if (!window.displayPrefsState || typeof window.displayPrefsState !== 'object') {
    window.displayPrefsState = {};
  }
  if (typeof window.displayPrefsState.superscriptEnabled !== 'boolean') {
    window.displayPrefsState.superscriptEnabled = true;
  }

  let debounceTimer = 0;

  const renderPreview = () => {
    const rawText = window.ChordProEditor
      ? window.ChordProEditor.getValue()
      : (chordProInput ? chordProInput.value : '');
    const text = normalizeTextBlock(rawText || '');

    try {
      const info = renderChordWikiLike(text, previewPaneContentEl);
      const displayTitle = info.title || (titleInput ? titleInput.value.trim() : '');
      const displaySubtitle = info.subtitle || '';
      const displayKey = info.key || '';
      if (displayTitle || displaySubtitle || displayKey) {
        const header = document.createElement('div');
        header.className = 'preview-song-header';
        if (displayTitle) {
          const h = document.createElement('div');
          h.className = 'preview-song-title';
          h.textContent = displayTitle;
          header.appendChild(h);
        }
        if (displaySubtitle) {
          const s = document.createElement('div');
          s.className = 'preview-song-subtitle';
          s.textContent = displaySubtitle;
          header.appendChild(s);
        }
        if (displayKey) {
          const k = document.createElement('div');
          k.className = 'preview-song-key';
          k.textContent = 'Key: ' + displayKey;
          header.appendChild(k);
        }
        previewPaneContentEl.insertBefore(header, previewPaneContentEl.firstChild);
      }
      syncPreviewPaneHeight();
    } catch (error) {
      const detail = String(error?.message || error || 'プレビューの描画に失敗しました。');
      previewPaneContentEl.innerHTML = `<div style="color:red; white-space:pre;">${detail}</div>`;
      syncPreviewPaneHeight();
    }
  };

  const syncPreviewPaneHeight = () => {
    // CM6 エディターの DOM 要素を取得 (なければ従来の textarea)
    const editorEl = document.getElementById('chordpro-cm6') || chordProInput;
    if (!editorEl) return;

    if (state.mode !== 'edit') {
      editorEl.style.height = '';
      previewPaneContentEl.style.height = '';
      return;
    }

    if (window.innerWidth <= 900) {
      editorEl.style.height = '';
      previewPaneContentEl.style.height = '';
      return;
    }

    editorEl.style.height = '';
    previewPaneContentEl.style.height = '';

    const targetHeight = Math.max(editorEl.scrollHeight, previewPaneContentEl.scrollHeight, 360);
    const cappedHeight = Math.min(targetHeight, Math.floor(window.innerHeight * 0.56));

    editorEl.style.height = `${cappedHeight}px`;
    previewPaneContentEl.style.height = `${cappedHeight}px`;
  };

  const schedulePreview = () => {
    if (debounceTimer) {
      window.clearTimeout(debounceTimer);
    }

    debounceTimer = window.setTimeout(() => {
      renderPreview();
    }, 300);
  };

  triggerChordProPreview = ({ immediate = false } = {}) => {
    if (immediate) {
      if (debounceTimer) {
        window.clearTimeout(debounceTimer);
      }
      renderPreview();
      return;
    }

    schedulePreview();
  };

  // CM6 がある場合は onChange で、なければ従来の input イベントでプレビュー更新
  if (window.ChordProEditor) {
    window.ChordProEditor.onChange(() => {
      triggerChordProPreview({ immediate: false });
    });
  } else if (chordProInput) {
    chordProInput.addEventListener('input', () => {
      triggerChordProPreview({ immediate: false });
    });
  }

  if (titleInput) {
    titleInput.addEventListener('input', () => {
      triggerChordProPreview({ immediate: false });
    });
  }

  // Ctrl+wheel: change font size of preview pane only
  const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24];
  let previewFontIdx = FONT_SIZES.indexOf(13);  // default 13px

  const applyPreviewFontSize = () => {
    previewPaneContentEl.style.fontSize = FONT_SIZES[previewFontIdx] + 'px';
  };

  previewPaneContentEl.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (e.deltaY < 0) previewFontIdx = Math.min(previewFontIdx + 1, FONT_SIZES.length - 1);
    else previewFontIdx = Math.max(previewFontIdx - 1, 0);
    applyPreviewFontSize();
  }, { passive: false });
}

// Resizer: drag to adjust editor/preview width ratio
function setupEditorResizer() {
  const wrapper = document.querySelector('.editor-preview-wrapper');
  const editorPane = document.querySelector('.editor-pane');
  const previewPane = document.querySelector('.preview-pane');
  const resizer = document.getElementById('editor-resizer');
  if (!wrapper || !editorPane || !previewPane || !resizer) return;

  let isDragging = false;
  let startX = 0;
  let startEditorW = 0;
  let startPreviewW = 0;

  resizer.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startEditorW = editorPane.getBoundingClientRect().width;
    startPreviewW = previewPane.getBoundingClientRect().width;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const total = startEditorW + startPreviewW;
    const newEditorW = Math.max(200, Math.min(startEditorW + dx, total - 200));
    const newPreviewW = total - newEditorW;
    editorPane.style.flex = `0 0 ${newEditorW}px`;
    previewPane.style.flex = `0 0 ${newPreviewW}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  updatePageMeta();

  titleInput.addEventListener('input', handleTitleInput);
  slugInput.addEventListener('input', handleSlugInput);
  deleteButton.addEventListener('click', handleDelete);
  cancelButton.addEventListener('click', handleCancel);
  formEl.addEventListener('submit', handleSubmit);
  setupEditorResizer();

  // CM6 は type="module" で非同期ロードされるため、
  // ロード完了を待ってから setupChordProLivePreview を呼ぶ
  async function waitForCm6AndSetup() {
    // 最大 5 秒待機 (50ms × 100 回)
    for (let i = 0; i < 100; i++) {
      if (window.ChordProEditor) break;
      await new Promise(r => setTimeout(r, 50));
    }
    setupChordProLivePreview();

    if (state.mode === 'edit') {
      await loadSongForEdit();
    } else {
      initializeAddMode();
    }
  }

  waitForCm6AndSetup();
});