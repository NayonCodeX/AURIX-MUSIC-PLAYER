/* ============================================================
   ui.js — AURIX UI rendering helpers.
   Pure DOM manipulation, no framework. Renders song rows,
   cards, lists, sheets, toasts, and the now-playing screen.
   ============================================================ */

(function (global) {
  "use strict";

  // -------------- Helpers --------------
  function el(tag, props, ...children) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === "class") e.className = props[k];
        else if (k === "html") e.innerHTML = props[k];
        else if (k === "style") e.setAttribute("style", props[k]);
        else if (k.startsWith("data-")) e.setAttribute(k, props[k]);
        else if (k.startsWith("on") && typeof props[k] === "function") {
          e.addEventListener(k.slice(2).toLowerCase(), props[k]);
        } else if (props[k] != null) e.setAttribute(k, props[k]);
      }
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(x => x && e.appendChild(x.nodeType ? x : document.createTextNode(String(x))));
      else e.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function fmtTime(sec) {
    if (!sec || isNaN(sec) || sec < 0) return "0:00";
    sec = Math.floor(sec);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + (s < 10 ? "0" + s : s);
  }

  function letterFor(name) {
    if (!name) return "?";
    const c = name.trim().charAt(0).toUpperCase();
    return /[A-Z0-9]/.test(c) ? c : "#";
  }

  function gradientFor(seed) {
    // Deterministic gradient based on string hash
    let h = 0;
    const s = String(seed || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    const palettes = [
      ["#a78bfa", "#38bdf8"],
      ["#fb7185", "#a78bfa"],
      ["#38bdf8", "#34d399"],
      ["#fbbf24", "#fb7185"],
      ["#8b5cf6", "#ec4899"],
      ["#06b6d4", "#8b5cf6"]
    ];
    const p = palettes[Math.abs(h) % palettes.length];
    return `linear-gradient(135deg, ${p[0]} 0%, ${p[1]} 100%)`;
  }

  function artElement(opts) {
    // opts: { songId, label, src, size }
    const wrap = el("div", { class: opts.cls || "song-art" });
    if (opts.src) {
      const img = el("img", { src: opts.src, alt: "" });
      img.addEventListener("error", () => {
        wrap.innerHTML = "";
        wrap.style.background = gradientFor(opts.songId || opts.label);
        wrap.appendChild(el("span", { class: "song-art-letter" }, letterFor(opts.label)));
      });
      wrap.appendChild(img);
    } else {
      wrap.style.background = gradientFor(opts.songId || opts.label);
      wrap.appendChild(el("span", { class: "song-art-letter" }, letterFor(opts.label)));
    }
    return wrap;
  }

  // -------------- Song Row --------------
  function songRow(song, opts) {
    opts = opts || {};
    const row = el("div", { class: "song-row", "data-song-id": song.id });
    if (opts.playing) row.classList.add("playing");

    const art = el("div", { class: "song-art" });
    art.style.background = gradientFor(song.id);
    if (opts.playing) {
      art.appendChild(el("div", { class: "playing-bars" },
        el("span"), el("span"), el("span")));
    } else {
      art.appendChild(el("span", { class: "song-art-letter" }, letterFor(song.title)));
    }

    const info = el("div", { class: "song-info" },
      el("div", { class: "song-title" }, song.title),
      el("div", { class: "song-meta" },
        song.artist,
        el("span", { class: "dot" }, "•"),
        song.album
      )
    );

    const actions = el("button", { class: "icon-btn song-actions", "aria-label": "More" });
    actions.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/></svg>';

    row.appendChild(art);
    row.appendChild(info);
    row.appendChild(actions);

    row.addEventListener("click", (e) => {
      if (e.target.closest(".song-actions")) return;
      if (opts.onPlay) opts.onPlay(song);
    });
    actions.addEventListener("click", (e) => {
      e.stopPropagation();
      if (opts.onMenu) opts.onMenu(song);
    });

    return row;
  }

  // -------------- Empty state --------------
  function empty(parent, title, message, icon) {
    clear(parent);
    const div = el("div", { class: "empty-state" });
    if (icon) div.appendChild(typeof icon === "string" ? (function() {
      const t = el("template"); t.innerHTML = icon; return t.content.firstChild;
    })() : icon);
    div.appendChild(el("h3", {}, title));
    div.appendChild(el("p", {}, message));
    parent.appendChild(div);
    return div;
  }

  // -------------- Sheet management --------------
  function openSheet(id) {
    const sheet = document.getElementById(id);
    const backdrop = document.getElementById("sheetBackdrop");
    if (!sheet) return;
    sheet.hidden = false;
    backdrop.hidden = false;
    sheet.classList.remove("closing");
  }
  function closeSheet() {
    const backdrop = document.getElementById("sheetBackdrop");
    document.querySelectorAll(".sheet").forEach(s => {
      if (!s.hidden) {
        s.classList.add("closing");
        setTimeout(() => { s.hidden = true; s.classList.remove("closing"); }, 220);
      }
    });
    backdrop.hidden = true;
  }

  // -------------- Expose --------------
  global.UI = { el, clear, fmtTime, letterFor, gradientFor, artElement, songRow, empty, openSheet, closeSheet };
})(window);
