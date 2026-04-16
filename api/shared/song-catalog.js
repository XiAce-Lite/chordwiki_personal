const {
  normalizeScore,
  attachDisplayScore,
  compareSongsForRanking
} = require('./ranking-score');
const { normalizeTags, normalizeText } = require('./validation');

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

function rankAndLimitSongs(resources, totalLimit, now = Date.now(), filterFn = null) {
  const source = Array.isArray(resources) ? resources : [];
  const filtered = typeof filterFn === 'function'
    ? source.filter(filterFn)
    : source;

  return filtered
    .map((song) => mapSongSummary(song, now))
    .sort((a, b) => compareSongsForRanking(a, b, now))
    .slice(0, totalLimit);
}

function getPageWindow(items, page, pageSize) {
  const offset = (page - 1) * pageSize;
  return items.slice(offset, offset + pageSize);
}

function matchesSongSearch(song, search, target = 'song') {
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

function collectTagSuggestions(songs, term, limit = 10) {
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

module.exports = {
  mapSongSummary,
  rankAndLimitSongs,
  getPageWindow,
  matchesSongSearch,
  collectTagSuggestions
};