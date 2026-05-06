(function initializeSetlistsPage(global) {
  const setlistStore = global.ChordWikiSetlists;
  const setlistUi = global.ChordWikiSetlistUi;
  const { buildApiUrl, buildSongUrl } = global.ChordWikiApiUtils || {};

  const selectorEl = document.getElementById('setlists-selector');
  const nameInputEl = document.getElementById('setlists-name');
  const songCountEl = document.getElementById('setlists-song-count');
  const songListEl = document.getElementById('setlists-song-list');
  const emptyEl = document.getElementById('setlists-empty');
  const detailEl = document.getElementById('setlists-detail');
  const createButtonEl = document.getElementById('setlists-create');
  const emptyCreateButtonEl = document.getElementById('setlists-empty-create');
  const renameButtonEl = document.getElementById('setlists-rename');
  const deleteButtonEl = document.getElementById('setlists-delete');

  const state = {
    setlists: [],
    selectedId: '',
    songCatalogById: new Map(),
    sortable: null,
    localCatalogLoaded: false
  };

  async function loadLocalCatalogFallback() {
    if (state.localCatalogLoaded) {
      return;
    }

    state.localCatalogLoaded = true;
    const scriptPath = './.local/local-test-songs.js';
    const globalKey = '__LOCAL_TEST_SONGS__';

    try {
      await new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-setlists-local-catalog="${scriptPath}"]`);
        if (existing) {
          resolve();
          return;
        }

        const script = document.createElement('script');
        script.src = scriptPath;
        script.async = true;
        script.dataset.setlistsLocalCatalog = scriptPath;
        script.addEventListener('load', () => resolve());
        script.addEventListener('error', () => reject(new Error('local catalog script failed')));
        document.head.appendChild(script);
      });

      const rawLocal = global[globalKey];
      const localSongs = Array.isArray(rawLocal?.songs)
        ? rawLocal.songs
        : (Array.isArray(rawLocal) ? rawLocal : []);
      localSongs.forEach((song) => {
        const id = String(song?.id || '').trim();
        if (!id || state.songCatalogById.has(id)) {
          return;
        }

        const artist = String(song?.artist || '').trim();
        state.songCatalogById.set(id, {
          id,
          title: String(song?.title || 'タイトルなし').trim() || 'タイトルなし',
          artist,
          href: typeof buildSongUrl === 'function'
            ? buildSongUrl(artist, id)
            : `/song.html?artist=${encodeURIComponent(artist)}&id=${encodeURIComponent(id)}`
        });
      });
    } catch (_error) {
      // API unavailable and local script unavailable の場合は Unknown 表示のまま継続する
    }
  }

  function readSetlists() {
    state.setlists = setlistStore.readSetlists();
    if (!state.selectedId || !state.setlists.some((item) => item.id === state.selectedId)) {
      state.selectedId = state.setlists[0]?.id || '';
    }
  }

  function getSelectedSetlist() {
    return state.setlists.find((item) => item.id === state.selectedId) || null;
  }

  async function loadSongCatalog() {
    state.songCatalogById.clear();

    if (typeof buildApiUrl !== 'function') {
      return;
    }

    try {
      const response = await fetch(buildApiUrl('/api/songs'), {
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const songs = await response.json();
      if (!Array.isArray(songs)) {
        return;
      }

      songs.forEach((song) => {
        const id = String(song?.id || '').trim();
        if (!id) {
          return;
        }

        state.songCatalogById.set(id, {
          id,
          title: String(song?.title || 'タイトルなし').trim() || 'タイトルなし',
          artist: String(song?.artist || '').trim(),
          href: typeof buildSongUrl === 'function'
            ? buildSongUrl(song?.artist || '', id)
            : `/song.html?artist=${encodeURIComponent(String(song?.artist || '').trim())}&id=${encodeURIComponent(id)}`
        });
      });
    } catch (error) {
      console.error('Failed to load song catalog for setlists page:', error);
      setlistUi?.showToast('曲カタログの取得に失敗しました', 'warn');
      await loadLocalCatalogFallback();
    }
  }

  function renderSelector() {
    selectorEl.innerHTML = '';

    const sortedSetlists = [...state.setlists].sort((a, b) =>
      String(a?.name || '').localeCompare(String(b?.name || ''), 'ja-JP', {
        sensitivity: 'base',
        numeric: true
      })
    );

    sortedSetlists.forEach((setlist) => {
      const option = document.createElement('option');
      option.value = setlist.id;
      option.selected = setlist.id === state.selectedId;
      option.textContent = `${setlist.name} (${setlist.songs.length}曲)`;
      selectorEl.appendChild(option);
    });
  }

  function renderEmptyState() {
    const isEmpty = state.setlists.length === 0;
    emptyEl.hidden = !isEmpty;
    detailEl.hidden = isEmpty;
    selectorEl.disabled = isEmpty;
    nameInputEl.disabled = isEmpty;
    renameButtonEl.disabled = isEmpty;
    deleteButtonEl.disabled = isEmpty;
  }

  function renderSongs() {
    const selected = getSelectedSetlist();
    songListEl.innerHTML = '';

    if (!selected) {
      songCountEl.textContent = '';
      nameInputEl.value = '';
      return;
    }

    nameInputEl.value = selected.name;
    songCountEl.textContent = `${selected.songs.length} 曲`;

    if (selected.songs.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'setlists-song-item';
      emptyItem.innerHTML = '<span></span><div><div class="setlists-song-title">曲がありません</div><div class="setlists-song-artist">曲一覧から追加してください</div></div><span></span>';
      songListEl.appendChild(emptyItem);
      return;
    }

    selected.songs.forEach((songId) => {
      const catalog = state.songCatalogById.get(songId);
      const item = document.createElement('li');
      item.className = 'setlists-song-item';
      item.dataset.songId = songId;

      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'setlists-drag-handle';
      handle.textContent = '≡';
      handle.setAttribute('aria-label', '並び替え');

      const meta = document.createElement('div');
      const titleEl = document.createElement('div');
      titleEl.className = 'setlists-song-title';

      if (catalog) {
        const link = document.createElement('a');
        link.href = catalog.href;
        link.textContent = catalog.title;
        link.style.color = 'inherit';
        link.style.textDecoration = 'none';
        titleEl.appendChild(link);
      } else {
        titleEl.textContent = `Unknown song (${songId})`;
      }

      const artistEl = document.createElement('div');
      artistEl.className = 'setlists-song-artist';
      artistEl.textContent = catalog?.artist || songId;

      meta.appendChild(titleEl);
      meta.appendChild(artistEl);

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'setlists-song-remove';
      removeButton.textContent = '×';
      removeButton.setAttribute('aria-label', '曲を削除');
      removeButton.addEventListener('click', () => {
        const updated = setlistStore.removeSongFromSetlist(selected.id, songId);
        if (!updated) {
          setlistUi?.showToast('曲を削除できませんでした', 'error');
          return;
        }

        setlistUi?.showToast('曲をセットリストから削除しました', 'success');
        refresh();
      });

      item.appendChild(handle);
      item.appendChild(meta);
      item.appendChild(removeButton);
      songListEl.appendChild(item);
    });
  }

  function initializeSortable() {
    if (state.sortable) {
      state.sortable.destroy();
      state.sortable = null;
    }

    if (typeof global.Sortable !== 'function') {
      return;
    }

    state.sortable = new global.Sortable(songListEl, {
      animation: 140,
      handle: '.setlists-drag-handle',
      draggable: '.setlists-song-item',
      onEnd: () => {
        const selected = getSelectedSetlist();
        if (!selected) {
          return;
        }

        const nextOrder = Array.from(songListEl.querySelectorAll('.setlists-song-item'))
          .map((item) => String(item.dataset.songId || '').trim())
          .filter(Boolean);

        setlistStore.reorderSetlistSongs(selected.id, nextOrder);
        setlistUi?.showToast('曲順を保存しました', 'success');
        refresh({ keepCatalog: true });
      }
    });
  }

  function refresh({ keepCatalog = true } = {}) {
    readSetlists();
    renderSelector();
    renderEmptyState();
    renderSongs();

    if (!emptyEl.hidden) {
      if (state.sortable) {
        state.sortable.destroy();
        state.sortable = null;
      }
      return;
    }

    if (!keepCatalog) {
      void loadSongCatalog().then(() => renderSongs());
    }

    initializeSortable();
  }

  function handleCreateSetlist() {
    setlistUi?.openCreateSetlistModal({
      onCreated: (createdSetlist) => {
        state.selectedId = createdSetlist.id;
        setlistUi?.showToast('セットリストを作成しました', 'success');
        refresh({ keepCatalog: true });
      }
    });
  }

  function handleRenameSetlist() {
    const selected = getSelectedSetlist();
    if (!selected) {
      return;
    }

    const nextName = String(nameInputEl.value || '').trim();
    if (!nextName) {
      setlistUi?.showToast('セットリスト名を入力してください', 'warn');
      return;
    }

    try {
      const updated = setlistStore.renameSetlist(selected.id, nextName);
      if (!updated) {
        setlistUi?.showToast('セットリスト名を保存できませんでした', 'error');
        return;
      }

      setlistUi?.showToast('セットリスト名を保存しました', 'success');
      refresh({ keepCatalog: true });
    } catch (error) {
      setlistUi?.showToast(String(error?.message || 'セットリスト名を保存できませんでした'), 'error');
    }
  }

  function handleDeleteSetlist() {
    const selected = getSelectedSetlist();
    if (!selected) {
      return;
    }

    const approved = global.confirm(`「${selected.name}」を削除しますか？`);
    if (!approved) {
      return;
    }

    const deleted = setlistStore.deleteSetlist(selected.id);
    if (!deleted) {
      setlistUi?.showToast('セットリストを削除できませんでした', 'error');
      return;
    }

    setlistUi?.showToast('セットリストを削除しました', 'success');
    refresh({ keepCatalog: true });
  }

  function bindEvents() {
    selectorEl.addEventListener('change', () => {
      state.selectedId = String(selectorEl.value || '').trim();
      renderSongs();
      initializeSortable();
    });

    nameInputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleRenameSetlist();
      }
    });

    createButtonEl.addEventListener('click', handleCreateSetlist);
    emptyCreateButtonEl.addEventListener('click', handleCreateSetlist);
    renameButtonEl.addEventListener('click', handleRenameSetlist);
    deleteButtonEl.addEventListener('click', handleDeleteSetlist);
  }

  async function init() {
    bindEvents();
    await setlistStore.ensureReady?.();
    readSetlists();
    renderSelector();
    renderEmptyState();

    await loadSongCatalog();
    renderSongs();

    if (!emptyEl.hidden) {
      return;
    }

    initializeSortable();
  }

  void init();
})(window);
