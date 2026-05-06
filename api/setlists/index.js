const { getContainer } = require('../shared/cosmos');
const {
  badRequest,
  forbidden,
  jsonResponse,
  methodNotAllowed,
  internalServerError
} = require('../shared/http');
const { getOwnerId, hasEditorRole } = require('../shared/auth');

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
  const isShared = source.isShared === true;

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
    isShared,
    createdAt: Number.isFinite(createdAt) ? createdAt : now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : now()
  };
}

// GET: editor → 自分の全セットリスト + 全ユーザーのisShared=true
//      viewer/未ログイン → 全ユーザーのisShared=true のみ
async function handleGet(context, req) {
  const ownerId = getOwnerId(req);
  const isEditor = hasEditorRole(req);

  // 全ユーザーのisShared=trueをクロスパーティションで取得
  const sharedQuery = {
    query: 'SELECT c.id, c.userId, c.name, c.songs, c.isShared, c.createdAt, c.updatedAt FROM c WHERE c.isShared = true ORDER BY c.updatedAt DESC'
  };

  const { resources: sharedResources } = await container.items.query(sharedQuery, {
    maxItemCount: 500
  }).fetchAll();

  const results = [...sharedResources];

  // editorかつログイン済みの場合は自分のisShared=falseも取得
  if (isEditor && ownerId) {
    const privateQuery = {
      query: 'SELECT c.id, c.userId, c.name, c.songs, c.isShared, c.createdAt, c.updatedAt FROM c WHERE c.userId = @userId AND (c.isShared = false OR NOT IS_DEFINED(c.isShared)) ORDER BY c.updatedAt DESC',
      parameters: [{ name: '@userId', value: ownerId }]
    };

    const { resources: privateResources } = await container.items.query(privateQuery, {
      partitionKey: ownerId,
      maxItemCount: 200
    }).fetchAll();

    results.push(...privateResources);
  }

  // 重複除去・updatedAt降順
  const seen = new Set();
  const deduped = results.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

  context.res = jsonResponse(200, deduped);
}

// POST: editorのみ
async function handlePost(context, req) {
  const ownerId = getOwnerId(req);
  if (!ownerId) {
    context.res = jsonResponse(401, { error: 'Unauthorized' });
    return;
  }

  if (!hasEditorRole(req)) {
    context.res = forbidden('セットリストの作成には編集権限が必要です。');
    return;
  }

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
  try {
    if (req.method === 'GET') {
      await handleGet(context, req);
      return;
    }

    if (req.method === 'POST') {
      await handlePost(context, req);
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