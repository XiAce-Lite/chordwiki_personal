const { jsonResponse } = require('../shared/http');

const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
const MUSICBRAINZ_RECORDING_URL = 'https://musicbrainz.org/ws/2/recording/';
const YOUTUBE_SEARCH_URL = 'https://www.youtube.com/results';
const MUSICBRAINZ_USER_AGENT = 'chordwiki_personal/1.0.0 (https://github.com/)';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SEARCH_TIMEOUT_MS = 4000;

const LOW_PRIORITY_TERMS = [
  'live',
  'ライブ',
  'cover',
  'カバー',
  'ver',
  'version',
  'instrumental',
  'karaoke',
  'remix',
  'shorts',
  '弾いてみた',
  '歌ってみた'
];

function safeText(value) {
  return String(value || '').trim();
}

function sanitizeSearchPart(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeText(value) {
  return safeText(value)
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[“”"'’`]/g, '')
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function countTokenHits(haystack, tokens) {
  return tokens.reduce((count, token) => (haystack.includes(token) ? count + 1 : count), 0);
}

function stripParenthesizedTitleText(value) {
  const original = safeText(value);
  if (!original) {
    return '';
  }

  const stripped = original
    .replace(/\s*（[^）]*）\s*/g, ' ')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*【[^】]*】\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/[\s\u3000]+/g, ' ')
    .trim();

  return stripped || original;
}

function parseDurationText(value) {
  const text = safeText(value);
  if (!text) {
    return 0;
  }

  const parts = text.split(':').map((part) => Number.parseInt(part, 10));
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) {
    return 0;
  }

  return parts.reduce((total, part) => (total * 60) + part, 0);
}

async function fetchTextWithTimeout(url, options = {}, timeoutMs = SEARCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timerId);
  }
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = SEARCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timerId);
  }
}

