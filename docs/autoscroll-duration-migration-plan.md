# Autoscroll Migration Plan (Pre-Implementation)

## 1. Goal

Port two capabilities from Chordwiki-AutoScroller into chordwiki_personal song page:

1. Highlight overlay during auto-scroll playback.
2. Duration estimation providers with fallback order:
   - iTunes
   - MusicBrainz
   - YouTube

This document is design-only. No implementation is included.

## 2. Constraints and Non-Goals

- Keep existing chordwiki_personal architecture (Azure Functions + frontend static JS).
- Do not use title/artist extraction from `{t:}` or `{s:}` tags.
- Use song metadata from DB (`song.title`, `song.artist`) directly.
- Do not move to browser-extension style architecture.
- Do not change existing marker model, variable-scroll model, or storage schema version in this phase.

## 3. Current State Summary

### 3.1 Frontend

- Auto-scroll controls exist in song page side panel.
- YouTube-only estimation function exists in `frontend/js/song-autoscroll.js`.
- Estimation is triggered from song render flow (`renderLoadedSong`).

### 3.2 Backend

- Existing API endpoint:
  - `GET /api/youtube/search-duration`
- No iTunes or MusicBrainz endpoints yet.

## 4. Target Architecture

### 4.1 New API strategy

Introduce one unified endpoint for duration estimation:

- `GET /api/duration/estimate?title=...&artist=...`

Server-side provider order:

1. iTunes search API
2. MusicBrainz recording search API
3. Existing YouTube scoring logic
4. Default fallback (not found)

### 4.2 Response shape (proposed)

```json
{
  "found": true,
  "durationSec": 262,
  "source": "itunes",
  "query": "song title artist",
  "diagnostics": {
    "providersTried": ["itunes"],
    "providerHits": {
      "itunes": true,
      "musicbrainz": false,
      "youtube": false
    }
  }
}
```

When no hit:

```json
{
  "found": false,
  "source": "default",
  "durationSec": null,
  "query": "song title artist",
  "diagnostics": {
    "providersTried": ["itunes", "musicbrainz", "youtube"]
  }
}
```

Notes:

- `source` values: `itunes | musicbrainz | youtube | default`
- Keep diagnostics optional (can be omitted in production response if needed).

## 5. Provider Matching Rules (Design)

### 5.1 iTunes

- Request: `https://itunes.apple.com/search?term=<title artist>&entity=song&limit=5`
- Pick first candidate with positive `trackTimeMillis`.
- Optional hardening (recommended):
  - Basic token overlap checks on title/artist.

### 5.2 MusicBrainz

- Request recordings endpoint with escaped query.
- Include explicit `User-Agent` header.
- Pick first candidate with positive `length` (ms).
- Optional hardening (recommended):
  - Basic token overlap checks to reduce false positives.

### 5.3 YouTube

- Reuse existing parser/scorer from `api/youtube-search-duration/index.js`.
- Make it callable as shared helper from the unified endpoint.

## 6. Frontend Integration Plan

### 6.1 Duration estimation call

- Replace direct call to `/api/youtube/search-duration` with unified endpoint.
- Keep current gate behavior:
  - estimate only once per page load.
  - estimate only when displayed/default duration is in default range.
- Keep existing bias application unless explicitly changed later.

### 6.2 Status text update

Current style: `Estimated ... YouTube reference`

Target style:

- `Estimated ... iTunes`
- `Estimated ... MusicBrainz`
- `Estimated ... YouTube`
- fallback remains warning/info as existing UX policy.

## 7. Highlight Overlay Port Plan

### 7.1 UI elements (song page)

Add to song page controls:

- Highlight toggle checkbox (`autoscroll-highlight-toggle`)

Add to stage layer:

- Overlay element (`autoscroll-focus-overlay`)

### 7.2 Runtime behavior

- Overlay visible only when:
  - auto-scroll is playing
  - highlight toggle is enabled
  - marker range and scrollable range satisfy minimum thresholds
- Overlay geometry follows viewport and marker-driven focus area.
- During lead-in and end phase, preserve current playback behavior first; overlay animation tuning can be incremental.

### 7.3 Persistence

Store highlight enabled/disabled in existing auto-scroll storage payload for each song key.
Default: enabled.

## 8. Proposed File-Level Change Map (for next implementation phase)

Backend:

- `api/duration-estimate/function.json` (new)
- `api/duration-estimate/index.js` (new)
- `api/shared/duration-providers.js` (new helper for iTunes/MusicBrainz/YouTube composition)
- `api/youtube-search-duration/index.js` (refactor: extract reusable YouTube candidate logic)

Frontend:

- `frontend/song.html` (add highlight toggle + overlay element)
- `frontend/css/chordwiki-song.css` (overlay and toggle styles)
- `frontend/js/song-autoscroll.js` (overlay state/geometry + unified endpoint call + source labels)
- `frontend/js/song-core.js` (if needed: keep invocation point unchanged; no regex metadata extraction)

Docs:

- `ChordWiki-Architecture.md` (update API route and provider order)
- `USER_GUIDE.md` (add highlight toggle and provider precedence notes)

## 9. Risk List

1. False-positive matches on iTunes/MusicBrainz if candidate validation is too weak.
2. Additional external API latency due to serial fallback.
3. Highlight overlay may visually conflict with annotations/sticky notes.
4. Existing playback resync edge cases can reappear if overlay updates are coupled too tightly to scroll loop.

## 10. Mitigations

1. Add lightweight token overlap checks before accepting provider hit.
2. Add per-provider timeout (e.g. 2s to 3s) and abort controller.
3. Keep overlay purely visual; do not change marker/timeline calculations in first pass.
4. Add feature flag constants in frontend for easy rollback.

## 11. Acceptance Criteria (Design)

1. Duration lookup order is strictly iTunes -> MusicBrainz -> YouTube.
2. No title/artist regex extraction from chord text tags is used.
3. Source label shown to user reflects actual winning provider.
4. Highlight overlay can be toggled and persists per song.
5. Existing auto-scroll controls, markers, and speed behaviors remain unchanged.
