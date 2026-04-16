const {
  MAX_PAGES,
  normalizePage,
  normalizePageSize,
  calculateTotalLimit
} = require('../shared/pagination');
const { getContainer } = require('../shared/cosmos');
const { jsonResponse, serverConfigError } = require('../shared/http');
const {
  normalizeSearchQuery,
  normalizeSearchTarget
} = require('../shared/validation');
const {
  rankAndLimitSongs,
  getPageWindow,
  matchesSongSearch,
  collectTagSuggestions
} = require('../shared/song-catalog');

const TAG_SUGGEST_LIMIT = 10;
const container = getContainer();

module.exports = async function (context, req) {
  if (!container) {
    context.res = serverConfigError();
    return;
  }

  const pageSize = normalizePageSize(req.query.pageSize);
  const totalLimit = calculateTotalLimit(pageSize);
  const page = normalizePage(req.query.page, MAX_PAGES);
  const now = Date.now();
  const target = normalizeSearchTarget(req.query.target);
  const search = normalizeSearchQuery(req.query.q);
  const isTagSuggest = target === 'tag' && String(req.query.suggest || '').trim() === '1';

  if (!search.raw || !search.term) {
    context.res = jsonResponse(200, isTagSuggest
      ? {
          target,
          query: '',
          limit: TAG_SUGGEST_LIMIT,
          suggestions: []
        }
      : {
          page,
          pageSize,
          totalLimit: totalLimit,
          totalSongs: 0,
          songs: []
        });
    return;
  }

  try {
    const query = {
      query: "SELECT c.id, c.artist, c.title, c.slug, c.score, c.last_viewed_at, c.tags FROM c"
    };

    const { resources } = await container.items.query(query, {
      enableCrossPartitionQuery: true,
      maxItemCount: totalLimit
    }).fetchAll();

    if (isTagSuggest) {
      context.res = jsonResponse(200, {
        target,
        query: search.term,
        limit: TAG_SUGGEST_LIMIT,
        suggestions: collectTagSuggestions(resources || [], search.term, TAG_SUGGEST_LIMIT)
      });
      return;
    }

    const limitedSearchResults = rankAndLimitSongs(
      resources,
      totalLimit,
      now,
      (song) => matchesSongSearch(song, search, target)
    );

    const songs = getPageWindow(limitedSearchResults, page, pageSize);

    context.res = jsonResponse(200, {
      page,
      pageSize,
      totalLimit: totalLimit,
      totalSongs: limitedSearchResults.length,
      songs
    });
  } catch (error) {
    context.log.error("Failed to search songs:", error);
    context.res = jsonResponse(500, {
      error: "InternalServerError",
      detail: String(error.message || error)
    });
  }
};
