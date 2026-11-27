// Anime Fighter (web) v3 — ala Build An Anime Character (yang bener).
// Match: 5 ronde. Tiap ronde, tiap pemain gacha 1 karakter acak (rarity ikut
// rate), pemain pilih SENDIRI karakter itu masuk slot stat mana. Bukan build
// dulu baru battle — fighter dibangun SELAMA match, kayak di Roblox-nya.
// Timer 15 dtk/ronde (habis = auto-place ke slot kosong acak), reroll 100 Cash,
// bot ikut roll tiap ronde (disembunyiin sampai SHOWDOWN), duel teman gantian
// 1 layar. SHOWDOWN: adu AVG SCORE 5 stat. Save di localStorage (cash/wins).
(function () {
  "use strict";

  var SAVE_KEY = "animeFighterSaveV1";
  var REROLL_COST = 100;
  var ROUND_TIME = 15; // detik per ronde, kayak Roblox
  var WIN_REWARD = 100;
  var LOSE_REWARD = 15;
  var DRAW_REWARD = 50;

  // 5 slot stat — nama Indonesia seperti di game Roblox-nya.
  var SLOT_DEFS = [
    { key: "str", label: "KEKUATAN", sub: "Strength" },
    { key: "spd", label: "KECEPATAN", sub: "Speed" },
    { key: "abi", label: "KEMAMPUAN", sub: "Abilities" },
    { key: "iq", label: "KEPINTARAN", sub: "IQ" },
    { key: "dur", label: "KETAHANAN", sub: "Durability" },
  ];

  var save = loadSave();
  var soundOn = save.soundOn !== false;
  var match = null;     // match aktif: {mode, reverse, round, turn, a, b, roll, timeLeft, timerId, over}
  var showdown = null;  // state showdown aktif

  // ---------------- SAVE ----------------
  function defaultSave() {
    return { cash: 200, wins: 0, battles: 0, soundOn: true };
  }
  function loadSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultSave();
      var s = JSON.parse(raw);
      var d = defaultSave();
      for (var k in d) if (s[k] === undefined) s[k] = d[k];
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
  function gradeOf(avg) {
    if (avg >= 92) return "S";
    if (avg >= 86) return "A";
    if (avg >= 78) return "B";
    if (avg >= 68) return "C";
    return "D";
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

  // ---------------- RENDER UMUM ----------------
  function renderBadges() {
    $("cashBadge").textContent = "Cash: " + save.cash;
    $("winsBadge").textContent = "Wins: " + save.wins + " (Battle: " + save.battles + ")";
    $("soundBtn").textContent = "Suara: " + (soundOn ? "ON" : "OFF");
  }
  function cardHtml(c, isSelected) {
    return '<button class="card rarity-' + c.rarity + (isSelected ? " selected" : "") + '" data-id="' + c.id + '">' +
      imgHtml(c) +
      '<div class="card-body"><div class="rarity-tag">' + c.rarity.toUpperCase() + '</div>' +
      '<div class="card-name">' + esc(c.name) + '</div>' +
      '<div class="card-anime">' + esc(c.anime) + '</div>' +
      '<div class="card-move">Jurus: ' + esc(c.move) + '</div>' +
      '<div class="card-stats">' + statLine(c) + '</div>' +
      "</div></button>";
  }
  function renderGallery() {
    var q = ($("gallerySearch").value || "").toLowerCase();
    var f = $("galleryFilter").value;
    var list = CHARACTERS.filter(function (c) {
      if (f && c.rarity !== f) return false;
      if (!q) return true;
      return (c.name + " " + c.anime + " " + c.move).toLowerCase().indexOf(q) !== -1;
    });
    $("galleryGrid").innerHTML = list.map(function (c) { return cardHtml(c, false); }).join("") ||
      '<p class="hint">Tidak ketemu. Coba kata lain.</p>';
  }
  function renderAll() { renderBadges(); renderGallery(); if (match && !match.over) renderMatch(); }

  // ---------------- MATCH: 5 RONDE (gacha + pasang sendiri) ----------------
  function emptyParts() { return { str: null, spd: null, abi: null, iq: null, dur: null }; }
  function filledCount(parts) {
    var n = 0;
    SLOT_DEFS.forEach(function (d) { if (parts[d.key]) n++; });
    return n;
  }
  function activeParts() { return match.turn === "a" ? match.a : match.b; }
  // Roll 1 karakter acak (rarity ikut rate) yang BELUM dipakai fighter ini.
  function rollUnique(parts) {
    var c = null, tries = 0;
    while (tries < 60) {
      c = rollCharacter();
      var used = false;
      SLOT_DEFS.forEach(function (d) { if (parts[d.key] === c.id) used = true; });
      if (!used) break;
      tries++;
    }
    return c;
  }
  // Slot kosong tempat karakter ini paling kuat (buat bot).
  function bestSlotFor(c, parts) {
    var best = null, bestVal = -1;
    SLOT_DEFS.forEach(function (d) {
      if (parts[d.key]) return;
      var v = statOf(c, d.key);
      if (v > bestVal) { bestVal = v; best = d.key; }
    });
    return best;
  }
  function startMatch(mode) {
    sfx.click();
    stopTimer();
    match = {
      mode: mode,
      reverse: $("battleMode").value === "reverse",
      round: 1, turn: "a",
      a: emptyParts(), b: emptyParts(),
      roll: null, timeLeft: ROUND_TIME, timerId: null, over: false
    };
    save.battles++; persist();
    showdown = null;
    $("arena").classList.add("hidden");
    $("matchPanel").classList.remove("hidden");
    $("matchTitle").textContent = mode === "bot" ? "SHOWDOWN VS BOT" : "DUEL TEMAN (1 LAYAR)";
    renderBadges();
    beginRound();
  }
  function beginRound() {
    if (match.mode === "bot") botRollAndPlace();
    beginTurn("a");
  }
  function botRollAndPlace() {
    // Bot ikut roll 1 karakter tiap ronde, langsung dipasang greedy
    // (slot kosong tempat stat-nya paling tinggi). Disembunyiin sampai SHOWDOWN.
    var c = rollUnique(match.b);
    var key = bestSlotFor(c, match.b);
    if (key) match.b[key] = c.id;
  }
  function beginTurn(side) {
    match.turn = side;
    match.roll = rollUnique(activeParts());
    match.timeLeft = ROUND_TIME;
    renderMatch();
    startTimer();
  }
  function startTimer() {
    stopTimer();
    match.timerId = setInterval(function () {
      if (!match || match.over) { stopTimer(); return; }
      match.timeLeft--;
      var t = $("timerLabel");
      t.textContent = "Waktu: " + match.timeLeft + " dtk";
      if (match.timeLeft <= 5) t.classList.add("timer-danger"); else t.classList.remove("timer-danger");
      if (match.timeLeft <= 0) autoPlace();
    }, 1000);
  }
  function stopTimer() {
    if (match && match.timerId) { clearInterval(match.timerId); match.timerId = null; }
  }
  function autoPlace() {
    stopTimer();
    if (!match || match.over || !match.roll) return;
    var parts = activeParts();
    var empty = SLOT_DEFS.filter(function (d) { return !parts[d.key]; });
    if (!empty.length) return;
    var key = empty[Math.floor(Math.random() * empty.length)].key;
    parts[key] = match.roll.id;
    toast("Waktu habis! " + match.roll.name + " otomatis masuk slot " + slotLabel(key) + ".");
    afterPlace();
  }
  function placeRoll(key) {
    if (!match || match.over || !match.roll) return;
    var parts = activeParts();
    if (parts[key]) { toast("Slot " + slotLabel(key) + " udah terisi. Pilih slot kosong."); return; }
    parts[key] = match.roll.id;
    sfx.pop();
    toast(match.roll.name + " masuk slot " + slotLabel(key) + " (" + statOf(match.roll, key) + ").");
    afterPlace();
  }
  function afterPlace() {
    stopTimer();
    if (!match) return;
    if (match.mode === "bot") {
      if (filledCount(match.a) === 5) { finishMatch(); return; }
      match.round++;
      beginRound();
      return;
    }
    // Duel: gantian dalam ronde yang sama.
    if (match.turn === "a") { beginTurn("b"); return; }
    if (filledCount(match.b) === 5) { finishMatch(); return; }
    match.round++;
    beginRound();
  }
  function rerollCurrent() {
    if (!match || match.over || !match.roll) return;
    if (save.cash < REROLL_COST) { toast("Cash tidak cukup buat reroll (100 Cash)! Menang battle dulu."); return; }
    save.cash -= REROLL_COST;
    match.roll = rollUnique(activeParts());
    persist();
    sfx.pop();
    if (match.roll.rarity === "Legendary" || match.roll.rarity === "Mythical" || match.roll.rarity === "Secret") sfx.levelup();
    renderBadges();
    renderMatch();
    toast("Reroll: " + match.roll.name + " [" + match.roll.rarity + "] — " + match.roll.move + "!");
  }
  function renderMatch() {
    if (!match) return;
    $("roundLabel").textContent = "RONDE " + match.round + "/5";
    var t = $("timerLabel");
    t.textContent = "Waktu: " + match.timeLeft + " dtk";
    if (match.timeLeft <= 5) t.classList.add("timer-danger"); else t.classList.remove("timer-danger");
    var who = match.mode === "bot" ? "" : (match.turn === "a" ? "GILIRAN LO — " : "GILIRAN TEMAN — ");
    $("turnLabel").textContent = who + "pilih slot buat " + match.roll.name + "!";
    $("rollCard").innerHTML = '<div style="max-width:280px;margin:0 auto">' + cardHtml(match.roll, false) + "</div>";
    var rb = $("rerollBtn");
    rb.textContent = "REROLL (100 CASH)";
    rb.disabled = save.cash < REROLL_COST;
    var parts = activeParts();
    var html = "";
    SLOT_DEFS.forEach(function (d) {
      var id = parts[d.key];
      var c = id ? charById(id) : null;
      html += '<button class="build-slot match-slot" data-slot="' + d.key + '"' + (c ? " disabled" : "") + ">";
      if (c) {
        html += imgHtml(c) +
          '<span class="slot-info"><span class="slot-label">' + d.label + ' <span class="slot-sub">(' + d.sub + ')</span></span>' +
          '<span class="slot-char">' + esc(c.name) + '</span>' +
          '<span class="slot-move">Jurus: ' + esc(c.move) + '</span></span>' +
          '<span class="slot-val">' + statOf(c, d.key) + '</span>';
      } else {
        html += '<span class="slot-info"><span class="slot-label">' + d.label + ' <span class="slot-sub">(' + d.sub + ')</span></span>' +
          '<span class="slot-empty">+ Kosong — tap buat pasang ' + esc(match.roll.name) + '</span></span>';
      }
      html += "</button>";
    });
    var box = $("matchSlots");
    box.innerHTML = html;
    box.querySelectorAll(".match-slot").forEach(function (el) {
      el.addEventListener("click", function () {
        sfx.click();
        placeRoll(el.getAttribute("data-slot"));
        renderAll();
      });
    });
  }
  function finishMatch() {
    if (!match) return;
    match.over = true;
    stopTimer();
    var a = match.a, b = match.b, mode = match.mode, rev = match.reverse;
    match = null;
    $("matchPanel").classList.add("hidden");
    startShowdown(a, b, mode, rev);
  }

  // ---------------- SHOWDOWN (adu AVG score, ala BAAC) ----------------
  function startShowdown(aParts, bParts, mode, reverse) {
    showdown = { a: aParts, b: bParts, mode: mode, reverse: reverse, revealed: false, over: false };
    $("arena").classList.remove("hidden");
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
      if (showdown.mode === "bot") save.cash += DRAW_REWARD;
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
      startMatch("bot");
    });
    renderBadges();
  });
  function closeMatchUI() {
    sfx.click();
    stopTimer();
    match = null;
    showdown = null;
    $("arena").classList.add("hidden");
    $("matchPanel").classList.add("hidden");
  }
  $("backBtn").addEventListener("click", closeMatchUI);
  $("matchBackBtn").addEventListener("click", closeMatchUI);
  $("botBtn").addEventListener("click", function () { startMatch("bot"); });
  $("duelBtn").addEventListener("click", function () { startMatch("duel"); });
  $("rerollBtn").addEventListener("click", function () {
    sfx.click();
    rerollCurrent();
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
})();
