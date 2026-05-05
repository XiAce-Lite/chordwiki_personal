(function attachChordWikiSetlists(global) {
  const STORAGE_KEY = 'setlists';

  function now() {
    return Date.now();
  }

  function createId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }

    return `sl-${now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function normalizeSetlist(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const id = String(raw.id || '').trim();
    const name = String(raw.name || '').trim();
    const songs = Array.isArray(raw.songs)
      ? raw.songs.map((songId) => String(songId || '').trim()).filter(Boolean)
      : [];
    const createdAt = Number(raw.createdAt);
    const updatedAt = Number(raw.updatedAt);

    if (!id || !name) {
      return null;
    }

    return {
      id,
      name,
      songs,
      createdAt: Number.isFinite(createdAt) ? createdAt : now(),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : now()
    };
  }

  function readSetlists() {
    try {
      const rawText = global.localStorage.getItem(STORAGE_KEY);
      if (!rawText) {
        return [];
      }

      const parsed = JSON.parse(rawText);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map(normalizeSetlist)
        .filter(Boolean)
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    } catch (error) {
      console.error('Failed to read setlists from localStorage:', error);
      return [];
    }
  }

  function writeSetlists(setlists) {
    const normalized = Array.isArray(setlists)
      ? setlists.map(normalizeSetlist).filter(Boolean)
      : [];

    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function createSetlist(name) {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      throw new Error('セットリスト名を入力してください。');
    }

    const timestamp = now();
    const created = {
      id: createId(),
      name: trimmedName,
      songs: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const setlists = readSetlists();
    setlists.unshift(created);
    writeSetlists(setlists);
    return created;
  }

  function updateSetlist(setlistId, updater) {
    const targetId = String(setlistId || '').trim();
    if (!targetId) {
      return null;
    }

    const setlists = readSetlists();
    const index = setlists.findIndex((item) => item.id === targetId);
    if (index < 0) {
      return null;
    }

    const current = setlists[index];
    const next = normalizeSetlist({
      ...current,
      ...(typeof updater === 'function' ? updater(current) : null),
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: now()
    });

    if (!next) {
      return null;
    }

    setlists[index] = next;
    writeSetlists(setlists);
    return next;
  }

  function addSongToSetlist(setlistId, songId) {
    const targetSongId = String(songId || '').trim();
    if (!targetSongId) {
      return { ok: false, reason: 'invalid-song-id' };
    }

    const updated = updateSetlist(setlistId, (current) => {
      if (current.songs.includes(targetSongId)) {
        return null;
      }

      return {
        songs: [...current.songs, targetSongId]
      };
    });

    if (!updated) {
      const current = readSetlists().find((item) => item.id === String(setlistId || '').trim());
      if (current && current.songs.includes(targetSongId)) {
        return { ok: false, reason: 'duplicate' };
      }
      return { ok: false, reason: 'not-found' };
    }

    return { ok: true, setlist: updated };
  }

  function removeSongFromSetlist(setlistId, songId) {
    const targetSongId = String(songId || '').trim();

    return updateSetlist(setlistId, (current) => ({
      songs: current.songs.filter((id) => id !== targetSongId)
    }));
  }

  function reorderSetlistSongs(setlistId, songIds) {
    const normalizedSongs = Array.isArray(songIds)
      ? songIds.map((songId) => String(songId || '').trim()).filter(Boolean)
      : [];

    return updateSetlist(setlistId, () => ({ songs: normalizedSongs }));
  }

  function renameSetlist(setlistId, name) {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      throw new Error('セットリスト名を入力してください。');
    }

    return updateSetlist(setlistId, () => ({ name: trimmedName }));
  }

  function deleteSetlist(setlistId) {
    const targetId = String(setlistId || '').trim();
    const setlists = readSetlists();
    const filtered = setlists.filter((item) => item.id !== targetId);

    if (filtered.length === setlists.length) {
      return false;
    }

    writeSetlists(filtered);
    return true;
  }

  global.ChordWikiSetlists = Object.freeze({
    STORAGE_KEY,
    readSetlists,
    writeSetlists,
    createSetlist,
    addSongToSetlist,
    removeSongFromSetlist,
    reorderSetlistSongs,
    renameSetlist,
    deleteSetlist
  });
})(window);
