window.ChordWikiAuth?.applyRoleVisibility();

const { buildApiUrl } = window.ChordWikiApiUtils;

document.getElementById('add-button').addEventListener('click', () => {
  location.href = '/edit.html?mode=add';
});

const DEFAULT_PAGE_SIZE = 30;
    const MIN_PAGE_SIZE = 20;
    const MAX_PAGE_SIZE = 60;
    const SEARCH_MAX_PAGES = 6;
    const RANKING_PAGE_SIZE = 20;
    const RANKING_MAX_SONGS = 100;
    const RANKING_MAX_PAGES = 5;
    const TOP_HEADER_MIN_HEIGHT = 64;
    const PAGINATION_MIN_HEIGHT = 56;
    const PAGINATION_SAFE_MARGIN = 24;
    const SONG_ROW_HEIGHT = 56;
    const SONG_SEARCH_TARGET = 'song';
    const TAG_SEARCH_TARGET = 'tag';
    const TAG_SUGGEST_LIMIT = 10;
    const LOCAL_TEST_SONGS_SCRIPT_PATH = './.local/local-test-songs.js';
    const LOCAL_TEST_SONGS_GLOBAL_KEY = '__LOCAL_TEST_SONGS__';
    const searchInput = document.getElementById('search');
    const searchForm = document.getElementById('search-form');
    const searchTarget = document.getElementById('search-target');
    const searchHelp = document.getElementById('search-help');
    const searchSuggest = document.getElementById('search-suggest');
    const searchState = document.getElementById('search-state');
    const searchStateText = document.getElementById('search-state-text');
    const searchClear = document.getElementById('search-clear');
    const homeLink = document.getElementById('home-link');
    const localSamplePanel = document.getElementById('local-sample-panel');
    const localSampleLinks = document.getElementById('local-sample-links');
    let currentPageSize = DEFAULT_PAGE_SIZE;
    let suggestRequestSerial = 0;
    let suggestHideTimer = 0;
    let resizeDebounceTimer = 0;
    const localTestSongsState = {
      scriptPromise: null,
      fallbackLogged: false
    };

