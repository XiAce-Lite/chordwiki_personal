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
const { normalizeTags } = require('../shared/validation');

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

  try {
    const query = {
      query: "SELECT c.id, c.artist, c.title, c.slug, c.score, c.last_viewed_at, c.tags FROM c"
    };

    const { resources } = await container.items.query(query, {
      enableCrossPartitionQuery: true,
      maxItemCount: totalLimit
    }).fetchAll();

    const limitedRankedSongs = (resources || [])
      .map((song) => mapSongSummary(song, now))
      .sort((a, b) => compareSongsForRanking(a, b, now))
      .slice(0, totalLimit);

    const songs = limitedRankedSongs.slice(offset, offset + pageSize);
    const totalSongs = limitedRankedSongs.length; // ranking対象総数（最大300件）

    context.res = jsonResponse(200, {
      page,
      pageSize,
      totalLimit: totalLimit,
      totalPages: MAX_PAGES,
      totalSongs,
      songs
    });
  } catch (error) {
    context.log.error("Failed to load ranking songs:", error);
    context.res = jsonResponse(500, {
      error: "InternalServerError",
      detail: String(error.message || error)
    });
  }
};
