/* ============================================================
   storage.js — Persistent data layer for AURIX
   Stores: library index, favorites, playlists, recents,
   play counts, settings. Uses Capacitor Preferences on
   native, localStorage on web.
   ============================================================ */

(function (global) {
  "use strict";

  const KEYS = {
    LIBRARY: "aurix.library.v1",
    FAVORITES: "aurix.favorites.v1",
    PLAYLISTS: "aurix.playlists.v1",
    RECENTS: "aurix.recents.v1",
    PLAYCOUNTS: "aurix.playcounts.v1",
    SETTINGS: "aurix.settings.v1",
    LASTSTATE: "aurix.laststate.v1"
  };

  async function readJSON(key, fallback) {
    const raw = await Cap.Storage.get(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }
  async function writeJSON(key, value) {
    await Cap.Storage.set(key, JSON.stringify(value));
  }

  // ---------- Library ----------
  async function getLibrary() {
    return readJSON(KEYS.LIBRARY, { songs: [], scannedAt: 0, version: 1 });
  }
  async function setLibrary(library) {
    await writeJSON(KEYS.LIBRARY, library);
  }

  // ---------- Favorites ----------
  async function getFavorites() {
    return readJSON(KEYS.FAVORITES, []);
  }
  async function setFavorites(ids) {
    await writeJSON(KEYS.FAVORITES, ids);
  }
  async function toggleFavorite(songId) {
    const favs = await getFavorites();
    const idx = favs.indexOf(songId);
    if (idx >= 0) { favs.splice(idx, 1); }
    else { favs.push(songId); }
    await setFavorites(favs);
    return idx < 0; // true if now favorite
  }

  // ---------- Playlists ----------
  async function getPlaylists() {
    return readJSON(KEYS.PLAYLISTS, []);
  }
  async function setPlaylists(pls) {
    await writeJSON(KEYS.PLAYLISTS, pls);
  }
  async function createPlaylist(name) {
    const pls = await getPlaylists();
    const id = "pl_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    pls.push({ id, name: name.trim(), songs: [], createdAt: Date.now() });
    await setPlaylists(pls);
    return id;
  }
  async function deletePlaylist(id) {
    const pls = await getPlaylists();
    const filtered = pls.filter(p => p.id !== id);
    await setPlaylists(filtered);
  }
  async function renamePlaylist(id, name) {
    const pls = await getPlaylists();
    const p = pls.find(p => p.id === id);
    if (p) { p.name = name.trim(); await setPlaylists(pls); }
  }
  async function addToPlaylist(playlistId, songId) {
    const pls = await getPlaylists();
    const p = pls.find(p => p.id === playlistId);
    if (!p) return false;
    if (!p.songs.includes(songId)) { p.songs.push(songId); p.updatedAt = Date.now(); await setPlaylists(pls); return true; }
    return false;
  }
  async function removeFromPlaylist(playlistId, songId) {
    const pls = await getPlaylists();
    const p = pls.find(p => p.id === playlistId);
    if (!p) return;
    p.songs = p.songs.filter(s => s !== songId);
    p.updatedAt = Date.now();
    await setPlaylists(pls);
  }

  // ---------- Recents & play counts ----------
  async function getRecents() {
    return readJSON(KEYS.RECENTS, []);
  }
  async function addRecent(songId, max = 60) {
    let rec = await getRecents();
    rec = rec.filter(s => s !== songId);
    rec.unshift(songId);
    if (rec.length > max) rec = rec.slice(0, max);
    await writeJSON(KEYS.RECENTS, rec);
  }
  async function getPlayCounts() {
    return readJSON(KEYS.PLAYCOUNTS, {});
  }
  async function incPlayCount(songId) {
    const counts = await getPlayCounts();
    counts[songId] = (counts[songId] || 0) + 1;
    await writeJSON(KEYS.PLAYCOUNTS, counts);
  }

  // ---------- Settings ----------
  const DEFAULT_SETTINGS = {
    shuffle: false,
    repeat: "off",      // off | all | one
    volume: 1,
    eqPreset: "flat",
    eqBands: null,      // null = use preset
    scanPaths: [],
    firstRun: true
  };
  async function getSettings() {
    return Object.assign({}, DEFAULT_SETTINGS, await readJSON(KEYS.SETTINGS, {}));
  }
  async function setSettings(patch) {
    const cur = await getSettings();
    const next = Object.assign({}, cur, patch);
    await writeJSON(KEYS.SETTINGS, next);
    return next;
  }

  // ---------- Last playback state (for resume) ----------
  async function getLastState() {
    return readJSON(KEYS.LASTSTATE, null);
  }
  async function setLastState(state) {
    await writeJSON(KEYS.LASTSTATE, state);
  }
  async function clearLastState() {
    await Cap.Storage.remove(KEYS.LASTSTATE);
  }

  // ---------- Expose ----------
  global.Storage = {
    KEYS,
    getLibrary, setLibrary,
    getFavorites, setFavorites, toggleFavorite,
    getPlaylists, setPlaylists, createPlaylist, deletePlaylist, renamePlaylist,
    addToPlaylist, removeFromPlaylist,
    getRecents, addRecent,
    getPlayCounts, incPlayCount,
    getSettings, setSettings,
    getLastState, setLastState, clearLastState
  };
})(window);
