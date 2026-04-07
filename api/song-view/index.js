const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_ENDPOINT || process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_KEY || process.env.COSMOS_DB_KEY;
const databaseId = process.env.COSMOS_DB_NAME || "ChordWiki";
const containerId = process.env.COSMOS_DB_CONTAINER || "Songs";

let container = null;
if (endpoint && key) {
  const client = new CosmosClient({ endpoint, key });
  container = client.database(databaseId).container(containerId);
}

function jsonResponse(status, body) {
  return {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body
  };
}

function parseBody(req) {
  let body = req.body;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return { error: "Request body must be valid JSON." };
    }
  }

  if (!body || typeof body !== "object") {
    return { error: "Request body must be JSON." };
  }

  const artist = String(body.artist || "").trim();
  if (!artist) {
    return { error: "artist is required." };
  }

  return { artist };
}

function normalizeScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.trunc(numeric));
}

module.exports = async function (context, req) {
  if (!container) {
    context.res = jsonResponse(500, {
      error: "ServerConfigError",
      detail: "Missing COSMOS_ENDPOINT/COSMOS_KEY (or COSMOS_DB_ENDPOINT/COSMOS_DB_KEY)."
    });
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

  const parsed = parseBody(req);
  if (parsed.error) {
    context.res = jsonResponse(400, {
      error: "BadRequest",
      detail: parsed.error
    });
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
