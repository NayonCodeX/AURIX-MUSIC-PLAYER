/* ============================================================
   capacitor.js — Bridge between web UI and Capacitor plugins.
   Provides a unified `Cap` global with graceful fallback to
   plain-browser stubs so the app also runs in a desktop browser
   during development.
   ============================================================ */

(function (global) {
  "use strict";

  const hasCapacitor = typeof global.Capacitor !== "undefined" && !!global.Capacitor.isNativePlatform;
  const isNative = hasCapacitor && global.Capacitor.isNativePlatform();

  // Lazy plugin getters (so we don't crash if a plugin isn't installed)
  function plugin(name) {
    if (!global.Capacitor || !global.Capacitor.Plugins) return null;
    return global.Capacitor.Plugins[name] || null;
  }

  // Filesystem plugin (for folder scanning via Filesystem.readdir / stat)
  const Filesystem = plugin("Filesystem");
  const Preferences = plugin("Preferences");
  const App$ = plugin("App");
  const StatusBar = plugin("StatusBar");
  const Haptics = plugin("Haptics");
  // Native AURIX music integration (foreground service + MediaSession)
  const Music = plugin("Music");

  // ---------- Storage abstraction ----------
  const Storage = (function () {
    const memStore = {};
    async function get(key) {
      if (Preferences) {
        try {
          const r = await Preferences.get({ key });
          return r.value || null;
        } catch (e) { console.warn("Preferences.get failed", e); }
      }
      try {
        const v = localStorage.getItem(key);
        return v;
      } catch (_) {
        return memStore[key] || null;
      }
    }
    async function set(key, value) {
      if (Preferences) {
        try { await Preferences.set({ key, value: String(value == null ? "" : value) }); return; }
        catch (e) { console.warn("Preferences.set failed", e); }
      }
      try { localStorage.setItem(key, value); }
      catch (_) { memStore[key] = value; }
    }
    async function remove(key) {
      if (Preferences) {
        try { await Preferences.remove({ key }); return; }
        catch (e) { console.warn("Preferences.remove failed", e); }
      }
      try { localStorage.removeItem(key); } catch (_) { delete memStore[key]; }
    }
    return { get, set, remove };
  })();

  // ---------- Toast helper ----------
  function toast(message, ms = 2200) {
    const el = document.getElementById("toast");
    if (!el) { console.log("[toast]", message); return; }
    el.textContent = message;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, ms);
  }

  // ---------- Haptic feedback (optional) ----------
  function haptic(style = "light") {
    if (Haptics && Haptics.impact) {
      Haptics.impact({ style }).catch(() => {});
    } else if (navigator.vibrate) {
      try { navigator.vibrate(style === "medium" ? 18 : 10); } catch (_) {}
    }
  }

  // ---------- Expose ----------
  global.Cap = {
    isNative,
    Filesystem,
    Preferences,
    App: App$,
    StatusBar,
    Music,
    Storage,
    toast,
    haptic,
    platform: isNative ? "android" : "web"
  };

  // Configure status bar if available
  if (isNative && StatusBar) {
    StatusBar.setStyle({ style: "DARK" }).catch(() => {});
    StatusBar.setBackgroundColor({ color: "#070713" }).catch(() => {});
  }
})(window);
