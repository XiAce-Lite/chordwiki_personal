const { getContainer } = require('../shared/cosmos');
const { jsonResponse, serverConfigError, internalServerError } = require('../shared/http');

const container = getContainer();

module.exports = async function (context, req) {
  if (!container) {
    context.res = serverConfigError();
    return;
  }

  try {
    const query = {
      query: 'SELECT c.id, c.artist, c.title, c.slug FROM c'
    };

    const { resources } = await container.items.query(query, {
      enableCrossPartitionQuery: true,
      maxItemCount: 100
    }).fetchAll();

    context.res = jsonResponse(200, resources);
  } catch (error) {
    context.log.error(error);
    context.res = internalServerError(error);
  }
};