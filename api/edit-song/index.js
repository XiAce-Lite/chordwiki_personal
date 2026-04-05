const { CosmosClient } = require('@azure/cosmos');

const endpoint = process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_DB_KEY;
const databaseId = process.env.COSMOS_DB_NAME || 'ChordWiki';
const containerId = process.env.COSMOS_DB_CONTAINER || 'Songs';

const client = new CosmosClient({ endpoint, key });

module.exports = async function (context, req) {
  try {
    const body = req.body;

    if (!body || typeof body !== 'object') {
      context.res = {
        status: 400,
        body: { error: 'BadRequest', detail: 'Request body must be JSON.' }
      };
      return;
    }

    const { id, title, slug, artist, tags, chordPro, updatedAt } = body;

    if (!id || !title || !slug || !artist || !tags || !chordPro || !updatedAt) {
      context.res = {
        status: 400,
        body: { error: 'BadRequest', detail: 'id, title, slug, artist, tags, chordPro, updatedAt are required.' }
      };
      return;
    }

    if (!Array.isArray(tags) || tags.length === 0) {
      context.res = {
        status: 400,
        body: { error: 'BadRequest', detail: 'tags must be a non-empty array.' }
      };
      return;
    }

    const database = client.database(databaseId);
    const container = database.container(containerId);

    const item = {
      id,
      title,
      slug,
      artist,
      tags,
      chordPro,
      updatedAt
    };

    const { resource } = await container.items.create(item, { partitionKey: artist });

    context.res = {
      status: 201,
      body: resource
    };
  } catch (error) {
    context.log.error(error);
    context.res = {
      status: 500,
      body: { error: 'InternalServerError', detail: error.message }
    };
  }
};