const DEFAULT_PAGE_SIZE = 30;
const MIN_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 60;
const MAX_PAGES = 6;

function normalizePage(value, maxPages = MAX_PAGES) {
  const parsed = Number.parseInt(String(value || "1"), 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(maxPages, Math.max(1, parsed));
}

function normalizePageSize(value) {
  const parsed = Number.parseInt(String(value || DEFAULT_PAGE_SIZE), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, parsed));
}

function calculateTotalLimit(pageSize, maxPages = MAX_PAGES) {
  return normalizePageSize(pageSize) * maxPages;
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MIN_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_PAGES,
  normalizePage,
  normalizePageSize,
  calculateTotalLimit
};
