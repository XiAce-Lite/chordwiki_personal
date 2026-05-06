(function attachChordWikiSetlists(global) {
  const STORAGE_KEY = 'setlists';
  const PENDING_DELETE_STORAGE_KEY = 'setlists.pendingDeletes';
  let activeUserId = '';
  let activeUserIdPromise = null;
  let syncPromise = null;
  let remoteQueue = Promise.resolve();

  function now() {
    return Date.now();
  }

  function createId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }

    return `sl-${now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function sortByUpdatedAtDesc(items) {
    return [...items].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }

  function normalizeSetlist(raw, fallbackUserId = '') {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const id = String(raw.id || '').trim();
    const userId = String(raw.userId || fallbackUserId || '').trim();
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
      userId,
      name,
      songs,
      isShared: raw.isShared === true,
      createdAt: Number.isFinite(createdAt) ? createdAt : now(),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : now()
    };
  }

  function normalizePendingDeletion(raw, fallbackUserId = '') {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const id = String(raw.id || '').trim();
    const userId = String(raw.userId || fallbackUserId || '').trim();
    const updatedAt = Number(raw.updatedAt);

    if (!id) {
      return null;
    }

    return {
      id,
      userId,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : now()
    };
  }

  function readStorageArray(key, normalizer) {
    try {
      const rawText = global.localStorage.getItem(key);
      if (!rawText) {
        return [];
      }

      const parsed = JSON.parse(rawText);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map(normalizer).filter(Boolean);
    } catch (error) {
      console.error(`Failed to read ${key} from localStorage:`, error);
      return [];
    }
  }

  function writeStorageArray(key, items) {
    global.localStorage.setItem(key, JSON.stringify(items));
    return items;
  }

  function readAllSetlists() {
    return sortByUpdatedAtDesc(readStorageArray(STORAGE_KEY, (item) => normalizeSetlist(item)));
  }

  function readAllPendingDeletions() {
    return sortByUpdatedAtDesc(readStorageArray(PENDING_DELETE_STORAGE_KEY, (item) => normalizePendingDeletion(item)));
  }

  function filterUserScopedItems(items, userId) {
    const targetUserId = String(userId || '').trim();
    return items.filter((item) => {
      const itemUserId = String(item?.userId || '').trim();
      if (!targetUserId) {
        return !itemUserId;
      }
      return !itemUserId || itemUserId === targetUserId;
    });
  }

  function writeAllSetlists(setlists) {
    const normalized = Array.isArray(setlists)
      ? sortByUpdatedAtDesc(setlists.map((item) => normalizeSetlist(item)).filter(Boolean))
      : [];

    return writeStorageArray(STORAGE_KEY, normalized);
  }

  function writeAllPendingDeletions(deletions) {
    const normalized = Array.isArray(deletions)
      ? sortByUpdatedAtDesc(deletions.map((item) => normalizePendingDeletion(item)).filter(Boolean))
      : [];

    return writeStorageArray(PENDING_DELETE_STORAGE_KEY, normalized);
  }

  function getScopedSetlists(userId = activeUserId) {
    return sortByUpdatedAtDesc(filterUserScopedItems(readAllSetlists(), userId));
  }

  function getScopedPendingDeletions(userId = activeUserId) {
    return sortByUpdatedAtDesc(filterUserScopedItems(readAllPendingDeletions(), userId));
  }

  function writeScopedSetlists(userId, setlists) {
    const targetUserId = String(userId || '').trim();
    const retained = readAllSetlists().filter((item) => {
      const itemUserId = String(item?.userId || '').trim();
      if (!targetUserId) {
        return itemUserId;
      }
      return itemUserId && itemUserId !== targetUserId;
    });

    const scoped = Array.isArray(setlists)
      ? setlists.map((item) => normalizeSetlist(item, targetUserId)).filter(Boolean)
      : [];

    return sortByUpdatedAtDesc(writeAllSetlists([...retained, ...scoped]));
  }

  function writeScopedPendingDeletions(userId, deletions) {
    const targetUserId = String(userId || '').trim();
    const retained = readAllPendingDeletions().filter((item) => {
      const itemUserId = String(item?.userId || '').trim();
      if (!targetUserId) {
        return itemUserId;
      }
      return itemUserId && itemUserId !== targetUserId;
    });

    const scoped = Array.isArray(deletions)
      ? deletions.map((item) => normalizePendingDeletion(item, targetUserId)).filter(Boolean)
      : [];

    return sortByUpdatedAtDesc(writeAllPendingDeletions([...retained, ...scoped]));
  }

  function readSetlists() {
    return getScopedSetlists();
  }

  function writeSetlists(setlists) {
    writeScopedSetlists(activeUserId, setlists);
    return readSetlists();
  }

  function upsertLocalSetlist(setlist) {
    const normalized = normalizeSetlist(setlist, activeUserId);
    if (!normalized) {
      return null;
    }

    const scoped = getScopedSetlists(normalized.userId || activeUserId);
    const next = scoped.filter((item) => item.id !== normalized.id);
    next.unshift(normalized);
    writeScopedSetlists(normalized.userId || activeUserId, next);
    return normalized;
  }

  function deleteLocalSetlist(setlistId, userId = activeUserId) {
    const targetId = String(setlistId || '').trim();
    if (!targetId) {
      return false;
    }

    const scoped = getScopedSetlists(userId);
    const filtered = scoped.filter((item) => item.id !== targetId);
    if (filtered.length === scoped.length) {
      return false;
    }

    writeScopedSetlists(userId, filtered);
    return true;
  }

  function upsertPendingDeletion(entry) {
    const normalized = normalizePendingDeletion(entry, activeUserId);
    if (!normalized) {
      return null;
    }

    const scoped = getScopedPendingDeletions(normalized.userId || activeUserId)
      .filter((item) => item.id !== normalized.id);
    scoped.unshift(normalized);
    writeScopedPendingDeletions(normalized.userId || activeUserId, scoped);
    return normalized;
  }

  function removePendingDeletion(setlistId, userId = activeUserId) {
    const targetId = String(setlistId || '').trim();
    const scoped = getScopedPendingDeletions(userId);
    const filtered = scoped.filter((item) => item.id !== targetId);
    if (filtered.length === scoped.length) {
      return false;
    }

    writeScopedPendingDeletions(userId, filtered);
    return true;
  }

  function enqueueRemoteOperation(operation) {
    remoteQueue = remoteQueue
      .then(() => operation())
      .catch((error) => {
        console.warn('Setlist sync failed:', error);
      });

    return remoteQueue;
  }

  async function resolveUserId() {
    if (activeUserId) {
      return activeUserId;
    }

    if (!activeUserIdPromise) {
      const auth = global.ChordWikiAuth;
      if (!auth || typeof auth.getClientPrincipal !== 'function') {
        activeUserIdPromise = Promise.resolve('');
      } else {
        activeUserIdPromise = auth.getClientPrincipal()
          .then((principal) => {
            activeUserId = String(principal?.userId || '').trim();
            return activeUserId;
          })
          .catch((error) => {
            console.warn('Failed to resolve setlist user id:', error);
            activeUserId = '';
            return '';
          });
      }
    }

    const resolved = await activeUserIdPromise;
    activeUserId = String(resolved || '').trim();
    return activeUserId;
  }

  function getApiUtils() {
    return global.ChordWikiApiUtils || {};
  }

  function buildSetlistsApiUrl(path = '', userId = '') {
    const { buildApiUrl } = getApiUtils();
    const suffix = String(path || '');
    const basePath = `/api/setlists${suffix}`;

    if (!userId) {
      return typeof buildApiUrl === 'function' ? buildApiUrl(basePath) : basePath;
    }

    const params = new URLSearchParams();
    params.set('userId', userId);
    const pathWithQuery = `${basePath}?${params.toString()}`;
    return typeof buildApiUrl === 'function' ? buildApiUrl(pathWithQuery) : pathWithQuery;
  }

  async function parseJsonResponse(response) {
    const { parseJsonResponse: parseJson } = getApiUtils();
    if (typeof parseJson === 'function') {
      return parseJson(response);
    }

    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  function getErrorMessage(payload, fallback) {
    const { getErrorDetail } = getApiUtils();
    if (typeof getErrorDetail === 'function') {
      return getErrorDetail(payload, fallback);
    }
    return payload?.detail || payload?.error || fallback;
  }

  async function requestSetlistsApi(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(options.headers || {})
      },
      ...options
    });

    if (response.status === 204) {
      return null;
    }

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      const error = new Error(getErrorMessage(payload, 'セットリストの同期に失敗しました。'));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  async function fetchCloudSetlists(userId) {
    const payload = await requestSetlistsApi(buildSetlistsApiUrl('', userId), {
      method: 'GET'
    });

    return Array.isArray(payload)
      ? payload.map((item) => normalizeSetlist(item, userId)).filter(Boolean)
      : [];
  }

  async function createCloudSetlist(setlist) {
    return normalizeSetlist(await requestSetlistsApi(buildSetlistsApiUrl(), {
      method: 'POST',
      body: JSON.stringify(setlist)
    }), setlist.userId);
  }

  async function updateCloudSetlist(setlist) {
    return normalizeSetlist(await requestSetlistsApi(buildSetlistsApiUrl(`/${encodeURIComponent(setlist.id)}`), {
      method: 'PUT',
      body: JSON.stringify(setlist)
    }), setlist.userId);
  }

  async function deleteCloudSetlist(setlistId) {
    await requestSetlistsApi(buildSetlistsApiUrl(`/${encodeURIComponent(setlistId)}`), {
      method: 'DELETE'
    });
  }

  async function pushCreatedSetlist(setlist) {
    try {
      return await createCloudSetlist(setlist);
    } catch (error) {
      if (error?.status === 409) {
        return updateCloudSetlist(setlist);
      }
      throw error;
    }
  }

  function mergeSetlists(localSetlists, cloudSetlists, pendingDeletions, userId) {
    const localMap = new Map(localSetlists.map((item) => [item.id, normalizeSetlist(item, userId)]));
    const cloudMap = new Map(cloudSetlists.map((item) => [item.id, normalizeSetlist(item, userId)]));
    const deletionMap = new Map(pendingDeletions.map((item) => [item.id, normalizePendingDeletion(item, userId)]));
    const merged = [];
    const uploads = [];
    const deletions = [];
    const removeDeletionIds = new Set();

    const ids = new Set([
      ...localMap.keys(),
      ...cloudMap.keys(),
      ...deletionMap.keys()
    ]);

    ids.forEach((id) => {
      const local = localMap.get(id) || null;
      const cloud = cloudMap.get(id) || null;
      const deletion = deletionMap.get(id) || null;
      const localUpdatedAt = Number(local?.updatedAt || 0);
      const cloudUpdatedAt = Number(cloud?.updatedAt || 0);
      const deletedUpdatedAt = Number(deletion?.updatedAt || 0);

      if (deletion) {
        if (cloud) {
          if (deletedUpdatedAt >= cloudUpdatedAt) {
            deletions.push(deletion);
            return;
          }

          merged.push(cloud);
          removeDeletionIds.add(id);
          return;
        }

        removeDeletionIds.add(id);
        return;
      }

      if (local && cloud) {
        if (localUpdatedAt >= cloudUpdatedAt) {
          merged.push(local);
          if (localUpdatedAt > cloudUpdatedAt) {
            uploads.push({ type: 'put', setlist: local });
          }
        } else {
          merged.push(cloud);
        }
        return;
      }

      if (local) {
        merged.push(local);
        uploads.push({ type: 'post', setlist: local });
        return;
      }

      if (cloud) {
        merged.push(cloud);
      }
    });

    return {
      merged: sortByUpdatedAtDesc(merged),
      uploads,
      deletions,
      removeDeletionIds
    };
  }

  function createSetlist(name) {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      throw new Error('セットリスト名を入力してください。');
    }

    const timestamp = now();
    const created = {
      id: createId(),
      userId: activeUserId,
      name: trimmedName,
      songs: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };

    upsertLocalSetlist(created);
    enqueueRemoteOperation(async () => {
      const saved = await pushCreatedSetlist(created);
      upsertLocalSetlist(saved);
    });
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

    upsertLocalSetlist(next);
    enqueueRemoteOperation(async () => {
      const saved = await updateCloudSetlist(next);
      upsertLocalSetlist(saved);
    });
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
    const existing = readSetlists().find((item) => item.id === targetId);
    if (!existing) {
      return false;
    }

    deleteLocalSetlist(targetId, existing.userId || activeUserId);
    upsertPendingDeletion({
      id: targetId,
      userId: existing.userId || activeUserId,
      updatedAt: now()
    });
    enqueueRemoteOperation(async () => {
      await deleteCloudSetlist(targetId);
      removePendingDeletion(targetId, existing.userId || activeUserId);
    });
    return true;
  }

  async function syncWithCloud() {
    if (syncPromise) {
      return syncPromise;
    }

    syncPromise = (async () => {
      const userId = await resolveUserId();
      if (!userId) {
        return readSetlists();
      }

      await remoteQueue;

      try {
        const cloudSetlists = await fetchCloudSetlists(userId);
        const localSetlists = getScopedSetlists(userId).map((item) => normalizeSetlist(item, userId)).filter(Boolean);
        const pendingDeletions = getScopedPendingDeletions(userId).map((item) => normalizePendingDeletion(item, userId)).filter(Boolean);
        const mergeResult = mergeSetlists(localSetlists, cloudSetlists, pendingDeletions, userId);

        writeScopedSetlists(userId, mergeResult.merged);
        const remainingDeletions = pendingDeletions.filter((item) => !mergeResult.removeDeletionIds.has(item.id));
        writeScopedPendingDeletions(userId, remainingDeletions);

        for (const deletion of mergeResult.deletions) {
          try {
            await deleteCloudSetlist(deletion.id);
            removePendingDeletion(deletion.id, userId);
          } catch (error) {
            console.warn('Failed to delete setlist from cloud during startup sync:', error);
          }
        }

        for (const upload of mergeResult.uploads) {
          try {
            const saved = upload.type === 'post'
              ? await pushCreatedSetlist(upload.setlist)
              : await updateCloudSetlist(upload.setlist);
            upsertLocalSetlist(saved);
          } catch (error) {
            console.warn('Failed to upload setlist during startup sync:', error);
          }
        }
      } catch (error) {
        console.warn('Failed to sync setlists from cloud:', error);
      }

      return readSetlists();
    })().finally(() => {
      syncPromise = null;
    });

    return syncPromise;
  }

  function ensureReady() {
    return syncWithCloud();
  }

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('online', () => {
      void syncWithCloud();
    });
  }

  global.ChordWikiSetlists = Object.freeze({
    STORAGE_KEY,
    PENDING_DELETE_STORAGE_KEY,
    readSetlists,
    writeSetlists,
    createSetlist,
    addSongToSetlist,
    removeSongFromSetlist,
    reorderSetlistSongs,
    renameSetlist,
    deleteSetlist,
    ensureReady,
    syncWithCloud
  });
})(window);
