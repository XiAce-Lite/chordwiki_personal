function jsonResponse(status, body) {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body
  };
}

function badRequest(detail) {
  return jsonResponse(400, { error: 'BadRequest', detail });
}

function unauthorized(detail = '') {
  const body = { error: 'Unauthorized' };
  if (detail) {
    body.detail = detail;
  }
  return jsonResponse(401, body);
}

function forbidden(detail = '') {
  const body = { error: 'Forbidden' };
  if (detail) {
    body.detail = detail;
  }
  return jsonResponse(403, body);
}

function notFound(detail) {
  return jsonResponse(404, { error: 'NotFound', detail });
}

function methodNotAllowed(detail = '') {
  const body = { error: 'MethodNotAllowed' };
  if (detail) {
    body.detail = detail;
  }
  return jsonResponse(405, body);
}

function serverConfigError(detail = 'Missing COSMOS_ENDPOINT or COSMOS_KEY.') {
  return jsonResponse(500, { error: 'ServerConfigError', detail });
}

function internalServerError(error) {
  return jsonResponse(500, {
    error: 'InternalServerError',
    detail: String(error?.message || error)
  });
}

module.exports = {
  jsonResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  methodNotAllowed,
  serverConfigError,
  internalServerError
};
