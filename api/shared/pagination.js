const DEFAULT_PAGE_SIZE = 30;
const MIN_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 60;

function normalizePage(value, maxPages = null) {
  const parsed = Number.parseInt(String(value || "1"), 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  const page = Math.max(1, parsed);
  if (maxPages == null || !Number.isFinite(Number(maxPages))) {
    return page;
  }

  return Math.min(Math.max(1, Number(maxPages)), page);
}

function normalizePageSize(value) {
  const parsed = Number.parseInt(String(value || DEFAULT_PAGE_SIZE), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, parsed));
}

function calculateTotalPages(totalSongs, pageSize) {
  const safePageSize = normalizePageSize(pageSize);
  const safeTotalSongs = Math.max(0, Number(totalSongs) || 0);
  return Math.max(1, Math.ceil(safeTotalSongs / safePageSize));
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MIN_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizePage,
  normalizePageSize,
  calculateTotalPages
};
