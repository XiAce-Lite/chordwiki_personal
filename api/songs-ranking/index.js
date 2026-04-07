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
      query: `
        SELECT c.id, c.artist, c.title, c.slug, c.score, c.last_viewed_at
        FROM c
        ORDER BY c.score DESC, c.last_viewed_at DESC
        OFFSET @offset LIMIT @limit
      `,
      parameters: [
        { name: "@offset", value: offset },
        { name: "@limit", value: PAGE_SIZE }
      ]
    };

    const { resources } = await container.items.query(query, {
      enableCrossPartitionQuery: true,
      maxItemCount: PAGE_SIZE
    }).fetchAll();

    const songs = (resources || []).slice(0, PAGE_SIZE).map((song) => ({
      id: song.id,
      artist: song.artist,
      title: song.title,
      slug: song.slug,
      score: Number.isFinite(Number(song.score)) ? Number(song.score) : 0,
      last_viewed_at: song.last_viewed_at || null
    }));

    context.res = jsonResponse(200, {
      page,
      pageSize: PAGE_SIZE,
      totalLimit: TOTAL_LIMIT,
      totalPages: MAX_PAGES,
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