function escapeMusicBrainzQueryTerm(raw) {
  let text = String(raw || '');
  text = text.replace(/\\/g, '\\\\');
  text = text.replace(/"/g, '\\"');
  text = text.replace(/\+/g, '\\+');
  text = text.replace(/\-/g, '\\-');
  text = text.replace(/\!/g, '\\!');
  text = text.replace(/\(/g, '\\(');
  text = text.replace(/\)/g, '\\)');
  text = text.replace(/\{/g, '\\{');
  text = text.replace(/\}/g, '\\}');
  text = text.replace(/\[/g, '\\[');
  text = text.replace(/\]/g, '\\]');
  text = text.replace(/\^/g, '\\^');
  text = text.replace(/\~/g, '\\~');
  text = text.replace(/\*/g, '\\*');
  text = text.replace(/\?/g, '\\?');
  text = text.replace(/\:/g, '\\:');
  text = text.replace(/\&\&/g, '\\&\\&');
  text = text.replace(/\|\|/g, '\\|\\|');
  return text.trim();
}

function hasMinimumTokenOverlap(titleA, artistA, titleB, artistB) {
  const titleTokensA = tokenize(titleA);
  const artistTokensA = tokenize(artistA);
  const normalizedTitleB = normalizeText(titleB);
  const normalizedArtistB = normalizeText(artistB);

  if (titleTokensA.length === 0 || artistTokensA.length === 0) {
    return false;
  }

  const titleHits = countTokenHits(normalizedTitleB, titleTokensA);
  const artistHits = countTokenHits(normalizedArtistB, artistTokensA);

  return titleHits >= 1 && artistHits >= 1;
}

async function fetchDurationFromItunes(title, artist) {
  const q = sanitizeSearchPart(`${title} ${artist}`);
  if (!q) {
    return null;
  }

  const url = `${ITUNES_SEARCH_URL}?term=${encodeURIComponent(q)}&entity=song&limit=5`;

  try {
    const response = await fetchJsonWithTimeout(url);
    if (!response.ok) {
      return null;
    }

    const payload = await response.json().catch(() => null);
    const results = Array.isArray(payload?.results) ? payload.results : [];

    for (const item of results) {
      const trackMs = Number(item?.trackTimeMillis);
      if (!Number.isFinite(trackMs) || trackMs <= 0) {
        continue;
      }

      const matchOk = hasMinimumTokenOverlap(
        title,
        artist,
        item?.trackName,
        item?.artistName
      );

      if (!matchOk) {
        continue;
      }

      return {
        found: true,
        source: 'itunes',
        durationSec: Math.round(trackMs / 1000),
        detail: {
          trackName: safeText(item?.trackName),
          artistName: safeText(item?.artistName)
        }
      };
    }
  } catch {
    // ignore provider error
  }

  return null;
}

async function fetchDurationFromMusicBrainz(title, artist) {
  const cleanTitle = sanitizeSearchPart(title);
  const cleanArtist = sanitizeSearchPart(artist);
  if (!cleanTitle || !cleanArtist) {
    return null;
  }

  const q = `recording:"${escapeMusicBrainzQueryTerm(cleanTitle)}" AND artist:"${escapeMusicBrainzQueryTerm(cleanArtist)}"`;
  const url = `${MUSICBRAINZ_RECORDING_URL}?query=${encodeURIComponent(q)}&fmt=json&limit=5`;

  try {
    const response = await fetchJsonWithTimeout(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': MUSICBRAINZ_USER_AGENT
      }
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json().catch(() => null);
    const recordings = Array.isArray(payload?.recordings) ? payload.recordings : [];

    for (const recording of recordings) {
      const lengthMs = Number(recording?.length);
      if (!Number.isFinite(lengthMs) || lengthMs <= 0) {
        continue;
      }

      const recordingTitle = safeText(recording?.title);
      const artistCredit = Array.isArray(recording?.['artist-credit'])
        ? recording['artist-credit']
          .map((entry) => safeText(entry?.name || entry?.artist?.name))
          .filter(Boolean)
          .join(' ')
        : '';

      const matchOk = hasMinimumTokenOverlap(
        cleanTitle,
        cleanArtist,
        recordingTitle,
        artistCredit
      );

      if (!matchOk) {
        continue;
      }

      return {
        found: true,
        source: 'musicbrainz',
        durationSec: Math.round(lengthMs / 1000),
        detail: {
          title: recordingTitle,
          artist: artistCredit
        }
      };
    }
  } catch {
    // ignore provider error
  }

  return null;
}

function extractText(node) {
  if (!node) {
    return '';
  }

  if (typeof node === 'string') {
    return node;
  }

  if (typeof node.text === 'string') {
    return node.text;
  }

  if (typeof node.simpleText === 'string') {
    return node.simpleText;
  }

  if (Array.isArray(node.runs)) {
    return node.runs.map((entry) => extractText(entry)).join('');
  }

  return '';
}

function collectVideoRenderers(node, results = []) {
  if (!node) {
    return results;
  }

  if (Array.isArray(node)) {
    node.forEach((entry) => collectVideoRenderers(entry, results));
    return results;
  }

  if (typeof node !== 'object') {
    return results;
  }

  if (node.videoRenderer) {
    results.push(node.videoRenderer);
  }

  Object.values(node).forEach((value) => collectVideoRenderers(value, results));
  return results;
}

function extractInitialData(html) {
  const patterns = [
    /var ytInitialData = (\{.*?\});<\/script>/s,
    /window\["ytInitialData"\] = (\{.*?\});/s,
    /ytInitialData\s*=\s*(\{.*?\});/s
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    try {
      return JSON.parse(match[1]);
    } catch {
      // continue
    }
  }

  return null;
}

function mapYoutubeCandidate(videoRenderer) {
  const title = safeText(extractText(videoRenderer?.title));
  const channel = safeText(
    extractText(videoRenderer?.ownerText) || extractText(videoRenderer?.longBylineText)
  );
  const durationText = safeText(extractText(videoRenderer?.lengthText));

  return {
    videoId: safeText(videoRenderer?.videoId),
    title,
    channel,
    durationText,
    durationSec: parseDurationText(durationText)
  };
}

function scoreYoutubeCandidate(candidate, title, artist) {
  const haystack = normalizeText(`${candidate.title} ${candidate.channel}`);
  const normalizedTitle = normalizeText(title);
  const normalizedArtist = normalizeText(artist);
  const titleTokens = tokenize(title);
  const artistTokens = tokenize(artist);

  if (!candidate.videoId || !candidate.durationSec) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  if (normalizedTitle && haystack.includes(normalizedTitle)) {
    score += 80;
  }
  score += countTokenHits(haystack, titleTokens) * 16;

  if (normalizedArtist && haystack.includes(normalizedArtist)) {
    score += 70;
  }
  score += countTokenHits(haystack, artistTokens) * 18;

  if (artistTokens.length > 0 && countTokenHits(haystack, artistTokens) === 0) {
    score -= 60;
  }

  if (titleTokens.length > 0 && countTokenHits(haystack, titleTokens) === 0) {
    score -= 40;
  }

  if (candidate.durationSec < 60) {
    score -= 20;
  }

  const normalizedCandidate = normalizeText(`${candidate.title} ${candidate.channel}`);
  LOW_PRIORITY_TERMS.forEach((term) => {
    if (normalizedCandidate.includes(term)) {
      score -= 8;
    }
  });

  return score;
}

async function fetchDurationFromYoutube(title, artist) {
  const cleanedTitle = stripParenthesizedTitleText(title);
  const query = `${cleanedTitle || title} ${artist}`.trim();
  if (!query) {
    return null;
  }

  const url = `${YOUTUBE_SEARCH_URL}?search_query=${encodeURIComponent(query)}&hl=ja&persist_hl=1`;

  try {
    const { response, text: html } = await fetchTextWithTimeout(url, {
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'ja,en-US;q=0.8,en;q=0.6'
      }
    });

    if (!response.ok) {
      return null;
    }

    const initialData = extractInitialData(html);
    if (!initialData) {
      return null;
    }

    const seenIds = new Set();
    const candidates = collectVideoRenderers(initialData)
      .map(mapYoutubeCandidate)
      .filter((candidate) => {
        if (!candidate.videoId || seenIds.has(candidate.videoId)) {
          return false;
        }

        seenIds.add(candidate.videoId);
        return candidate.durationSec > 0;
      })
      .slice(0, 12)
      .map((candidate) => ({
        ...candidate,
        score: scoreYoutubeCandidate(candidate, cleanedTitle || title, artist)
      }))
      .sort((left, right) => right.score - left.score);

    const best = candidates[0];
    if (!best || best.score < 30) {
      return null;
    }

    return {
      found: true,
      source: 'youtube',
      durationSec: best.durationSec,
      detail: {
        videoId: best.videoId,
        title: best.title,
        channel: best.channel,
        score: best.score
      }
    };
  } catch {
    // ignore provider error
  }

  return null;
}

