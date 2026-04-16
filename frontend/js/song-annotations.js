const {
  STICKY_NOTES_STORAGE_PREFIX = 'annotations:v1',
  INK_STORAGE_PREFIX = 'annotations-ink:v1',
  AUTOSCROLL_SECTION_COLLAPSED_STORAGE_KEY = 'autoscrollSectionCollapsed',
  TRANSPOSE_NOTATION_COLLAPSED_STORAGE_KEY = 'transposeNotationCollapsed',
  ANNOTATION_SECTION_COLLAPSED_STORAGE_KEY = 'annotationSectionCollapsed',
  INK_TOOLBAR_COLLAPSED_STORAGE_KEY = 'inkToolbarCollapsed',
  INK_COLOR_STORAGE_KEY = 'inkColorPreference',
  INK_WIDTH_STORAGE_KEY = 'inkWidthPreference',
  buildSongScopedKey = (prefix, artist, id) => `${prefix}:${artist}:${id}`
} = window.ChordWikiStorageKeys || {};
const DEFAULT_NOTE_W = 240;
const DEFAULT_NOTE_H = 180;
const DEFAULT_NOTE_COLOR = '#fff3a6';
const DEFAULT_INK_COLOR = '#111111';
const DEFAULT_INK_WIDTH = 4;
const MIN_INK_WIDTH = Math.max(1, DEFAULT_INK_WIDTH / 2);
const MAX_INK_WIDTH = DEFAULT_INK_WIDTH;
const INK_PRESET_COLORS = ['#111111', '#d32f2f', '#1976d2', '#2e7d32', '#7b1fa2', '#f57c00'];
const MIN_NOTE_W = 208;
const MIN_NOTE_H = 108;

const songAnnotationsState = {
  songKey: '',
  artist: '',
  songId: '',
  notes: [],
  noteDrafts: new Map(),
  strokes: [],
  selectedStrokeId: '',
  inkModeEnabled: false,
  inkPinned: true,
  inkToolbarCollapsed: true,
  inkColor: DEFAULT_INK_COLOR,
  inkWidth: MIN_INK_WIDTH,
  dragSession: null,
  resizeSession: null,
  drawingSession: null,
  pendingDeleteNoteId: ''
};

function buildSongAnnotationKey(artist = '', id = '') {
  return `${String(artist || '').trim()}::${String(id || '').trim()}`;
}

function getSongAnnotationIdentity({ artist, id } = {}) {
  const resolvedArtist = String(artist || currentSongData?.artist || getQueryParam('artist') || '').trim();
  const resolvedId = String(id || currentSongData?.id || getQueryParam('id') || '').trim();
  return {
    artist: resolvedArtist,
    id: resolvedId,
    key: buildSongAnnotationKey(resolvedArtist, resolvedId)
  };
}

function getStickyNotesStorageKey(artist = '', id = '') {
  return buildSongScopedKey(STICKY_NOTES_STORAGE_PREFIX, artist, id);
}

function getInkStorageKey(artist = '', id = '') {
  return buildSongScopedKey(INK_STORAGE_PREFIX, artist, id);
}

function persistInkToolPreferences() {
  try {
    window.localStorage.setItem(INK_COLOR_STORAGE_KEY, normalizeAnnotationColor(songAnnotationsState.inkColor, DEFAULT_INK_COLOR));
    window.localStorage.setItem(INK_WIDTH_STORAGE_KEY, String(Math.round((songAnnotationsState.inkWidth || MIN_INK_WIDTH) * 10) / 10));
  } catch (error) {
    console.warn('Failed to store handwriting tool preferences:', error);
  }
}

function restoreInkToolPreferences() {
  try {
    const storedColor = window.localStorage.getItem(INK_COLOR_STORAGE_KEY);
    const storedWidth = window.localStorage.getItem(INK_WIDTH_STORAGE_KEY);

    if (storedColor) {
      songAnnotationsState.inkColor = normalizeAnnotationColor(storedColor, DEFAULT_INK_COLOR);
    }

    if (storedWidth !== null && storedWidth !== '') {
      const safeWidth = Math.max(MIN_INK_WIDTH, Math.min(MAX_INK_WIDTH, Number(storedWidth) || MIN_INK_WIDTH));
      songAnnotationsState.inkWidth = Math.round(safeWidth * 10) / 10;
    }
  } catch (error) {
    console.warn('Failed to restore handwriting tool preferences:', error);
  }
}

function sanitizeFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAnnotationColor(value, fallback = DEFAULT_NOTE_COLOR) {
  const text = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : fallback;
}

