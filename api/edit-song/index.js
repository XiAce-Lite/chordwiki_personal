const { getContainer } = require('../shared/cosmos');
const {
  badRequest: buildBadRequest,
  notFound: buildNotFound,
  serverConfigError,
  internalServerError,
  jsonResponse
} = require('../shared/http');
const { normalizeSongBody } = require('../shared/validation');

const container = getContainer();

function badRequest(context, detail) {
  context.res = buildBadRequest(detail);
}

function notFound(context, detail) {
  context.res = buildNotFound(detail);
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
  const originalArtist = String(req.query?.artist || context.bindingData.artist || "").trim();
  const originalId = String(req.query?.id || context.bindingData.id || "").trim();

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

async function handleDelete(context, req) {
  const originalArtist = String(req.query?.artist || context.bindingData.artist || "").trim();
  const originalId = String(req.query?.id || context.bindingData.id || "").trim();

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
      context.res = serverConfigError('Missing COSMOS_ENDPOINT or COSMOS_KEY');
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
      await handleDelete(context, req);
      return;
    }

    context.res = jsonResponse(405, { error: "MethodNotAllowed", detail: `Unsupported method: ${method}` });
  } catch (error) {
    context.log.error(error);
    context.res = internalServerError(error);
  }
};