(function attachChordWikiApiUtils(global) {
  function buildApiUrl(path) {
    return global.ChordWikiRuntime?.buildApiUrl?.(path) || path;
  }

  function buildSongApiUrl(artist, id) {
    const params = new URLSearchParams();
    params.set('artist', String(artist || '').trim());
    params.set('id', String(id || '').trim());
    return buildApiUrl(`/api/song?${params.toString()}`);
  }

  function buildEditSongApiUrl(artist, id) {
    const params = new URLSearchParams();
    params.set('artist', String(artist || '').trim());
    params.set('id', String(id || '').trim());
    return buildApiUrl(`/api/edit/song?${params.toString()}`);
  }

  function buildSongUrl(artist, id) {
    return `/song.html?artist=${encodeURIComponent(String(artist || '').trim())}&id=${encodeURIComponent(String(id || '').trim())}`;
  }

  function getErrorDetail(payload, fallback = '処理に失敗しました。') {
    return payload?.error?.detail || payload?.detail || payload?.error || fallback;
  }

  async function parseJsonResponse(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  // chordwiki_personal では認証は SWA の MS アカウントが処理するため、
  // handleUnauthorized は常に false を返すスタブとして提供する。
  function handleUnauthorized(_response) {
    return false;
  }

  global.ChordWikiApiUtils = Object.freeze({
    buildApiUrl,
    buildSongApiUrl,
    buildEditSongApiUrl,
    buildSongUrl,
    getErrorDetail,
    parseJsonResponse,
    handleUnauthorized
  });
})(window);