function darkenAnnotationColor(value, amount = 0.18) {
  const safe = normalizeAnnotationColor(value, DEFAULT_NOTE_COLOR);
  const ratio = Math.min(0.85, Math.max(0, Number(amount) || 0));
  const channels = [1, 3, 5].map((startIndex) => {
    const base = Number.parseInt(safe.slice(startIndex, startIndex + 2), 16);
    return Math.max(0, Math.min(255, Math.round(base * (1 - ratio))));
  });

  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function createStickyNoteId() {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createInkStrokeId() {
  return `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStickyNote(note = {}) {
  const noteId = String(note?.id || '').trim() || createStickyNoteId();
  return {
    id: noteId,
    x: sanitizeFiniteNumber(note?.x, 0),
    y: sanitizeFiniteNumber(note?.y, 0),
    width: Math.max(MIN_NOTE_W, sanitizeFiniteNumber(note?.width, DEFAULT_NOTE_W)),
    height: Math.max(MIN_NOTE_H, sanitizeFiniteNumber(note?.height, DEFAULT_NOTE_H)),
    title: String(note?.title || '').slice(0, 200),
    text: String(note?.text || '').slice(0, 5000),
    color: normalizeAnnotationColor(note?.color),
    pinned: Boolean(note?.pinned),
    minimized: Boolean(note?.minimized),
    updatedAt: Math.max(0, Math.trunc(sanitizeFiniteNumber(note?.updatedAt, Date.now())))
  };
}

function normalizeInkPoint(point = {}) {
  return {
    x: sanitizeFiniteNumber(point?.x, 0),
    y: sanitizeFiniteNumber(point?.y, 0),
    pressure: Number.isFinite(Number(point?.pressure)) ? Number(point.pressure) : undefined
  };
}

function normalizeInkStroke(stroke = {}) {
  const points = Array.isArray(stroke?.points)
    ? stroke.points.map(normalizeInkPoint).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    : [];

  if (!points.length) {
    return null;
  }

  return {
    id: String(stroke?.id || '').trim() || createInkStrokeId(),
    points,
    color: normalizeAnnotationColor(stroke?.color, DEFAULT_INK_COLOR),
    width: Math.max(1, sanitizeFiniteNumber(stroke?.width, DEFAULT_INK_WIDTH)),
    pinned: Boolean(stroke?.pinned),
    createdAt: Math.max(0, Math.trunc(sanitizeFiniteNumber(stroke?.createdAt, Date.now())))
  };
}

function serializeInkStroke(stroke = {}) {
  const normalized = normalizeInkStroke(stroke);
  if (!normalized) {
    return null;
  }

  return {
    id: normalized.id,
    points: normalized.points.map((point) => ({
      x: Math.round(point.x * 100) / 100,
      y: Math.round(point.y * 100) / 100,
      ...(typeof point.pressure === 'number' ? { pressure: Math.round(point.pressure * 100) / 100 } : {})
    })),
    color: normalizeAnnotationColor(normalized.color, DEFAULT_INK_COLOR),
    width: Math.max(1, Math.round((normalized.width || DEFAULT_INK_WIDTH) * 100) / 100),
    pinned: Boolean(normalized.pinned),
    createdAt: Math.max(0, Math.trunc(normalized.createdAt || Date.now()))
  };
}

function loadStickyNotesFromStorage(artist = '', id = '') {
  if (!artist || !id) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(getStickyNotesStorageKey(artist, id));
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map(normalizeStickyNote) : [];
  } catch (error) {
    console.warn('Failed to load sticky notes:', error);
    return [];
  }
}

function loadInkStrokesFromStorage(artist = '', id = '') {
  if (!artist || !id) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(getInkStorageKey(artist, id));
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) {
      return [];
    }

    let migrated = false;
    const strokes = parsed.map((stroke) => {
      const normalized = normalizeInkStroke(stroke);
      if (!normalized) {
        migrated = true;
        return null;
      }

      if (normalized.id !== String(stroke?.id || '').trim()) {
        migrated = true;
      }

      return normalized;
    }).filter(Boolean);

    if (migrated) {
      const payload = strokes.map(serializeInkStroke).filter(Boolean);
      window.localStorage.setItem(getInkStorageKey(artist, id), JSON.stringify(payload));
    }

    return strokes;
  } catch (error) {
    console.warn('Failed to load ink strokes:', error);
    return [];
  }
}

function saveStickyNotesToStorage() {
  const identity = getSongAnnotationIdentity({
    artist: songAnnotationsState.artist,
    id: songAnnotationsState.songId
  });
  if (!identity.artist || !identity.id) {
    return;
  }

  songAnnotationsState.artist = identity.artist;
  songAnnotationsState.songId = identity.id;
  songAnnotationsState.songKey = identity.key;

  try {
    const payload = songAnnotationsState.notes.map((note) => ({
      id: note.id,
      x: Math.round(note.x),
      y: Math.round(note.y),
      width: Math.round(note.width),
      height: Math.round(note.height),
      title: String(note.title || ''),
      text: String(note.text || ''),
      color: normalizeAnnotationColor(note.color),
      pinned: Boolean(note.pinned),
      minimized: Boolean(note.minimized),
      updatedAt: Math.max(0, Math.trunc(note.updatedAt || Date.now()))
    }));
    window.localStorage.setItem(getStickyNotesStorageKey(identity.artist, identity.id), JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to save sticky notes:', error);
  }
}

function saveInkStrokesToStorage() {
  const identity = getSongAnnotationIdentity({
    artist: songAnnotationsState.artist,
    id: songAnnotationsState.songId
  });
  if (!identity.artist || !identity.id) {
    return;
  }

  songAnnotationsState.artist = identity.artist;
  songAnnotationsState.songId = identity.id;
  songAnnotationsState.songKey = identity.key;

  try {
    const payload = songAnnotationsState.strokes.map(serializeInkStroke).filter(Boolean);
    window.localStorage.setItem(getInkStorageKey(identity.artist, identity.id), JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to save ink strokes:', error);
  }
}

function getViewportAnnotationLayer() {
  return document.getElementById('annotation-viewport-layer');
}

function getViewportStickyNotesLayer() {
  return document.getElementById('sticky-note-viewport-layer');
}

function getViewportInkLayer() {
  return document.getElementById('annotation-ink-viewport');
}

function ensureViewportAnnotationLayer() {
  let root = getViewportAnnotationLayer();
  if (!root) {
    root = document.createElement('div');
    root.id = 'annotation-viewport-layer';
    root.className = 'annotation-viewport-layer';

    const inkLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    inkLayer.id = 'annotation-ink-viewport';
    inkLayer.classList.add('annotation-ink-layer', 'annotation-ink-viewport');
    inkLayer.dataset.pinned = '1';
    inkLayer.setAttribute('aria-hidden', 'true');
    inkLayer.addEventListener('pointerdown', handleInkPointerDown);

    const notesLayer = document.createElement('div');
    notesLayer.id = 'sticky-note-viewport-layer';
    notesLayer.className = 'sticky-note-viewport-layer';

    root.appendChild(inkLayer);
    root.appendChild(notesLayer);
    document.body.appendChild(root);
  }

  return root;
}

function getSheetAnnotationRoot() {
  return document.getElementById('sheet-annotation-root');
}

function getSheetStickyNotesLayer() {
  return document.getElementById('sticky-note-sheet-layer');
}

function getSheetInkLayer() {
  return document.getElementById('annotation-ink-sheet');
}

function ensureSheetAnnotationRoot() {
  const sheetEl = getSheetEl();
  if (!sheetEl) {
    return null;
  }

  let root = getSheetAnnotationRoot();
  if (!root || root.parentElement !== sheetEl) {
    root = document.createElement('div');
    root.id = 'sheet-annotation-root';
    root.className = 'sheet-annotation-root';

    const inkLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    inkLayer.id = 'annotation-ink-sheet';
    inkLayer.classList.add('annotation-ink-layer', 'annotation-ink-sheet');
    inkLayer.dataset.pinned = '0';
    inkLayer.setAttribute('aria-hidden', 'true');
    inkLayer.addEventListener('pointerdown', handleInkPointerDown);

    const notesLayer = document.createElement('div');
    notesLayer.id = 'sticky-note-sheet-layer';
    notesLayer.className = 'sticky-note-sheet-layer';

    root.appendChild(inkLayer);
    root.appendChild(notesLayer);
    sheetEl.appendChild(root);
  }

  syncInkLayerSize();
  return root;
}

function syncInkLayerSize() {
  const sheetEl = getSheetEl();
  const sheetInk = getSheetInkLayer();
  const viewportInk = getViewportInkLayer();

  if (sheetEl && sheetInk) {
    const width = Math.max(sheetEl.scrollWidth, sheetEl.clientWidth, 1);
    const height = Math.max(sheetEl.scrollHeight, sheetEl.clientHeight, 1);
    sheetInk.setAttribute('viewBox', `0 0 ${width} ${height}`);
    sheetInk.setAttribute('width', String(width));
    sheetInk.setAttribute('height', String(height));
  }

  if (viewportInk) {
    const width = Math.max(window.innerWidth || 1, document.documentElement?.clientWidth || 1);
    const height = Math.max(window.innerHeight || 1, document.documentElement?.clientHeight || 1);
    viewportInk.setAttribute('viewBox', `0 0 ${width} ${height}`);
    viewportInk.setAttribute('width', String(width));
    viewportInk.setAttribute('height', String(height));
  }
}

function clearSongAnnotationsFromUi() {
  const sheetRoot = getSheetAnnotationRoot();
  const viewportLayer = getViewportAnnotationLayer();

  if (sheetRoot) {
    sheetRoot.remove();
  }

  if (viewportLayer) {
    viewportLayer.remove();
  }
}

function refreshSongAnnotationsAfterRender({ artist, id, reloadFromStorage = false } = {}) {
  const identity = getSongAnnotationIdentity({ artist, id });
  ensureViewportAnnotationLayer();
  ensureSheetAnnotationRoot();

  if (!identity.artist || !identity.id) {
    songAnnotationsState.songKey = '';
    songAnnotationsState.artist = '';
    songAnnotationsState.songId = '';
    songAnnotationsState.notes = [];
    songAnnotationsState.strokes = [];
    songAnnotationsState.selectedStrokeId = '';
    songAnnotationsState.noteDrafts.clear();
    renderStickyNotes();
    renderInkStrokes();
    updateInkControlsUi();
    return;
  }

  const changed = songAnnotationsState.songKey !== identity.key;
  if (reloadFromStorage || changed) {
    songAnnotationsState.songKey = identity.key;
    songAnnotationsState.artist = identity.artist;
    songAnnotationsState.songId = identity.id;
    songAnnotationsState.notes = loadStickyNotesFromStorage(identity.artist, identity.id);
    songAnnotationsState.strokes = loadInkStrokesFromStorage(identity.artist, identity.id);
    songAnnotationsState.selectedStrokeId = '';
    songAnnotationsState.noteDrafts.clear();
  }

  syncInkLayerSize();
  renderStickyNotes();
  renderInkStrokes();
  updateInkControlsUi();
}

function findStickyNoteById(noteId = '') {
  return songAnnotationsState.notes.find((note) => note.id === noteId) || null;
}

function getStickyNoteDraft(noteId = '') {
  return songAnnotationsState.noteDrafts.get(noteId) || null;
}

function findInkStrokeById(strokeId = '') {
  return songAnnotationsState.strokes.find((stroke) => stroke.id === strokeId) || null;
}

function setSelectedInkStroke(strokeId = '') {
  const nextId = String(strokeId || '').trim();
  const resolvedId = nextId && songAnnotationsState.strokes.some((stroke) => stroke.id === nextId) ? nextId : '';
  if (songAnnotationsState.selectedStrokeId === resolvedId) {
    return;
  }

  songAnnotationsState.selectedStrokeId = resolvedId;
  renderInkStrokes();
  updateInkControlsUi();
}

function getDistanceFromPointToSegment(point, segmentStart, segmentEnd) {
  const x1 = sanitizeFiniteNumber(segmentStart?.x, 0);
  const y1 = sanitizeFiniteNumber(segmentStart?.y, 0);
  const x2 = sanitizeFiniteNumber(segmentEnd?.x, x1);
  const y2 = sanitizeFiniteNumber(segmentEnd?.y, y1);
  const px = sanitizeFiniteNumber(point?.x, 0);
  const py = sanitizeFiniteNumber(point?.y, 0);
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return Math.hypot(px - x1, py - y1);
  }

  const projection = ((px - x1) * dx + (py - y1) * dy) / ((dx * dx) + (dy * dy));
  const t = Math.max(0, Math.min(1, projection));
  const closestX = x1 + (dx * t);
  const closestY = y1 + (dy * t);
  return Math.hypot(px - closestX, py - closestY);
}

function pickInkStrokeAtPoint(point, pinned = false) {
  const candidates = [];

  for (let index = songAnnotationsState.strokes.length - 1; index >= 0; index -= 1) {
    const stroke = songAnnotationsState.strokes[index];
    if (Boolean(stroke?.pinned) !== Boolean(pinned)) {
      continue;
    }

    const threshold = Math.max(8, (Number(stroke?.width) || DEFAULT_INK_WIDTH) * 1.4 + 5);
    let minDistance = Number.POSITIVE_INFINITY;
    const strokePoints = Array.isArray(stroke?.points) ? stroke.points : [];

    for (let pointIndex = 0; pointIndex < strokePoints.length - 1; pointIndex += 1) {
      const distance = getDistanceFromPointToSegment(point, strokePoints[pointIndex], strokePoints[pointIndex + 1]);
      if (distance < minDistance) {
        minDistance = distance;
      }
      if (minDistance <= threshold) {
        break;
      }
    }

    if (!Number.isFinite(minDistance) && strokePoints[0]) {
      minDistance = Math.hypot(point.x - strokePoints[0].x, point.y - strokePoints[0].y);
    }

    if (minDistance <= threshold) {
      candidates.push(stroke);
    }
  }

  if (!candidates.length) {
    return null;
  }

  const selectedIndex = candidates.findIndex((stroke) => stroke.id === songAnnotationsState.selectedStrokeId);
  if (selectedIndex >= 0 && candidates.length > 1) {
    return candidates[(selectedIndex + 1) % candidates.length];
  }

  return candidates[0];
}

function setStickyNoteDraft(noteId, draft = null) {
  if (!noteId) {
    return;
  }

  if (!draft) {
    songAnnotationsState.noteDrafts.delete(noteId);
    return;
  }

  songAnnotationsState.noteDrafts.set(noteId, {
    title: String(draft.title || ''),
    text: String(draft.text || '')
  });
}

function enterStickyNoteEditMode(noteId, { focusBody = false } = {}) {
  const note = findStickyNoteById(noteId);
  if (!note) {
    return;
  }

  setStickyNoteDraft(noteId, {
    title: note.title,
    text: note.text
  });
  renderStickyNotes();

  if (focusBody) {
    window.requestAnimationFrame(() => {
      const textarea = document.querySelector(`.sticky-note[data-note-id="${CSS.escape(noteId)}"] .sticky-note-textarea`);
      textarea?.focus();
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }
}

function cancelStickyNoteEdit(noteId) {
  setStickyNoteDraft(noteId, null);
  renderStickyNotes();
}

function saveStickyNoteEdit(noteId) {
  const note = findStickyNoteById(noteId);
  const draft = getStickyNoteDraft(noteId);
  if (!note || !draft) {
    return;
  }

  note.title = draft.title.trim();
  note.text = draft.text;
  note.updatedAt = Date.now();
  setStickyNoteDraft(noteId, null);
  saveStickyNotesToStorage();
  renderStickyNotes();
}

function copyStickyNoteText(noteId) {
  const note = findStickyNoteById(noteId);
  if (!note) {
    return;
  }

  const payload = String(note.text || '').trim();
  if (!payload) {
    return;
  }

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(payload).catch((error) => {
      console.warn('Failed to copy note text:', error);
    });
    return;
  }

  const temp = document.createElement('textarea');
  temp.value = payload;
  temp.setAttribute('readonly', 'readonly');
  temp.style.position = 'fixed';
  temp.style.opacity = '0';
  document.body.appendChild(temp);
  temp.select();
  try {
    document.execCommand('copy');
  } catch (error) {
    console.warn('Failed to copy note text:', error);
  }
  temp.remove();
}

function openStickyNoteDeleteDialog(noteId) {
  const modal = document.getElementById('sticky-note-delete-modal');
  const cancelButton = document.getElementById('sticky-note-delete-cancel');
  if (!modal) {
    const confirmed = window.confirm('このメモを削除しますか？');
    if (confirmed) {
      deleteStickyNote(noteId);
    }
    return;
  }

  songAnnotationsState.pendingDeleteNoteId = noteId;
  modal.hidden = false;
  window.requestAnimationFrame(() => cancelButton?.focus());
}

function closeStickyNoteDeleteDialog({ confirmed = false } = {}) {
  const modal = document.getElementById('sticky-note-delete-modal');
  const pendingId = songAnnotationsState.pendingDeleteNoteId;
  songAnnotationsState.pendingDeleteNoteId = '';

  if (modal) {
    modal.hidden = true;
  }

  if (confirmed && pendingId) {
    deleteStickyNote(pendingId);
  }
}

function deleteStickyNote(noteId) {
  const nextNotes = songAnnotationsState.notes.filter((note) => note.id !== noteId);
  if (nextNotes.length === songAnnotationsState.notes.length) {
    return;
  }

  songAnnotationsState.notes = nextNotes;
  setStickyNoteDraft(noteId, null);
  saveStickyNotesToStorage();
  renderStickyNotes();
}

function getStickyNoteInitialPosition() {
  const viewportCenterX = Math.max(0, window.innerWidth / 2);
  const viewportCenterY = Math.max(0, window.innerHeight / 2);
  return {
    x: Math.round(viewportCenterX - (DEFAULT_NOTE_W / 2)),
    y: Math.round(viewportCenterY - (DEFAULT_NOTE_H / 2))
  };
}

function createStickyNote() {
  const identity = getSongAnnotationIdentity();
  if (!identity.artist || !identity.id) {
    return;
  }

  songAnnotationsState.artist = identity.artist;
  songAnnotationsState.songId = identity.id;
  songAnnotationsState.songKey = identity.key;

  const initialPos = getStickyNoteInitialPosition();
  const note = normalizeStickyNote({
    id: createStickyNoteId(),
    x: initialPos.x,
    y: initialPos.y,
    width: DEFAULT_NOTE_W,
    height: DEFAULT_NOTE_H,
    title: '',
    text: '',
    color: DEFAULT_NOTE_COLOR,
    pinned: false,
    minimized: false,
    updatedAt: Date.now()
  });

  songAnnotationsState.notes.push(note);
  saveStickyNotesToStorage();
  renderStickyNotes();
}

function setStickyNoteColor(noteId, color) {
  const note = findStickyNoteById(noteId);
  if (!note) {
    return;
  }

  note.color = normalizeAnnotationColor(color, DEFAULT_NOTE_COLOR);
  note.updatedAt = Date.now();
  saveStickyNotesToStorage();
  renderStickyNotes();
}

function toggleStickyNotePinned(noteId) {
  const note = findStickyNoteById(noteId);
  const sheetEl = getSheetEl();
  if (!note || !sheetEl) {
    return;
  }

  const sheetRect = sheetEl.getBoundingClientRect();
  if (note.pinned) {
    note.x = Math.round(sheetRect.left + note.x);
    note.y = Math.round(sheetRect.top + note.y);
    note.pinned = false;
  } else {
    note.x = Math.round(note.x - sheetRect.left);
    note.y = Math.round(note.y - sheetRect.top);
    note.pinned = true;
  }

  note.updatedAt = Date.now();
  saveStickyNotesToStorage();
  renderStickyNotes();
}

function toggleStickyNoteMinimized(noteId) {
  const note = findStickyNoteById(noteId);
  if (!note) {
    return;
  }

  note.minimized = !note.minimized;
  note.updatedAt = Date.now();
  if (note.minimized) {
    setStickyNoteDraft(noteId, null);
  }
  saveStickyNotesToStorage();
  renderStickyNotes();
}

function createMaterialIcon(name = '') {
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = name;
  return icon;
}

function createStickyNoteIconButton(iconName, label, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `sticky-note-icon-button${className ? ` ${className}` : ''}`;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.appendChild(createMaterialIcon(iconName));
  return button;
}

function formatStickyNoteTitle(note) {
  const title = String(note?.title || '').trim();
  return title || 'Memo';
}

function buildStickyNoteElement(note) {
  const noteEl = document.createElement('article');
  const draft = getStickyNoteDraft(note.id);
  noteEl.className = 'sticky-note';
  noteEl.dataset.noteId = note.id;
  noteEl.style.left = `${Math.round(note.x)}px`;
  noteEl.style.top = `${Math.round(note.y)}px`;
  noteEl.style.width = `${Math.round(note.width)}px`;
  noteEl.style.height = `${Math.round(note.height)}px`;
  noteEl.style.setProperty('--sticky-note-color', note.color);
  noteEl.style.setProperty('--sticky-note-active-bg', darkenAnnotationColor(note.color, 0.18));
  noteEl.style.setProperty('--sticky-note-active-border', darkenAnnotationColor(note.color, 0.32));
  noteEl.classList.toggle('is-pinned', note.pinned);
  noteEl.classList.toggle('is-minimized', note.minimized);
  noteEl.classList.toggle('is-editing', Boolean(draft));
  noteEl.addEventListener('click', (event) => event.stopPropagation());

  if (note.minimized && !draft) {
    const restoreButton = document.createElement('button');
    restoreButton.type = 'button';
    restoreButton.className = 'sticky-note-minimized-button';
    restoreButton.setAttribute('aria-label', 'メモを開く');
    restoreButton.title = 'メモを開く';
    restoreButton.appendChild(createMaterialIcon('sticky_note_2'));
    restoreButton.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleStickyNoteMinimized(note.id);
    });
    noteEl.appendChild(restoreButton);
    return noteEl;
  }

  const headerEl = document.createElement('div');
  headerEl.className = 'sticky-note-header';

  if (draft) {
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'sticky-note-title-input';
    titleInput.placeholder = 'タイトル';
    titleInput.value = draft.title;
    titleInput.addEventListener('input', () => {
      setStickyNoteDraft(note.id, {
        ...getStickyNoteDraft(note.id),
        title: titleInput.value,
        text: getStickyNoteDraft(note.id)?.text || ''
      });
    });
    titleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelStickyNoteEdit(note.id);
      }
    });
    headerEl.appendChild(titleInput);
  } else {
    const titleEl = document.createElement('div');
    titleEl.className = 'sticky-note-title';
    titleEl.textContent = formatStickyNoteTitle(note);
    headerEl.dataset.noteDragHandle = 'true';
    headerEl.appendChild(titleEl);
  }

  noteEl.appendChild(headerEl);

  if (draft) {
    const textarea = document.createElement('textarea');
    textarea.className = 'sticky-note-textarea';
    textarea.placeholder = 'ダブルクリックで編集';
    textarea.value = draft.text;
    textarea.addEventListener('input', () => {
      setStickyNoteDraft(note.id, {
        ...getStickyNoteDraft(note.id),
        title: getStickyNoteDraft(note.id)?.title || '',
        text: textarea.value
      });
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelStickyNoteEdit(note.id);
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveStickyNoteEdit(note.id);
      }
    });
    noteEl.appendChild(textarea);
  } else {
    const bodyEl = document.createElement('div');
    bodyEl.className = 'sticky-note-body';
    bodyEl.dataset.noteDragHandle = 'true';
    bodyEl.textContent = note.text || 'ダブルクリックで編集';
    if (!String(note.text || '').trim()) {
      bodyEl.classList.add('is-placeholder');
    }
    bodyEl.addEventListener('dblclick', () => enterStickyNoteEditMode(note.id, { focusBody: true }));
    noteEl.appendChild(bodyEl);
  }

  const controlsEl = document.createElement('div');
  controlsEl.className = 'sticky-note-controls';

  if (draft) {
    const saveButton = createStickyNoteIconButton('save', '保存');
    saveButton.addEventListener('click', () => saveStickyNoteEdit(note.id));

    const cancelButton = createStickyNoteIconButton('close', 'キャンセル');
    cancelButton.addEventListener('click', () => cancelStickyNoteEdit(note.id));

    controlsEl.append(saveButton, cancelButton);
  } else {
    const pinButton = createStickyNoteIconButton('push_pin', note.pinned ? '譜面固定を解除' : '譜面に固定', 'sticky-note-pin-button');
    pinButton.classList.toggle('is-active', note.pinned);
    pinButton.setAttribute('aria-pressed', String(note.pinned));
    pinButton.addEventListener('click', () => toggleStickyNotePinned(note.id));

    const editButton = createStickyNoteIconButton('edit', '編集');
    editButton.addEventListener('click', () => enterStickyNoteEditMode(note.id, { focusBody: true }));

    const copyButton = createStickyNoteIconButton('content_copy', '本文をコピー');
    copyButton.addEventListener('click', () => copyStickyNoteText(note.id));

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'sticky-note-color-input';
    colorInput.value = normalizeAnnotationColor(note.color, DEFAULT_NOTE_COLOR);
    colorInput.addEventListener('input', () => setStickyNoteColor(note.id, colorInput.value));

    const colorButton = createStickyNoteIconButton('palette', '背景色を変更');
    colorButton.addEventListener('click', () => colorInput.click());

    const deleteButton = createStickyNoteIconButton('delete', '削除');
    deleteButton.addEventListener('click', () => openStickyNoteDeleteDialog(note.id));

    controlsEl.append(pinButton, editButton, copyButton, colorButton, deleteButton, colorInput);
  }

  noteEl.appendChild(controlsEl);

  if (!draft) {
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'sticky-note-resize-handle';
    resizeHandle.title = 'サイズ変更';
    resizeHandle.setAttribute('aria-hidden', 'true');
    noteEl.appendChild(resizeHandle);
  }

  return noteEl;
}

function renderStickyNotes() {
  ensureViewportAnnotationLayer();
  ensureSheetAnnotationRoot();

  const sheetLayer = getSheetStickyNotesLayer();
  const viewportLayer = getViewportStickyNotesLayer();
  if (!sheetLayer || !viewportLayer) {
    return;
  }

  sheetLayer.innerHTML = '';
  viewportLayer.innerHTML = '';

  songAnnotationsState.notes.forEach((note) => {
    const noteEl = buildStickyNoteElement(note);
    if (note.pinned) {
      sheetLayer.appendChild(noteEl);
    } else {
      viewportLayer.appendChild(noteEl);
    }
  });
}

function startStickyNoteDrag(event, noteEl, note) {
  if (!noteEl || !note) {
    return;
  }

  const rect = noteEl.getBoundingClientRect();
  songAnnotationsState.dragSession = {
    noteId: note.id,
    noteEl,
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top
  };
  noteEl.classList.add('is-dragging');
}

function updateStickyNoteDragPosition(event) {
  const session = songAnnotationsState.dragSession;
  if (!session || session.pointerId !== event.pointerId) {
    return;
  }

  const note = findStickyNoteById(session.noteId);
  if (!note) {
    return;
  }

  if (note.pinned) {
    const sheetEl = getSheetEl();
    const sheetRect = sheetEl?.getBoundingClientRect();
    if (!sheetRect) {
      return;
    }
    note.x = event.clientX - sheetRect.left - session.offsetX;
    note.y = event.clientY - sheetRect.top - session.offsetY;
  } else {
    note.x = event.clientX - session.offsetX;
    note.y = event.clientY - session.offsetY;
  }

  session.noteEl.style.left = `${Math.round(note.x)}px`;
  session.noteEl.style.top = `${Math.round(note.y)}px`;
}

function finishStickyNoteDrag() {
  const session = songAnnotationsState.dragSession;
  if (!session) {
    return;
  }

  session.noteEl?.classList.remove('is-dragging');
  const note = findStickyNoteById(session.noteId);
  if (note) {
    note.updatedAt = Date.now();
    saveStickyNotesToStorage();
  }
  songAnnotationsState.dragSession = null;
}

function startStickyNoteResize(event, noteEl, note) {
  if (!noteEl || !note) {
    return;
  }

  const rect = noteEl.getBoundingClientRect();
  songAnnotationsState.resizeSession = {
    noteId: note.id,
    noteEl,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startWidth: rect.width,
    startHeight: rect.height
  };
  noteEl.classList.add('is-resizing');
}

function updateStickyNoteResize(event) {
  const session = songAnnotationsState.resizeSession;
  if (!session || session.pointerId !== event.pointerId) {
    return;
  }

  const note = findStickyNoteById(session.noteId);
  if (!note) {
    return;
  }

  const nextWidth = Math.max(MIN_NOTE_W, session.startWidth + (event.clientX - session.startClientX));
  const nextHeight = Math.max(MIN_NOTE_H, session.startHeight + (event.clientY - session.startClientY));
  note.width = nextWidth;
  note.height = nextHeight;
  session.noteEl.style.width = `${Math.round(nextWidth)}px`;
  session.noteEl.style.height = `${Math.round(nextHeight)}px`;
}

function finishStickyNoteResize() {
  const session = songAnnotationsState.resizeSession;
  if (!session) {
    return;
  }

  session.noteEl?.classList.remove('is-resizing');
  const note = findStickyNoteById(session.noteId);
  if (note) {
    note.updatedAt = Date.now();
    saveStickyNotesToStorage();
  }
  songAnnotationsState.resizeSession = null;
}

function buildStrokeSvg(stroke) {
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  const points = stroke.points.length === 1
    ? [stroke.points[0], stroke.points[0]]
    : stroke.points;

  polyline.setAttribute(
    'points',
    points.map((point) => `${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`).join(' ')
  );
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', normalizeAnnotationColor(stroke.color, DEFAULT_INK_COLOR));
  polyline.setAttribute('stroke-width', String(Math.max(1, stroke.width || DEFAULT_INK_WIDTH)));
  polyline.setAttribute('stroke-linecap', 'round');
  polyline.setAttribute('stroke-linejoin', 'round');
  polyline.classList.add('annotation-ink-stroke');
  if (stroke.id) {
    polyline.dataset.strokeId = stroke.id;
  }
  if (stroke.id && stroke.id === songAnnotationsState.selectedStrokeId) {
    polyline.classList.add('is-selected');
  }
  return polyline;
}

function renderInkStrokes() {
  ensureViewportAnnotationLayer();
  ensureSheetAnnotationRoot();
  syncInkLayerSize();

  if (songAnnotationsState.selectedStrokeId && !findInkStrokeById(songAnnotationsState.selectedStrokeId)) {
    songAnnotationsState.selectedStrokeId = '';
  }

  const sheetLayer = getSheetInkLayer();
  const viewportLayer = getViewportInkLayer();
  if (!sheetLayer || !viewportLayer) {
    return;
  }

  Array.from(sheetLayer.querySelectorAll('.annotation-ink-stroke')).forEach((strokeEl) => strokeEl.remove());
  Array.from(viewportLayer.querySelectorAll('.annotation-ink-stroke')).forEach((strokeEl) => strokeEl.remove());

  songAnnotationsState.strokes.forEach((stroke) => {
    const targetLayer = stroke.pinned ? sheetLayer : viewportLayer;
    targetLayer.appendChild(buildStrokeSvg(stroke));
  });
}

function getInkWidthChoices() {
  const midpoint = Math.round((((MIN_INK_WIDTH + MAX_INK_WIDTH) / 2) * 10)) / 10;
  return Array.from(new Set([MIN_INK_WIDTH, midpoint, MAX_INK_WIDTH]));
}

function closeInkFloatingPopovers() {
  const widthButton = document.getElementById('ink-width-button');
  const widthPalette = document.getElementById('ink-width-palette');
  const colorButton = document.getElementById('ink-color-button');
  const colorPalette = document.getElementById('ink-color-palette');

  widthPalette?.setAttribute('hidden', '');
  colorPalette?.setAttribute('hidden', '');
  widthButton?.setAttribute('aria-expanded', 'false');
  colorButton?.setAttribute('aria-expanded', 'false');
}

function renderInkWidthPalette() {
  const palette = document.getElementById('ink-width-palette');
  if (!palette) {
    return;
  }

  palette.innerHTML = '';
  getInkWidthChoices().forEach((width) => {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'ink-width-choice';
    choice.classList.toggle('is-active', Math.abs(width - songAnnotationsState.inkWidth) < 0.01);
    choice.setAttribute('aria-label', `太さ ${width}px`);
    choice.innerHTML = `
      <svg width="34" height="14" viewBox="0 0 34 14" aria-hidden="true">
        <line x1="4" y1="7" x2="30" y2="7" stroke="currentColor" stroke-width="${width}" stroke-linecap="round"></line>
      </svg>
      <span>${width}px</span>
    `;
    choice.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setInkWidth(width);
      closeInkFloatingPopovers();
    });
    palette.appendChild(choice);
  });
}

function renderInkColorPalette() {
  const palette = document.getElementById('ink-color-palette');
  const colorInput = document.getElementById('ink-color-input');
  if (!palette) {
    return;
  }

  palette.innerHTML = '';
  INK_PRESET_COLORS.forEach((color) => {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'ink-color-choice';
    choice.style.background = color;
    choice.setAttribute('aria-label', `色 ${color}`);
    choice.title = color;
    choice.classList.toggle('is-active', normalizeAnnotationColor(color, DEFAULT_INK_COLOR) === songAnnotationsState.inkColor);
    choice.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setInkColor(color);
      closeInkFloatingPopovers();
    });
    palette.appendChild(choice);
  });

  const customChoice = document.createElement('button');
  customChoice.type = 'button';
  customChoice.className = 'ink-color-choice is-custom';
  customChoice.setAttribute('aria-label', '別の色を選択');
  customChoice.appendChild(createMaterialIcon('tune'));
  customChoice.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeInkFloatingPopovers();

    if (!colorInput) {
      return;
    }

    try {
      if (typeof colorInput.showPicker === 'function') {
        colorInput.showPicker();
        return;
      }
    } catch (error) {
      // Fall back to click below when showPicker is unavailable.
    }

    colorInput.click();
  });
  palette.appendChild(customChoice);
}

function updateInkControlsUi() {
  const body = document.body;
  const floatingUi = document.getElementById('ink-floating-ui');
  const toggleButton = document.getElementById('ink-mode-toggle');
  const pinButton = document.getElementById('ink-pin-toggle');
  const widthButton = document.getElementById('ink-width-button');
  const colorButton = document.getElementById('ink-color-button');
  const colorInput = document.getElementById('ink-color-input');
  const undoButton = document.getElementById('ink-undo-button');
  const deleteButton = document.getElementById('ink-delete-button');
  const hint = document.getElementById('ink-mode-hint');
  const sheetInk = getSheetInkLayer();
  const viewportInk = getViewportInkLayer();
  const hasSelectedStroke = Boolean(songAnnotationsState.selectedStrokeId && findInkStrokeById(songAnnotationsState.selectedStrokeId));

  if (!hasSelectedStroke && songAnnotationsState.selectedStrokeId) {
    songAnnotationsState.selectedStrokeId = '';
  }

  body?.classList.toggle('ink-mode-enabled', songAnnotationsState.inkModeEnabled);
  floatingUi?.classList.toggle('is-collapsed', Boolean(songAnnotationsState.inkToolbarCollapsed));

  if (songAnnotationsState.inkToolbarCollapsed) {
    closeInkFloatingPopovers();
  }

  if (toggleButton) {
    toggleButton.classList.toggle('is-active', songAnnotationsState.inkModeEnabled);
    toggleButton.setAttribute('aria-pressed', String(songAnnotationsState.inkModeEnabled));
    toggleButton.setAttribute('aria-expanded', String(!songAnnotationsState.inkToolbarCollapsed));
    toggleButton.title = songAnnotationsState.inkModeEnabled ? '手書きモードを終了' : '手書きモードを開始';
    toggleButton.setAttribute('aria-label', songAnnotationsState.inkModeEnabled ? '手書きモードを終了' : '手書きモードを開始');
  }

  if (pinButton) {
    pinButton.classList.toggle('is-active', songAnnotationsState.inkPinned);
    pinButton.setAttribute('aria-pressed', String(songAnnotationsState.inkPinned));
    pinButton.title = songAnnotationsState.inkPinned ? '新しい手書き線は譜面固定' : '新しい手書き線は画面に固定';
    pinButton.setAttribute('aria-label', songAnnotationsState.inkPinned ? '新しい手書き線は譜面固定' : '新しい手書き線は画面に固定');
  }

  if (widthButton) {
    widthButton.title = `手書き太さ ${songAnnotationsState.inkWidth}px`;
    widthButton.setAttribute('aria-label', `手書き太さを変更 (${songAnnotationsState.inkWidth}px)`);
  }

  if (colorButton) {
    colorButton.style.setProperty('--annotation-ink-current-color', songAnnotationsState.inkColor || DEFAULT_INK_COLOR);
  }

  if (colorInput && colorInput.value !== (songAnnotationsState.inkColor || DEFAULT_INK_COLOR)) {
    colorInput.value = songAnnotationsState.inkColor || DEFAULT_INK_COLOR;
  }

  renderInkWidthPalette();
  renderInkColorPalette();

  if (undoButton) {
    undoButton.disabled = songAnnotationsState.strokes.length === 0;
  }

  if (deleteButton) {
    deleteButton.disabled = !hasSelectedStroke;
    deleteButton.title = hasSelectedStroke ? '選択した手書き線を削除' : '削除する線を選択';
    deleteButton.setAttribute('aria-label', hasSelectedStroke ? '選択した手書き線を削除' : '削除する線を選択');
  }

  if (hint) {
    hint.textContent = songAnnotationsState.inkModeEnabled
      ? `手書き中: ${songAnnotationsState.inkPinned ? '譜面に追従' : '画面固定'} / ${songAnnotationsState.inkColor || DEFAULT_INK_COLOR}${hasSelectedStroke ? ' / 1本選択中' : ''}`
      : '手書き OFF';
  }

  if (sheetInk) {
    sheetInk.classList.toggle('is-active', songAnnotationsState.inkModeEnabled && songAnnotationsState.inkPinned);
  }

  if (viewportInk) {
    viewportInk.classList.toggle('is-active', songAnnotationsState.inkModeEnabled && !songAnnotationsState.inkPinned);
  }
}

function setInkToolbarCollapsed(collapsed) {
  const nextCollapsed = Boolean(collapsed);

  if (nextCollapsed && songAnnotationsState.drawingSession) {
    finishInkDrawing();
  }

  songAnnotationsState.inkToolbarCollapsed = nextCollapsed;
  songAnnotationsState.inkModeEnabled = !nextCollapsed;
  if (nextCollapsed) {
    closeInkFloatingPopovers();
  }
  updateInkControlsUi();

  try {
    window.localStorage.setItem(INK_TOOLBAR_COLLAPSED_STORAGE_KEY, nextCollapsed ? '1' : '0');
  } catch (error) {
    console.warn('Failed to store handwriting toolbar state:', error);
  }

  window.requestAnimationFrame(() => {
    updateAutoScrollSafeTop?.();
    refreshSongExtrasLayout?.();
  });
}

function restoreInkToolbarCollapsedState() {
  try {
    setInkToolbarCollapsed(true);
  } catch (error) {
    console.warn('Failed to initialize handwriting toolbar state:', error);
    setInkToolbarCollapsed(true);
  }
}

function toggleInkMode(forceState) {
  const nextState = typeof forceState === 'boolean'
    ? forceState
    : Boolean(songAnnotationsState.inkToolbarCollapsed);
  setInkToolbarCollapsed(!nextState);
}

function toggleInkPinned() {
  songAnnotationsState.inkPinned = !songAnnotationsState.inkPinned;
  updateInkControlsUi();
}

function setInkWidth(width) {
  const safeWidth = Math.max(MIN_INK_WIDTH, Math.min(MAX_INK_WIDTH, Number(width) || MIN_INK_WIDTH));
  songAnnotationsState.inkWidth = Math.round(safeWidth * 10) / 10;
  persistInkToolPreferences();
  updateInkControlsUi();
}

function setInkColor(color) {
  songAnnotationsState.inkColor = normalizeAnnotationColor(color, DEFAULT_INK_COLOR);
  persistInkToolPreferences();
  updateInkControlsUi();
}

function toggleInkPalette(type = 'color') {
  const isWidth = type === 'width';
  const button = document.getElementById(isWidth ? 'ink-width-button' : 'ink-color-button');
  const palette = document.getElementById(isWidth ? 'ink-width-palette' : 'ink-color-palette');
  if (!button || !palette || songAnnotationsState.inkToolbarCollapsed) {
    return;
  }

  const shouldOpen = palette.hasAttribute('hidden');
  closeInkFloatingPopovers();

  if (shouldOpen) {
    palette.removeAttribute('hidden');
    button.setAttribute('aria-expanded', 'true');
  }
}

function undoInkStroke() {
  if (!songAnnotationsState.strokes.length) {
    return;
  }

  const removedStroke = songAnnotationsState.strokes.pop();
  if (removedStroke?.id === songAnnotationsState.selectedStrokeId) {
    songAnnotationsState.selectedStrokeId = '';
  }
  saveInkStrokesToStorage();
  renderInkStrokes();
  updateInkControlsUi();
}

function deleteSelectedInkStroke() {
  const selectedId = songAnnotationsState.selectedStrokeId;
  if (!selectedId) {
    return;
  }

  const nextStrokes = songAnnotationsState.strokes.filter((stroke) => stroke.id !== selectedId);
  if (nextStrokes.length === songAnnotationsState.strokes.length) {
    songAnnotationsState.selectedStrokeId = '';
    renderInkStrokes();
    updateInkControlsUi();
    return;
  }

  songAnnotationsState.strokes = nextStrokes;
  songAnnotationsState.selectedStrokeId = '';
  saveInkStrokesToStorage();
  renderInkStrokes();
  updateInkControlsUi();
}

function getInkPointFromEvent(event, pinned = false) {
  if (!pinned) {
    return {
      x: sanitizeFiniteNumber(event.clientX, 0),
      y: sanitizeFiniteNumber(event.clientY, 0),
      pressure: Number.isFinite(Number(event.pressure)) ? Number(event.pressure) : undefined
    };
  }

  const sheetEl = getSheetEl();
  const rect = sheetEl?.getBoundingClientRect();
  if (!rect) {
    return null;
  }

  return {
    x: sanitizeFiniteNumber(event.clientX - rect.left, 0),
    y: sanitizeFiniteNumber(event.clientY - rect.top, 0),
    pressure: Number.isFinite(Number(event.pressure)) ? Number(event.pressure) : undefined
  };
}

function updateDrawingPreview() {
  const session = songAnnotationsState.drawingSession;
  if (!session?.previewEl) {
    return;
  }

  const points = session.stroke.points.length === 1
    ? [session.stroke.points[0], session.stroke.points[0]]
    : session.stroke.points;

  session.previewEl.setAttribute(
    'points',
    points.map((point) => `${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`).join(' ')
  );
}

function findInteractiveTargetAtPoint(clientX, clientY, layer = null) {
  const targetLayer = layer instanceof Element ? layer : null;
  const previousPointerEvents = targetLayer?.style.pointerEvents;
  if (targetLayer) {
    targetLayer.style.pointerEvents = 'none';
  }
  const underlying = document.elementFromPoint(clientX, clientY);
  if (targetLayer) {
    targetLayer.style.pointerEvents = previousPointerEvents;
  }

  if (!(underlying instanceof Element)) {
    return null;
  }

  return underlying.closest(
    '#autoscroll-ui button, #autoscroll-ui input, #autoscroll-ui label, #autoscroll-ui a,'
    + ' #ink-floating-ui button, #ink-floating-ui input, #ink-floating-ui label, #ink-floating-ui a,'
    + ' #song-extras-ui button, #song-extras-ui input, #song-extras-ui a,'
    + ' .youtube-player-shell button, .youtube-player-shell a,'
    + ' .song-meta-dialog button, .song-meta-dialog input, .song-meta-dialog textarea, .song-meta-dialog a'
  );
}

function getInkPassthroughTarget(event) {
  return findInteractiveTargetAtPoint(event.clientX, event.clientY, event.currentTarget);
}

function updateInkHoverCursor(event) {
  const interactiveTarget = findInteractiveTargetAtPoint(event.clientX, event.clientY);
  const nextCursor = interactiveTarget ? 'pointer' : 'crosshair';
  const nextPointerEvents = interactiveTarget ? 'none' : '';
  const sheetInk = getSheetInkLayer();
  const viewportInk = getViewportInkLayer();

  if (sheetInk?.classList.contains('is-active')) {
    sheetInk.style.cursor = nextCursor;
    sheetInk.style.pointerEvents = nextPointerEvents;
  }
  if (viewportInk?.classList.contains('is-active')) {
    viewportInk.style.cursor = nextCursor;
    viewportInk.style.pointerEvents = nextPointerEvents;
  }
}

function handleInkPointerDown(event) {
  if (!songAnnotationsState.inkModeEnabled || event.button !== 0) {
    return;
  }

  const passthroughTarget = getInkPassthroughTarget(event);
  if (passthroughTarget) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof passthroughTarget.focus === 'function') {
      passthroughTarget.focus();
    }
    if (typeof passthroughTarget.click === 'function') {
      passthroughTarget.click();
    }
    return;
  }

  const pinned = event.currentTarget?.dataset?.pinned !== '1';
  if (pinned !== Boolean(songAnnotationsState.inkPinned)) {
    return;
  }

  const point = getInkPointFromEvent(event, pinned);
  if (!point) {
    return;
  }

  const selectedStroke = pickInkStrokeAtPoint(point, pinned);
  if (selectedStroke) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedInkStroke(selectedStroke.id);
    return;
  }

  if (songAnnotationsState.selectedStrokeId) {
    songAnnotationsState.selectedStrokeId = '';
    renderInkStrokes();
    updateInkControlsUi();
  }

  event.preventDefault();
  event.stopPropagation();
  const activeWidth = Math.max(MIN_INK_WIDTH, Math.min(MAX_INK_WIDTH, Number(songAnnotationsState.inkWidth) || MIN_INK_WIDTH));
  const previewEl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  previewEl.classList.add('annotation-ink-stroke', 'is-preview');
  previewEl.setAttribute('fill', 'none');
  previewEl.setAttribute('stroke', songAnnotationsState.inkColor || DEFAULT_INK_COLOR);
  previewEl.setAttribute('stroke-width', String(activeWidth));
  previewEl.setAttribute('stroke-linecap', 'round');
  previewEl.setAttribute('stroke-linejoin', 'round');
  event.currentTarget.appendChild(previewEl);

  songAnnotationsState.drawingSession = {
    pointerId: event.pointerId,
    pinned,
    previewEl,
    stroke: {
      id: createInkStrokeId(),
      points: [point],
      color: songAnnotationsState.inkColor || DEFAULT_INK_COLOR,
      width: activeWidth,
      pinned,
      createdAt: Date.now()
    }
  };
  updateDrawingPreview();

  if (typeof event.currentTarget?.setPointerCapture === 'function') {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (error) {
      // Synthetic pointer events in tests may not have an active capture target.
    }
  }
}

function handleInkPointerMove(event) {
  const session = songAnnotationsState.drawingSession;
  if (!session || session.pointerId !== event.pointerId) {
    return;
  }

  const point = getInkPointFromEvent(event, session.pinned);
  if (!point) {
    return;
  }

  const lastPoint = session.stroke.points[session.stroke.points.length - 1];
  if (lastPoint && Math.abs(lastPoint.x - point.x) < 0.8 && Math.abs(lastPoint.y - point.y) < 0.8) {
    return;
  }

  session.stroke.points.push(point);
  updateDrawingPreview();
}

function finishInkDrawing(event) {
  const session = songAnnotationsState.drawingSession;
  if (!session || (event && session.pointerId !== event.pointerId)) {
    return;
  }

  if (session.stroke.points.length === 1) {
    const point = session.stroke.points[0];
    session.stroke.points.push({ ...point });
  }

  session.previewEl?.remove();
  if (session.stroke.points.length >= 2) {
    songAnnotationsState.strokes.push(session.stroke);
    songAnnotationsState.selectedStrokeId = '';
    saveInkStrokesToStorage();
  }

  songAnnotationsState.drawingSession = null;
  renderInkStrokes();
  updateInkControlsUi();
}

function applySectionCollapseUi({ sectionId, detailId, toggleId, titleId, collapsedLabel = '', expandedLabel = '', storageKey, collapsed = false }) {
  const section = document.getElementById(sectionId);
  const detail = document.getElementById(detailId);
  const toggle = document.getElementById(toggleId);
  const title = titleId ? document.getElementById(titleId) : null;
  const isCollapsed = Boolean(collapsed);

  section?.classList.toggle('is-collapsed', isCollapsed);
  detail?.toggleAttribute('hidden', isCollapsed);

  if (title && collapsedLabel && expandedLabel) {
    title.textContent = isCollapsed ? collapsedLabel : expandedLabel;
  }

  if (toggle) {
    toggle.textContent = isCollapsed ? '▶' : '▼';
    toggle.setAttribute('aria-expanded', String(!isCollapsed));
  }

  if (storageKey) {
    try {
      window.localStorage.setItem(storageKey, isCollapsed ? '1' : '0');
    } catch (error) {
      console.warn(`Failed to save section collapse state: ${storageKey}`, error);
    }
  }

  window.requestAnimationFrame(() => {
    updateAutoScrollSafeTop?.();
    renderMarkerPositions?.();
    refreshSongExtrasLayout?.();
  });
}

function setTransposeNotationCollapsed(collapsed) {
  applySectionCollapseUi({
    sectionId: 'transpose-notation-section',
    detailId: 'transpose-notation-detail',
    toggleId: 'transpose-notation-collapse-toggle',
    titleId: 'transpose-notation-section-title',
    expandedLabel: '移調',
    collapsedLabel: '移調/表記',
    storageKey: TRANSPOSE_NOTATION_COLLAPSED_STORAGE_KEY,
    collapsed
  });
}

function restoreTransposeNotationCollapsedState() {
  try {
    const raw = window.localStorage.getItem(TRANSPOSE_NOTATION_COLLAPSED_STORAGE_KEY);
    setTransposeNotationCollapsed(raw === '1');
  } catch (error) {
    console.warn('Failed to restore transpose/notation section state:', error);
    setTransposeNotationCollapsed(false);
  }
}

function toggleTransposeNotationCollapsed() {
  const section = document.getElementById('transpose-notation-section');
  setTransposeNotationCollapsed(!section?.classList.contains('is-collapsed'));
}

function setAnnotationSectionCollapsed(collapsed) {
  applySectionCollapseUi({
    sectionId: 'annotation-section',
    detailId: 'annotation-detail',
    toggleId: 'annotation-section-collapse-toggle',
    storageKey: ANNOTATION_SECTION_COLLAPSED_STORAGE_KEY,
    collapsed
  });
}

function restoreAnnotationSectionCollapsedState() {
  try {
    const raw = window.localStorage.getItem(ANNOTATION_SECTION_COLLAPSED_STORAGE_KEY);
    setAnnotationSectionCollapsed(raw === '1');
  } catch (error) {
    console.warn('Failed to restore annotation section state:', error);
    setAnnotationSectionCollapsed(false);
  }
}

function toggleAnnotationSectionCollapsed() {
  const section = document.getElementById('annotation-section');
  setAnnotationSectionCollapsed(!section?.classList.contains('is-collapsed'));
}

function setAutoScrollSectionCollapsed(collapsed) {
  applySectionCollapseUi({
    sectionId: 'autoscroll-section',
    detailId: 'autoscroll-detail',
    toggleId: 'autoscroll-section-collapse-toggle',
    storageKey: AUTOSCROLL_SECTION_COLLAPSED_STORAGE_KEY,
    collapsed
  });
}

function restoreAutoScrollSectionCollapsedState() {
  try {
    const raw = window.localStorage.getItem(AUTOSCROLL_SECTION_COLLAPSED_STORAGE_KEY);
    setAutoScrollSectionCollapsed(raw === '1');
  } catch (error) {
    console.warn('Failed to restore auto-scroll section state:', error);
    setAutoScrollSectionCollapsed(false);
  }
}

function toggleAutoScrollSectionCollapsed() {
  const section = document.getElementById('autoscroll-section');
  setAutoScrollSectionCollapsed(!section?.classList.contains('is-collapsed'));
}

function handleStickyNoteLayerPointerDown(event) {
  const resizeHandle = event.target.closest('.sticky-note-resize-handle');
  const dragHandle = event.target.closest('[data-note-drag-handle="true"]');
  const noteEl = event.target.closest('.sticky-note');
  if (!noteEl) {
    return;
  }

  const note = findStickyNoteById(noteEl.dataset.noteId || '');
  if (!note) {
    return;
  }

  if (resizeHandle && event.button === 0) {
    event.preventDefault();
    startStickyNoteResize(event, noteEl, note);
    return;
  }

  if (!dragHandle || event.button !== 0 || getStickyNoteDraft(note.id)) {
    return;
  }

  event.preventDefault();
  startStickyNoteDrag(event, noteEl, note);
}

function initializeStickyNoteDeleteDialog() {
  document.getElementById('sticky-note-delete-cancel')?.addEventListener('click', () => {
    closeStickyNoteDeleteDialog({ confirmed: false });
  });

  document.getElementById('sticky-note-delete-confirm')?.addEventListener('click', () => {
    closeStickyNoteDeleteDialog({ confirmed: true });
  });

  document.getElementById('sticky-note-delete-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'sticky-note-delete-modal') {
      closeStickyNoteDeleteDialog({ confirmed: false });
    }
  });
}

function initializeSongAnnotationsUi() {
  ensureViewportAnnotationLayer();
  ensureSheetAnnotationRoot();
  syncInkLayerSize();
  restoreInkToolPreferences();
  restoreTransposeNotationCollapsedState();
  restoreAnnotationSectionCollapsedState();
  restoreInkToolbarCollapsedState();
  restoreAutoScrollSectionCollapsedState();
  updateInkControlsUi();
  initializeStickyNoteDeleteDialog();

  document.getElementById('sticky-note-add-button')?.addEventListener('click', createStickyNote);
  document.getElementById('transpose-notation-collapse-toggle')?.addEventListener('click', toggleTransposeNotationCollapsed);
  document.getElementById('annotation-section-collapse-toggle')?.addEventListener('click', toggleAnnotationSectionCollapsed);
  document.getElementById('ink-mode-toggle')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleInkMode();
  });
  document.getElementById('ink-pin-toggle')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleInkPinned();
  });
  document.getElementById('ink-width-button')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleInkPalette('width');
  });
  document.getElementById('ink-color-button')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleInkPalette('color');
  });
  document.getElementById('ink-color-input')?.addEventListener('input', (event) => {
    setInkColor(event.target?.value);
  });
  document.getElementById('ink-undo-button')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    undoInkStroke();
  });
  document.getElementById('ink-delete-button')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    deleteSelectedInkStroke();
  });
  document.getElementById('autoscroll-section-collapse-toggle')?.addEventListener('click', toggleAutoScrollSectionCollapsed);

  document.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('#ink-floating-ui')) {
      closeInkFloatingPopovers();
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    const eventTarget = event.target instanceof HTMLElement ? event.target : null;
    const isTypingField = Boolean(eventTarget && (eventTarget.matches('input, textarea, select') || eventTarget.isContentEditable));

    if ((event.key === 'Delete' || event.key === 'Backspace') && songAnnotationsState.selectedStrokeId && !isTypingField) {
      event.preventDefault();
      deleteSelectedInkStroke();
      return;
    }

    if (event.key === 'Escape') {
      if (!document.getElementById('sticky-note-delete-modal')?.hidden) {
        closeStickyNoteDeleteDialog({ confirmed: false });
        return;
      }

      if (!document.getElementById('ink-width-palette')?.hidden || !document.getElementById('ink-color-palette')?.hidden) {
        closeInkFloatingPopovers();
        return;
      }

      if (songAnnotationsState.drawingSession) {
        finishInkDrawing();
        return;
      }

      const [editingNoteId] = Array.from(songAnnotationsState.noteDrafts.keys());
      if (editingNoteId) {
        cancelStickyNoteEdit(editingNoteId);
      }
    }
  });

  document.addEventListener('pointerdown', handleStickyNoteLayerPointerDown);
  document.addEventListener('pointermove', (event) => {
    updateStickyNoteDragPosition(event);
    updateStickyNoteResize(event);
    handleInkPointerMove(event);
    updateInkHoverCursor(event);
  });
  document.addEventListener('pointerup', (event) => {
    finishStickyNoteDrag(event);
    finishStickyNoteResize(event);
    finishInkDrawing(event);
  });
  document.addEventListener('pointercancel', (event) => {
    finishStickyNoteDrag(event);
    finishStickyNoteResize(event);
    finishInkDrawing(event);
  });

  window.addEventListener('resize', () => {
    syncInkLayerSize();
    renderInkStrokes();
    updateAutoScrollSafeTop?.();
  });
}
