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

function notFound(detail) {
  return jsonResponse(404, { error: 'NotFound', detail });
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
  notFound,
  serverConfigError,
  internalServerError
};