module.exports = async function (context, req) {
  const title = safeText(req.query.title);
  const artist = safeText(req.query.artist);

  if (!title || !artist) {
    context.res = jsonResponse(400, {
      error: 'BadRequest',
      detail: 'title and artist query parameters are required.'
    });
    return;
  }

  const providersTried = [];

  const itunesResult = await fetchDurationFromItunes(title, artist);
  providersTried.push('itunes');
  if (itunesResult?.found) {
    context.res = jsonResponse(200, {
      found: true,
      source: 'itunes',
      durationSec: itunesResult.durationSec,
      diagnostics: {
        providersTried
      }
    });
    return;
  }

  const musicBrainzResult = await fetchDurationFromMusicBrainz(title, artist);
  providersTried.push('musicbrainz');
  if (musicBrainzResult?.found) {
    context.res = jsonResponse(200, {
      found: true,
      source: 'musicbrainz',
      durationSec: musicBrainzResult.durationSec,
      diagnostics: {
        providersTried
      }
    });
    return;
  }

  const youtubeResult = await fetchDurationFromYoutube(title, artist);
  providersTried.push('youtube');
  if (youtubeResult?.found) {
    context.res = jsonResponse(200, {
      found: true,
      source: 'youtube',
      durationSec: youtubeResult.durationSec,
      diagnostics: {
        providersTried
      }
    });
    return;
  }

  context.res = jsonResponse(200, {
    found: false,
    source: 'default',
    durationSec: null,
    diagnostics: {
      providersTried
    }
  });
};
