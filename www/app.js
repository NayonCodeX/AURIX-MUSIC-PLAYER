/* ============================================================
   app.js — AURIX main entry point.
   Wires UI events, library scanning, player, equalizer,
   and renders all views. This is the orchestration layer.
   ============================================================ */

(function (global) {
  "use strict";

  // -------------- DOM refs --------------
  const $ = (id) => document.getElementById(id);
  const bootScreen = $("bootScreen");
  const grantBtn = $("grantPermissionBtn");
  const appShell = $("app");
  const mainView = $("mainView");
  const searchView = $("searchView");
  const quickView = $("quickView");
  const eqView = $("eqView");
  const nowPlaying = $("nowPlaying");
  const miniPlayer = $("miniPlayer");
  const audioEl = $("audioEl");

  // View state
  let currentTab = "songs";
  let currentNav = "library";

  // -------------- Boot sequence --------------
  async function boot() {
    // Show loader animation briefly
    await wait(900);

    // Init modules
    await Library.load();
    await Player.init();
    await Equalizer.init();

    // Render everything
    renderAll();
    wireEvents();
    wirePlayerEvents();
    restoreLastPlayback();

    const stats = Library.getStats();

    if (Cap.isNative) {
      // On native Android: if we already have songs, enter app and refresh
      // in the background (in case the user added new music since last launch).
      // If library is empty, prompt for permission first.
      if (stats.songs > 0) {
        enterApp();
        // Background refresh — silently pick up any new music added since last run
        // (only fires if we have a working native scanner)
        if (Cap.Music && Cap.Music.scanAllAudio) {
          // Check if we already have permission; only auto-scan if so
          try {
            const perm = await Cap.Music.hasAudioPermission();
            if (perm && perm.granted) {
              const added = await scanLibraryNative();
              if (added > 0) {
                renderAll();
                Cap.toast("Added " + added + " new songs");
              }
            }
          } catch (_) {}
        }
      } else {
        // First run or empty library — show grant-permission CTA
        grantBtn.hidden = false;
        document.querySelector(".boot-loader").style.display = "none";
      }
    } else {
      // Web preview — no permission needed
      enterApp();
    }
  }

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  function enterApp() {
    bootScreen.style.transition = "opacity 0.4s";
    bootScreen.style.opacity = "0";
    setTimeout(() => { bootScreen.style.display = "none"; }, 400);
    appShell.hidden = false;
    // Mark first-run done
    Storage.setSettings({ firstRun: false });
  }

  // -------------- Permission & scanning --------------
  async function requestPermissionAndScan() {
    Cap.haptic("medium");
    if (!Cap.isNative || !Cap.Filesystem) {
      // Web fallback: open file picker
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "audio/*";
      input.multiple = true;
      // Try to support directory selection for batch import
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
      input.addEventListener("change", async (e) => {
        const songs = Library.scanFromFileList(e.target.files);
        await Library.addSongs(songs);
        renderAll();
        enterApp();
      });
      input.click();
      return;
    }

    // Native: request READ_MEDIA_AUDIO + POST_NOTIFICATIONS permissions first
    grantBtn.textContent = "Requesting permission...";
    grantBtn.disabled = true;

    if (Cap.Music) {
      try {
        await Cap.Music.requestNotificationPermission();
        const audioPerm = await Cap.Music.requestAudioPermission();
        if (!audioPerm || !audioPerm.granted) {
          Cap.toast("Storage permission is required to scan music files");
          grantBtn.textContent = "Grant Music Access";
          grantBtn.disabled = false;
          return;
        }
      } catch (e) {
        console.warn("permission request failed", e);
      }
    }

    grantBtn.textContent = "Scanning all music...";
    await scanLibraryNative();
    renderAll();
    enterApp();
  }

  /**
   * Scan all audio on the device using the native MediaStore-backed
   * `Cap.Music.scanAllAudio()` plugin method. This finds songs on:
   *   - Internal shared storage (/sdcard/Music, /sdcard/Download, etc.)
   *   - Removable SD card (/storage/XXXX-XXXX/Music, etc.)
   *   - USB OTG drives
   * Returns true if any songs were added.
   */
  async function scanLibraryNative() {
    if (!Cap.Music || !Cap.Music.scanAllAudio) {
      // Fallback to the old Filesystem-based scanner if the native
      // MediaStore method isn't available.
      return await scanLibraryFilesystemFallback();
    }
    let addedTotal = 0;
    try {
      const result = await Cap.Music.scanAllAudio();
      const songsRaw = (result && result.songs) || [];
      const count = result && typeof result.count === "number" ? result.count : songsRaw.length;
      if (result && result.error === "permission-denied") {
        Cap.toast("Storage permission denied");
        return 0;
      }
      // Convert content:// URIs to WebView-loadable URLs and pass through
      // makeSong() so the library gets rich metadata (title/artist/album/duration)
      // directly from MediaStore.
      const songs = songsRaw.map(s => {
        // Make sure each song's URI is converted from content:// → https://localhost/_capacitor_content_/...
        const convertedUri = s.uri ? Cap.convertFileSrc(s.uri) : null;
        return Library.makeSong(Object.assign({}, s, { uri: convertedUri }));
      });
      addedTotal = await Library.addSongs(songs);
      if (count > 0 && addedTotal === 0) {
        Cap.toast("Library already up to date (" + count + " songs)");
      } else if (addedTotal > 0) {
        Cap.toast("Found " + addedTotal + " songs (SD card + phone)");
      } else {
        Cap.toast("No music found on device");
      }
    } catch (e) {
      console.error("scanAllAudio failed", e);
      Cap.toast("Scan failed — trying fallback");
      addedTotal = await scanLibraryFilesystemFallback();
    }
    return addedTotal;
  }

  /** Fallback: scan common paths via the Capacitor Filesystem plugin. */
  async function scanLibraryFilesystemFallback() {
    const Filesystem = Cap.Filesystem;
    const Directory = (Filesystem && Filesystem.Directory) || {};
    const dirs = [
      // Internal shared storage (primary)
      { dir: Directory.ExternalStorage, path: "Music" },
      { dir: Directory.ExternalStorage, path: "Download" },
      { dir: Directory.ExternalStorage, path: "Downloads" },
      { dir: Directory.ExternalStorage, path: "Audiobooks" },
      { dir: Directory.ExternalStorage, path: "Podcasts" },
      { dir: Directory.ExternalStorage, path: "Recordings" },
      { dir: Directory.ExternalStorage, path: "DCIM" },
      // Application-specific external storage
      { dir: Directory.External, path: "Music" },
      { dir: Directory.External, path: "Download" }
    ];
    let addedTotal = 0;
    for (const d of dirs) {
      if (!d.dir) continue;
      try {
        const songs = await Library.scanPathWithFilesystem({ directory: d.dir, path: d.path });
        if (songs.length) {
          const added = await Library.addSongs(songs);
          addedTotal += added;
        }
      } catch (e) {
        // permission denied or path missing — skip
      }
    }
    if (addedTotal > 0) Cap.toast("Found " + addedTotal + " songs (fallback scan)");
    else Cap.toast("No music found in common folders");
    return addedTotal;
  }

  async function rescan() {
    if (!Cap.isNative || !Cap.Filesystem) {
      // Web: open picker
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "audio/*";
      input.multiple = true;
      input.addEventListener("change", async (e) => {
        const songs = Library.scanFromFileList(e.target.files);
        const added = await Library.addSongs(songs);
        renderAll();
        Cap.toast(added ? "Added " + added + " songs" : "No new songs found");
      });
      input.click();
      return;
    }
    Cap.toast("Scanning all storage (SD card + phone)...");
    const added = await scanLibraryNative();
    renderAll();
    if (added > 0) Cap.toast("Added " + added + " new songs");
    else Cap.toast("Library is up to date");
  }

  // -------------- Render --------------
  function renderAll() {
    renderSongs();
    renderAlbums();
    renderArtists();
    renderFolders();
    renderPlaylists();
    renderQuick();
    updateStats();
  }

  function updateStats() {
    const stats = Library.getStats();
    $("songsCount").textContent = stats.songs;
    $("albumsCount").textContent = stats.albums;
    $("artistsCount").textContent = stats.artists;
    Storage.getFavorites().then(favs => {
      $("favCount").textContent = favs.length + " song" + (favs.length === 1 ? "" : "s");
    });
    Storage.getRecents().then(rec => {
      $("recentCount").textContent = rec.length + " song" + (rec.length === 1 ? "" : "s");
    });
    Storage.getPlayCounts().then(counts => {
      const n = Object.keys(counts).length;
      $("mostCount").textContent = n + " song" + (n === 1 ? "" : "s");
    });
  }

  function renderSongs() {
    const list = $("songsList");
    const songs = Library.getAllSongs();
    UI.clear(list);
    if (!songs.length) {
      UI.empty(list, "No songs yet", "Scan your device or import audio files to start.", '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z"/></svg>');
      return;
    }
    const currentId = Player.getCurrentSong() ? Player.getCurrentSong().id : null;
    const frag = document.createDocumentFragment();
    songs.forEach(s => {
      frag.appendChild(UI.songRow(s, {
        playing: s.id === currentId,
        onPlay: (song) => playFromList(song, songs),
        onMenu: (song) => openSongMenu(song)
      }));
    });
    list.appendChild(frag);
  }

  function renderAlbums() {
    const grid = $("albumsGrid");
    const albums = Library.getAlbums();
    UI.clear(grid);
    if (!albums.length) { UI.empty(grid, "No albums", "Albums are grouped by folder name."); return; }
    albums.forEach(album => {
      const card = UI.el("button", { class: "card", "data-album": album.name });
      const art = UI.el("div", { class: "card-art" });
      art.style.background = UI.gradientFor(album.name);
      art.appendChild(UI.el("span", { class: "letter" }, UI.letterFor(album.name)));
      art.appendChild(UI.el("div", { class: "card-count" }, album.songs.length + " songs"));
      card.appendChild(art);
      card.appendChild(UI.el("div", { class: "card-title" }, album.name));
      card.appendChild(UI.el("div", { class: "card-sub" }, album.artist));
      card.addEventListener("click", () => openAlbumView(album));
      grid.appendChild(card);
    });
  }

  function renderArtists() {
    const grid = $("artistsGrid");
    const artists = Library.getArtists();
    UI.clear(grid);
    if (!artists.length) { UI.empty(grid, "No artists", "Artists are detected from filenames."); return; }
    artists.forEach(artist => {
      const card = UI.el("button", { class: "card", "data-artist": artist.name });
      const art = UI.el("div", { class: "card-art" });
      art.style.background = UI.gradientFor(artist.name);
      art.appendChild(UI.el("span", { class: "letter" }, UI.letterFor(artist.name)));
      art.appendChild(UI.el("div", { class: "card-count" }, artist.songs.length + " songs"));
      card.appendChild(art);
      card.appendChild(UI.el("div", { class: "card-title" }, artist.name));
      card.appendChild(UI.el("div", { class: "card-sub" }, artist.albums.length + (artist.albums.length === 1 ? " album" : " albums")));
      card.addEventListener("click", () => openArtistView(artist));
      grid.appendChild(card);
    });
  }

  function renderFolders() {
    const list = $("foldersList");
    const folders = Library.getFolders();
    UI.clear(list);
    if (!folders.length) { UI.empty(list, "No folders", "Folders are detected from your file structure."); return; }
    folders.forEach(folder => {
      const row = UI.el("button", { class: "song-row", "data-folder": folder.name });
      const art = UI.el("div", { class: "song-art" });
      art.style.background = UI.gradientFor(folder.name);
      art.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"/></svg>';
      art.style.color = "rgba(255,255,255,0.8)";
      const info = UI.el("div", { class: "song-info" },
        UI.el("div", { class: "song-title" }, folder.name),
        UI.el("div", { class: "song-meta" }, folder.songs.length + " songs")
      );
      row.appendChild(art); row.appendChild(info);
      row.addEventListener("click", () => openFolderView(folder));
      list.appendChild(row);
    });
  }

  function renderPlaylists() {
    const list = $("playlistsList");
    UI.clear(list);
    Storage.getPlaylists().then(playlists => {
      if (!playlists.length) {
        UI.empty(list, "No playlists", "Tap + New to create your first playlist.");
        return;
      }
      playlists.forEach(pl => {
        const row = UI.el("button", { class: "song-row", "data-playlist": pl.id });
        const art = UI.el("div", { class: "song-art" });
        art.style.background = UI.gradientFor(pl.id);
        art.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M3 6h13v2H3V6Zm0 5h13v2H3v-2Zm0 5h9v2H3v-2Zm15-9h2v6h-2V7Zm-3 5h7v2h-7v-2Z"/></svg>';
        art.style.color = "rgba(255,255,255,0.8)";
        const info = UI.el("div", { class: "song-info" },
          UI.el("div", { class: "song-title" }, pl.name),
          UI.el("div", { class: "song-meta" }, pl.songs.length + " song" + (pl.songs.length === 1 ? "" : "s"))
        );
        const actions = UI.el("button", { class: "icon-btn song-actions", "aria-label": "More" });
        actions.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/></svg>';
        row.appendChild(art); row.appendChild(info); row.appendChild(actions);
        row.addEventListener("click", (e) => {
          if (e.target.closest(".song-actions")) return;
          openPlaylistView(pl);
        });
        actions.addEventListener("click", (e) => {
          e.stopPropagation();
          openPlaylistMenu(pl);
        });
        list.appendChild(row);
      });
    });
  }

  function renderQuick() {
    const list = $("recentList");
    UI.clear(list);
    Storage.getRecents().then(recents => {
      const songs = recents.map(id => Library.getSong(id)).filter(Boolean).slice(0, 15);
      if (!songs.length) {
        UI.empty(list, "Nothing here yet", "Songs you play will appear here.");
        return;
      }
      const currentId = Player.getCurrentSong() ? Player.getCurrentSong().id : null;
      const frag = document.createDocumentFragment();
      songs.forEach(s => {
        frag.appendChild(UI.songRow(s, {
          playing: s.id === currentId,
          onPlay: (song) => playFromList(song, songs),
          onMenu: (song) => openSongMenu(song)
        }));
      });
      list.appendChild(frag);
    });
  }

  // -------------- View switching --------------
  function showView(name) {
    [mainView, searchView, quickView, eqView].forEach(v => v.hidden = true);
    const viewMap = { library: mainView, quick: quickView, equalizer: eqView, search: searchView };
    if (viewMap[name]) viewMap[name].hidden = false;
    // Update nav active state
    document.querySelectorAll(".nav-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.nav === name);
    });
    currentNav = name;
    const titles = { library: "Library", quick: "For You", equalizer: "Equalizer", search: "Search" };
    $("topbarViewName").textContent = titles[name] || "Library";
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.tab === tab));
    document.querySelectorAll(".tab-panel").forEach(p => p.hidden = true);
    const panel = $("tab-" + tab);
    if (panel) panel.hidden = false;
  }

  // -------------- Song menu (bottom sheet) --------------
  function openSongMenu(song) {
    Cap.haptic("light");
    const list = $("songSheetList");
    UI.clear(list);
    $("songSheetTitle").textContent = song.title;

    Storage.getFavorites().then(favs => {
      const isFav = favs.includes(song.id);
      const items = [
        { ic: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8 5v14l11-7L8 5Z"/></svg>', t: "Play", s: song.artist, action: () => { playFromList(song); UI.closeSheet(); } },
        { ic: isFav
            ? '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 21s-7-4.35-9.5-8.5C.9 9.4 2.2 5.5 6 5.5c2 0 3.4 1.1 4 2.3.6-1.2 2-2.3 4-2.3 3.8 0 5.1 3.9 3.5 7C19 16.65 12 21 12 21Z"/></svg>'
            : '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" d="M12 21s-7-4.35-9.5-8.5C.9 9.4 2.2 5.5 6 5.5c2 0 3.4 1.1 4 2.3.6-1.2 2-2.3 4-2.3 3.8 0 5.1 3.9 3.5 7C19 16.65 12 21 12 21Z"/></svg>',
          t: isFav ? "Remove from Favorites" : "Add to Favorites", s: null,
          action: async () => { await Storage.toggleFavorite(song.id); renderAll(); UI.closeSheet(); Cap.toast(isFav ? "Removed from favorites" : "Added to favorites"); }
        },
        { ic: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 6h13v2H3V6Zm0 5h13v2H3v-2Zm0 5h9v2H3v-2Zm15-9h2v6h-2V7Zm-3 5h7v2h-7v-2Z"/></svg>',
          t: "Add to Playlist", s: null, action: () => { UI.closeSheet(); openAddToPlaylistSheet(song); } },
        { ic: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 6h13v2H3V6Zm0 5h13v2H3v-2Zm0 5h9v2H3v-2Zm15-9h2v6h-2V7Zm-3 5h7v2h-7v-2Z"/></svg>',
          t: "Play Next", s: null, action: () => { playNext(song); UI.closeSheet(); } },
        { ic: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2Zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2Zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2Z"/></svg>',
          t: "Song Info", s: song.path || song.uri, action: () => { Cap.toast(song.title + " — " + song.artist + " • " + song.album); } }
      ];
      items.forEach(it => {
        const row = UI.el("button", { class: "sheet-row" });
        const icWrap = UI.el("div", { class: "row-ic" });
        icWrap.innerHTML = it.ic;
        const textWrap = UI.el("div", {}, UI.el("div", { class: "row-t" }, it.t));
        if (it.s) textWrap.appendChild(UI.el("div", { class: "row-s" }, it.s));
        row.appendChild(icWrap); row.appendChild(textWrap);
        row.addEventListener("click", it.action);
        list.appendChild(row);
      });
      UI.openSheet("songSheet");
    });
  }

  function openPlaylistMenu(pl) {
    const list = $("songSheetList");
    UI.clear(list);
    $("songSheetTitle").textContent = pl.name;
    const items = [
      { ic: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8 5v14l11-7L8 5Z"/></svg>',
        t: "Play All", s: pl.songs.length + " songs", action: () => playPlaylist(pl) },
      { ic: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg>',
        t: "Delete Playlist", s: null, action: async () => {
          await Storage.deletePlaylist(pl.id);
          renderPlaylists(); UI.closeSheet();
          Cap.toast("Playlist deleted");
        } }
    ];
    items.forEach(it => {
      const row = UI.el("button", { class: "sheet-row" });
      const icWrap = UI.el("div", { class: "row-ic" });
      icWrap.innerHTML = it.ic;
      const textWrap = UI.el("div", {}, UI.el("div", { class: "row-t" }, it.t));
      if (it.s) textWrap.appendChild(UI.el("div", { class: "row-s" }, it.s));
      row.appendChild(icWrap); row.appendChild(textWrap);
      row.addEventListener("click", () => { it.action(); UI.closeSheet(); });
      list.appendChild(row);
    });
    UI.openSheet("songSheet");
  }

  // -------------- Add-to-playlist sheet --------------
  function openAddToPlaylistSheet(song) {
    const list = $("addToPlaylistList");
    UI.clear(list);
    Storage.getPlaylists().then(playlists => {
      if (!playlists.length) {
        list.appendChild(UI.el("p", { class: "text-dim", style: "padding:12px;text-align:center;" }, "No playlists yet. Create one first."));
      }
      playlists.forEach(pl => {
        const row = UI.el("button", { class: "sheet-row" });
        const icWrap = UI.el("div", { class: "row-ic" });
        icWrap.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 6h13v2H3V6Zm0 5h13v2H3v-2Zm0 5h9v2H3v-2Zm15-9h2v6h-2V7Zm-3 5h7v2h-7v-2Z"/></svg>';
        const textWrap = UI.el("div", {},
          UI.el("div", { class: "row-t" }, pl.name),
          UI.el("div", { class: "row-s" }, pl.songs.length + " songs")
        );
        row.appendChild(icWrap); row.appendChild(textWrap);
        row.addEventListener("click", async () => {
          const added = await Storage.addToPlaylist(pl.id, song.id);
          UI.closeSheet();
          Cap.toast(added ? "Added to " + pl.name : "Already in " + pl.name);
        });
        list.appendChild(row);
      });
      UI.openSheet("addToPlaylistSheet");
    });
  }

  // -------------- Now Playing --------------
  function openNowPlaying() {
    if (!Player.getCurrentSong()) return;
    nowPlaying.hidden = false;
    nowPlaying.classList.remove("closing");
    updateNowPlayingArt();
  }

  function closeNowPlaying() {
    nowPlaying.classList.add("closing");
    setTimeout(() => { nowPlaying.hidden = true; nowPlaying.classList.remove("closing"); }, 280);
  }

  function updateNowPlayingArt() {
    const song = Player.getCurrentSong();
    if (!song) return;
    $("npTitle").textContent = song.title;
    $("npArtist").textContent = song.artist;
    $("npAlbum").textContent = song.album;
    const art = $("npArt");
    art.style.background = UI.gradientFor(song.id);
    const defaultArt = $("npArtDefault");
    defaultArt.innerHTML = '<span style="font-size:64px;font-weight:800;background:linear-gradient(135deg,#a78bfa,#38bdf8);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;">' + UI.letterFor(song.title) + '</span>';
    // Toggle shuffle / repeat button states
    $("npShuffle").classList.toggle("active", Player.getShuffle());
    $("npRepeat").classList.toggle("active", Player.getRepeat() !== "off");
    // Favorite state
    Storage.getFavorites().then(favs => {
      $("npFav").classList.toggle("active", favs.includes(song.id));
    });
  }

  // -------------- Playback helpers --------------
  function playFromList(song, list) {
    Cap.haptic("light");
    const songList = (list && list.length) ? list : Library.getAllSongs();
    const ids = songList.map(s => s.id);
    const idx = ids.indexOf(song.id);
    Player.setQueue(ids, idx >= 0 ? idx : 0);
    Player.playSong(song.id);
    Equalizer.activateOnPlay();
  }

  function playPlaylist(pl) {
    if (!pl.songs.length) { Cap.toast("Playlist is empty"); return; }
    const songs = pl.songs.map(id => Library.getSong(id)).filter(Boolean);
    if (!songs.length) { Cap.toast("No playable songs in playlist"); return; }
    const ids = songs.map(s => s.id);
    Player.setQueue(ids, 0);
    Player.playSong(ids[0]);
    Equalizer.activateOnPlay();
  }

  function playNext(song) {
    const q = Player.getQueue();
    if (!q.queue.length) { playFromList(song); return; }
    const newQueue = q.queue.slice();
    const insertAt = q.queueIndex + 1;
    newQueue.splice(insertAt, 0, song.id);
    Player.setQueue(newQueue, q.queueIndex);
    Cap.toast("Will play next: " + song.title);
  }

  function openAlbumView(album) {
    // Simple: filter songs list to this album and switch to songs tab
    const list = $("songsList");
    UI.clear(list);
    const currentId = Player.getCurrentSong() ? Player.getCurrentSong().id : null;
    album.songs.forEach(s => {
      list.appendChild(UI.songRow(s, {
        playing: s.id === currentId,
        onPlay: (song) => playFromList(song, album.songs),
        onMenu: (song) => openSongMenu(song)
      }));
    });
    switchTab("songs");
    showView("library");
    // Replace back behavior temporarily
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    Cap.toast("Viewing album: " + album.name);
    // Render a back chip
    setTimeout(() => { renderSongs(); document.querySelector('.chip[data-tab="songs"]').classList.add("active"); }, 60000);
  }

  function openArtistView(artist) {
    const list = $("songsList");
    UI.clear(list);
    const currentId = Player.getCurrentSong() ? Player.getCurrentSong().id : null;
    artist.songs.forEach(s => {
      list.appendChild(UI.songRow(s, {
        playing: s.id === currentId,
        onPlay: (song) => playFromList(song, artist.songs),
        onMenu: (song) => openSongMenu(song)
      }));
    });
    switchTab("songs");
    showView("library");
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    Cap.toast("Viewing artist: " + artist.name);
  }

  function openFolderView(folder) {
    const list = $("songsList");
    UI.clear(list);
    const currentId = Player.getCurrentSong() ? Player.getCurrentSong().id : null;
    folder.songs.forEach(s => {
      list.appendChild(UI.songRow(s, {
        playing: s.id === currentId,
        onPlay: (song) => playFromList(song, folder.songs),
        onMenu: (song) => openSongMenu(song)
      }));
    });
    switchTab("songs");
    showView("library");
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    Cap.toast("Viewing folder: " + folder.name);
  }

  function openPlaylistView(pl) {
    const list = $("songsList");
    UI.clear(list);
    if (!pl.songs.length) {
      UI.empty(list, "Empty playlist", "Add songs to this playlist from any song's menu.");
    } else {
      const currentId = Player.getCurrentSong() ? Player.getCurrentSong().id : null;
      const songs = pl.songs.map(id => Library.getSong(id)).filter(Boolean);
      songs.forEach(s => {
        list.appendChild(UI.songRow(s, {
          playing: s.id === currentId,
          onPlay: (song) => playFromList(song, songs),
          onMenu: (song) => openSongMenu(song)
        }));
      });
    }
    switchTab("songs");
    showView("library");
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    Cap.toast("Viewing playlist: " + pl.name);
  }

  // -------------- Restore last playback --------------
  async function restoreLastPlayback() {
    const last = await Storage.getLastState();
    if (!last || !last.songId) return;
    const song = Library.getSong(last.songId);
    if (!song) return;
    // Show mini player without auto-playing
    Player.audioEl.src = song.uri;
    Player.audioEl.load();
    try { Player.audioEl.currentTime = last.position || 0; } catch (_) {}
    updateMiniPlayer(song, false);
    updateNowPlayingArt();
  }

  // -------------- Mini player updates --------------
  function updateMiniPlayer(song, playing) {
    if (!song) { miniPlayer.hidden = true; appShell.classList.remove("has-mini"); return; }
    miniPlayer.hidden = false;
    appShell.classList.add("has-mini");
    $("mpTitle").textContent = song.title;
    $("mpArtist").textContent = song.artist;
    const art = $("mpArtImg");
    art.style.background = UI.gradientFor(song.id);
    // Update play icon
    const icon = $("mpPlayIcon");
    icon.innerHTML = playing
      ? '<path fill="currentColor" d="M6 5h4v14H6V5Zm8 0h4v14h-4V5Z"/>'
      : '<path fill="currentColor" d="M8 5v14l11-7L8 5Z"/>';
  }

  // -------------- Player event wiring --------------
  function wirePlayerEvents() {
    Player.on("song", (song) => {
      updateMiniPlayer(song, true);
      updateNowPlayingArt();
      renderAll();
    });
    Player.on("playback", ({ playing }) => {
      updateMiniPlayer(Player.getCurrentSong(), playing);
      nowPlaying.classList.toggle("playing", playing);
      // Update play icons
      const npIcon = $("npPlayIcon");
      const mpIcon = $("mpPlayIcon");
      npIcon.innerHTML = playing
        ? '<path fill="currentColor" d="M6 5h4v14H6V5Zm8 0h4v14h-4V5Z"/>'
        : '<path fill="currentColor" d="M8 5v14l11-7L8 5Z"/>';
      mpIcon.innerHTML = npIcon.innerHTML;
      // Update now-playing song row in lists
      document.querySelectorAll(".song-row.playing").forEach(r => {
        const art = r.querySelector(".song-art");
        if (art) art.querySelector(".playing-bars")?.remove();
      });
      document.querySelectorAll(".song-row").forEach(r => {
        if (r.dataset.songId === Player.getCurrentSong()?.id) {
          r.classList.add("playing");
        } else {
          r.classList.remove("playing");
        }
      });
      // Re-render songs list with current playing indicator
      // (lightweight: update only marked rows above; full re-render not needed)
    });
    Player.on("timeupdate", ({ current, duration }) => {
      // Mini player progress
      const fill = $("mpProgressFill");
      if (fill && duration) fill.style.width = (current / duration * 100) + "%";
      // Now playing progress
      if (!nowPlaying.hidden) {
        $("npCurrent").textContent = UI.fmtTime(current);
        $("npDuration").textContent = UI.fmtTime(duration);
        if (duration) {
          $("npProgressFill").style.width = (current / duration * 100) + "%";
          $("npProgressHandle").style.left = (current / duration * 100) + "%";
        }
      }
      // Visualizer
      if (nowPlaying.hidden === false) updateVisualizer();
    });
    Player.on("loadedmetadata", ({ duration }) => {
      if (!nowPlaying.hidden) $("npDuration").textContent = UI.fmtTime(duration);
    });
    Player.on("settings", ({ shuffle, repeat, volume }) => {
      $("npShuffle").classList.toggle("active", shuffle);
      $("npRepeat").classList.toggle("active", repeat !== "off");
      $("masterVolume").value = volume;
    });
    Player.on("error", ({ song }) => {
      // Visual indicator on song row
      Cap.toast("Could not play: " + (song ? song.title : "track"));
    });
  }

  // -------------- Visualizer (faux bars based on time) --------------
  let vizBars = [];
  function buildVisualizer() {
    const c = $("npVisualizer");
    UI.clear(c);
    vizBars = [];
    for (let i = 0; i < 24; i++) {
      const b = document.createElement("span");
      c.appendChild(b);
      vizBars.push(b);
    }
  }
  let vizT = 0;
  function updateVisualizer() {
    if (!vizBars.length) buildVisualizer();
    if (!Player.getIsPlaying()) {
      vizBars.forEach(b => b.style.height = "4px");
      return;
    }
    vizT += 0.18;
    vizBars.forEach((b, i) => {
      const base = 6 + Math.sin(vizT * 2 + i * 0.4) * 8 + Math.sin(vizT * 3.7 + i * 0.6) * 6;
      const h = Math.max(4, base + 6);
      b.style.height = h + "px";
    });
  }

  // -------------- UI event wiring --------------
  function wireEvents() {
    // Grant permission button
    grantBtn.addEventListener("click", requestPermissionAndScan);

    // Bottom nav
    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        Cap.haptic("light");
        showView(btn.dataset.nav);
      });
    });

    // Chips (library tabs)
    document.querySelectorAll(".chip").forEach(c => {
      c.addEventListener("click", () => switchTab(c.dataset.tab));
    });

    // Search
    $("searchBtn").addEventListener("click", () => {
      showView("search");
      setTimeout(() => $("searchInput").focus(), 100);
    });
    $("searchInput").addEventListener("input", (e) => {
      const q = e.target.value;
      $("clearSearch").hidden = !q;
      const results = Library.search(q);
      const list = $("searchResults");
      UI.clear(list);
      if (!q) { list.appendChild(UI.el("p", { class: "text-dim", style: "padding:20px;text-align:center;" }, "Type to search your library.")); return; }
      if (!results.length) { UI.empty(list, "No results", "Try a different keyword."); return; }
      const currentId = Player.getCurrentSong() ? Player.getCurrentSong().id : null;
      results.forEach(s => {
        list.appendChild(UI.songRow(s, {
          playing: s.id === currentId,
          onPlay: (song) => playFromList(song, results),
          onMenu: (song) => openSongMenu(song)
        }));
      });
    });
    $("clearSearch").addEventListener("click", () => {
      $("searchInput").value = "";
      $("clearSearch").hidden = true;
      UI.clear($("searchResults"));
    });

    // Menu button → rescan
    $("menuBtn").addEventListener("click", () => {
      Cap.haptic("light");
      // Build a quick actions sheet
      const list = $("songSheetList");
      UI.clear(list);
      $("songSheetTitle").textContent = "AURIX";
      const items = [
        { ic: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M17.6 6.4A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h7V4l-2.4 2.4Z"/></svg>',
          t: "Rescan Library", s: "Find new music files", action: rescan },
        { ic: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2 4 6v6c0 5 3.4 9.5 8 10 4.6-.5 8-5 8-10V6l-8-4Z"/></svg>',
          t: "About AURIX", s: "v1.0.0 • NCX", action: () => Cap.toast("AURIX Music Player v1.0.0 • NCX / NayonCodeX") }
      ];
      items.forEach(it => {
        const row = UI.el("button", { class: "sheet-row" });
        const icWrap = UI.el("div", { class: "row-ic" });
        icWrap.innerHTML = it.ic;
        const textWrap = UI.el("div", {}, UI.el("div", { class: "row-t" }, it.t));
        if (it.s) textWrap.appendChild(UI.el("div", { class: "row-s" }, it.s));
        row.appendChild(icWrap); row.appendChild(textWrap);
        row.addEventListener("click", () => { it.action(); UI.closeSheet(); });
        list.appendChild(row);
      });
      UI.openSheet("songSheet");
    });

    // New playlist button
    $("newPlaylistBtn").addEventListener("click", () => {
      $("playlistName").value = "";
      UI.openSheet("playlistSheet");
      setTimeout(() => $("playlistName").focus(), 100);
    });
    $("createPlaylistBtn").addEventListener("click", async () => {
      const name = $("playlistName").value.trim();
      if (!name) { Cap.toast("Enter a name"); return; }
      const id = await Storage.createPlaylist(name);
      UI.closeSheet();
      renderPlaylists();
      Cap.toast("Playlist created");
    });
    $("playlistName").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("createPlaylistBtn").click();
    });

    // Quick tiles
    document.querySelectorAll(".quick-tile").forEach(t => {
      t.addEventListener("click", async () => {
        Cap.haptic("light");
        const which = t.dataset.quick;
        if (which === "favorites") {
          const favs = await Storage.getFavorites();
          const songs = favs.map(id => Library.getSong(id)).filter(Boolean);
          openCustomList("Favorites", songs);
        } else if (which === "recent") {
          const rec = await Storage.getRecents();
          const songs = rec.map(id => Library.getSong(id)).filter(Boolean);
          openCustomList("Recently Played", songs);
        } else if (which === "mostplayed") {
          const counts = await Storage.getPlayCounts();
          const ids = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
          const songs = ids.map(id => Library.getSong(id)).filter(Boolean);
          openCustomList("Most Played", songs);
        }
      });
    });

    // Sheet cancel buttons
    document.querySelectorAll(".sheet-cancel").forEach(b => {
      b.addEventListener("click", UI.closeSheet);
    });
    $("sheetBackdrop").addEventListener("click", UI.closeSheet);

    // Mini player
    $("mpArt").addEventListener("click", openNowPlaying);
    $("mpInfo").addEventListener("click", openNowPlaying);
    $("mpPlay").addEventListener("click", () => { Cap.haptic("light"); Player.togglePlay(); });
    $("mpNext").addEventListener("click", () => { Cap.haptic("light"); Player.next(); });

    // Now Playing controls
    $("npClose").addEventListener("click", closeNowPlaying);
    $("npPlay").addEventListener("click", () => { Cap.haptic("light"); Player.togglePlay(); Equalizer.activateOnPlay(); });
    $("npNext2").addEventListener("click", () => { Cap.haptic("light"); Player.next(); });
    $("npPrev").addEventListener("click", () => { Cap.haptic("light"); Player.previous(); });
    $("npShuffle").addEventListener("click", () => {
      Cap.haptic("light");
      Player.setShuffle(!Player.getShuffle());
      $("npShuffle").classList.toggle("active", Player.getShuffle());
    });
    $("npRepeat").addEventListener("click", () => {
      Cap.haptic("light");
      const cur = Player.getRepeat();
      const next = cur === "off" ? "all" : cur === "all" ? "one" : "off";
      Player.setRepeat(next);
      $("npRepeat").classList.toggle("active", next !== "off");
      Cap.toast("Repeat: " + next);
    });
    $("npFav").addEventListener("click", async () => {
      Cap.haptic("light");
      const song = Player.getCurrentSong();
      if (!song) return;
      const isFav = await Storage.toggleFavorite(song.id);
      $("npFav").classList.toggle("active", isFav);
      Cap.toast(isFav ? "Added to favorites" : "Removed from favorites");
    });
    $("npAddPlaylist").addEventListener("click", () => {
      const song = Player.getCurrentSong();
      if (song) openAddToPlaylistSheet(song);
    });

    // Now playing progress bar
    let dragging = false;
    const npProg = $("npProgress");
    function progressFromEvent(e) {
      const rect = npProg.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const ratio = Math.max(0, Math.min(1, x / rect.width));
      return ratio;
    }
    npProg.addEventListener("pointerdown", (e) => {
      dragging = true;
      npProg.setPointerCapture(e.pointerId);
      const ratio = progressFromEvent(e);
      Player.seek(ratio);
    });
    npProg.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const ratio = progressFromEvent(e);
      $("npProgressFill").style.width = (ratio * 100) + "%";
      $("npProgressHandle").style.left = (ratio * 100) + "%";
    });
    npProg.addEventListener("pointerup", (e) => {
      if (!dragging) return;
      dragging = false;
      const ratio = progressFromEvent(e);
      Player.seek(ratio);
    });

    // Equalizer presets
    document.querySelectorAll(".eq-preset").forEach(b => {
      b.addEventListener("click", () => {
        Cap.haptic("light");
        document.querySelectorAll(".eq-preset").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        Equalizer.applyPreset(b.dataset.preset);
        refreshEqBandsUI();
      });
    });

    // Master volume
    $("masterVolume").addEventListener("input", (e) => {
      Player.setVolume(parseFloat(e.target.value));
    });

    // App lifecycle: save state on background
    if (Cap.App && Cap.App.addListener) {
      Cap.App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) Player.persistState();
      });
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") Player.persistState();
    });

    // Build visualizer
    buildVisualizer();

    // Initial EQ UI
    initEqualizerUI();
  }

  function openCustomList(title, songs) {
    const list = $("songsList");
    UI.clear(list);
    if (!songs.length) {
      UI.empty(list, "Nothing here yet", "Songs you play will appear here.");
    } else {
      const currentId = Player.getCurrentSong() ? Player.getCurrentSong().id : null;
      songs.forEach(s => {
        list.appendChild(UI.songRow(s, {
          playing: s.id === currentId,
          onPlay: (song) => playFromList(song, songs),
          onMenu: (song) => openSongMenu(song)
        }));
      });
    }
    switchTab("songs");
    showView("library");
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    Cap.toast(title);
  }

  // -------------- Equalizer UI --------------
  function initEqualizerUI() {
    const bandsContainer = $("eqBands");
    UI.clear(bandsContainer);
    const bandLabels = ["60Hz", "230Hz", "910Hz", "3.6k", "14k"];
    const currentBands = Equalizer.getBands();
    bandLabels.forEach((label, i) => {
      const band = UI.el("div", { class: "eq-band" });
      const val = UI.el("div", { class: "eq-val" }, (currentBands[i] || 0) + "dB");
      const input = UI.el("input", { type: "range", min: "-12", max: "12", step: "1", value: currentBands[i] || 0, "data-band": i });
      input.addEventListener("input", (e) => {
        const v = parseInt(e.target.value, 10);
        val.textContent = v + "dB";
        Equalizer.setBand(i, v);
        // Mark preset as custom
        document.querySelectorAll(".eq-preset").forEach(x => x.classList.remove("active"));
        Storage.setSettings({ eqBands: Equalizer.getBands(), eqPreset: "custom" });
      });
      band.appendChild(val);
      band.appendChild(input);
      band.appendChild(UI.el("label", {}, label));
      bandsContainer.appendChild(band);
    });
    // Activate preset button based on saved state
    const preset = Equalizer.getPreset();
    document.querySelectorAll(".eq-preset").forEach(b => b.classList.toggle("active", b.dataset.preset === preset));
    // Master volume slider
    $("masterVolume").value = Player.getVolume();
  }
  function refreshEqBandsUI() {
    const bands = Equalizer.getBands();
    document.querySelectorAll(".eq-band input").forEach((inp, i) => {
      inp.value = bands[i] || 0;
      const val = inp.parentElement.querySelector(".eq-val");
      if (val) val.textContent = (bands[i] || 0) + "dB";
    });
  }

  // -------------- Boot --------------
  document.addEventListener("DOMContentLoaded", boot);

  // Expose for debugging
  global.Aurix = { rescan, renderAll, openNowPlaying };
})(window);
