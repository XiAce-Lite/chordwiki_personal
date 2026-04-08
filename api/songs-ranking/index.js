const { CosmosClient } = require("@azure/cosmos");
const {
  normalizeScore,
  attachDisplayScore,
  compareSongsForRanking
} = require("../shared/ranking-score");

const endpoint = process.env.COSMOS_ENDPOINT || process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_KEY || process.env.COSMOS_DB_KEY;
const databaseId = process.env.COSMOS_DB_NAME || "ChordWiki";
const containerId = process.env.COSMOS_DB_CONTAINER || "Songs";

const PAGE_SIZE = 50;
const MAX_PAGES = 6;
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

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .map((tag) => String(tag || '').trim())
    .filter(Boolean);
}

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
    context.res = jsonResponse(500, {
      error: "ServerConfigError",
      detail: "Missing COSMOS_ENDPOINT/COSMOS_KEY (or COSMOS_DB_ENDPOINT/COSMOS_DB_KEY)."
    });
    return;
  }

  const page = normalizePage(req.query.page);
  const offset = (page - 1) * PAGE_SIZE;
  const now = Date.now();

  try {
    const query = {
      query: "SELECT c.id, c.artist, c.title, c.slug, c.score, c.last_viewed_at, c.tags FROM c"
    };

    const { resources } = await container.items.query(query, {
      enableCrossPartitionQuery: true,
      maxItemCount: TOTAL_LIMIT
    }).fetchAll();

    const limitedRankedSongs = (resources || [])
      .map((song) => mapSongSummary(song, now))
      .sort((a, b) => compareSongsForRanking(a, b, now))
      .slice(0, TOTAL_LIMIT);

    const songs = limitedRankedSongs.slice(offset, offset + PAGE_SIZE);
    const totalSongs = limitedRankedSongs.length; // ranking対象総数（最大300件）

    context.res = jsonResponse(200, {
      page,
      pageSize: PAGE_SIZE,
      totalLimit: TOTAL_LIMIT,
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
