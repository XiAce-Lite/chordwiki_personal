const DECAY_INTERVAL_DAYS = 7;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.trunc(numeric));
}

function normalizeViewedAt(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function calculateScoreDecay(lastViewedAt, now = Date.now()) {
  const viewedAt = normalizeViewedAt(lastViewedAt);
  if (!viewedAt || !Number.isFinite(now) || now <= viewedAt) {
    return 0;
  }

  const elapsedDays = Math.floor((now - viewedAt) / MILLISECONDS_PER_DAY);
  return Math.max(0, Math.floor(elapsedDays / DECAY_INTERVAL_DAYS));
}

function calculateDisplayScore(score, lastViewedAt, now = Date.now()) {
  const baseScore = normalizeScore(score);
  const decay = calculateScoreDecay(lastViewedAt, now);
  return Math.max(0, baseScore - decay);
}

function attachDisplayScore(song, now = Date.now()) {
  return {
    ...song,
    display_score: calculateDisplayScore(song.score, song.last_viewed_at, now)
  };
}

function compareSongsForRanking(a, b, now = Date.now()) {
  const aDisplayScore = calculateDisplayScore(a.score, a.last_viewed_at, now);
  const bDisplayScore = calculateDisplayScore(b.score, b.last_viewed_at, now);

  if (bDisplayScore !== aDisplayScore) {
    return bDisplayScore - aDisplayScore;
  }

  return normalizeViewedAt(b.last_viewed_at) - normalizeViewedAt(a.last_viewed_at);
}

module.exports = {
  DECAY_INTERVAL_DAYS,
  normalizeScore,
  normalizeViewedAt,
  calculateScoreDecay,
  calculateDisplayScore,
  attachDisplayScore,
  compareSongsForRanking
};
