const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_DB_KEY;
const databaseId = process.env.COSMOS_DB_NAME || "ChordWiki";
const containerId = process.env.COSMOS_DB_CONTAINER || "Songs";

let container = null;
if (endpoint && key) {
  const client = new CosmosClient({ endpoint, key });
  container = client.database(databaseId).container(containerId);
}

function badRequest(context, detail) {
  context.res = { status: 400, body: { error: "BadRequest", detail } };
}

function notFound(context, detail) {
  context.res = { status: 404, body: { error: "NotFound", detail } };
}

function normalizeNewlines(text) {
  return String(text || "").replace(/\r\n|\n\r|\r/g, "\n");
}

function normalizeYoutubeEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => {
      const id = String(entry?.id || "").trim();
      const rawStart = entry?.start;
      const hasStart = rawStart !== undefined && rawStart !== null && String(rawStart).trim() !== "";
      const start = Number.parseInt(String(rawStart ?? 0), 10);

      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
        return null;
      }

      if (hasStart && !Number.isFinite(start)) {
        return null;
      }

      return {
        id,
        start: Math.max(0, Math.trunc(Number.isFinite(start) ? start : 0))
      };
    })
    .filter(Boolean);
}

function normalizeSongBody(rawBody, { fallbackId = "", requireId = true } = {}) {
  let body = rawBody;

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

  const id = String(body.id || fallbackId || "").trim();
  const title = String(body.title || "").trim();
  const slug = String(body.slug || "").trim();
  const artist = String(body.artist || "").trim();
  const createdAt = String(body.createdAt || "").trim();
  const updatedAt = String(body.updatedAt || "").trim();
  const chordPro = normalizeNewlines(body.chordPro || "").trim();
  const youtube = normalizeYoutubeEntries(body.youtube);

  if (requireId && !id) {
    return { error: "id is required." };
  }

  if (!title || !slug || !artist || !chordPro) {
    return { error: "title, slug, artist, chordPro are required." };
  }

  const rawTags = Array.isArray(body.tags)
    ? body.tags
    : typeof body.tags === "string"
      ? normalizeNewlines(body.tags).split("\n")
      : [];

  const tags = rawTags
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
    .filter(Boolean);

  return {
    value: {
      id,
      title,
      slug,
      artist,
      tags,
      chordPro,
      youtube,
      createdAt,
      updatedAt
    }
  };
}

async function handleCreate(context, req) {
  const parsed = normalizeSongBody(req.body, { requireId: true });
  if (parsed.error) {
    badRequest(context, parsed.error);
    return;
  }

  const now = new Date().toISOString();
  const item = {
    ...parsed.value,
    createdAt: now,
    updatedAt: now,
    score: 0,
    last_viewed_at: null
  };

  try {
    const { resource } = await container.items.create(item, { partitionKey: item.artist });
    context.res = { status: 201, body: resource };
  } catch (error) {
    if (error.code === 409) {
      context.res = {
        status: 409,
        body: { error: "Conflict", detail: "Item already exists (id conflict within partition)." }
      };
      return;
    }

    throw error;
  }
}

async function readExistingSong(originalArtist, originalId) {
  try {
    const response = await container.item(originalId, originalArtist).read();
    return response.resource || null;
  } catch (error) {
    if (error.code === 404) {
      return null;
    }

    throw error;
  }
}

async function handleUpdate(context, req) {
  const originalArtist = String(context.bindingData.artist || "").trim();
  const originalId = String(context.bindingData.id || "").trim();

  if (!originalArtist || !originalId) {
    badRequest(context, "artist and id route parameters are required for update.");
    return;
  }

  const parsed = normalizeSongBody(req.body, { fallbackId: originalId, requireId: false });
  if (parsed.error) {
    badRequest(context, parsed.error);
    return;
  }

  const nextItem = parsed.value;
  if (nextItem.id && nextItem.id !== originalId) {
    badRequest(context, "id cannot be changed in edit mode.");
    return;
  }

  const existing = await readExistingSong(originalArtist, originalId);
  if (!existing) {
    notFound(context, "Song not found.");
    return;
  }

  const now = new Date().toISOString();
  const updatedItem = {
    ...existing,
    ...nextItem,
    id: originalId,
    createdAt: existing.createdAt || nextItem.createdAt || now,
    updatedAt: now
  };

  const { resource } = await container.items.upsert(updatedItem, { partitionKey: updatedItem.artist });

  if (updatedItem.artist !== originalArtist) {
    await container.item(originalId, originalArtist).delete();
  }

  context.res = { status: 200, body: resource };
}

async function handleDelete(context) {
  const originalArtist = String(context.bindingData.artist || "").trim();
  const originalId = String(context.bindingData.id || "").trim();

  if (!originalArtist || !originalId) {
    badRequest(context, "artist and id route parameters are required for delete.");
    return;
  }

  const existing = await readExistingSong(originalArtist, originalId);
  if (!existing) {
    notFound(context, "Song not found.");
    return;
  }

  await container.item(originalId, originalArtist).delete();
  context.res = {
    status: 200,
    body: { ok: true, id: originalId, artist: originalArtist }
  };
}

module.exports = async function (context, req) {
  try {
    if (!container) {
      context.res = {
        status: 500,
        body: {
          error: "ServerConfigError",
          detail: "Missing COSMOS_DB_ENDPOINT or COSMOS_DB_KEY"
        }
      };
      return;
    }

    const method = String(req.method || "").toUpperCase();

    if (method === "POST") {
      await handleCreate(context, req);
      return;
    }

    if (method === "PUT") {
      await handleUpdate(context, req);
      return;
    }

    if (method === "DELETE") {
      await handleDelete(context);
      return;
    }

    context.res = {
      status: 405,
      body: { error: "MethodNotAllowed", detail: `Unsupported method: ${method}` }
    };
  } catch (error) {
    context.log.error(error);
    context.res = {
      status: 500,
      body: { error: "InternalServerError", detail: String(error.message || error) }
    };
  }
};