(function attachChordWikiIndexSearchUi(global) {
  function createIndexSearchUiService(options = {}) {
    const {
      searchInput,
      searchForm,
      searchTarget,
      searchHelp,
      searchSuggest,
      searchState,
      searchStateText,
      searchClear,
      homeLink,
      SONG_SEARCH_TARGET,
      TAG_SEARCH_TARGET,
      TAG_SUGGEST_LIMIT,
      normalizeSearchTarget,
      collectTagSuggestions,
      buildApiUrl,
      loadSongs,
      loadLocalTestSongsData,
      updatePageUrl,
      localTestSongsState
    } = options;

    let suggestRequestSerial = 0;
    let suggestHideTimer = 0;

    function hideTagSuggestions() {
      if (suggestHideTimer) {
        global.clearTimeout(suggestHideTimer);
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
          if (searchInput) {
            searchInput.value = tag;
          }
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

    function bindSearchInteractions() {
      searchForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        hideTagSuggestions();
        loadSongs(1, searchInput?.value, searchTarget?.value);
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
        if (normalizeSearchTarget(searchTarget.value) === TAG_SEARCH_TARGET && String(searchInput?.value || '').trim()) {
          updateTagSuggestions(searchInput?.value);
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
        suggestHideTimer = global.setTimeout(hideTagSuggestions, 120);
      });

      searchSuggest?.addEventListener('pointerdown', (event) => {
        event.preventDefault();
      });
    }

    return Object.freeze({
      hideTagSuggestions,
      renderTagSuggestions,
      updateTagSuggestions,
      updateSearchState,
      resetToHome,
      updateSearchUiForTarget,
      bindSearchInteractions
    });
  }

  global.ChordWikiIndexSearchUi = Object.freeze({
    createIndexSearchUiService
  });
})(window);