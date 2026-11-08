/* ============================================================
   equalizer.js — AURIX Web Audio API equalizer.
   Connects the <audio> element through a BiquadFilter chain
   (low-shelf → 5 peaking → high-shelf) plus master gain.
   Falls back gracefully if Web Audio API is unavailable
   (in which case sliders are disabled).
   ============================================================ */

(function (global) {
  "use strict";

  const BAND_FREQS = [60, 230, 910, 3600, 14000];
  // 7 bands total: low-shelf(60Hz), peaking(230, 910, 3600), high-shelf(14k), plus we present 5 visible sliders
  // Actually we'll do 5 peaking bands + low shelf + high shelf = 7 filters, but expose 5 user-facing sliders
  // for the peaking bands, plus bass/treble presets adjust the shelves.
  // To keep UI simple, expose 5 sliders (60, 230, 910, 3600, 14000 Hz) as peaking/low/high.

  const PRESETS = {
    flat:       [0, 0, 0, 0, 0],
    bass:       [9, 6, 2, 0, 0],
    treble:     [0, 0, 2, 6, 9],
    vocal:      [-3, 0, 5, 4, 0],
    pop:        [-1, 3, 5, 3, -1],
    rock:       [5, 2, -1, 3, 5],
    jazz:       [3, 1, 0, 2, 4],
    electronic: [6, 4, 0, 4, 7]
  };

  let ctx = null;
  let source = null;
  let filters = [];
  let masterGain = null;
  let currentPreset = "flat";
  let bands = PRESETS.flat.slice();
  let ready = false;

  // -------------- Setup --------------
  function ensureContext() {
    if (ctx) return true;
    try {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      return true;
    } catch (e) {
      console.warn("AudioContext init failed", e);
      return false;
    }
  }

  function buildGraph() {
    if (!ensureContext()) return false;
    if (!Player || !Player.audioEl) return false;
    try {
      source = ctx.createMediaElementSource(Player.audioEl);
    } catch (e) {
      // Already connected to another source
      console.warn("MediaElementSource already created?", e);
      return false;
    }
    // Build 5 filters matching BAND_FREQS
    filters = BAND_FREQS.map((freq, i) => {
      let type = "peaking";
      if (i === 0) type = "lowshelf";
      if (i === BAND_FREQS.length - 1) type = "highshelf";
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = 1.0;
      f.gain.value = bands[i] || 0;
      return f;
    });
    masterGain = ctx.createGain();
    masterGain.gain.value = 1.0;

    // Chain: source → f0 → f1 → ... → masterGain → destination
    let node = source;
    for (const f of filters) {
      node.connect(f);
      node = f;
    }
    node.connect(masterGain);
    masterGain.connect(ctx.destination);
    ready = true;
    return true;
  }

  function setBand(i, gainDb) {
    if (!filters[i]) return;
    bands[i] = gainDb;
    filters[i].gain.value = gainDb;
  }

  function applyPreset(name) {
    if (!PRESETS[name]) return;
    currentPreset = name;
    bands = PRESETS[name].slice();
    if (ready) {
      bands.forEach((g, i) => {
        if (filters[i]) filters[i].gain.value = g;
      });
    }
    Storage.setSettings({ eqPreset: name, eqBands: bands });
  }

  function applyBands(bandArr) {
    bands = bandArr.slice();
    if (ready) {
      bands.forEach((g, i) => { if (filters[i]) filters[i].gain.value = g; });
    }
    Storage.setSettings({ eqBands: bands, eqPreset: "custom" });
    currentPreset = "custom";
  }

  function setMasterVolume(v) {
    if (!masterGain) return;
    masterGain.gain.value = Math.max(0, Math.min(1, v));
  }

  async function resume() {
    if (!ctx) return;
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch (e) {}
    }
  }

  async function suspend() {
    if (!ctx) return;
    if (ctx.state === "running") {
      try { await ctx.suspend(); } catch (e) {}
    }
  }

  async function init() {
    const s = await Storage.getSettings();
    currentPreset = s.eqPreset || "flat";
    if (s.eqBands && Array.isArray(s.eqBands) && s.eqBands.length === 5) {
      bands = s.eqBands.slice();
    } else {
      bands = (PRESETS[currentPreset] || PRESETS.flat).slice();
    }
  }

  // Lazy-activate on first play (browsers require user gesture for AudioContext)
  function activateOnPlay() {
    if (ready) { resume(); return; }
    if (buildGraph()) { resume(); }
  }

  // -------------- Expose --------------
  global.Equalizer = {
    BAND_FREQS, PRESETS,
    init, activateOnPlay, resume, suspend,
    setBand, applyPreset, applyBands, setMasterVolume,
    getBands() { return bands.slice(); },
    getPreset() { return currentPreset; },
    isReady() { return ready; }
  };
})(window);
