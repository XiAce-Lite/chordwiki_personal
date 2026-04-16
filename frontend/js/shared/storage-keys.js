(function attachChordWikiStorageKeys(global) {
  const KEYS = Object.freeze({
    AUTO_SCROLL_STORAGE_PREFIX: 'autoscroll:v1',
    SONG_PREFS_STORAGE_PREFIX: 'prefs:v1',
    STICKY_NOTES_STORAGE_PREFIX: 'annotations:v1',
    INK_STORAGE_PREFIX: 'annotations-ink:v1',
    AUTO_SCROLL_COLLAPSED_STORAGE_KEY: 'autoscrollCollapsed',
    SONG_EXTRAS_COLLAPSED_STORAGE_KEY: 'songExtrasCollapsed',
    DISPLAY_PREFS_STORAGE_KEY: 'displayPrefs:v1',
    DISPLAY_PREFS_COLLAPSED_STORAGE_KEY: 'displayPrefsCollapsed',
    AUTOSCROLL_SECTION_COLLAPSED_STORAGE_KEY: 'autoscrollSectionCollapsed',
    TRANSPOSE_NOTATION_COLLAPSED_STORAGE_KEY: 'transposeNotationCollapsed',
    ANNOTATION_SECTION_COLLAPSED_STORAGE_KEY: 'annotationSectionCollapsed',
    INK_TOOLBAR_COLLAPSED_STORAGE_KEY: 'inkToolbarCollapsed',
    INK_COLOR_STORAGE_KEY: 'inkColorPreference',
    INK_WIDTH_STORAGE_KEY: 'inkWidthPreference'
  });

  function buildSongScopedKey(prefix, artist, id) {
    return `${prefix}:${artist}:${id}`;
  }

  global.ChordWikiStorageKeys = Object.freeze({
    ...KEYS,
    buildSongScopedKey
  });
})(window);