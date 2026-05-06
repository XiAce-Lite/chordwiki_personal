const { getContainer } = require('../shared/cosmos');
const {
  badRequest,
  jsonResponse,
  methodNotAllowed,
  internalServerError
} = require('../shared/http');
const { resolveAuthorizedOwnerContext } = require('../shared/request-context');

const container = getContainer(
  process.env.COSMOS_DB_NAME || 'ChordWiki',
  process.env.COSMOS_DB_CONTAINER_SETLISTS || 'setlists'
);

function now() {
  return Date.now();
}

function normalizeSongIds(songIds) {
  if (!Array.isArray(songIds)) {
    return [];
  }

  return songIds
    .map((songId) => String(songId || '').trim())
    .filter(Boolean);
}

function normalizeSetlistPayload(id, body, userId, existingCreatedAt) {
  const source = body && typeof body === 'object' ? body : {};
  const name = String(source.name || '').trim();
  const createdAt = Number(source.createdAt);

  if (!id) {
    return { error: 'id is required.' };
  }

  if (!name) {
    return { error: 'name is required.' };
  }

  return {
    id,
    userId,
    name,
    songs: normalizeSongIds(source.songs),
    createdAt: Number.isFinite(createdAt)
      ? createdAt
      : (Number.isFinite(existingCreatedAt) ? existingCreatedAt : now()),
    updatedAt: now()
  };
}

async function handlePut(context, req, ownerId) {
  const id = String(context.bindingData?.id || '').trim();
  if (!id) {
    context.res = badRequest('id is required.');
    return;
  }

  let existingCreatedAt = NaN;
  try {
    const { resource } = await container.item(id, ownerId).read();
    existingCreatedAt = Number(resource?.createdAt);
  } catch (error) {
    if (error?.code !== 404) {
      throw error;
    }
  }

  const normalized = normalizeSetlistPayload(id, req.body, ownerId, existingCreatedAt);
  if (normalized.error) {
    context.res = badRequest(normalized.error);
    return;
  }

  const result = await container.items.upsert(normalized, {
    partitionKey: ownerId
  });

  context.res = jsonResponse(200, result.resource);
}

async function handleDelete(context, ownerId) {
  const id = String(context.bindingData?.id || '').trim();
  if (!id) {
    context.res = badRequest('id is required.');
    return;
  }

  try {
    await container.item(id, ownerId).delete();
  } catch (error) {
    if (error?.code !== 404) {
      throw error;
    }
  }

  context.res = {
    status: 204,
    headers: {}
  };
}

module.exports = async function (context, req) {
  const requestContext = resolveAuthorizedOwnerContext(context, req, container, {
    serverConfigDetail: 'Missing Cosmos DB configuration for setlists.'
  });
  if (!requestContext) {
    return;
  }

  try {
    if (req.method === 'PUT') {
      await handlePut(context, req, requestContext.ownerId);
      return;
    }

    if (req.method === 'DELETE') {
      await handleDelete(context, requestContext.ownerId);
      return;
    }

    context.res = methodNotAllowed('Supported methods: PUT, DELETE');
  } catch (error) {
    context.log.error(error);
    context.res = internalServerError(error);
  }
};