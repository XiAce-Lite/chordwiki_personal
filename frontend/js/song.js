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

    if (window.ChordWikiApiUtils?.handleUnauthorized?.(response)) {
      return;
    }

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
  refreshSongAnnotationsAfterRender({ reloadFromStorage: false });
}

function initializeAutoScrollUi() {
  document.getElementById('autoscroll-toggle')?.addEventListener('click', toggleAutoScroll);
  document.getElementById('autoscroll-duration-reset')?.addEventListener('click', resetAutoScrollDuration);
  document.getElementById('autoscroll-speed-down')?.addEventListener('click', () => nudgeAutoScrollSpeed(-1, { notify: true }));
  document.getElementById('autoscroll-speed-up')?.addEventListener('click', () => nudgeAutoScrollSpeed(1, { notify: true }));
  document.getElementById('autoscroll-speed-reset')?.addEventListener('click', resetAutoScrollSpeed);
  document.getElementById('autoscroll-markers-reset')?.addEventListener('click', resetAutoScrollMarkers);
  document.getElementById('autoscroll-variable-toggle')?.addEventListener('change', (event) => {
    setAutoScrollVariableScrollEnabled(event.target.checked, { persist: true, notify: true });
  });
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
  updateAutoScrollSpeedUi();
  updateAutoScrollControls();
  setStatus('Stopped', 'info');
  restoreAutoScrollCollapsedState();
  updateAutoScrollSafeTop();

  window.addEventListener('scroll', () => {
    renderMarkerPositions();

    if (
      autoScrollState.isPlaying
      && Math.abs(window.scrollY - autoScrollState.virtualScrollY) > 3
    ) {
      syncAutoScrollPlaybackFromScrollY(window.scrollY, { fromUserScroll: true });
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    updateAutoScrollSafeTop();
    syncCompactMarkerMode();
    renderMarkerPositions();
    refreshAutoScrollTimelineFromCurrentSettings();

    if (autoScrollState.isPlaying) {
      recalculateAutoScrollSpeed();
    } else {
      updateStoppedStatus(false);
    }
  });

  window.addEventListener('wheel', handleAutoScrollWheelAdjust, { passive: true });

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
  const chordStyleSelect = document.getElementById('display-chord-style');
  const fontSizeInput = document.getElementById('display-chord-font-size');
  const offsetInput = document.getElementById('display-chord-offset');
  const lineOffsetInput = document.getElementById('display-chord-line-offset');
  const lyricGapInput = document.getElementById('display-lyric-gap');
  const blankLineHeightInput = document.getElementById('display-blank-line-height');
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
    displayPrefsState.chordLineOffsetPx = clampDisplayPreferenceNumber(
      lineOffsetInput?.value,
      -16,
      16,
      DEFAULT_DISPLAY_PREFS.chordLineOffsetPx
    );
    displayPrefsState.lyricLineGapPx = clampDisplayPreferenceNumber(
      lyricGapInput?.value,
      8,
      32,
      DEFAULT_DISPLAY_PREFS.lyricLineGapPx
    );
    displayPrefsState.blankLineHeightPx = clampDisplayPreferenceNumber(
      blankLineHeightInput?.value,
      4,
      32,
      DEFAULT_DISPLAY_PREFS.blankLineHeightPx
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

  chordStyleSelect?.addEventListener('change', () => {
    displayPrefsState.chordStyle = chordStyleSelect.value;
    commitDisplayPreferences();
  });

  fontSizeInput?.addEventListener('change', commitDisplayPreferences);
  offsetInput?.addEventListener('change', commitDisplayPreferences);
  lineOffsetInput?.addEventListener('change', commitDisplayPreferences);
  lyricGapInput?.addEventListener('change', commitDisplayPreferences);
  blankLineHeightInput?.addEventListener('change', commitDisplayPreferences);
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
  initializeSongAnnotationsUi();
  initializeAutoScrollUi();
  initializeSongExtrasUi();
  initializeDisplayPreferencesUi();
  updateTransposeDisplay();
  updateAutoScrollSafeTop();
  window.requestAnimationFrame(updateAutoScrollSafeTop);
  loadSong();
});
