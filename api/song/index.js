const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_DB_ENDPOINT; // ←SWAの設定と一致させる
const key = process.env.COSMOS_DB_KEY;           // ←SWAの設定と一致させる
const databaseId = process.env.COSMOS_DB_NAME || "ChordWiki";
const containerId = process.env.COSMOS_DB_CONTAINER || "Songs";

const client = new CosmosClient({ endpoint, key });

module.exports = async function (context, req) {
  const artist = String(req.query?.artist || context.bindingData.artist || '').trim();
  const id = String(req.query?.id || context.bindingData.id || '').trim();

  if (!artist || !id) {
    context.res = {
      status: 400,
      body: { error: 'BadRequest', detail: 'artist and id are required.' }
    };
    return;
  }

  try {
    const container = client.database(databaseId).container(containerId);

    // partition key が /artist なので item(id, artist) で point read
    const { resource: item } = await container.item(id, artist).read();

    if (!item) {
      context.res = { status: 404, body: "Song not found" };
      return;
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: item
    };
  } catch (error) {
    context.log.error(error);
    context.res = {
      status: 500,
      body: { error: "Internal Server Error", detail: String(error.message || error) }
    };
  }
};