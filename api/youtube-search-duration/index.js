const YOUTUBE_SEARCH_URL = "https://www.youtube.com/results";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const LOW_PRIORITY_TERMS = [
  "live",
  "ライブ",
  "cover",
  "カバー",
  "ver",
  "version",
  "instrumental",
  "karaoke",
  "remix",
  "shorts",
  "弾いてみた",
  "歌ってみた"
];

function jsonResponse(status, body) {
  return {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body
  };
}

function safeText(value) {
  return String(value || "").trim();
}

function stripParenthesizedTitleText(value) {
  const original = safeText(value);
  if (!original) {
    return "";
  }

  const stripped = original
    .replace(/\s*（[^）]*）\s*/g, " ")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*【[^】]*】\s*/g, " ")
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/[\s\u3000]+/g, " ")
    .trim();

  return stripped || original;
}

function normalizeText(value) {
  return safeText(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[“”"'’`]/g, "")
    .replace(/[\s\u3000]+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function extractText(node) {
  if (!node) {
    return "";
  }

  if (typeof node === "string") {
    return node;
  }

  if (typeof node.text === "string") {
    return node.text;
  }

  if (typeof node.simpleText === "string") {
    return node.simpleText;
  }

  if (Array.isArray(node.runs)) {
    return node.runs.map((entry) => extractText(entry)).join("");
  }

  return "";
}

function parseDurationText(value) {
  const text = safeText(value);
  if (!text) {
    return 0;
  }

  const parts = text.split(":").map((part) => Number.parseInt(part, 10));
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) {
    return 0;
  }

  return parts.reduce((total, part) => (total * 60) + part, 0);
}

function collectVideoRenderers(node, results = []) {
  if (!node) {
    return results;
  }

  if (Array.isArray(node)) {
    node.forEach((entry) => collectVideoRenderers(entry, results));
    return results;
  }

  if (typeof node !== "object") {
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
      // try next pattern
    }
  }

  return null;
}

function mapCandidate(videoRenderer) {
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

function countTokenHits(haystack, tokens) {
  return tokens.reduce((count, token) => (haystack.includes(token) ? count + 1 : count), 0);
}

function scoreCandidate(candidate, title, artist) {
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

module.exports = async function (context, req) {
  const title = safeText(req.query.title);
  const artist = safeText(req.query.artist);

  if (!title || !artist) {
    context.res = jsonResponse(400, {
      error: "BadRequest",
      detail: "title and artist query parameters are required."
    });
    return;
  }

  const cleanedTitle = stripParenthesizedTitleText(title);
  const query = `${cleanedTitle || title} ${artist}`.trim();

  try {
    const url = `${YOUTUBE_SEARCH_URL}?search_query=${encodeURIComponent(query)}&hl=ja&persist_hl=1`;
    const response = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        "accept-language": "ja,en-US;q=0.8,en;q=0.6"
      }
    });

    if (!response.ok) {
      context.res = jsonResponse(200, {
        found: false,
        query,
        detail: `YouTube search returned HTTP ${response.status}`
      });
      return;
    }

    const html = await response.text();
    const initialData = extractInitialData(html);
    if (!initialData) {
      context.res = jsonResponse(200, {
        found: false,
        query,
        detail: "Could not parse YouTube search results."
      });
      return;
    }

    const seenIds = new Set();
    const candidates = collectVideoRenderers(initialData)
      .map(mapCandidate)
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
        score: scoreCandidate(candidate, cleanedTitle || title, artist)
      }))
      .sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (!best || best.score < 30) {
      context.res = jsonResponse(200, {
        found: false,
        query,
        candidates: candidates.slice(0, 3)
      });
      return;
    }

    context.res = jsonResponse(200, {
      found: true,
      query,
      videoId: best.videoId,
      title: best.title,
      channel: best.channel,
      durationSec: best.durationSec,
      durationText: best.durationText,
      score: best.score
    });
  } catch (error) {
    context.log.warn("Failed to estimate duration from YouTube:", error);
    context.res = jsonResponse(200, {
      found: false,
      query,
      detail: String(error.message || error)
    });
  }
};
