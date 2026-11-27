// Anime Fighter (web) v2 — Power Building + SHOWDOWN (ala Build An Anime Character).
// Spin dapetin karakter, susun 5 karakter (satu per slot stat) jadi 1 fighter.
// Battle = SHOWDOWN: adu AVG SCORE 5 stat, tertinggi menang (atau terendah di Reverse).
// Save di localStorage.
(function () {
  "use strict";

  var SAVE_KEY = "animeFighterSaveV1";
  var SPIN_COST = 50;
  var FREE_SPIN_INTERVAL = 60000; // 1 free spin tiap 60 detik
  var MAX_FREE_SPINS = 3;
  var WIN_REWARD = 100;
  var LOSE_REWARD = 15;

  // 5 slot stat — nama Indonesia seperti di game Roblox-nya.
  var SLOT_DEFS = [
    { key: "str", label: "KEKUATAN", sub: "Strength" },
    { key: "spd", label: "KECEPATAN", sub: "Speed" },
    { key: "abi", label: "KEMAMPUAN", sub: "Abilities" },
    { key: "iq", label: "KEPINTARAN", sub: "IQ" },
    { key: "dur", label: "KETAHANAN", sub: "Durability" },
  ];

  var save = loadSave();
  var selectedSlot = "str"; // slot yang lagi dipilih di Power Building
  var duelSelected = [];    // id karakter dipilih teman buat duel (maks 5, urutan = slot)
  var showdown = null;      // state showdown aktif
  var soundOn = save.soundOn !== false;

  // ---------------- SAVE ----------------
  function defaultSave() {
    return { cash: 200, freeSpins: 3, lastRefill: Date.now(), owned: {}, fighter: null, build: { str: null, spd: null, abi: null, iq: null, dur: null }, wins: 0, battles: 0, soundOn: true };
  }
  function loadSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultSave();
      var s = JSON.parse(raw);
      var d = defaultSave();
      for (var k in d) if (s[k] === undefined) s[k] = d[k];
      if (!s.build) s.build = { str: null, spd: null, abi: null, iq: null, dur: null };
      return s;
    } catch (e) { return defaultSave(); }
  }
  function persist() {
    save.soundOn = soundOn;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
  }

  // ---------------- SUARA (WebAudio, dibuat dari code — tanpa file) ----------------
  var audioCtx = null;
  function ctx() {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  function tone(freq, dur, type, vol, when, slideTo) {
    if (!soundOn) return;
    var c = ctx(); if (!c) return;
    var t = c.currentTime + (when || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noiseBurst(dur, vol, freq) {
    if (!soundOn) return;
    var c = ctx(); if (!c) return;
    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = freq || 800;
    var g = c.createGain(); g.gain.value = vol || 0.4;
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start();
  }
  var sfx = {
    click: function () { tone(700, 0.06, "square", 0.08); },
    pop: function () { tone(500, 0.09, "sine", 0.2, 0, 900); },
    punch: function () { noiseBurst(0.12, 0.5, 900); tone(160, 0.14, "sine", 0.35, 0, 60); },
    swing: function () { noiseBurst(0.14, 0.16, 2400); },
    coin: function () { tone(880, 0.09, "sine", 0.18); tone(1320, 0.14, "sine", 0.18, 0.08); },
    levelup: function () { var n = [523, 659, 784, 1047]; for (var i = 0; i < n.length; i++) tone(n[i], 0.12, "triangle", 0.18, i * 0.09); },
    win: function () { var n = [523, 659, 784, 1047, 1319]; for (var i = 0; i < n.length; i++) tone(n[i], 0.18, "triangle", 0.2, i * 0.11); }
  };

  // ---------------- BANTU ----------------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(t._timer); t._timer = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }
  function imgHtml(c, cls) {
    if (c.img) return '<img class="' + (cls || "") + '" src="' + esc(c.img) + '" alt="' + esc(c.name) + '" loading="lazy" onerror="this.outerHTML=\'<div class=&quot;img-fallback&quot; style=&quot;background:' + esc(c.color) + '&quot;>' + esc(c.name.charAt(0)) + '</div>\'">';
    return '<div class="img-fallback" style="background:' + esc(c.color) + '">' + esc(c.name.charAt(0)) + "</div>";
  }
  // Nilai 1 stat (0-100) dari lore.
  function statOf(c, key) {
    if (c.stats && typeof c.stats[key] === "number") return c.stats[key];
    if (key === "str") return c.atk || 50;
    if (key === "spd") return c.spd || 50;
    if (key === "dur") return c.def || 50;
    return 50;
  }
  function statLine(c) {
    if (c.stats) {
      return "STR " + c.stats.str + " &nbsp;SPD " + c.stats.spd + " &nbsp;ABI " + c.stats.abi + " &nbsp;IQ " + c.stats.iq + " &nbsp;DUR " + c.stats.dur;
    }
    return "ATK " + c.atk + " &nbsp;DEF " + c.def + " &nbsp;SPD " + c.spd + " &nbsp;HP " + c.hp;
  }
  function slotLabel(key) {
    for (var i = 0; i < SLOT_DEFS.length; i++) if (SLOT_DEFS[i].key === key) return SLOT_DEFS[i].label;
    return key;
  }
  function slotOfChar(id) {
    for (var i = 0; i < SLOT_DEFS.length; i++) {
      if (save.build[SLOT_DEFS[i].key] === id) return SLOT_DEFS[i].key;
    }
    return null;
  }

  // ---------------- POWER BUILDING ----------------
  function buildValues() {
    var vals = {}, filled = 0, sum = 0;
    SLOT_DEFS.forEach(function (d) {
      var id = save.build[d.key];
      var c = id ? charById(id) : null;
      var v = c ? statOf(c, d.key) : null;
      vals[d.key] = v;
      if (v !== null) { filled++; sum += v; }
    });
    var avg = filled ? sum / 5 : null;
    return { vals: vals, filled: filled, avg: avg, grade: avg === null ? null : gradeOf(avg) };
  }
  function gradeOf(avg) {
    if (avg >= 92) return "S";
    if (avg >= 86) return "A";
    if (avg >= 78) return "B";
    if (avg >= 68) return "C";
    return "D";
  }
  function renderBuild() {
    var box = $("buildSlots");
    var html = "";
    SLOT_DEFS.forEach(function (d) {
      var id = save.build[d.key];
      var c = id ? charById(id) : null;
      var v = c ? statOf(c, d.key) : null;
      html += '<button class="build-slot' + (selectedSlot === d.key ? " selected" : "") + '" data-slot="' + d.key + '">';
      if (c) {
        html += imgHtml(c) +
          '<span class="slot-info"><span class="slot-label">' + d.label + ' <span class="slot-sub">(' + d.sub + ')</span></span>' +
          '<span class="slot-char">' + esc(c.name) + '</span>' +
          '<span class="slot-move">Jurus: ' + esc(c.move) + '</span></span>' +
          '<span class="slot-val">' + v + '</span>';
      } else {
        html += '<span class="slot-info"><span class="slot-label">' + d.label + ' <span class="slot-sub">(' + d.sub + ')</span></span>' +
          '<span class="slot-empty">+ Kosong — tap slot ini, terus klik karakter di koleksi</span></span>';
      }
      html += "</button>";
    });
    box.innerHTML = html;
    box.querySelectorAll(".build-slot").forEach(function (el) {
      el.addEventListener("click", function () {
        sfx.click();
        selectedSlot = el.getAttribute("data-slot");
        renderBuild();
      });
    });

    var b = buildValues();
    var pb = $("powerBox");
    if (b.filled === 0) {
      pb.innerHTML = '<p class="hint">Belum ada slot terisi. Tap slot KEKUATAN di atas, terus klik karakter di koleksi lo.</p>';
      return;
    }
    var names = SLOT_DEFS.map(function (d) {
      var c = save.build[d.key] ? charById(save.build[d.key]) : null;
      return c ? c.name : "-";
    }).join(" + ");
    var bars = "";
    SLOT_DEFS.forEach(function (d) {
      var v = b.vals[d.key];
      bars += '<div class="stat-row"><span class="stat-name">' + d.label + '</span>' +
        '<span class="stat-bar"><span class="stat-fill" style="width:' + (v === null ? 0 : v) + '%"></span></span>' +
        '<span class="stat-num">' + (v === null ? "-" : v) + '</span></div>';
    });
    pb.innerHTML = '<div class="power-head"><span class="power-label">POWER (AVG SCORE)</span>' +
      '<span class="power-num">' + (b.avg === null ? "-" : b.avg.toFixed(1)) + '</span>' +
      (b.grade ? '<span class="power-grade">Grade ' + b.grade + '</span>' : "") + "</div>" +
      '<div class="muted" style="margin:6px 0 4px">' + esc(names) + "</div>" +
      bars +
      (b.filled < 5 ? '<p class="hint" style="margin-top:8px">Masih ' + (5 - b.filled) + ' slot kosong. Isi semua biar Power kehitung penuh.</p>' : "");
  }

  // ---------------- FREE SPIN ----------------
  function refillFreeSpins() {
    var now = Date.now();
    var add = Math.floor((now - save.lastRefill) / FREE_SPIN_INTERVAL);
    if (add > 0) {
      save.freeSpins = Math.min(MAX_FREE_SPINS, save.freeSpins + add);
      save.lastRefill = now - ((now - save.lastRefill) % FREE_SPIN_INTERVAL);
      persist();
    }
  }

  // ---------------- RENDER ----------------
  function renderBadges() {
    refillFreeSpins();
    $("cashBadge").textContent = "Cash: " + save.cash;
    $("winsBadge").textContent = "Wins: " + save.wins + " (Battle: " + save.battles + ")";
    $("spinBadge").textContent = "Free Spin: " + save.freeSpins;
    $("spinBtn").textContent = save.freeSpins > 0 ? "SPIN (GRATIS x" + save.freeSpins + ")" : "SPIN (50 Cash)";
    $("soundBtn").textContent = "Suara: " + (soundOn ? "ON" : "OFF");
  }

  function cardHtml(c, count, isSelected) {
    var used = slotOfChar(c.id);
    return '<button class="card rarity-' + c.rarity + (isSelected ? " selected" : "") + '" data-id="' + c.id + '">' +
      imgHtml(c) +
      '<div class="card-body"><div class="rarity-tag">' + c.rarity.toUpperCase() + '</div>' +
      '<div class="card-name">' + esc(c.name) + '</div>' +
      '<div class="card-anime">' + esc(c.anime) + '</div>' +
      '<div class="card-move">Jurus: ' + esc(c.move) + '</div>' +
      '<div class="card-stats">' + statLine(c) + '</div>' +
      (count ? '<div class="card-count">Punya x' + count + '</div>' : "") +
      (used ? '<div class="card-used">Dipakai: ' + slotLabel(used) + '</div>' : "") +
      "</div></button>";
  }

  function renderCollection() {
    var grid = $("collectionGrid");
    var ids = Object.keys(save.owned).filter(function (id) { return save.owned[id] > 0; });
    var total = 0; ids.forEach(function (id) { total += save.owned[id]; });
    $("collectionCount").textContent = "(" + total + " karakter)";
    if (!ids.length) { grid.innerHTML = '<p class="hint">Koleksi masih kosong. Spin dulu!</p>'; return; }
    ids.sort(function (a, b) {
      var ra = ["Common", "Rare", "Epic", "Legendary", "Mythical", "Secret"].indexOf(charById(a).rarity);
      var rb = ["Common", "Rare", "Epic", "Legendary", "Mythical", "Secret"].indexOf(charById(b).rarity);
      return rb - ra || charById(a).name.localeCompare(charById(b).name);
    });
    grid.innerHTML = ids.map(function (id) {
      return cardHtml(charById(id), save.owned[id], false);
    }).join("");
    grid.querySelectorAll(".card").forEach(function (el) {
      el.addEventListener("click", function () {
        sfx.click();
        var id = el.getAttribute("data-id");
        var c = charById(id);
        if (!c) return;
        var used = slotOfChar(id);
        if (used === selectedSlot) {
          save.build[selectedSlot] = null;
          persist(); toast(c.name + " dilepas dari slot " + slotLabel(selectedSlot) + ".");
        } else if (used) {
          toast(c.name + " udah dipakai di slot " + slotLabel(used) + ". Lepas dulu atau pilih karakter lain.");
          return;
        } else {
          save.build[selectedSlot] = id;
          persist(); sfx.pop();
          toast(c.name + " masuk slot " + slotLabel(selectedSlot) + " (" + statOf(c, selectedSlot) + ").");
        }
        renderAll();
      });
    });
  }

  function renderGallery() {
    var q = ($("gallerySearch").value || "").toLowerCase();
    var f = $("galleryFilter").value;
    var list = CHARACTERS.filter(function (c) {
      if (f && c.rarity !== f) return false;
      if (!q) return true;
      return (c.name + " " + c.anime + " " + c.move).toLowerCase().indexOf(q) !== -1;
    });
    $("galleryGrid").innerHTML = list.map(function (c) { return cardHtml(c, save.owned[c.id] || 0, false); }).join("") ||
      '<p class="hint">Tidak ketemu. Coba kata lain.</p>';
  }

  function renderAll() { renderBadges(); renderBuild(); renderCollection(); renderGallery(); }

  // ---------------- SPIN ----------------
  $("spinBtn").addEventListener("click", function () {
    refillFreeSpins();
    if (save.freeSpins > 0) save.freeSpins--;
    else if (save.cash >= SPIN_COST) save.cash -= SPIN_COST;
    else { toast("Cash tidak cukup! Menang battle buat dapet Cash."); renderBadges(); return; }
    var c = rollCharacter();
    save.owned[c.id] = (save.owned[c.id] || 0) + 1;
    persist();
    sfx.pop();
    if (c.rarity === "Legendary") sfx.levelup();
    var box = $("spinResult");
    box.innerHTML = '<div style="max-width:280px;margin:0 auto">' + cardHtml(c, save.owned[c.id], false) + "</div>";
    toast("Dapet: " + c.name + " [" + c.rarity + "] — " + c.move + "!");
    renderAll();
  });

  // ---------------- POWER BUILDING: TOMBOL ----------------
  $("autoFillBtn").addEventListener("click", function () {
    sfx.click();
    var ownedIds = Object.keys(save.owned).filter(function (id) { return save.owned[id] > 0; });
    if (!ownedIds.length) { toast("Koleksi masih kosong. Spin dulu!"); return; }
    var used = [];
    SLOT_DEFS.forEach(function (d) {
      var best = null, bestVal = -1;
      ownedIds.forEach(function (id) {
        if (used.indexOf(id) !== -1) return;
        var v = statOf(charById(id), d.key);
        if (v > bestVal) { bestVal = v; best = id; }
      });
      if (best) { save.build[d.key] = best; used.push(best); }
    });
    persist(); sfx.levelup();
    var b = buildValues();
    toast("Fighter terisi otomatis! Power " + (b.avg === null ? "-" : b.avg.toFixed(1)) + " (Grade " + b.grade + ").");
    renderAll();
  });
  $("resetBuildBtn").addEventListener("click", function () {
    sfx.click();
    SLOT_DEFS.forEach(function (d) { save.build[d.key] = null; });
    persist();
    toast("Power Building di-reset.");
    renderAll();
  });

  // ---------------- SHOWDOWN (adu AVG score, ala BAAC) ----------------
  function partsFromBuild() {
    var b = buildValues();
    if (b.filled < 5) return null;
    var parts = {};
    SLOT_DEFS.forEach(function (d) { parts[d.key] = save.build[d.key]; });
    return parts;
  }
  function partsStats(parts) {
    var vals = {}, sum = 0;
    SLOT_DEFS.forEach(function (d) {
      var c = charById(parts[d.key]);
      vals[d.key] = c ? statOf(c, d.key) : 0;
      sum += vals[d.key];
    });
    var avg = sum / 5;
    return { vals: vals, avg: avg, grade: gradeOf(avg) };
  }
  function partsNames(parts) {
    return SLOT_DEFS.map(function (d) {
      var c = charById(parts[d.key]);
      return c ? c.name : "-";
    }).join(" + ");
  }
  function botParts() {
    // Bot roll 8 karakter UNIK, lalu isi otomatis (terbaik per slot, beda karakter).
    var pool = [], tries = 0;
    while (pool.length < 8 && tries < 60) {
      var id = rollCharacter().id;
      if (pool.indexOf(id) === -1) pool.push(id);
      tries++;
    }
    var parts = {}, used = [];
    SLOT_DEFS.forEach(function (d) {
      var best = null, bestVal = -1;
      pool.forEach(function (id) {
        if (used.indexOf(id) !== -1) return;
        var v = statOf(charById(id), d.key);
        if (v > bestVal) { bestVal = v; best = id; }
      });
      if (best) { parts[d.key] = best; used.push(best); }
    });
    return parts;
  }
  function startShowdown(aParts, bParts, mode, reverse) {
    showdown = { a: aParts, b: bParts, mode: mode, reverse: reverse, revealed: false, over: false };
    save.battles++; persist();
    $("arena").classList.remove("hidden");
    $("duelPicker").classList.add("hidden");
    $("showdownResult").innerHTML = "";
    $("showdownBtn").textContent = "SHOWDOWN!";
    $("showdownBtn").classList.remove("hidden");
    renderShowdown();
  }
  function sdFighterHtml(title, parts, st, showVals) {
    var names = partsNames(parts);
    var bars = "";
    SLOT_DEFS.forEach(function (d) {
      var v = st.vals[d.key];
      bars += '<div class="stat-row"><span class="stat-name">' + d.label + '</span>' +
        '<span class="stat-bar"><span class="stat-fill" style="width:' + (showVals ? v : 0) + '%"></span></span>' +
        '<span class="stat-num">' + (showVals ? v : "?") + '</span></div>';
    });
    return '<div class="sd-fighter"><div class="sd-title">' + title + '</div>' +
      '<div class="muted" style="font-size:12px;margin-bottom:6px">' + esc(names) + '</div>' +
      bars +
      '<div class="sd-avg">' + (showVals ? st.avg.toFixed(1) : "?") + '</div>' +
      '<div class="sd-grade">' + (showVals ? "Grade " + st.grade : "???") + '</div></div>';
  }
  function renderShowdown() {
    if (!showdown) return;
    var a = partsStats(showdown.a), b = partsStats(showdown.b);
    $("showdownBox").innerHTML =
      '<div class="sd-wrap">' +
      sdFighterHtml("FIGHTER LO", showdown.a, a, true) +
      '<div class="vs">VS</div>' +
      sdFighterHtml("LAWAN", showdown.b, b, showdown.revealed) +
      "</div>";
  }
  $("showdownBtn").addEventListener("click", function () {
    if (!showdown || showdown.over) return;
    sfx.click();
    showdown.revealed = true;
    showdown.over = true;
    var rev = showdown.reverse;
    var a = partsStats(showdown.a), b = partsStats(showdown.b);
    var winner;
    if (a.avg === b.avg) winner = "draw";
    else if (rev) winner = a.avg < b.avg ? "A" : "B";
    else winner = a.avg > b.avg ? "A" : "B";
    renderShowdown();
    var msg;
    if (winner === "draw") {
      msg = "SERI! AVG sama-sama " + a.avg.toFixed(1) + ". +50 Cash.";
      if (showdown.mode === "bot") save.cash += 50;
      sfx.coin();
    } else if (winner === "A") {
      msg = "MENANG! " + a.avg.toFixed(1) + " vs " + b.avg.toFixed(1) + ". +100 Cash, +1 Win!";
      if (showdown.mode === "bot") { save.cash += WIN_REWARD; save.wins++; }
      sfx.win(); sfx.coin();
    } else {
      msg = "KALAH. " + a.avg.toFixed(1) + " vs " + b.avg.toFixed(1) + ". +15 Cash.";
      if (showdown.mode === "bot") save.cash += LOSE_REWARD;
      sfx.coin();
    }
    persist();
    $("showdownResult").innerHTML = '<div class="sd-result">' + esc(msg) + '</div>' +
      (showdown.mode === "bot" ? '<button id="rematchBtn" class="btn btn-red btn-big" style="margin-top:10px">REMATCH (BOT BARU)</button>' : "");
    $("showdownBtn").classList.add("hidden");
    var rb = $("rematchBtn");
    if (rb) rb.addEventListener("click", function () {
      sfx.click();
      startShowdown(partsFromBuild(), botParts(), "bot", rev);
    });
    renderBadges();
  });
  $("botBtn").addEventListener("click", function () {
    sfx.click();
    if (!partsFromBuild()) { toast("Bangun fighter dulu di Power Building (isi 5 slot)!"); return; }
    startShowdown(partsFromBuild(), botParts(), "bot", $("battleMode").value === "reverse");
  });
  $("backBtn").addEventListener("click", function () {
    sfx.click();
    showdown = null;
    $("arena").classList.add("hidden");
    $("duelPicker").classList.add("hidden");
  });

  // ---------------- DUEL TEMAN (SHOWDOWN 1 layar) ----------------
  $("duelBtn").addEventListener("click", function () {
    sfx.click();
    if (!partsFromBuild()) { toast("Lo harus punya fighter dulu (isi 5 slot di Power Building)."); return; }
    duelSelected = [];
    $("arena").classList.add("hidden");
    $("duelPicker").classList.remove("hidden");
    renderDuelGrid();
    renderDuelSlots();
  });
  function renderDuelGrid() {
    var q = ($("duelSearch").value || "").toLowerCase();
    var list = CHARACTERS.filter(function (c) {
      return !q || (c.name + " " + c.anime + " " + c.move).toLowerCase().indexOf(q) !== -1;
    });
    var grid = $("duelGrid");
    grid.innerHTML = list.map(function (c) { return cardHtml(c, 0, duelSelected.indexOf(c.id) !== -1); }).join("");
    grid.querySelectorAll(".card").forEach(function (el) {
      el.addEventListener("click", function () {
        sfx.click();
        var id = el.getAttribute("data-id");
        var i = duelSelected.indexOf(id);
        if (i !== -1) duelSelected.splice(i, 1);
        else {
          if (duelSelected.length >= 5) { toast("Maksimal 5 karakter (satu per slot)."); return; }
          duelSelected.push(id);
        }
        renderDuelGrid(); renderDuelSlots();
      });
    });
  }
  function renderDuelSlots() {
    var html = "";
    SLOT_DEFS.forEach(function (d, i) {
      var c = duelSelected[i] ? charById(duelSelected[i]) : null;
      html += '<div class="duel-slot-row"><span class="slot-label">' + d.label + '</span><span>' + (c ? esc(c.name) + " (" + statOf(c, d.key) + ")" : "-") + '</span></div>';
    });
    $("duelSlots").innerHTML = html;
  }
  $("duelSearch").addEventListener("input", renderDuelGrid);
  $("duelStartBtn").addEventListener("click", function () {
    sfx.click();
    if (duelSelected.length < 5) { toast("Teman pilih 5 karakter dulu."); return; }
    var parts = {};
    SLOT_DEFS.forEach(function (d, i) { parts[d.key] = duelSelected[i]; });
    startShowdown(partsFromBuild(), parts, "duel", $("battleMode").value === "reverse");
  });

  // ---------------- GALERI + TAB + SUARA ----------------
  $("gallerySearch").addEventListener("input", renderGallery);
  $("galleryFilter").addEventListener("change", renderGallery);
  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      sfx.click();
      document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
      document.querySelectorAll(".tabpage").forEach(function (p) { p.classList.remove("active"); });
      tab.classList.add("active");
      $("tab-" + tab.getAttribute("data-tab")).classList.add("active");
    });
  });
  $("soundBtn").addEventListener("click", function () {
    soundOn = !soundOn; persist(); renderBadges();
    if (soundOn) sfx.click();
  });

  // ---------------- START ----------------
  $("galleryCount").textContent = "(" + CHARACTERS.length + ")";
  renderAll();
  setInterval(renderBadges, 10000);
})();
