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

  const rawSearchTitle = String(song?.title || '').trim();
  const searchTitle = stripParenthesizedTitleText(rawSearchTitle);
  const searchArtist = String(song?.artist || '').trim();
  const searchQuery = [searchTitle, searchArtist].filter(Boolean).join(' ');

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
    refreshSongExtrasLayout();
    refreshSongExtrasLayout();
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
    refreshSongExtrasLayout();
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

function refreshSongExtrasLayout() {
  const extrasUi = getSongExtrasUiEl();
  if (!extrasUi || extrasUi.hidden) {
    return;
  }

  if (currentSongData) {
    const displayTitle = String(document.getElementById('title')?.textContent || '').trim();
    const displayArtist = String(document.getElementById('artist')?.textContent || '').trim();
    renderSongSideRail(currentSongData, displayTitle, displayArtist);
  }

  window.requestAnimationFrame(updateAutoScrollSafeTop);
}

function updateAutoScrollSafeTop() {
  const rootStyle = document.documentElement?.style;
  if (!rootStyle) {
    return;
  }

  const adminActionsEl = document.getElementById('song-admin-actions');
  const autoScrollEl = getAutoScrollUiEl();
  const youtubeShell = document.getElementById('youtube-player-shell');
  let safeTop = 64;
  let extrasTop = 64;
  let extrasBottomSafe = 18;

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

  if (youtubeShell && !youtubeShell.hidden) {
    const computedStyle = window.getComputedStyle(youtubeShell);
    if (computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden') {
      const rect = youtubeShell.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        extrasBottomSafe = Math.max(extrasBottomSafe, Math.round(Math.max(0, window.innerHeight - rect.top) + 12));
      }
    }
  }

  rootStyle.setProperty('--autoscroll-safe-top', `${safeTop}px`);
  rootStyle.setProperty('--song-extras-safe-top', `${extrasTop}px`);
  rootStyle.setProperty('--song-extras-safe-bottom', `${extrasBottomSafe}px`);
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

  if (songMetaModalState.mode === 'youtube') {
    const youtubeErrors = window.ChordWikiSongUtils?.validateYoutubeTextarea?.(inputEl.value) || [];
    if (youtubeErrors.length) {
      setSongMetaModalMessage(youtubeErrors[0], 'error');
      inputEl.focus();
      return;
    }
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