function isLocalPreview() {
      return Boolean(window.ChordWikiRuntime?.isLocalPreview?.(window.location))
        || window.location.protocol === 'file:'
        || window.location.hostname === 'localhost'
        || window.location.hostname === '127.0.0.1';
    }

    function normalizeText(value) {
      return String(value || '').trim().toLocaleLowerCase('ja-JP');
    }

    function normalizeTags(tags) {
      return Array.isArray(tags)
        ? tags.map((tag) => String(tag || '').trim()).filter(Boolean)
        : [];
    }

    function normalizeSearchQuery(value) {
      const raw = String(value || '').trim();
      if (!raw) {
        return { raw: '', term: '', isExact: false };
      }

      const isExact = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
      const term = (isExact ? raw.slice(1, -1) : raw).trim();
      return { raw, term, isExact };
    }

    function getSongDisplayScore(song) {
      const explicitDisplayScore = Number(song?.display_score);
      if (Number.isFinite(explicitDisplayScore)) {
        return explicitDisplayScore;
      }

      const baseScore = Number(song?.score);
      return Number.isFinite(baseScore) ? baseScore : 0;
    }

    function compareSongsForRanking(a, b) {
      const scoreDiff = getSongDisplayScore(b) - getSongDisplayScore(a);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      const titleDiff = String(a?.title || '').localeCompare(String(b?.title || ''), 'ja-JP', {
        sensitivity: 'base',
        numeric: true
      });
      if (titleDiff !== 0) {
        return titleDiff;
      }

      return String(a?.artist || '').localeCompare(String(b?.artist || ''), 'ja-JP', {
        sensitivity: 'base',
        numeric: true
      });
    }

    function matchesSearch(song, search, target = SONG_SEARCH_TARGET) {
      const needle = normalizeText(search?.term);
      if (!needle) {
        return false;
      }

      if (normalizeSearchTarget(target) === TAG_SEARCH_TARGET) {
        return normalizeTags(song?.tags).some((tag) => normalizeText(tag) === needle);
      }

      const title = normalizeText(song?.title);
      const artist = normalizeText(song?.artist);

      if (search?.isExact) {
        return title === needle || artist === needle;
      }

      return title.includes(needle) || artist.includes(needle);
    }

    function collectTagSuggestions(songs, query, limit = TAG_SUGGEST_LIMIT) {
      const needle = normalizeText(query);
      if (!needle) {
        return [];
      }

      const uniqueTags = new Set();
      (songs || []).forEach((song) => {
        normalizeTags(song?.tags).forEach((tag) => {
          if (normalizeText(tag).startsWith(needle)) {
            uniqueTags.add(tag);
          }
        });
      });

      return Array.from(uniqueTags)
        .sort((a, b) => a.localeCompare(b, 'ja-JP', { sensitivity: 'base', numeric: true }))
        .slice(0, limit);
    }

    function normalizeLocalSongSummary(song, index = 0) {
      const fallbackId = `local-song-${index + 1}`;
      const id = String(song?.id || fallbackId).trim() || fallbackId;
      const title = String(song?.title || `Local Sample ${index + 1}`).trim() || `Local Sample ${index + 1}`;
      const artist = String(song?.artist || 'Local Preview').trim();
      const score = Number(song?.score);
      const displayScore = Number(song?.display_score);

      return {
        id,
        artist,
        title,
        slug: String(song?.slug || id).trim() || id,
        tags: normalizeTags(song?.tags),
        score: Number.isFinite(score) ? score : 0,
        display_score: Number.isFinite(displayScore) ? displayScore : (Number.isFinite(score) ? score : 0),
        last_viewed_at: song?.last_viewed_at || null
      };
    }

    function buildSongHref(song) {
      return `song.html?artist=${encodeURIComponent(song?.artist || '')}&id=${encodeURIComponent(song?.id || '')}`;
    }

    async function loadLocalTestSongsData() {
      if (!isLocalPreview()) {
        return [];
      }

      const readSongs = (source) => {
        const rawSongs = Array.isArray(source)
          ? source
          : (Array.isArray(source?.songs) ? source.songs : []);

        return rawSongs
          .map((song, index) => normalizeLocalSongSummary(song, index))
          .sort(compareSongsForRanking);
      };

      const existingSongs = readSongs(window[LOCAL_TEST_SONGS_GLOBAL_KEY]);
      if (existingSongs.length > 0) {
        return existingSongs;
      }

      if (!localTestSongsState.scriptPromise) {
        localTestSongsState.scriptPromise = new Promise((resolve) => {
          const scriptEl = document.createElement('script');
          scriptEl.src = LOCAL_TEST_SONGS_SCRIPT_PATH;
          scriptEl.async = true;
          scriptEl.dataset.localTestSongs = 'true';
          scriptEl.onload = () => resolve(window[LOCAL_TEST_SONGS_GLOBAL_KEY] || null);
          scriptEl.onerror = () => resolve(null);
          document.head.appendChild(scriptEl);
        });
      }

      return readSongs(await localTestSongsState.scriptPromise);
    }

    async function buildLocalSongsPayload(page = 1, query = '', target = SONG_SEARCH_TARGET, pageSize = currentPageSize) {
      const localSongs = await loadLocalTestSongsData();
      if (!Array.isArray(localSongs) || localSongs.length === 0) {
        return null;
      }

      const appliedQuery = String(query || '').trim();
      const safeTarget = normalizeSearchTarget(target);
      const rankingMode = isRankingMode(appliedQuery, safeTarget);
      const safePageSize = rankingMode ? RANKING_PAGE_SIZE : clampPageSize(pageSize);
      const safePage = clampPage(page, rankingMode ? RANKING_MAX_PAGES : SEARCH_MAX_PAGES);
      const search = normalizeSearchQuery(appliedQuery);
      const filteredSongs = search.term
        ? localSongs.filter((song) => matchesSearch(song, search, safeTarget))
        : localSongs.slice();
      const limitedSongs = rankingMode
        ? filteredSongs.slice(0, RANKING_MAX_SONGS)
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

    function normalizeSearchTarget(value) {
      return String(value || '').trim().toLowerCase() === TAG_SEARCH_TARGET ? TAG_SEARCH_TARGET : SONG_SEARCH_TARGET;
    }

    function isRankingMode(query = '', target = SONG_SEARCH_TARGET) {
      return normalizeSearchTarget(target) === SONG_SEARCH_TARGET && !String(query || '').trim();
    }

    function clampPage(page, maxPages = SEARCH_MAX_PAGES) {
      const parsed = Number.parseInt(String(page || '1'), 10);
      if (!Number.isFinite(parsed)) {
        return 1;
      }

      const safeMaxPages = Math.max(1, Number(maxPages) || SEARCH_MAX_PAGES);
      return Math.min(safeMaxPages, Math.max(1, parsed));
    }

    function clampPageSize(pageSize) {
      const parsed = Number.parseInt(String(pageSize || DEFAULT_PAGE_SIZE), 10);
      if (!Number.isFinite(parsed)) {
        return DEFAULT_PAGE_SIZE;
      }

      return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, parsed));
    }

    function getSongRowHeight() {
      return SONG_ROW_HEIGHT;
    }

    function updateHeaderSafeSpace() {
      const headerEl = document.querySelector('.top-header');
      const measuredHeight = headerEl ? headerEl.getBoundingClientRect().height : 0;
      const safeSpace = Math.max(TOP_HEADER_MIN_HEIGHT, Math.ceil(measuredHeight || TOP_HEADER_MIN_HEIGHT));
      document.documentElement.style.setProperty('--top-header-safe-space', `${safeSpace}px`);
      return safeSpace;
    }

    function updatePaginationSafeSpace() {
      const paginationEl = document.getElementById('pagination');
      const measuredHeight = paginationEl ? paginationEl.getBoundingClientRect().height : 0;
      const safeSpace = Math.max(PAGINATION_MIN_HEIGHT, Math.ceil(measuredHeight || PAGINATION_MIN_HEIGHT)) + PAGINATION_SAFE_MARGIN;
      document.documentElement.style.setProperty('--pagination-safe-space', `${safeSpace}px`);
      return safeSpace;
    }

    function calculatePageSizeFromViewport() {
      const viewportHeight = Number(window.innerHeight) || 0;
      if (!viewportHeight) {
        return DEFAULT_PAGE_SIZE;
      }

      const headerSafeSpace = updateHeaderSafeSpace();
      const paginationSafeSpace = updatePaginationSafeSpace();
      const rowHeight = getSongRowHeight();
      const availableHeight = viewportHeight - headerSafeSpace - paginationSafeSpace - 12;

      if (!Number.isFinite(availableHeight) || availableHeight <= 0) {
        return DEFAULT_PAGE_SIZE;
      }

      return clampPageSize(Math.floor(availableHeight / rowHeight));
    }

    function syncPageSizeWithViewport() {
      const nextPageSize = calculatePageSizeFromViewport();
      const changed = nextPageSize !== currentPageSize;
      currentPageSize = nextPageSize;
      return { pageSize: currentPageSize, changed };
    }

    function getPageFromUrl() {
      const params = new URLSearchParams(window.location.search);
      return clampPage(params.get('page'));
    }

    function getQueryFromUrl() {
      const params = new URLSearchParams(window.location.search);
      return String(params.get('q') || '').trim();
    }

    function getTargetFromUrl() {
      const params = new URLSearchParams(window.location.search);
      return normalizeSearchTarget(params.get('target'));
    }

    function updatePageUrl(page, query = '', target = SONG_SEARCH_TARGET) {
      const url = new URL(window.location.href);
      const safeQuery = String(query || '').trim();
      const safeTarget = normalizeSearchTarget(target);
      const safePage = clampPage(
        page,
        isRankingMode(safeQuery, safeTarget) ? RANKING_MAX_PAGES : SEARCH_MAX_PAGES
      );

      if (safeQuery) {
        url.searchParams.set('q', safeQuery);
      } else {
        url.searchParams.delete('q');
      }

      if (safeTarget === TAG_SEARCH_TARGET && safeQuery) {
        url.searchParams.set('target', safeTarget);
      } else {
        url.searchParams.delete('target');
      }

      if (safePage > 1) {
        url.searchParams.set('page', String(safePage));
      } else {
        url.searchParams.delete('page');
      }

      window.history.replaceState({}, '', url);
    }

    function hideTagSuggestions() {
      if (suggestHideTimer) {
        window.clearTimeout(suggestHideTimer);
        suggestHideTimer = 0;
      }

      if (!searchSuggest) {
        return;
      }

      searchSuggest.hidden = true;
      searchSuggest.innerHTML = '';
    }

    function renderTagSuggestions(suggestions, query = '') {
      if (!searchSuggest) {
        return;
      }

      const safeQuery = String(query || '').trim();
      const safeTarget = normalizeSearchTarget(searchTarget?.value);
      if (safeTarget !== TAG_SEARCH_TARGET || !safeQuery) {
        hideTagSuggestions();
        return;
      }

      searchSuggest.innerHTML = '';

      if (!Array.isArray(suggestions) || suggestions.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'search-suggest-empty';
        emptyEl.textContent = '一致するタグがありません';
        searchSuggest.appendChild(emptyEl);
        searchSuggest.hidden = false;
        return;
      }

      suggestions.slice(0, TAG_SUGGEST_LIMIT).forEach((tag) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'search-suggest-item';
        button.textContent = tag;
        button.addEventListener('click', () => {
          searchInput.value = tag;
          hideTagSuggestions();
          loadSongs(1, tag, TAG_SEARCH_TARGET);
        });
        searchSuggest.appendChild(button);
      });

      searchSuggest.hidden = false;
    }

    async function updateTagSuggestions(query = searchInput?.value || '') {
      const safeTarget = normalizeSearchTarget(searchTarget?.value);
      const safeQuery = String(query || '').trim();
      if (safeTarget !== TAG_SEARCH_TARGET || !safeQuery) {
        hideTagSuggestions();
        return;
      }

      const requestId = ++suggestRequestSerial;

      try {
        const response = await fetch(
          buildApiUrl(`/api/songs/search?target=${encodeURIComponent(TAG_SEARCH_TARGET)}&suggest=1&q=${encodeURIComponent(safeQuery)}`),
          { credentials: 'include' }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        if (requestId !== suggestRequestSerial) {
          return;
        }

        renderTagSuggestions(Array.isArray(payload.suggestions) ? payload.suggestions : [], safeQuery);
      } catch (error) {
        console.error('Error loading tag suggestions:', error);
        if (requestId !== suggestRequestSerial) {
          return;
        }

        const localSongs = await loadLocalTestSongsData();
        if (localSongs.length > 0) {
          if (!localTestSongsState.fallbackLogged) {
            console.info('Using local test data for top-page preview because the API is unavailable.');
            localTestSongsState.fallbackLogged = true;
          }
          renderTagSuggestions(collectTagSuggestions(localSongs, safeQuery), safeQuery);
          return;
        }

        renderTagSuggestions([], safeQuery);
      }
    }

    function getSearchModeLabel(target = SONG_SEARCH_TARGET) {
      return normalizeSearchTarget(target) === TAG_SEARCH_TARGET ? 'タグ' : '曲名/アーティスト';
    }

    function updateSearchState(query = '', target = SONG_SEARCH_TARGET) {
      if (!searchState || !searchStateText) {
        return;
      }

      const safeQuery = String(query || '').trim();
      if (!safeQuery) {
        searchState.hidden = true;
        searchStateText.textContent = '';
        return;
      }

      searchStateText.textContent = `検索条件：${getSearchModeLabel(target)} ${safeQuery}`;
      searchState.hidden = false;
    }

    function resetToHome() {
      hideTagSuggestions();

      if (searchInput) {
        searchInput.value = '';
      }

      if (searchTarget) {
        searchTarget.value = SONG_SEARCH_TARGET;
      }

      updateSearchUiForTarget(SONG_SEARCH_TARGET);
      updateSearchState('', SONG_SEARCH_TARGET);
      updatePageUrl(1, '', SONG_SEARCH_TARGET);
      loadSongs(1, '', SONG_SEARCH_TARGET);
    }

    function updateSearchUiForTarget(target = SONG_SEARCH_TARGET) {
      const safeTarget = normalizeSearchTarget(target);
      if (searchTarget && searchTarget.value !== safeTarget) {
        searchTarget.value = safeTarget;
      }

      if (!searchInput) {
        return;
      }

      if (safeTarget === TAG_SEARCH_TARGET) {
        searchInput.placeholder = 'タグを入力（完全一致検索）';
        searchInput.title = 'タグ検索は完全一致です。入力中は前方一致サジェストを表示します。';
        if (searchHelp) {
          searchHelp.innerHTML = '※ タグ検索は <strong>完全一致</strong> で実行し、入力中サジェストは前方一致です。曲名 / アーティスト検索では AND/OR や全文検索は行いません。';
        }
      } else {
        searchInput.placeholder = '1ワード検索（対象は曲名とアーティスト）';
        searchInput.title = '1ワード検索のみ対応。AND/OR検索はしません。ダブルコーテーションで括ると完全一致検索します。';
        if (searchHelp) {
          searchHelp.innerHTML = '※ 曲名 / アーティスト検索は 1ワードのみ対応します。半角スペースで区切っても AND/OR 検索はしません。<code>"..."</code> で完全一致です。タグ検索はセレクトで切り替えます。';
        }
        hideTagSuggestions();
      }
    }

    function createPaginationButton(label, targetPage, appliedQuery, safeTarget, { disabled = false, isActive = false, ariaLabel = '' } = {}) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `page-button${isActive ? ' is-active' : ''}`;
      button.textContent = label;
      button.disabled = disabled;

      if (ariaLabel) {
        button.setAttribute('aria-label', ariaLabel);
      }

      if (!disabled && !isActive) {
        button.addEventListener('click', () => {
          loadSongs(targetPage, appliedQuery, safeTarget);
        });
      }

      return button;
    }

    function renderPagination(page, songCount = 0, query = '', target = SONG_SEARCH_TARGET, pageSize = currentPageSize) {
      const paginationEl = document.getElementById('pagination');
      const appliedQuery = String(query || '').trim();
      const safeTarget = normalizeSearchTarget(target);
      const rankingMode = isRankingMode(appliedQuery, safeTarget);
      const safePageSize = rankingMode ? RANKING_PAGE_SIZE : clampPageSize(pageSize);
      const maxPages = rankingMode ? RANKING_MAX_PAGES : SEARCH_MAX_PAGES;
      const availablePages = Math.max(1, Math.min(maxPages, Math.ceil(songCount / safePageSize)));
      const safePage = clampPage(page, availablePages);
      paginationEl.innerHTML = '';

      paginationEl.appendChild(
        createPaginationButton('<', Math.max(1, safePage - 1), appliedQuery, safeTarget, {
          disabled: safePage <= 1,
          ariaLabel: '前のページ'
        })
      );

      for (let p = 1; p <= availablePages; p += 1) {
        paginationEl.appendChild(
          createPaginationButton(String(p), p, appliedQuery, safeTarget, {
            disabled: p === safePage,
            isActive: p === safePage,
            ariaLabel: `ページ ${p}`
          })
        );
      }

      paginationEl.appendChild(
        createPaginationButton('>', Math.min(availablePages, safePage + 1), appliedQuery, safeTarget, {
          disabled: safePage >= availablePages,
          ariaLabel: '次のページ'
        })
      );

      updatePaginationSafeSpace();
    }

    function getVisibleTags(tags) {
      const normalizedTags = Array.isArray(tags)
        ? tags.map((tag) => String(tag || '').trim()).filter(Boolean)
        : [];

      return {
        visible: normalizedTags.slice(0, 3),
        hasMore: normalizedTags.length > 3,
        fullText: normalizedTags.join(' / ')
      };
    }

    function createTagButton(tag) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'song-tag-inline';
      button.textContent = tag;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        if (searchTarget) {
          searchTarget.value = TAG_SEARCH_TARGET;
        }
        if (searchInput) {
          searchInput.value = tag;
        }
        hideTagSuggestions();
        loadSongs(1, tag, TAG_SEARCH_TARGET);
      });
      return button;
    }

    function renderSongs(songs, page, query = '', pageSize = currentPageSize) {
      const songList = document.getElementById('song-list');
      const appliedQuery = String(query || '').trim();
      const safePageSize = clampPageSize(pageSize);
      songList.innerHTML = '';

      if (!Array.isArray(songs) || songs.length === 0) {
        songList.textContent = appliedQuery
          ? '該当する曲がありません。'
          : 'このページには曲がありません。';
        return;
      }

      songs.forEach((song, index) => {
        const rank = ((page - 1) * safePageSize) + index + 1;
        const itemEl = document.createElement('div');
        const rankEl = document.createElement('span');
        const mainEl = document.createElement('span');
        const titleEl = document.createElement('a');
        const metaEl = document.createElement('span');
        const scoreEl = document.createElement('span');
        const artistText = String(song.artist || '').trim();
        const baseScore = Number(song.score) || 0;
        const displayScore = Number.isFinite(Number(song.display_score))
          ? Number(song.display_score)
          : baseScore;
        const { visible: visibleTags, hasMore, fullText: tagsText } = getVisibleTags(song.tags);

        itemEl.className = 'song-item';
        itemEl.setAttribute('data-id', song.id);
        itemEl.setAttribute('data-artist', song.artist);
        itemEl.setAttribute('data-slug', song.slug || '');

        rankEl.className = 'song-rank';
        rankEl.textContent = `#${rank}`;

        mainEl.className = 'song-main';
        titleEl.className = 'song-title song-title-link';
        titleEl.textContent = song.title || 'タイトルなし';
        titleEl.title = song.title || 'タイトルなし';
        titleEl.href = buildSongHref(song);
        metaEl.className = 'song-meta';

        if (artistText) {
          const artistEl = document.createElement('span');
          artistEl.className = 'song-artist-name';
          artistEl.textContent = artistText;
          metaEl.appendChild(artistEl);
        }

        if (visibleTags.length > 0) {
          const tagsEl = document.createElement('span');
          tagsEl.className = 'song-tags-inline';

          visibleTags.forEach((tag) => {
            tagsEl.appendChild(createTagButton(tag));
          });

          if (hasMore) {
            const ellipsisEl = document.createElement('span');
            ellipsisEl.className = 'song-tag-ellipsis';
            ellipsisEl.textContent = '…';
            tagsEl.appendChild(ellipsisEl);
          }

          metaEl.appendChild(tagsEl);
        }

        metaEl.title = [artistText, tagsText].filter(Boolean).join(' · ');
        mainEl.appendChild(titleEl);
        mainEl.appendChild(metaEl);

        scoreEl.className = 'song-score';
        scoreEl.textContent = `Score ${displayScore}`;
        scoreEl.title = displayScore === baseScore
          ? `表示スコア ${displayScore}`
          : `表示スコア ${displayScore}（保存スコア ${baseScore}）`;

        itemEl.appendChild(rankEl);
        itemEl.appendChild(mainEl);
        itemEl.appendChild(scoreEl);
        songList.appendChild(itemEl);
      });
    }

    async function loadSongs(page = getPageFromUrl(), query = getQueryFromUrl(), target = getTargetFromUrl()) {
      const appliedQuery = String(query || '').trim();
      const safeTarget = normalizeSearchTarget(target);
      const rankingMode = isRankingMode(appliedQuery, safeTarget);
      const safePage = clampPage(page, rankingMode ? RANKING_MAX_PAGES : SEARCH_MAX_PAGES);
      const songList = document.getElementById('song-list');

      if (searchInput && searchInput.value !== appliedQuery) {
        searchInput.value = appliedQuery;
      }

      updateSearchUiForTarget(safeTarget);
      updateSearchState(appliedQuery, safeTarget);

      const { pageSize } = syncPageSizeWithViewport();
      const requestPageSize = rankingMode ? RANKING_PAGE_SIZE : pageSize;
      const endpoint = buildApiUrl(appliedQuery
        ? `/api/songs/search?q=${encodeURIComponent(appliedQuery)}&page=${safePage}&target=${encodeURIComponent(safeTarget)}&pageSize=${requestPageSize}`
        : `/api/songs/ranking?page=${safePage}&pageSize=${requestPageSize}`);

      songList.textContent = 'Loading...';

      try {
        const response = await fetch(endpoint, {
          credentials: 'include'
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        localTestSongsState.fallbackLogged = false;
        const songs = Array.isArray(payload.songs) ? payload.songs : [];
        const effectivePageSize = rankingMode ? RANKING_PAGE_SIZE : clampPageSize(payload.pageSize || requestPageSize);
        const rawTotalSongs = Number.isFinite(Number(payload.totalSongs))
          ? Number(payload.totalSongs)
          : (((safePage - 1) * effectivePageSize) + songs.length);
        const totalSongs = rankingMode ? Math.min(RANKING_MAX_SONGS, rawTotalSongs) : rawTotalSongs;
        const availablePages = Math.max(
          1,
          Math.min(rankingMode ? RANKING_MAX_PAGES : SEARCH_MAX_PAGES, Math.ceil(totalSongs / effectivePageSize))
        );

        currentPageSize = effectivePageSize;

        if (safePage > availablePages) {
          loadSongs(availablePages, appliedQuery, safeTarget);
          return;
        }

        renderSongs(songs, safePage, appliedQuery, effectivePageSize);
        renderPagination(safePage, totalSongs, appliedQuery, safeTarget, effectivePageSize);
        updatePageUrl(safePage, appliedQuery, safeTarget);
      } catch (error) {
        console.error('Error loading songs:', error);

        const localPayload = await buildLocalSongsPayload(safePage, appliedQuery, safeTarget, pageSize);
        if (localPayload) {
          if (!localTestSongsState.fallbackLogged) {
            console.info('Using local test data for top-page preview because the API is unavailable.');
            localTestSongsState.fallbackLogged = true;
          }

          const effectivePageSize = rankingMode ? RANKING_PAGE_SIZE : clampPageSize(localPayload.pageSize || requestPageSize);
          const rawTotalSongs = Number.isFinite(Number(localPayload.totalSongs))
            ? Number(localPayload.totalSongs)
            : localPayload.songs.length;
          const totalSongs = rankingMode ? Math.min(RANKING_MAX_SONGS, rawTotalSongs) : rawTotalSongs;
          const availablePages = Math.max(
            1,
            Math.min(rankingMode ? RANKING_MAX_PAGES : SEARCH_MAX_PAGES, Math.ceil(totalSongs / effectivePageSize))
          );

          currentPageSize = effectivePageSize;

          if (safePage > availablePages) {
            loadSongs(availablePages, appliedQuery, safeTarget);
            return;
          }

          renderSongs(localPayload.songs, safePage, appliedQuery, effectivePageSize);
          renderPagination(safePage, totalSongs, appliedQuery, safeTarget, effectivePageSize);
          updatePageUrl(safePage, appliedQuery, safeTarget);
          return;
        }

        songList.textContent = appliedQuery
          ? '検索結果の読み込みに失敗しました。'
          : 'ランキングの読み込みに失敗しました。';
        renderPagination(safePage, 0, appliedQuery, safeTarget, pageSize);
      }
    }

    searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      hideTagSuggestions();
      loadSongs(1, searchInput.value, searchTarget?.value);
    });

    searchClear?.addEventListener('click', () => {
      resetToHome();
    });

    homeLink?.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      event.preventDefault();
      resetToHome();
    });

    searchTarget?.addEventListener('change', () => {
      updateSearchUiForTarget(searchTarget.value);
      if (normalizeSearchTarget(searchTarget.value) === TAG_SEARCH_TARGET && String(searchInput.value || '').trim()) {
        updateTagSuggestions(searchInput.value);
      }
    });

    searchInput?.addEventListener('input', () => {
      if (normalizeSearchTarget(searchTarget?.value) === TAG_SEARCH_TARGET) {
        updateTagSuggestions(searchInput.value);
      } else {
        hideTagSuggestions();
      }
    });

    searchInput?.addEventListener('focus', () => {
      if (normalizeSearchTarget(searchTarget?.value) === TAG_SEARCH_TARGET && String(searchInput.value || '').trim()) {
        updateTagSuggestions(searchInput.value);
      }
    });

    searchInput?.addEventListener('blur', () => {
      suggestHideTimer = window.setTimeout(hideTagSuggestions, 120);
    });

    searchSuggest?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
    });

    window.addEventListener('popstate', () => {
      loadSongs(getPageFromUrl(), getQueryFromUrl(), getTargetFromUrl());
    });

    window.addEventListener('resize', () => {
      if (resizeDebounceTimer) {
        window.clearTimeout(resizeDebounceTimer);
      }

      resizeDebounceTimer = window.setTimeout(() => {
        const { changed } = syncPageSizeWithViewport();
        if (changed) {
          loadSongs(getPageFromUrl(), getQueryFromUrl(), getTargetFromUrl());
        } else {
          updatePaginationSafeSpace();
        }
      }, 120);
    });

    window.addEventListener('load', () => {
      updateSearchUiForTarget(getTargetFromUrl());
      syncPageSizeWithViewport();
      renderLocalSamplePanel();
      loadSongs(getPageFromUrl(), getQueryFromUrl(), getTargetFromUrl());
    });
