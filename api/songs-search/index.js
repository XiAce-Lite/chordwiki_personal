const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_ENDPOINT || process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_KEY || process.env.COSMOS_DB_KEY;
const databaseId = process.env.COSMOS_DB_NAME || "ChordWiki";
const containerId = process.env.COSMOS_DB_CONTAINER || "Songs";

const PAGE_SIZE = 50;
const MAX_PAGES = 6;
const TOTAL_LIMIT = PAGE_SIZE * MAX_PAGES;
const TAG_SUGGEST_LIMIT = 10;

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

function normalizeText(value) {
  return String(value || "").trim().toLocaleLowerCase("ja-JP");
}

function normalizeSearchQuery(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return { raw: "", term: "", isExact: false };
  }

  const isExact = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
  const term = (isExact ? raw.slice(1, -1) : raw).trim();
  return { raw, term, isExact };
}

function normalizeSearchTarget(value) {
  return String(value || '').trim().toLowerCase() === 'tag' ? 'tag' : 'song';
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .map((tag) => String(tag || '').trim())
    .filter(Boolean);
}

function mapSongSummary(song) {
  return {
    id: song.id,
    artist: song.artist,
    title: song.title,
    slug: song.slug,
    tags: normalizeTags(song.tags),
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
    context.res = jsonResponse(500, {
      error: "ServerConfigError",
      detail: "Missing COSMOS_ENDPOINT/COSMOS_KEY (or COSMOS_DB_ENDPOINT/COSMOS_DB_KEY)."
    });
    return;
  }

  const page = normalizePage(req.query.page);
  const offset = (page - 1) * PAGE_SIZE;
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
          pageSize: PAGE_SIZE,
          totalLimit: TOTAL_LIMIT,
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
      maxItemCount: TOTAL_LIMIT
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
      .map(mapSongSummary)
      .sort(compareSongsForRanking)
      .slice(0, TOTAL_LIMIT);

    const songs = limitedSearchResults.slice(offset, offset + PAGE_SIZE);

    context.res = jsonResponse(200, {
      page,
      pageSize: PAGE_SIZE,
      totalLimit: TOTAL_LIMIT,
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
