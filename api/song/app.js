const { CosmosClient } = require('@azure/cosmos');

const endpoint = process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_DB_KEY;
const databaseId = 'ChordWiki';
const containerId = 'Songs';

const client = new CosmosClient({ endpoint, key });

module.exports = async function (context, req) {
  const { artist, id } = req.params;

  try {
    const database = client.database(databaseId);
    const container = database.container(containerId);

    const { resource: item } = await container.item(id, artist).read();

    if (item) {
      context.res = {
        status: 200,
        body: item
      };
    } else {
      context.res = {
        status: 404,
        body: 'Song not found'
      };
    }
  } catch (error) {
    context.log.error(error);
    context.res = {
      status: 500,
      body: 'Internal Server Error'
    };
  }
};</content>
<parameter name="filePath">d:\Documents\GitHub\chordwiki_personal\api\song\app.js