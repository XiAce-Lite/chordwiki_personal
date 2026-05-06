const { unauthorized, serverConfigError } = require('./http');
const { getOwnerId } = require('./auth');

function resolveAuthorizedOwnerContext(context, req, container, options = {}) {
  const ownerId = getOwnerId(req);
  if (!ownerId) {
    context.res = unauthorized();
    return null;
  }

  if (!container) {
    context.res = serverConfigError(options.serverConfigDetail);
    return null;
  }

  return { ownerId };
}

module.exports = {
  resolveAuthorizedOwnerContext
};