const { getContainer } = require('../shared/cosmos');
const {
  jsonResponse,
  badRequest,
  notFound,
  serverConfigError
} = require('../shared/http');
const { parseArtistBody } = require('../shared/validation');

const container = getContainer();

function normalizeScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.trunc(numeric));
}

module.exports = async function (context, req) {
  if (!container) {
    context.res = serverConfigError();
    return;
  }

  const id = String(context.bindingData.id || "").trim();
  if (!id) {
    context.res = jsonResponse(400, {
      error: "BadRequest",
      detail: "id route parameter is required."
    });
    return;
  }

  const parsed = parseArtistBody(req.body);
  if (parsed.error) {
    context.res = badRequest(parsed.error);
    return;
  }

  const { artist } = parsed;

  try {
    const itemRef = container.item(id, artist);
    const { resource: song } = await itemRef.read();

    if (!song) {
      context.res = jsonResponse(404, {
        error: "NotFound",
        detail: "Song not found."
      });
      return;
    }

    const lastViewedAt = new Date().toISOString();
    const nextScore = Math.min(normalizeScore(song.score) + 1, 100);

    const updatedSong = {
      ...song,
      score: nextScore,
      last_viewed_at: lastViewedAt
    };

    await itemRef.replace(updatedSong);

    context.res = jsonResponse(200, {
      id: updatedSong.id,
      artist: updatedSong.artist,
      score: updatedSong.score,
      last_viewed_at: updatedSong.last_viewed_at
    });
  } catch (error) {
    if (error.code === 404) {
      context.res = jsonResponse(404, {
        error: "NotFound",
        detail: "Song not found."
      });
      return;
    }

    context.log.error("Failed to update song view score:", error);
    context.res = jsonResponse(500, {
      error: "InternalServerError",
      detail: String(error.message || error)
    });
  }
};
