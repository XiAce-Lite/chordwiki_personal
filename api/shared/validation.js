function normalizeNewlines(text) {
  return String(text || '').replace(/\r\n|\n\r|\r/g, '\n');
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .map((tag) => String(tag || '').trim())
    .filter(Boolean);
}

function normalizeYoutubeEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => {
      const id = String(entry?.id || '').trim();
      const rawStart = entry?.start;
      const hasStart = rawStart !== undefined && rawStart !== null && String(rawStart).trim() !== '';
      const start = Number.parseInt(String(rawStart ?? 0), 10);

      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
        return null;
      }

      if (hasStart && !Number.isFinite(start)) {
        return null;
      }

      return {
        id,
        start: Math.max(0, Math.trunc(Number.isFinite(start) ? start : 0))
      };
    })
    .filter(Boolean);
}

function normalizeText(value) {
  return String(value || '').trim().toLocaleLowerCase('ja-JP');
}

function normalizeSearchQuery(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return { raw: '', term: '', isExact: false };
  }

  const isExact = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
  const term = (isExact ? raw.slice(1, -1) : raw).trim();
  return { raw, term, isExact };
}

function normalizeSearchTarget(value) {
  return String(value || '').trim().toLowerCase() === 'tag' ? 'tag' : 'song';
}

function normalizeSongBody(rawBody, { fallbackId = '', requireId = true } = {}) {
  let body = rawBody;

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return { error: 'Request body must be valid JSON.' };
    }
  }

  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be JSON.' };
  }

  const id = String(body.id || fallbackId || '').trim();
  const title = String(body.title || '').trim();
  const slug = String(body.slug || '').trim();
  const artist = String(body.artist || '').trim();
  const createdAt = String(body.createdAt || '').trim();
  const updatedAt = String(body.updatedAt || '').trim();
  const chordPro = normalizeNewlines(body.chordPro || '').trim();
  const youtube = normalizeYoutubeEntries(body.youtube);

  if (requireId && !id) {
    return { error: 'id is required.' };
  }

  if (!title || !slug || !artist || !chordPro) {
    return { error: 'title, slug, artist, chordPro are required.' };
  }

  const rawTags = Array.isArray(body.tags)
    ? body.tags
    : typeof body.tags === 'string'
      ? normalizeNewlines(body.tags).split('\n')
      : [];

  return {
    value: {
      id,
      title,
      slug,
      artist,
      tags: normalizeTags(rawTags),
      chordPro,
      youtube,
      createdAt,
      updatedAt
    }
  };
}

function parseArtistBody(rawBody) {
  let body = rawBody;

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return { error: 'Request body must be valid JSON.' };
    }
  }

  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be JSON.' };
  }

  const artist = String(body.artist || '').trim();
  if (!artist) {
    return { error: 'artist is required.' };
  }

  return { artist };
}

module.exports = {
  normalizeNewlines,
  normalizeTags,
  normalizeYoutubeEntries,
  normalizeText,
  normalizeSearchQuery,
  normalizeSearchTarget,
  normalizeSongBody,
  parseArtistBody
};
