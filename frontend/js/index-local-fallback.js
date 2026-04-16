(function attachChordWikiIndexLocalFallback(global) {
  function createIndexLocalFallbackService(options = {}) {
    const {
      scriptPath,
      globalKey,
      state,
      isLocalPreview,
      normalizeLocalSongSummary,
      compareSongsForRanking,
      normalizeSearchQuery,
      matchesSearch,
      normalizeSearchTarget,
      isRankingMode,
      clampPageSize,
      clampPage,
      getCurrentPageSize,
      rankingPageSize,
      rankingMaxPages,
      searchMaxPages,
      rankingMaxSongs,
      buildSongHref,
      localSamplePanel,
      localSampleLinks
    } = options;

    function readSongs(source) {
      const rawSongs = Array.isArray(source)
        ? source
        : (Array.isArray(source?.songs) ? source.songs : []);

      return rawSongs
        .map((song, index) => normalizeLocalSongSummary(song, index))
        .sort(compareSongsForRanking);
    }

    async function loadLocalTestSongsData() {
      if (!isLocalPreview()) {
        return [];
      }

      const existingSongs = readSongs(global[globalKey]);
      if (existingSongs.length > 0) {
        return existingSongs;
      }

      if (!state.scriptPromise) {
        state.scriptPromise = new Promise((resolve) => {
          const scriptEl = document.createElement('script');
          scriptEl.src = scriptPath;
          scriptEl.async = true;
          scriptEl.dataset.localTestSongs = 'true';
          scriptEl.onload = () => resolve(global[globalKey] || null);
          scriptEl.onerror = () => resolve(null);
          document.head.appendChild(scriptEl);
        });
      }

      return readSongs(await state.scriptPromise);
    }

    async function buildLocalSongsPayload(page = 1, query = '', target = 'song') {
      const localSongs = await loadLocalTestSongsData();
      if (!Array.isArray(localSongs) || localSongs.length === 0) {
        return null;
      }

      const appliedQuery = String(query || '').trim();
      const safeTarget = normalizeSearchTarget(target);
      const rankingMode = isRankingMode(appliedQuery, safeTarget);
      const safePageSize = rankingMode ? rankingPageSize : clampPageSize(getCurrentPageSize());
      const safePage = clampPage(page, rankingMode ? rankingMaxPages : searchMaxPages);
      const search = normalizeSearchQuery(appliedQuery);
      const filteredSongs = search.term
        ? localSongs.filter((song) => matchesSearch(song, search, safeTarget))
        : localSongs.slice();
      const limitedSongs = rankingMode
        ? filteredSongs.slice(0, rankingMaxSongs)
        : filteredSongs;
      const offset = (safePage - 1) * safePageSize;

      return {
        page: safePage,
        pageSize: safePageSize,
        totalSongs: limitedSongs.length,
        songs: limitedSongs.slice(offset, offset + safePageSize),
        isLocalFallback: true
      };
    }

    async function renderLocalSamplePanel() {
      if (!localSamplePanel || !localSampleLinks || !isLocalPreview()) {
        return;
      }

      const localSongs = await loadLocalTestSongsData();
      if (!Array.isArray(localSongs) || localSongs.length === 0) {
        localSamplePanel.hidden = true;
        localSampleLinks.innerHTML = '';
        return;
      }

      localSampleLinks.innerHTML = '';
      localSongs.slice(0, 4).forEach((song) => {
        const linkEl = document.createElement('a');
        linkEl.className = 'local-sample-link';
        linkEl.href = buildSongHref(song);
        linkEl.textContent = song.title || song.id || 'Local Sample';
        linkEl.title = song.artist ? `${song.title} / ${song.artist}` : (song.title || song.id || 'Local Sample');
        localSampleLinks.appendChild(linkEl);
      });

      localSamplePanel.hidden = false;
    }

    return Object.freeze({
      loadLocalTestSongsData,
      buildLocalSongsPayload,
      renderLocalSamplePanel
    });
  }

  global.ChordWikiIndexLocalFallback = Object.freeze({
    createIndexLocalFallbackService
  });
})(window);