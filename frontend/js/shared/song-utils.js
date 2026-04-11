(function attachChordWikiSongUtils(global) {
  function normalizeTextBlock(text) {
    return String(text || '').replace(/\r\n|\n\r|\r/g, '\n');
  }

  function normalizeSongTags(tags) {
    if (!Array.isArray(tags)) {
      return [];
    }

    return tags
      .map((tag) => String(tag || '').trim())
      .filter(Boolean);
  }

  function normalizeTagsInput(text) {
    const normalized = normalizeTextBlock(text).trim();
    if (!normalized) {
      return [];
    }

    return normalized
      .split('\n')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  function normalizeYoutubeStart(value) {
    const parsed = Number.parseInt(String(value || '0'), 10);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
  }

  function extractYoutubeId(text) {
    const raw = String(text || '').trim();
    if (!raw) {
      return '';
    }

    const directMatch = raw.match(/^([A-Za-z0-9_-]{11})(?=$|[?&#\s])/);
    if (directMatch) {
      return directMatch[1];
    }

    if (/^https?:\/\//i.test(raw)) {
      try {
        const url = new URL(raw);
        const hostname = url.hostname.toLowerCase();

        if (hostname.includes('youtu.be')) {
          return (url.pathname.split('/').filter(Boolean)[0] || '').trim();
        }

        if (hostname.includes('youtube.com')) {
          const fromQuery = (url.searchParams.get('v') || '').trim();
          if (fromQuery) {
            return fromQuery;
          }

          const parts = url.pathname.split('/').filter(Boolean);
          const markerIndex = parts.findIndex((part) => part === 'embed' || part === 'shorts');
          if (markerIndex !== -1 && parts[markerIndex + 1]) {
            return parts[markerIndex + 1].trim();
          }
        }
      } catch {
        return '';
      }
    }

    const embeddedMatch = raw.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/i);
    return embeddedMatch ? embeddedMatch[1] : '';
  }

  function extractYoutubeStart(text) {
    const raw = String(text || '').trim();
    const match = raw.match(/(?:[?&\s]|^)(?:t|start)\s*=\s*(\d+)(?:s)?(?=$|[&#\s])/i);
    return normalizeYoutubeStart(match?.[1]);
  }

  function validateYoutubeLine(line) {
    const raw = String(line || '').trim();
    if (!raw) {
      return { entry: null, error: '' };
    }

    const id = extractYoutubeId(raw);
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
      return {
        entry: null,
        error: 'YouTube のアドレスとして不正です。動画ID（11文字）またはURLを入力してください。'
      };
    }

    return {
      entry: {
        id,
        start: extractYoutubeStart(raw)
      },
      error: ''
    };
  }

  function parseYoutubeLine(line) {
    return validateYoutubeLine(line).entry;
  }

  function parseYoutubeTextareaDetailed(text) {
    const entries = [];
    const errors = [];

    normalizeTextBlock(text)
      .split('\n')
      .forEach((line, index) => {
        const result = validateYoutubeLine(line);
        if (result.entry) {
          entries.push(result.entry);
          return;
        }

        if (result.error) {
          errors.push(`YouTube の${index + 1}行目が不正です。${result.error}`);
        }
      });

    return { entries, errors };
  }

  function parseYoutubeTextarea(text) {
    return parseYoutubeTextareaDetailed(text).entries;
  }

  function validateYoutubeTextarea(text) {
    return parseYoutubeTextareaDetailed(text).errors;
  }

  function normalizeSongYoutubeEntries(entries) {
    if (!Array.isArray(entries)) {
      return [];
    }

    return entries
      .map((entry) => {
        const id = String(entry?.id || '').trim();
        if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
          return null;
        }

        return {
          id,
          start: normalizeYoutubeStart(entry?.start)
        };
      })
      .filter(Boolean);
  }

  function formatYoutubeEntriesForEdit(entries) {
    return normalizeSongYoutubeEntries(entries)
      .map((entry) => (entry.start > 0 ? `${entry.id}?t=${entry.start}` : entry.id))
      .join('\n');
  }

  global.ChordWikiSongUtils = Object.freeze({
    normalizeTextBlock,
    normalizeSongTags,
    normalizeTagsInput,
    normalizeYoutubeStart,
    extractYoutubeId,
    extractYoutubeStart,
    validateYoutubeLine,
    parseYoutubeLine,
    parseYoutubeTextareaDetailed,
    parseYoutubeTextarea,
    validateYoutubeTextarea,
    normalizeSongYoutubeEntries,
    formatYoutubeEntriesForEdit,
    formatYoutubeEntries: formatYoutubeEntriesForEdit
  });
})(window);
