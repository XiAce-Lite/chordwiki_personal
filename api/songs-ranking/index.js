const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_ENDPOINT || process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_KEY || process.env.COSMOS_DB_KEY;
const databaseId = process.env.COSMOS_DB_NAME || "ChordWiki";
const containerId = process.env.COSMOS_DB_CONTAINER || "Songs";

const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const TOTAL_LIMIT = PAGE_SIZE * MAX_PAGES;

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

function normalizePage(value) {
  const parsed = Number.parseInt(String(value || "1"), 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(MAX_PAGES, Math.max(1, parsed));
}

function normalizeScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.trunc(numeric));
}

function normalizeViewedAt(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function mapSongSummary(song) {
  return {
    id: song.id,
    artist: song.artist,
    title: song.title,
    slug: song.slug,
    score: normalizeScore(song.score),
    last_viewed_at: song.last_viewed_at || null
  };
}

function compareSongsForRanking(a, b) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }

  return normalizeViewedAt(b.last_viewed_at) - normalizeViewedAt(a.last_viewed_at);
}

module.exports = async function (context, req) {
  if (!container) {
    context.res = jsonResponse(500, {
      error: "ServerConfigError",
      detail: "Missing COSMOS_ENDPOINT/COSMOS_KEY (or COSMOS_DB_ENDPOINT/COSMOS_DB_KEY)."
    });
    return;
  }

  const page = normalizePage(req.query.page);
  const offset = (page - 1) * PAGE_SIZE;

  try {
    const query = {
      query: "SELECT c.id, c.artist, c.title, c.slug, c.score, c.last_viewed_at FROM c"
    };

    const { resources } = await container.items.query(query, {
      enableCrossPartitionQuery: true,
      maxItemCount: TOTAL_LIMIT
    }).fetchAll();

    const rankedSongs = (resources || [])
      .map(mapSongSummary)
      .sort(compareSongsForRanking)
      .slice(0, TOTAL_LIMIT);

    const songs = rankedSongs.slice(offset, offset + PAGE_SIZE);

    context.res = jsonResponse(200, {
      page,
      pageSize: PAGE_SIZE,
      totalLimit: TOTAL_LIMIT,
      totalPages: MAX_PAGES,
      totalSongs: rankedSongs.length,
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
