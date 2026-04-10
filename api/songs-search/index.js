const {
  normalizeScore,
  attachDisplayScore,
  compareSongsForRanking
} = require('../shared/ranking-score');
const {
  MAX_PAGES,
  normalizePage,
  normalizePageSize,
  calculateTotalLimit
} = require('../shared/pagination');
const { getContainer } = require('../shared/cosmos');
const { jsonResponse, serverConfigError } = require('../shared/http');
const {
  normalizeText,
  normalizeSearchQuery,
  normalizeSearchTarget,
  normalizeTags
} = require('../shared/validation');

const TAG_SUGGEST_LIMIT = 10;
const container = getContainer();

function mapSongSummary(song, now = Date.now()) {
  return attachDisplayScore({
    id: song.id,
    artist: song.artist,
    title: song.title,
    slug: song.slug,
    tags: normalizeTags(song.tags),
    score: normalizeScore(song.score),
    last_viewed_at: song.last_viewed_at || null
  }, now);
}

function matchesSearch(song, search, target = 'song') {
  const needle = normalizeText(search.term);

  if (!needle) {
    return false;
  }

  if (target === 'tag') {
    const tags = normalizeTags(song.tags).map((tag) => normalizeText(tag));
    return tags.some((tag) => tag === needle);
  }

  const title = normalizeText(song.title);
  const artist = normalizeText(song.artist);

  if (search.isExact) {
    return title === needle || artist === needle;
  }

  return title.includes(needle) || artist.includes(needle);
}

function collectTagSuggestions(songs, term, limit = TAG_SUGGEST_LIMIT) {
  const needle = normalizeText(term);
  if (!needle) {
    return [];
  }

  const uniqueTags = new Set();
  (songs || []).forEach((song) => {
    normalizeTags(song.tags).forEach((tag) => {
      if (normalizeText(tag).startsWith(needle)) {
        uniqueTags.add(tag);
      }
    });
  });

  return Array.from(uniqueTags)
    .sort((a, b) => a.localeCompare(b, 'ja-JP', { sensitivity: 'base', numeric: true }))
    .slice(0, limit);
}

module.exports = async function (context, req) {
  if (!container) {
    context.res = serverConfigError();
    return;
  }

  const pageSize = normalizePageSize(req.query.pageSize);
  const totalLimit = calculateTotalLimit(pageSize);
  const page = normalizePage(req.query.page, MAX_PAGES);
  const offset = (page - 1) * pageSize;
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
    const needsTags = target === 'tag' || isTagSuggest;
    const query = {
      query: needsTags
        ? "SELECT c.id, c.artist, c.title, c.slug, c.score, c.last_viewed_at, c.tags FROM c"
        : "SELECT c.id, c.artist, c.title, c.slug, c.score, c.last_viewed_at, c.tags FROM c"
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
        suggestions: collectTagSuggestions(resources || [], search.term)
      });
      return;
    }

    const limitedSearchResults = (resources || [])
      .filter((song) => matchesSearch(song, search, target))
      .map((song) => mapSongSummary(song, now))
      .sort((a, b) => compareSongsForRanking(a, b, now))
      .slice(0, totalLimit);

    const songs = limitedSearchResults.slice(offset, offset + pageSize);

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
