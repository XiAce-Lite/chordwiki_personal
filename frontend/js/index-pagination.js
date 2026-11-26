(function attachChordWikiIndexPagination(global) {
  function createIndexPaginationService(options = {}) {
    const {
      getPaginationElement,
      normalizeSearchTarget,
      isRankingMode,
      clampPage,
      clampPageSize,
      rankingPageSize,
      updatePaginationSafeSpace,
      loadSongs
    } = options;

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

    function renderPagination(page, songCount = 0, query = '', target = 'song', pageSize = 30) {
      const paginationEl = getPaginationElement?.();
      if (!paginationEl) {
        return;
      }

      const appliedQuery = String(query || '').trim();
      const safeTarget = normalizeSearchTarget(target);
      const rankingMode = isRankingMode(appliedQuery, safeTarget);
      const safePageSize = rankingMode ? rankingPageSize : clampPageSize(pageSize);
      const availablePages = Math.max(1, Math.ceil(Math.max(0, Number(songCount) || 0) / safePageSize));
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

    return Object.freeze({
      renderPagination
    });
  }

  global.ChordWikiIndexPagination = Object.freeze({
    createIndexPaginationService
  });
})(window);
