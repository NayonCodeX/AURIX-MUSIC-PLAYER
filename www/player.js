/* ============================================================
   player.js — AURIX audio player controller.
   Owns the <audio> element, queue, shuffle/repeat, and the
   W3C MediaSession API integration for notification + lock
   screen controls on Android.
   ============================================================ */

(function (global) {
  "use strict";

  // -------------- State --------------
  const audioEl = document.getElementById("audioEl");

  let queue = [];          // array of song ids in current order
  let queueIndex = -1;     // index into queue
  let originalOrder = [];  // pre-shuffle order (for un-shuffle)
  let currentSong = null;  // resolved song object
  let isPlaying = false;
  let shuffle = false;
  let repeat = "off";      // off | all | one
  let volume = 1;
  let seekInProgress = false;
  let listeners = new Map(); // event name → Set<fn>

  // -------------- Event emitter --------------
  function on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
  }
  function off(name, fn) {
    const s = listeners.get(name);
    if (s) s.delete(fn);
  }
  function emit(name, payload) {
    const s = listeners.get(name);
    if (!s) return;
    s.forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
  }

  // -------------- Persistence --------------
  async function persistState() {
    if (!currentSong) return;
    try {
      await Storage.setLastState({
        songId: currentSong.id,
        queue,
        queueIndex,
        shuffle,
        repeat,
        volume,
        position: audioEl.currentTime || 0,
        duration: audioEl.duration || 0,
        savedAt: Date.now()
      });
    } catch (e) { console.warn("persist state failed", e); }
  }

  async function loadSettings() {
    const s = await Storage.getSettings();
    shuffle = !!s.shuffle;
    repeat = ["off", "all", "one"].includes(s.repeat) ? s.repeat : "off";
    volume = (typeof s.volume === "number") ? s.volume : 1;
    audioEl.volume = volume;
    emit("settings", { shuffle, repeat, volume });
  }

  async function saveSettings() {
    await Storage.setSettings({ shuffle, repeat, volume });
  }

  // -------------- Queue management --------------
  function setQueue(songIds, startIndex) {
    originalOrder = songIds.slice();
    if (shuffle) {
      queue = shuffleArray(songIds.slice());
    } else {
      queue = songIds.slice();
    }
    queueIndex = (typeof startIndex === "number" && startIndex >= 0) ? startIndex : 0;
    emit("queue", { queue, queueIndex });
  }

  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function setShuffle(on) {
    if (on === shuffle) return;
    shuffle = on;
    if (on) {
      // Re-shuffle but keep current song at position 0
      const currentId = queue[queueIndex];
      const rest = queue.filter(id => id !== currentId);
      queue = [currentId].concat(shuffleArray(rest));
      queueIndex = 0;
    } else {
      // Restore original order, find current song
      const currentId = queue[queueIndex];
      queue = originalOrder.slice();
      queueIndex = queue.indexOf(currentId);
      if (queueIndex < 0) queueIndex = 0;
    }
    emit("queue", { queue, queueIndex });
    emit("shuffle", shuffle);
    saveSettings();
  }

  function setRepeat(mode) {
    if (!["off", "all", "one"].includes(mode)) return;
    repeat = mode;
    emit("repeat", repeat);
    saveSettings();
  }

  function setVolume(v) {
    v = Math.max(0, Math.min(1, v));
    volume = v;
    audioEl.volume = v;
    emit("volume", v);
    saveSettings();
  }

  // -------------- Playback --------------
  async function playSong(songId, opts) {
    const song = Library.getSong(songId);
    if (!song) { Cap.toast("Song not found in library"); return; }
    if (!song.uri) { Cap.toast("Cannot play this file (no path)"); return; }

    currentSong = song;
    emit("song", song);

    // Update queue index if part of queue
    if (queue.length && queue[queueIndex] !== songId) {
      const idx = queue.indexOf(songId);
      if (idx >= 0) queueIndex = idx;
    }

    try {
      audioEl.src = song.uri;
      audioEl.load();
      await audioEl.play();
      isPlaying = true;
      startNativeService();
      emit("playback", { playing: true });
      updateMediaSession();
      await Storage.addRecent(songId);
      await Storage.incPlayCount(songId);
      persistState();
    } catch (e) {
      console.error("play failed", e);
      Cap.toast("Unable to play this track");
      emit("error", { song, error: e });
    }
  }

  async function play() {
    if (!currentSong) {
      // Resume from last state or play first
      const last = await Storage.getLastState();
      if (last && Library.getSong(last.songId)) {
        queue = last.queue || [];
        queueIndex = Math.max(0, last.queueIndex || 0);
        await playSong(last.songId);
        if (last.position) {
          try { audioEl.currentTime = last.position; } catch (_) {}
        }
      } else {
        const songs = Library.getAllSongs();
        if (songs.length) {
          setQueue(songs.map(s => s.id), 0);
          await playSong(songs[0].id);
        }
      }
      return;
    }
    try {
      await audioEl.play();
      isPlaying = true;
      startNativeService();
      emit("playback", { playing: true });
      updateMediaSession();
      persistState();
    } catch (e) {
      console.error("play failed", e);
      Cap.toast("Playback failed");
    }
  }

  function pause() {
    audioEl.pause();
    isPlaying = false;
    emit("playback", { playing: false });
    updateMediaSession();
    persistState();
  }

  function togglePlay() {
    if (isPlaying) pause(); else play();
  }

  function stop() {
    audioEl.pause();
    audioEl.currentTime = 0;
    isPlaying = false;
    emit("playback", { playing: false });
    stopNativeService();
    if (navigator.mediaSession) navigator.mediaSession.playbackState = "none";
  }

  async function next(auto = false) {
    if (!queue.length) return;
    if (auto && repeat === "one") {
      audioEl.currentTime = 0;
      await audioEl.play();
      return;
    }
    let nextIdx = queueIndex + 1;
    if (nextIdx >= queue.length) {
      if (repeat === "all") nextIdx = 0;
      else { pause(); return; }
    }
    queueIndex = nextIdx;
    await playSong(queue[queueIndex]);
  }

  async function previous() {
    if (!queue.length) return;
    // If more than 3 seconds in, restart current
    if (audioEl.currentTime > 3) {
      audioEl.currentTime = 0;
      return;
    }
    let prevIdx = queueIndex - 1;
    if (prevIdx < 0) {
      if (repeat === "all") prevIdx = queue.length - 1;
      else prevIdx = 0;
    }
    queueIndex = prevIdx;
    await playSong(queue[queueIndex]);
  }

  function seek(ratio) {
    if (!audioEl.duration) return;
    audioEl.currentTime = Math.max(0, Math.min(audioEl.duration, ratio * audioEl.duration));
    emit("timeupdate", { current: audioEl.currentTime, duration: audioEl.duration });
  }

  function getCurrentSong() { return currentSong; }
  function getIsPlaying() { return isPlaying; }
  function getQueue() { return { queue, queueIndex, originalOrder }; }
  function getShuffle() { return shuffle; }
  function getRepeat() { return repeat; }
  function getVolume() { return volume; }

  // -------------- Media Session (W3C) --------------
  function updateMediaSession() {
    if (!currentSong) return;
    // Native: prefer the AURIX Music plugin (foreground service + MediaSession + AudioFocus).
    // Web fallback: use the W3C MediaSession API.
    if (Cap.isNative && Cap.Music) {
      try {
        Cap.Music.updateInfo({
          title: currentSong.title || "Unknown",
          artist: currentSong.artist || "Unknown Artist",
          album: currentSong.album || "",
          duration: Math.round((audioEl.duration || 0) * 1000),
          position: Math.round((audioEl.currentTime || 0) * 1000),
          isPlaying: isPlaying
        }).catch(() => {});
      } catch (e) { console.warn("Music.updateInfo failed", e); }
      return;
    }
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentSong.title || "Unknown",
        artist: currentSong.artist || "Unknown Artist",
        album: currentSong.album || "Unknown Album",
        artwork: [
          { src: "assets/img/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "assets/img/icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      });
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
      try {
        navigator.mediaSession.setPositionState({
          duration: audioEl.duration || 0,
          playbackRate: audioEl.playbackRate || 1,
          position: Math.min(audioEl.currentTime || 0, audioEl.duration || 0)
        });
      } catch (_) {}
    } catch (e) {
      console.warn("MediaSession update failed", e);
    }
  }

  function setupMediaSessionHandlers() {
    // On native Android, notification button taps come through the AURIX
    // Music plugin's `musicAction` event. On web, fall back to the W3C API.
    if (Cap.isNative && Cap.Music) {
      try {
        Cap.Music.addListener("musicAction", (e) => {
          const action = (e && e.action) || "";
          if (action === "play") play();
          else if (action === "pause") pause();
          else if (action === "next") next(true);
          else if (action === "previous") previous();
          else if (action === "stop") stop();
          else if (typeof action === "string" && action.startsWith("seek:")) {
            const ms = parseInt(action.slice(5), 10) || 0;
            audioEl.currentTime = ms / 1000;
            updateMediaSession();
          }
        });
      } catch (e) { console.warn("Music.addListener failed", e); }
      return;
    }
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler("play", () => play());
      navigator.mediaSession.setActionHandler("pause", () => pause());
      navigator.mediaSession.setActionHandler("previoustrack", () => previous());
      navigator.mediaSession.setActionHandler("nexttrack", () => next(true));
      navigator.mediaSession.setActionHandler("seekbackward", (d) => {
        audioEl.currentTime = Math.max(0, audioEl.currentTime - (d.seekOffset || 10));
      });
      navigator.mediaSession.setActionHandler("seekforward", (d) => {
        audioEl.currentTime = Math.min(audioEl.duration, audioEl.currentTime + (d.seekOffset || 10));
      });
      navigator.mediaSession.setActionHandler("seekto", (d) => {
        if (d.fastSeek && "fastSeek" in HTMLMediaElement.prototype) audioEl.fastSeek(d.seekTime);
        else audioEl.currentTime = d.seekTime;
      });
      navigator.mediaSession.setActionHandler("stop", () => stop());
    } catch (e) { console.warn("mediaSession handlers setup failed", e); }
  }

  // -------------- Foreground service control --------------
  function startNativeService() {
    if (Cap.isNative && Cap.Music) {
      Cap.Music.startService().catch(() => {});
    }
  }
  function stopNativeService() {
    if (Cap.isNative && Cap.Music) {
      Cap.Music.stopService().catch(() => {});
    }
  }

  // -------------- Audio element event wiring --------------
  function setupAudioEvents() {
    audioEl.addEventListener("loadedmetadata", () => {
      emit("loadedmetadata", { duration: audioEl.duration });
      updateMediaSession();
    });
    audioEl.addEventListener("timeupdate", () => {
      if (seekInProgress) return;
      emit("timeupdate", { current: audioEl.currentTime, duration: audioEl.duration });
    });
    audioEl.addEventListener("durationchange", () => {
      emit("durationchange", { duration: audioEl.duration });
    });
    audioEl.addEventListener("ended", () => {
      emit("ended", {});
      next(true);
    });
    audioEl.addEventListener("play", () => {
      isPlaying = true;
      emit("playback", { playing: true });
      updateMediaSession();
    });
    audioEl.addEventListener("pause", () => {
      // Only treat as paused if not just seeking/buffering
      isPlaying = false;
      emit("playback", { playing: false });
      updateMediaSession();
      persistState();
    });
    audioEl.addEventListener("error", (e) => {
      console.error("audio error", audioEl.error);
      emit("error", { song: currentSong, error: audioEl.error });
      Cap.toast("Could not play this file");
      // Skip to next on error after short delay
      setTimeout(() => next(true), 600);
    });
    audioEl.addEventListener("waiting", () => emit("buffering", { buffering: true }));
    audioEl.addEventListener("canplay", () => emit("buffering", { buffering: false }));
  }

  // -------------- Init --------------
  async function init() {
    await loadSettings();
    setupAudioEvents();
    setupMediaSessionHandlers();
    // Restore last state queue (without auto-playing)
    const last = await Storage.getLastState();
    if (last && last.queue && last.queue.length) {
      queue = last.queue;
      queueIndex = Math.max(0, Math.min(last.queueIndex || 0, queue.length - 1));
      originalOrder = last.queue; // best-effort
    }
    // Periodic state save (every 10s while playing)
    setInterval(() => { if (isPlaying) persistState(); }, 10000);
  }

  // -------------- Expose --------------
  global.Player = {
    init,
    on, off,
    setQueue, setShuffle, setRepeat, setVolume,
    playSong, play, pause, togglePlay, stop, next, previous, seek,
    getCurrentSong, getIsPlaying, getQueue, getShuffle, getRepeat, getVolume,
    persistState, updateMediaSession,
    audioEl
  };
})(window);
