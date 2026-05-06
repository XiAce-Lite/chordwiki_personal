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

function normalizeSetlistPayload(body, userId) {
  const source = body && typeof body === 'object' ? body : {};
  const id = String(source.id || '').trim();
  const name = String(source.name || '').trim();
  const createdAt = Number(source.createdAt);
  const updatedAt = Number(source.updatedAt);

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
    createdAt: Number.isFinite(createdAt) ? createdAt : now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : now()
  };
}

async function handleGet(context, ownerId) {
  const query = {
    query: 'SELECT c.id, c.userId, c.name, c.songs, c.createdAt, c.updatedAt FROM c WHERE c.userId = @userId ORDER BY c.updatedAt DESC',
    parameters: [{ name: '@userId', value: ownerId }]
  };

  const { resources } = await container.items.query(query, {
    partitionKey: ownerId,
    maxItemCount: 200
  }).fetchAll();

  context.res = jsonResponse(200, resources);
}

async function handlePost(context, req, ownerId) {
  const normalized = normalizeSetlistPayload(req.body, ownerId);
  if (normalized.error) {
    context.res = badRequest(normalized.error);
    return;
  }

  const created = await container.items.create(normalized, {
    partitionKey: ownerId
  });

  context.res = jsonResponse(201, created.resource);
}

module.exports = async function (context, req) {
  const requestContext = resolveAuthorizedOwnerContext(context, req, container, {
    serverConfigDetail: 'Missing Cosmos DB configuration for setlists.'
  });
  if (!requestContext) {
    return;
  }

  try {
    if (req.method === 'GET') {
      await handleGet(context, requestContext.ownerId);
      return;
    }

    if (req.method === 'POST') {
      await handlePost(context, req, requestContext.ownerId);
      return;
    }

    context.res = methodNotAllowed('Supported methods: GET, POST');
  } catch (error) {
    if (error?.code === 409) {
      context.res = jsonResponse(409, {
        error: 'Conflict',
        detail: 'A setlist with the same id already exists.'
      });
      return;
    }

    context.log.error(error);
    context.res = internalServerError(error);
  }
};