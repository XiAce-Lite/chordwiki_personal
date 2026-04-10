const { getContainer } = require('../shared/cosmos');
const {
  badRequest,
  notFound,
  serverConfigError,
  internalServerError,
  jsonResponse
} = require('../shared/http');

const container = getContainer();

module.exports = async function (context, req) {
  const artist = String(req.query?.artist || context.bindingData.artist || '').trim();
  const id = String(req.query?.id || context.bindingData.id || '').trim();

  if (!artist || !id) {
    context.res = badRequest('artist and id are required.');
    return;
  }

  if (!container) {
    context.res = serverConfigError();
    return;
  }

  try {
    const { resource: item } = await container.item(id, artist).read();

    if (!item) {
      context.res = notFound('Song not found.');
      return;
    }

    context.res = jsonResponse(200, item);
  } catch (error) {
    context.log.error(error);
    context.res = internalServerError(error);
  }
};