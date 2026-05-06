function getHeaderValue(req, name) {
  const key = String(name || '').toLowerCase();
  if (!req || !req.headers) {
    return '';
  }

  if (typeof req.headers.get === 'function') {
    const value = req.headers.get(name) || req.headers.get(key);
    return String(value || '').trim();
  }

  const headers = req.headers;
  const value = headers[name] ?? headers[key];
  return String(value || '').trim();
}

function decodeClientPrincipal(rawValue) {
  const normalized = String(rawValue || '').trim();
  if (!normalized) {
    return null;
  }

  const base64 = normalized
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const paddingLength = (4 - (base64.length % 4)) % 4;
  const padded = base64 + '='.repeat(paddingLength);

  const decoded = Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(decoded);
}

function getOwnerId(req) {
  const rawPrincipal = getHeaderValue(req, 'x-ms-client-principal');
  if (!rawPrincipal) {
    return '';
  }

  try {
    const principal = decodeClientPrincipal(rawPrincipal);
    return String(principal?.userId || '').trim();
  } catch {
    return '';
  }
}

function hasEditorRole(req) {
  const rawPrincipal = getHeaderValue(req, 'x-ms-client-principal');
  if (!rawPrincipal) {
    return false;
  }

  try {
    const principal = decodeClientPrincipal(rawPrincipal);
    const roles = Array.isArray(principal?.userRoles) ? principal.userRoles : [];
    return roles.includes('editor');
  } catch {
    return false;
  }
}

module.exports = {
  getOwnerId,
  hasEditorRole
};