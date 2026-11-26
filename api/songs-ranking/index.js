const {
  normalizePage,
  normalizePageSize,
  calculateTotalPages
} = require('../shared/pagination');
const { getContainer } = require('../shared/cosmos');
const { jsonResponse, serverConfigError } = require('../shared/http');
const {
  rankAndLimitSongs,
  getPageWindow
} = require('../shared/song-catalog');

const container = getContainer();

module.exports = async function (context, req) {
  if (!container) {
    context.res = serverConfigError();
    return;
  }

  const pageSize = normalizePageSize(req.query.pageSize);
  const now = Date.now();

  try {
    const query = {
      query: "SELECT c.id, c.artist, c.title, c.slug, c.score, c.last_viewed_at, c.tags FROM c"
    };

    const { resources } = await container.items.query(query, {
      enableCrossPartitionQuery: true
    }).fetchAll();

    const rankedSongs = rankAndLimitSongs(resources, null, now);
    const totalSongs = rankedSongs.length;
    const totalPages = calculateTotalPages(totalSongs, pageSize);
    const page = normalizePage(req.query.page, totalPages);
    const songs = getPageWindow(rankedSongs, page, pageSize);

    context.res = jsonResponse(200, {
      page,
      pageSize,
      totalPages,
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
