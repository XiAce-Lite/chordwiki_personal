const { CosmosClient } = require('@azure/cosmos');

const endpoint = process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_DB_KEY;
const databaseId = 'ChordWiki';
const containerId = 'Songs';

const client = new CosmosClient({ endpoint, key });

module.exports = async function (context, req) {
  try {
    const database = client.database(databaseId);
    const container = database.container(containerId);

    const querySpec = {
      query: 'SELECT c.id, c.artist, c.title, c.slug FROM c'
    };

    const { resources: items } = await container.items.query(querySpec, { enableCrossPartitionQuery: true }).fetchAll();

    context.res = {
      status: 200,
      body: items
    };
  } catch (error) {
    context.log.error(error);
    context.res = {
      status: 500,
      body: 'Internal Server Error'
    };
  }
};