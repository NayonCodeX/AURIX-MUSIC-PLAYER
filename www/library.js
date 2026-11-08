/* ============================================================
   library.js — Music library scanner and indexer for AURIX.
   Reads audio files from device storage (via Capacitor Filesystem
   or HTML file input fallback), extracts metadata from filenames
   (since Android WebView does not expose ID3 parsing without
   external libs), and maintains a searchable in-memory index.
   ============================================================ */

(function (global) {
  "use strict";

  const AUDIO_EXTENSIONS = ["mp3", "m4a", "aac", "flac", "ogg", "oga", "wav", "opus", "weba", "wma", "amr", "3ga", "m4b"];

  // -------------- Internal state --------------
  let library = { songs: [], scannedAt: 0, version: 1 };
  let indexes = { byId: new Map(), byAlbum: new Map(), byArtist: new Map(), byFolder: new Map() };

  // -------------- Helpers --------------
  function isAudioFile(name) {
    if (!name) return false;
    const dot = name.lastIndexOf(".");
    if (dot < 0) return false;
    const ext = name.slice(dot + 1).toLowerCase();
    return AUDIO_EXTENSIONS.includes(ext);
  }

  function sanitizeFilename(name) {
    // Strip extension
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    // Heuristic split: "Artist - Title" or "Artist - Title (Remix)"
    let artist = "Unknown Artist";
    let title = base;
    if (base.includes(" - ")) {
      const parts = base.split(" - ");
      artist = parts[0].trim();
      title = parts.slice(1).join(" - ").trim();
    } else if (base.includes("–")) {
      const parts = base.split("–");
      artist = parts[0].trim();
      title = parts.slice(1).join("–").trim();
    }
    if (!artist) artist = "Unknown Artist";
    if (!title) title = base;
    return { artist, title };
  }

  function albumOf(song) {
    // Use parent folder name as album hint if no ID3 album tag
    const folder = song.folderName || "Unknown Album";
    return folder;
  }

  function folderNameFromPath(path) {
    if (!path) return "Unknown Folder";
    const clean = path.replace(/\/+$/, "");
    const slash = clean.lastIndexOf("/");
    return slash >= 0 ? clean.slice(slash + 1) : clean;
  }

  function parentPath(path) {
    const slash = path.lastIndexOf("/");
    return slash > 0 ? path.slice(0, slash) : "/";
  }

  function hashId(input) {
    // Lightweight FNV-1a hash → base36 string. Stable per content/path.
    let h = 0x811c9dc5;
    const s = String(input);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return "s_" + h.toString(36);
  }

  function makeSong(opts) {
    const { artist, title } = sanitizeFilename(opts.name);
    const folderName = folderNameFromPath(opts.dirPath || opts.parentPath || "");
    const album = opts.album || folderName;
    const id = opts.id || hashId(opts.uri || opts.path || opts.name);
    return {
      id,
      title: title || opts.name,
      artist: artist || "Unknown Artist",
      album: album || "Unknown Album",
      duration: opts.duration || 0,
      uri: opts.uri || null,
      path: opts.path || opts.dirPath + "/" + opts.name,
      dirPath: opts.dirPath || opts.parentPath || "",
      folderName,
      name: opts.name,
      size: opts.size || 0,
      mtime: opts.mtime || 0,
      addedAt: opts.addedAt || Date.now()
    };
  }

  // -------------- Scanner (Capacitor Filesystem) --------------
  // Accepts either:
  //   - a string path (e.g. "Music" — for back-compat, scoped to ExternalStorage)
  //   - an object { directory, path } where `directory` is the Capacitor Directory enum
  async function scanPathWithFilesystem(spec) {
    if (!Cap.Filesystem || !Cap.Filesystem.readdir) return [];

    // Normalize spec to { path, directory }
    let pathArg, directoryArg;
    if (typeof spec === "string") {
      pathArg = spec;
      directoryArg = Cap.Filesystem.Directory && Cap.Filesystem.Directory.ExternalStorage;
    } else if (spec && typeof spec === "object") {
      pathArg = spec.path || "";
      directoryArg = spec.directory;
    } else {
      return [];
    }
    if (!pathArg) return [];

    const found = [];
    const visited = new Set();
    const stack = [{ path: pathArg, directory: directoryArg }];
    const MAX_DEPTH = 8;
    const MAX_FILES = 4000;

    function keyOf(node) {
      return (node.directory ? String(node.directory) : "") + "|" + node.path;
    }

    while (stack.length) {
      const node = stack.pop();
      const key = keyOf(node);
      if (visited.has(key)) continue;
      visited.add(key);
      if (found.length >= MAX_FILES) break;

      let result;
      try {
        result = await Cap.Filesystem.readdir({ path: node.path, directory: node.directory });
      } catch (e) {
        // Permission denied or not a directory — skip silently
        continue;
      }
      const files = (result && result.files) || [];
      for (const f of files) {
        const childPath = node.path.endsWith("/") ? node.path + f.name : node.path + "/" + f.name;
        if (f.type === "directory") {
          if (visited.size < 200) stack.push({ path: childPath, directory: node.directory });
        } else if (isAudioFile(f.name)) {
          // Stat to get full URI (needed for audio playback)
          let uri = null, size = 0, mtime = 0;
          try {
            const stat = await Cap.Filesystem.stat({ path: childPath, directory: node.directory });
            // Capacitor's Filesystem.stat() returns a `file://` URI. To play
            // it in the WebView (loaded via https:// scheme), we must convert
            // it via `Capacitor.convertFileSrc()` to a `https://localhost/_capacitor_file_/...` URL.
            let rawUri = stat.uri;
            if (rawUri && global.Capacitor && typeof global.Capacitor.convertFileSrc === "function") {
              uri = global.Capacitor.convertFileSrc(rawUri);
            } else {
              uri = rawUri;
            }
            size = stat.size || 0;
            mtime = stat.mtime || 0;
          } catch (e) {
            // Stat failed — fall back to constructing uri from path (may not work but won't crash)
          }
          found.push(makeSong({
            name: f.name,
            dirPath: node.path,
            path: childPath,
            uri: uri,
            size: size,
            mtime: mtime
          }));
          if (found.length >= MAX_FILES) break;
        }
      }
    }
    return found;
  }

  // -------------- Scanner (HTML File input fallback) --------------
  // Used in browser dev environment or as a manual import option
  function scanFromFileList(fileList) {
    const songs = [];
    if (!fileList || !fileList.length) return songs;
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      if (!isAudioFile(f.name)) continue;
      // file.webkitRelativePath is set when using <input webkitdirectory>
      const rel = f.webkitRelativePath || f.name;
      const dir = parentPath(rel);
      songs.push(makeSong({
        name: f.name,
        dirPath: dir,
        path: rel,
        uri: URL.createObjectURL(f),
        size: f.size,
        mtime: f.lastModified || 0
      }));
    }
    return songs;
  }

  // -------------- Build indexes --------------
  function rebuildIndexes() {
    indexes.byId.clear();
    indexes.byAlbum.clear();
    indexes.byArtist.clear();
    indexes.byFolder.clear();
    for (const s of library.songs) {
      indexes.byId.set(s.id, s);
      if (!indexes.byAlbum.has(s.album)) indexes.byAlbum.set(s.album, []);
      indexes.byAlbum.get(s.album).push(s);
      if (!indexes.byArtist.has(s.artist)) indexes.byArtist.set(s.artist, []);
      indexes.byArtist.get(s.artist).push(s);
      if (!indexes.byFolder.has(s.folderName)) indexes.byFolder.set(s.folderName, []);
      indexes.byFolder.get(s.folderName).push(s);
    }
  }

  // -------------- Public API --------------
  async function load() {
    library = await Storage.getLibrary();
    if (!library.songs) library.songs = [];
    rebuildIndexes();
    return library;
  }

  async function save() {
    library.scannedAt = Date.now();
    await Storage.setLibrary(library);
  }

  function getAllSongs() { return library.songs; }
  function getSong(id) { return indexes.byId.get(id) || null; }

  function getAlbums() {
    const albums = [];
    indexes.byAlbum.forEach((songs, name) => {
      albums.push({
        name,
        artist: songs[0].artist,
        songs,
        cover: null
      });
    });
    return albums.sort((a, b) => a.name.localeCompare(b.name));
  }
  function getArtists() {
    const artists = [];
    indexes.byArtist.forEach((songs, name) => {
      artists.push({ name, songs, albums: [...new Set(songs.map(s => s.album))] });
    });
    return artists.sort((a, b) => a.name.localeCompare(b.name));
  }
  function getFolders() {
    const folders = [];
    indexes.byFolder.forEach((songs, name) => {
      folders.push({ name, path: songs[0].dirPath, songs });
    });
    return folders.sort((a, b) => a.name.localeCompare(b.name));
  }

  function search(query) {
    if (!query) return [];
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return library.songs.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.artist.toLowerCase().includes(q) ||
      s.album.toLowerCase().includes(q)
    );
  }

  async function addSongs(newSongs) {
    if (!newSongs || !newSongs.length) return 0;
    const existingIds = new Set(library.songs.map(s => s.id));
    let added = 0;
    for (const s of newSongs) {
      if (!existingIds.has(s.id)) {
        library.songs.push(s);
        existingIds.add(s.id);
        added++;
      }
    }
    rebuildIndexes();
    if (added) await save();
    return added;
  }

  async function clearLibrary() {
    library = { songs: [], scannedAt: 0, version: 1 };
    rebuildIndexes();
    await Storage.setLibrary(library);
  }

  async function removeSong(id) {
    library.songs = library.songs.filter(s => s.id !== id);
    rebuildIndexes();
    await save();
  }

  function getStats() {
    return {
      songs: library.songs.length,
      albums: indexes.byAlbum.size,
      artists: indexes.byArtist.size,
      folders: indexes.byFolder.size
    };
  }

  // -------------- Expose --------------
  global.Library = {
    AUDIO_EXTENSIONS,
    load, save,
    getAllSongs, getSong, getAlbums, getArtists, getFolders,
    search, addSongs, clearLibrary, removeSong,
    scanPathWithFilesystem, scanFromFileList,
    isAudioFile, sanitizeFilename, makeSong, getStats,
    get lastScan() { return library.scannedAt; }
  };
})(window);
