// Anime Fighter (web) v4.3 — ala Build An Anime Character.
// Match lokal (bot/duel 1 layar): 5 ronde, gacha sepasang, pasang sendiri,
// v4.2: join timeout (12 dtk peer open + 10 dtk conn open) + error case tampilkan COBA LAGI.
// v4.3: UI polish Neon HIGH (topbar/tabs/kartu/HUD/room/SHOWDOWN) + reorder joinRoomBtn + guard timeout.
// stat DITAMPILIN selama match (chip di kartu + nilai per slot), timer acak
// 11-20 dtk, reroll sepasang 100 Cash. Gambar kartu object-fit contain
// (utuh, tidak kepotong). Battle menu disembunyiin saat match aktif.
// ONLINE 1v1 (PeerJS P2P): host buat room (kode 6 huruf), teman join pakai
// kode/link. Host = wasit: gacha sepasang tiap ronde, pegang timer (endsAt),
// auto-place buat yang belum pasang. Tamu tidak auto-place sendiri — state
// ronde selalu datang dari host (pesan `round` bawa parts kedua sisi).
// SHOWDOWN: adu AVG SCORE 5 stat (reveal di sini). Save di localStorage.
(function () {
  "use strict";

  var SAVE_KEY = "animeFighterSaveV1";
  var REROLL_COST = 100;
  var ROUND_TIME_MIN = 11; // timer acak per ronde, kayak Roblox (teramati 11-20)
  var ROUND_TIME_MAX = 20;
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
  var match = null;     // match aktif: {mode, reverse, round, turn, a, b, pair, roll, timeLeft, timerId, over,
                          //   online, mySide, oppSide, myPlaced, oppPlaced, endsAt, startedAt}
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
    pop: function () { tone(500, 0.09, "sine", 0.18, 0, 900); },
    punch: function () { noiseBurst(0.12, 0.2, 900); tone(160, 0.14, "sine", 0.2, 0, 60); },
    swing: function () { noiseBurst(0.14, 0.16, 2400); },
    coin: function () { tone(880, 0.09, "sine", 0.16); tone(1320, 0.14, "sine", 0.16, 0.08); },
    levelup: function () { var n = [523, 659, 784, 1047]; for (var i = 0; i < n.length; i++) tone(n[i], 0.12, "triangle", 0.16, i * 0.09); },
    win: function () { var n = [523, 659, 784, 1047, 1319]; for (var i = 0; i < n.length; i++) tone(n[i], 0.18, "triangle", 0.18, i * 0.11); },
    lose: function () { var n = [440, 392, 349, 294]; for (var i = 0; i < n.length; i++) tone(n[i], 0.16, "triangle", 0.16, i * 0.11); },
    draw: function () { tone(440, 0.14, "triangle", 0.15, 0); tone(440, 0.18, "triangle", 0.15, 0.16); },
    roundStart: function () { tone(523, 0.08, "triangle", 0.14, 0); tone(784, 0.12, "triangle", 0.15, 0.07); },
    oppPlace: function () { tone(988, 0.07, "sine", 0.12, 0); },
    tick: function () { tone(880, 0.04, "square", 0.07, 0); },
    reroll: function () { noiseBurst(0.12, 0.14, 2000); tone(380, 0.12, "sine", 0.14, 0.04, 820); },
    showdown: function () { var n = [392, 523, 659, 784]; for (var i = 0; i < n.length; i++) tone(n[i], 0.1, "sawtooth", 0.1, i * 0.07); },
    roomJoin: function () { tone(659, 0.09, "sine", 0.16, 0); tone(988, 0.14, "sine", 0.16, 0.09); },
    matchStart: function () { var n = [523, 659, 784]; for (var i = 0; i < n.length; i++) tone(n[i], 0.12, "triangle", 0.16, i * 0.08); },
    error: function () { tone(220, 0.12, "sawtooth", 0.12, 0); tone(180, 0.16, "sawtooth", 0.12, 0.12); }
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
      return '<span class="stat-chip">STR <b>' + c.stats.str + '</b></span>' +
        '<span class="stat-chip">SPD <b>' + c.stats.spd + '</b></span>' +
        '<span class="stat-chip">ABI <b>' + c.stats.abi + '</b></span>' +
        '<span class="stat-chip">IQ <b>' + c.stats.iq + '</b></span>' +
        '<span class="stat-chip">DUR <b>' + c.stats.dur + '</b></span>';
    }
    return '<span class="stat-chip">ATK <b>' + c.atk + '</b></span>' +
      '<span class="stat-chip">DEF <b>' + c.def + '</b></span>' +
      '<span class="stat-chip">SPD <b>' + c.spd + '</b></span>' +
      '<span class="stat-chip">HP <b>' + c.hp + '</b></span>';
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
  // Roll 1 karakter acak (rarity ikut rate) yang BELUM dipakai fighter ini
  // dan bukan salah satu id di excludeIds (biar sepasang tidak kembar).
  function rollUnique(parts, excludeIds) {
    var c = null, tries = 0;
    while (tries < 60) {
      c = rollCharacter();
      var used = false;
      SLOT_DEFS.forEach(function (d) { if (parts[d.key] === c.id) used = true; });
      if (excludeIds && excludeIds.indexOf(c.id) !== -1) used = true;
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
      pair: { a: null, b: null }, roll: null, timeLeft: ROUND_TIME_MAX, timerId: null, over: false,
      online: mode === "online",
      mySide: (mode === "online" && window.AFOnline) ? (AFOnline.isHost ? "a" : "b") : "a",
      oppSide: (mode === "online" && window.AFOnline) ? (AFOnline.isHost ? "b" : "a") : "b",
      myPlaced: false, oppPlaced: false, endsAt: 0, startedAt: Date.now()
    };
    save.battles++; persist();
    showdown = null;
    $("battleMenu").classList.add("hidden");
    $("roomPanel").classList.add("hidden");
    $("arena").classList.add("hidden");
    $("matchPanel").classList.remove("hidden");
    $("matchTitle").textContent = mode === "bot" ? "SHOWDOWN VS BOT" : (mode === "duel" ? "DUEL TEMAN (1 LAYAR)" : "1VS1 ONLINE");
    sfx.matchStart();
    renderBadges();
    if (mode === "online") return; // ronde pertama datang dari host (pesan round)
    beginRound();
  }
  function beginRound() {
    // Tiap ronde: gacha SEPASANG karakter (satu buat lo, satu buat lawan),
    // ditampilin VS kayak di Roblox. Lawan belum pasang — dia lock-in bareng
    // pas lo pasang (bot) atau pas gilirannya (duel).
    var pa = rollUnique(match.a, []);
    var pb = rollUnique(match.b, [pa.id]);
    match.pair = { a: pa, b: pb };
    if (match.round > 1) sfx.roundStart();
    beginTurn("a");
  }
  // Bot lock-in bareng pas pemain pasang: pasang karakternya (pair.b) greedy
  // ke slot kosong tempat stat-nya paling tinggi. Keliatan live di panel lawan.
  function lockOpponent() {
    var c = match.pair.b;
    if (!c) return;
    var key = bestSlotFor(c, match.b);
    if (key) match.b[key] = c.id;
  }
  function beginTurn(side) {
    match.turn = side;
    match.roll = match.pair[side];
    // Online: timer ikut endsAt dari host. Lokal: acak 11-20 dtk.
    match.timeLeft = match.online
      ? Math.max(0, Math.ceil((match.endsAt - Date.now()) / 1000))
      : ROUND_TIME_MIN + Math.floor(Math.random() * (ROUND_TIME_MAX - ROUND_TIME_MIN + 1));
    renderMatch();
    startTimer();
  }
  function startTimer() {
    stopTimer();
    match.timerId = setInterval(function () {
      if (!match || match.over) { stopTimer(); return; }
      if (match.online) {
        match.timeLeft = Math.max(0, Math.ceil((match.endsAt - Date.now()) / 1000));
      } else {
        match.timeLeft--;
      }
      var t = $("timerLabel");
      t.textContent = "Waktu: " + match.timeLeft + " dtk";
      if (match.timeLeft <= 5) t.classList.add("timer-danger"); else t.classList.remove("timer-danger");
      if (match.timeLeft > 0 && match.timeLeft <= 3) sfx.tick();
      if (match.timeLeft <= 0) {
        if (match.online) onlineTimeout();
        else autoPlace();
      }
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
    if (match.online && match.myPlaced) { toast("Kamu sudah pasang ronde ini — menunggu lawan."); return; }
    var parts = match.online ? onlineMyParts() : activeParts();
    if (parts[key]) { toast("Slot " + slotLabel(key) + " udah terisi. Pilih slot kosong."); return; }
    parts[key] = match.roll.id;
    sfx.pop();
    toast(match.roll.name + " masuk slot " + slotLabel(key) + ".");
    if (match.online) {
      match.myPlaced = true;
      AFOnline.send({ t: "place", round: match.round, slot: key, charId: match.roll.id });
    }
    afterPlace();
  }
  function afterPlace() {
    if (!match) return;
    if (match.online) {
      // Online: ronde tidak berakhir pas lo pasang — nunggu lawan juga pasang
      // (atau timer habis, host yang majuin). Host lanjut kalau sudah lengkap.
      if (onlineIsHost()) onlineAdvanceIfReady();
      renderMatch();
      return;
    }
    stopTimer();
    if (match.mode === "bot") {
      lockOpponent(); // lawan lock-in bareng
      sfx.oppPlace();
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
    if (!match || match.over || !match.pair.a || !match.pair.b) return;
    if (match.online) {
      // Reroll cuma bisa sebelum ada yang pasang ronde ini.
      if (match.myPlaced || match.oppPlaced) { toast("Reroll cuma bisa sebelum ada yang pasang ronde ini."); return; }
      if (save.cash < REROLL_COST) { toast("Cash tidak cukup buat reroll (100 Cash)! Menang battle dulu."); return; }
      if (onlineIsHost()) {
        save.cash -= REROLL_COST;
        persist();
        var pa = rollUnique(match.a, []);
        var pb = rollUnique(match.b, [pa.id]);
        match.pair = { a: pa, b: pb };
        AFOnline.send({ t: "round", n: match.round, pair: { a: pa.id, b: pb.id }, endsAt: match.endsAt, a: match.a, b: match.b });
        match.roll = match.pair[match.mySide];
        sfx.reroll();
        renderBadges();
        renderMatch();
        toast("Reroll: " + match.roll.name + " [" + match.roll.rarity + "] — " + match.roll.move + "!");
      } else {
        match.rerollPending = true;
        AFOnline.send({ t: "reroll" });
        renderMatch();
        toast("Minta reroll ke host...");
        setTimeout(function () {
          if (match && match.rerollPending) {
            match.rerollPending = false;
            toast("Reroll tidak dijawab host — coba lagi.");
            renderMatch();
          }
        }, 3000);
      }
      return;
    }
    if (save.cash < REROLL_COST) { toast("Cash tidak cukup buat reroll (100 Cash)! Menang battle dulu."); return; }
    save.cash -= REROLL_COST;
    // Reroll = sepasang baru (kayak di Roblox): dua-duanya ganti.
    var pa = rollUnique(activeParts(), []);
    var pb = rollUnique(match.turn === "a" ? match.b : match.a, [pa.id]);
    match.pair = match.turn === "a" ? { a: pa, b: pb } : { a: pb, b: pa };
    match.roll = match.pair[match.turn];
    persist();
    sfx.reroll();
    if (match.roll.rarity === "Legendary" || match.roll.rarity === "Mythical" || match.roll.rarity === "Secret") sfx.levelup();
    renderBadges();
    renderMatch();
    toast("Reroll: " + match.roll.name + " [" + match.roll.rarity + "] — " + match.roll.move + "!");
  }
  // Panel lawan (LIVE): 5 slot lawan terisi satu per satu tiap ronde,
  // keliatan karakternya + nilai stat untuk slot itu.
  function renderOppPanel() {
    var oppParts, oppName;
    if (match.online) {
      oppParts = onlineOppParts();
      oppName = (window.AFOnline && AFOnline.oppName) || "LAWAN";
    } else if (match.mode === "bot") {
      oppParts = match.b;
      oppName = "BOT";
    } else {
      oppParts = match.turn === "a" ? match.b : match.a;
      oppName = "TEMAN";
    }
    $("oppTitle").textContent = "LAWAN (" + oppName + ") — LIVE";
    var html = "";
    SLOT_DEFS.forEach(function (d) {
      var id = oppParts[d.key];
      var c = id ? charById(id) : null;
      html += '<div class="opp-row"><span class="opp-label">' + d.label + '</span>' +
        (c ? imgHtml(c) + '<span class="opp-name">' + esc(c.name) + '</span><span class="opp-val">' + statOf(c, d.key) + '</span>' :
          '<span class="opp-empty">— menunggu —</span>') +
        "</div>";
    });
    $("oppPanel").innerHTML = html;
  }
  function renderMatch() {
    if (!match) return;
    if (!match.roll) {
      // Online: menunggu ronde pertama dari host.
      $("roundLabel").textContent = "RONDE " + match.round + "/5";
      $("turnLabel").textContent = "Menunggu host mulai match...";
      $("rollCard").innerHTML = "";
      $("matchSlots").innerHTML = "";
      renderOppPanel();
      return;
    }
    $("roundLabel").textContent = "RONDE " + match.round + "/5";
    var t = $("timerLabel");
    t.textContent = "Waktu: " + match.timeLeft + " dtk";
    if (match.timeLeft <= 5) t.classList.add("timer-danger"); else t.classList.remove("timer-danger");
    var who;
    if (match.online) {
      who = match.myPlaced ? "Kamu sudah pasang — menunggu lawan..." : "pilih slot buat " + match.roll.name + "!";
    } else {
      who = match.mode === "bot" ? "" : (match.turn === "a" ? "GILIRAN LO — " : "GILIRAN TEMAN — ");
      who += "pilih slot buat " + match.roll.name + "!";
    }
    $("turnLabel").textContent = who;
    renderOppPanel();
    // VS pair: roll lo vs roll lawan, live. Stat tampil sebagai chip.
    var myLabel, oppLabel;
    if (match.online) {
      myLabel = (window.AFOnline && AFOnline.myName) || "LO";
      oppLabel = (window.AFOnline && AFOnline.oppName) || "LAWAN";
    } else {
      myLabel = match.mode === "bot" ? "LO" : (match.turn === "a" ? "LO" : "TEMAN");
      oppLabel = match.mode === "bot" ? "BOT" : (match.turn === "a" ? "TEMAN" : "LO");
    }
    var myChar = match.online ? match.pair[match.mySide] : match.pair[match.turn];
    var oppChar = match.online ? match.pair[match.oppSide] : match.pair[match.turn === "a" ? "b" : "a"];
    $("rollCard").innerHTML = '<div class="vs-pair">' +
      '<div class="vs-side"><div class="vs-side-label">' + esc(myLabel) + '</div>' + cardHtml(myChar, false) + "</div>" +
      '<div class="vs-mid">VS</div>' +
      '<div class="vs-side"><div class="vs-side-label">' + esc(oppLabel) + '</div>' + cardHtml(oppChar, false) + "</div>" +
      "</div>";
    var rb = $("rerollBtn");
    rb.textContent = "REROLL (100 CASH)";
    // Online: reroll mati kalau sudah ada yang pasang ronde ini / lagi nunggu jawaban host.
    rb.disabled = save.cash < REROLL_COST ||
      (match.online && (match.myPlaced || match.oppPlaced || match.rerollPending));
    var parts = match.online ? onlineMyParts() : activeParts();
    var html = "";
    SLOT_DEFS.forEach(function (d) {
      var id = parts[d.key];
      var c = id ? charById(id) : null;
      html += '<button class="build-slot match-slot" data-slot="' + d.key + '"' + ((c || (match.online && match.myPlaced)) ? " disabled" : "") + ">";
      if (c) {
        html += imgHtml(c) +
          '<span class="slot-info"><span class="slot-label">' + d.label + ' <span class="slot-sub">(' + d.sub + ')</span></span>' +
          '<span class="slot-char">' + esc(c.name) + '</span>' +
          '<span class="slot-move">Jurus: ' + esc(c.move) + '</span></span>' +
          '<span class="slot-val">' + statOf(c, d.key) + '</span>';
      } else {
        html += '<span class="slot-info"><span class="slot-label">' + d.label + ' <span class="slot-sub">(' + d.sub + ')</span></span>' +
          '<span class="slot-empty">+ Kosong — tap buat pasang ' + esc(match.roll.name) + '</span></span>' +
          '<span class="slot-val slot-val-preview">' + statOf(match.roll, d.key) + '</span>';
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
  function finishMatch(partsA, partsB) {
    if (!match) return;
    match.over = true;
    stopTimer();
    var a = partsA || match.a, b = partsB || match.b, mode = match.mode, rev = match.reverse;
    var mySide = match.mySide || "a";
    match = null;
    $("matchPanel").classList.add("hidden");
    startShowdown(a, b, mode, rev, mySide);
  }

  // ---------------- SHOWDOWN (adu AVG score, ala BAAC) ----------------
  function startShowdown(aParts, bParts, mode, reverse, mySide) {
    // "A" = fighter LOKAL (tamu online = sisi b, jadi ditukar supaya kiri
    // selalu fighter lo dan kanan selalu lawan — menang/kalah tidak kebalik).
    var local = mySide === "b" ? bParts : aParts;
    var opp = mySide === "b" ? aParts : bParts;
    showdown = { a: local, b: opp, mode: mode, reverse: reverse, revealed: false, over: false };
    $("arena").classList.remove("hidden");
    $("showdownResult").innerHTML = "";
    $("showdownBtn").textContent = "SHOWDOWN!";
    $("showdownBtn").classList.remove("hidden");
    sfx.showdown();
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
      if (showdown.mode === "bot" || showdown.mode === "online") save.cash += DRAW_REWARD;
      sfx.draw();
    } else if (winner === "A") {
      msg = "MENANG! " + a.avg.toFixed(1) + " vs " + b.avg.toFixed(1) + ". +100 Cash, +1 Win!";
      if (showdown.mode === "bot" || showdown.mode === "online") { save.cash += WIN_REWARD; save.wins++; }
      sfx.win(); sfx.coin();
    } else {
      msg = "KALAH. " + a.avg.toFixed(1) + " vs " + b.avg.toFixed(1) + ". +15 Cash.";
      if (showdown.mode === "bot" || showdown.mode === "online") save.cash += LOSE_REWARD;
      sfx.lose();
    }
    persist();
    var rematchHtml = "";
    if (showdown.mode === "bot") rematchHtml = '<button id="rematchBtn" class="btn btn-red btn-big" style="margin-top:10px">REMATCH (BOT BARU)</button>';
    else if (showdown.mode === "online") rematchHtml = '<button id="rematchBtn" class="btn btn-red btn-big" style="margin-top:10px">REMATCH (ONLINE)</button>';
    $("showdownResult").innerHTML = '<div class="sd-result">' + esc(msg) + '</div>' + rematchHtml;
    $("showdownBtn").classList.add("hidden");
    var rb = $("rematchBtn");
    if (rb) rb.addEventListener("click", function () {
      sfx.click();
      rb.disabled = true;
      if (showdown.mode === "online") onlineRematch();
      else startMatch("bot");
    });
    renderBadges();
  });
  function closeMatchUI(quiet) {
    sfx.click();
    stopTimer();
    if (match && match.online && !quiet && window.AFOnline) { onlineLeaving = true; AFOnline.leave(); }
    match = null;
    showdown = null;
    $("arena").classList.add("hidden");
    $("matchPanel").classList.add("hidden");
    $("battleMenu").classList.remove("hidden");
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

  // ---------------- ONLINE 1v1 (PeerJS) ----------------
  var onlineLeaving = false; // true kalau KITA yang keluar (bukan lawan)
  function onlineIsHost() { return match && match.online && window.AFOnline && AFOnline.isHost; }
  function onlineMyParts() { return match[match.mySide]; }
  function onlineOppParts() { return match[match.oppSide]; }
  function randomEmptySlot(parts) {
    var empty = SLOT_DEFS.filter(function (d) { return !parts[d.key]; });
    if (!empty.length) return null;
    return empty[Math.floor(Math.random() * empty.length)].key;
  }

  // Host: mulai ronde (roll sepasang, kirim pesan round, terapkan lokal).
  function onlineBeginRound() {
    if (!match || match.over) return;
    if (match.round > 5) { onlineFinishLocal(); return; }
    var pa = rollUnique(match.a, []);
    var pb = rollUnique(match.b, [pa.id]);
    match.pair = { a: pa, b: pb };
    match.endsAt = Date.now() + (ROUND_TIME_MIN + Math.floor(Math.random() * (ROUND_TIME_MAX - ROUND_TIME_MIN + 1))) * 1000;
    match.myPlaced = false;
    match.oppPlaced = false;
    AFOnline.send({ t: "round", n: match.round, pair: { a: pa.id, b: pb.id }, endsAt: match.endsAt, a: match.a, b: match.b });
    beginTurn(match.mySide);
  }

  // Terapkan pesan round dari host (ronde baru maupun reroll).
  function onlineApplyRound(msg) {
    if (!match) startMatch("online"); // rejoin tengah match
    if (!match || match.over) return;
    if (msg.n !== match.round && msg.n !== match.round + 1) return; // ronde basi
    var oldPairA = match.pair.a ? match.pair.a.id : null;
    match.round = msg.n;
    match.pair = { a: charById(msg.pair.a), b: charById(msg.pair.b) };
    match.a = msg.a; match.b = msg.b;
    match.endsAt = msg.endsAt;
    match.myPlaced = false;
    match.oppPlaced = false;
    // Reroll tamu diterima: pair berubah -> potong 100 Cash sekali.
    if (match.rerollPending) {
      match.rerollPending = false;
      if (msg.pair.a !== oldPairA) {
        save.cash -= REROLL_COST;
        persist();
        renderBadges();
        sfx.reroll();
        toast("Reroll: " + match.pair[match.mySide].name + "!");
      } else {
        sfx.error();
        toast("Reroll ditolak — sudah ada yang pasang.");
      }
    } else if (match.round > 1) {
      sfx.roundStart();
    }
    beginTurn(match.mySide);
  }

  // Timer habis (online). Tamu: kunci pasang, tunggu host. Host: jeda 1,5 dtk
  // buat pesan place yang telat, lalu auto-place buat yang belum pasang.
  function onlineTimeout() {
    stopTimer();
    if (!match || match.over) return;
    if (!onlineIsHost()) { renderMatch(); return; }
    setTimeout(function () {
      if (!match || match.over) return;
      if (!match.myPlaced) {
        var key = randomEmptySlot(onlineMyParts());
        if (key) {
          onlineMyParts()[key] = match.roll.id;
          match.myPlaced = true;
          AFOnline.send({ t: "place", round: match.round, slot: key, charId: match.roll.id });
        }
      }
      if (!match.oppPlaced) {
        var oppChar = match.pair[match.oppSide];
        var okey = randomEmptySlot(onlineOppParts());
        if (okey && oppChar) {
          onlineOppParts()[okey] = oppChar.id;
          match.oppPlaced = true;
          AFOnline.send({ t: "place", round: match.round, slot: okey, charId: oppChar.id });
        }
      }
      onlineAdvanceIfReady();
    }, 1500);
  }

  // Host: kalau kedua sisi sudah pasang, lanjut ronde berikut / finish.
  function onlineAdvanceIfReady() {
    if (!match || match.over) return;
    if (!match.myPlaced || !match.oppPlaced) return;
    if (match.round >= 5) { onlineFinishLocal(); return; }
    match.round++;
    onlineBeginRound();
  }

  function onlineFinishLocal() {
    if (!match) return;
    AFOnline.send({ t: "finish", a: match.a, b: match.b });
    finishMatch(match.a, match.b);
  }

  function onlineRematch() {
    if (window.AFOnline) AFOnline.send({ t: "rematch" });
    startMatch("online");
    if (onlineIsHost()) onlineBeginRound();
  }

  function onlineHandleMessage(msg) {
    if (!msg || !msg.t) return;
    switch (msg.t) {
      case "join": // host: tamu masuk
        if (window.AFOnline) AFOnline.oppName = msg.name || "Pemain 2";
        var inMatch = !!(match && !match.over && match.pair && match.pair.a);
        if (inMatch) {
          AFOnline.send({ t: "welcome", name: AFOnline.myName, inMatch: true,
            round: { n: match.round, pair: { a: match.pair.a.id, b: match.pair.b.id }, endsAt: match.endsAt, a: match.a, b: match.b } });
        } else {
          AFOnline.send({ t: "welcome", name: AFOnline.myName, inMatch: false });
        }
        $("roomStatus").className = "hint status-ok";
        $("roomStatus").textContent = "Lawan masuk: " + AFOnline.oppName + " — tap MULAI MATCH.";
        $("startOnlineBtn").classList.remove("hidden");
        sfx.roomJoin();
        toast(AFOnline.oppName + " masuk room!");
        break;
      case "welcome": // tamu: host jawab
        if (window.AFOnline) AFOnline.oppName = msg.name || "Pemain 1";
        $("roomStatus").textContent = "Terhubung dengan " + AFOnline.oppName + "! Menunggu host mulai match...";
        if (msg.inMatch && msg.round) onlineApplyRound(msg.round);
        break;
      case "start": // tamu: host mulai
        startMatch("online");
        $("roomPanel").classList.add("hidden");
        break;
      case "round":
        onlineApplyRound(msg);
        break;
      case "place":
        if (!match || match.over) break;
        if (msg.round !== match.round) break; // ronde basi
        var oppParts = onlineOppParts();
        if (oppParts[msg.slot]) break; // sudah terisi (auto-place host vs pesan telat)
        oppParts[msg.slot] = msg.charId;
        match.oppPlaced = true;
        sfx.oppPlace();
        renderMatch();
        if (onlineIsHost()) onlineAdvanceIfReady();
        break;
      case "reroll": // host: tamu minta reroll
        if (!match || match.over || !onlineIsHost()) break;
        if (match.myPlaced || match.oppPlaced) {
          // Sudah ada yang pasang: kirim ronde sekarang (pair sama) biar tamu batal.
          AFOnline.send({ t: "round", n: match.round, pair: { a: match.pair.a.id, b: match.pair.b.id }, endsAt: match.endsAt, a: match.a, b: match.b });
          break;
        }
        var rpa = rollUnique(match.a, []);
        var rpb = rollUnique(match.b, [rpa.id]);
        match.pair = { a: rpa, b: rpb };
        AFOnline.send({ t: "round", n: match.round, pair: { a: rpa.id, b: rpb.id }, endsAt: match.endsAt, a: match.a, b: match.b });
        match.roll = match.pair[match.mySide];
        renderMatch();
        break;
      case "finish":
        if (match) finishMatch(msg.a, msg.b);
        break;
      case "rematch":
        if (showdown && showdown.over) {
          if (match && Date.now() - match.startedAt < 2000) break; // dua-duanya tap bareng
          startMatch("online");
          if (onlineIsHost()) onlineBeginRound();
        }
        break;
      case "leave":
        onlineOpponentLeft();
        break;
    }
  }

  function onlineOpponentLeft() {
    if (onlineLeaving) { onlineLeaving = false; return; } // kita yang keluar
    var wasHost = window.AFOnline && AFOnline.isHost;
    toast("Lawan keluar room.");
    if (match) closeMatchUI(true);
    if (wasHost) {
      // Host tetap di room, tunggu lawan baru.
      $("roomPanel").classList.remove("hidden");
      $("startOnlineBtn").classList.add("hidden");
      $("roomStatus").textContent = "Lawan keluar — room " + AFOnline.roomCode + " masih buka, tunggu lawan baru.";
    } else {
      onlineResetRoomPanel();
      if (window.AFOnline) AFOnline.destroy();
    }
  }

  function onlineResetRoomPanel() {
    $("roomPanel").classList.remove("hidden");
    $("roomInfo").classList.add("hidden");
    $("startOnlineBtn").classList.add("hidden");
    $("retryJoinBtn").classList.add("hidden");
    $("roomStatus").className = "hint";
    $("roomStatus").textContent = "Bikin room baru atau gabung pakai kode teman lo.";
  }

  function onlineSetupHandlers() {
    if (!window.AFOnline) return;
    AFOnline.onEvent = function (ev) {
      switch (ev.type) {
        case "waiting":
          $("roomInfo").classList.remove("hidden");
          $("retryJoinBtn").classList.add("hidden");
          $("roomCodeLabel").textContent = ev.code;
          $("roomStatus").className = "hint status-ok";
          $("roomStatus").textContent = "ROOM AKTIF (" + ev.code + ") — bagikan kode/link ke teman lo.";
          $("startOnlineBtn").classList.add("hidden");
          break;
        case "peer-disconnected":
          // Host: room-nya yang putus. Tamu: koneksinya ke cloud yang putus
          // (bukan room) — arahkan ke COBA LAGI, bukan pesan room.
          if (AFOnline.isHost) {
            $("roomStatus").className = "hint status-warn";
            $("roomStatus").textContent = "ROOM PUTUS — menyambung ulang... Jangan pindah aplikasi / kunci HP.";
          } else {
            $("roomStatus").className = "hint status-warn";
            $("roomStatus").textContent = "Koneksi putus — tap COBA LAGI buat gabung ulang.";
            $("retryJoinBtn").classList.remove("hidden");
          }
          break;
        case "peer-reconnected":
          $("roomStatus").className = "hint status-ok";
          $("roomStatus").textContent = "ROOM AKTIF kembali (" + ev.code + ") — siap menerima lawan.";
          toast("Koneksi room tersambung ulang!");
          break;
        case "connected":
          $("retryJoinBtn").classList.add("hidden");
          if (!AFOnline.isHost) {
            AFOnline.send({ t: "join", name: AFOnline.myName });
            $("roomStatus").className = "hint status-ok";
            $("roomStatus").textContent = "Terhubung! Menunggu host...";
          }
          break;
        case "message":
          onlineHandleMessage(ev.msg);
          break;
        case "disconnected":
          onlineOpponentLeft();
          break;
        case "peer-unavailable":
          sfx.error();
          $("roomStatus").className = "hint status-warn";
          $("roomStatus").textContent = ev.message;
          $("retryJoinBtn").classList.remove("hidden");
          toast("Room " + ev.code + " tidak ketemu.");
          break;
        case "error":
          // v4.2: sebelumnya case ini HANYA toast — roomStatus tetap
          // "Join room ..." dan COBA LAGI tidak muncul, jadi user mentok.
          // Sekarang error generik (termasuk timeout join) juga menampilkan
          // status + COBA LAGI untuk tamu, sama seperti peer-unavailable.
          sfx.error();
          $("roomStatus").className = "hint status-warn";
          $("roomStatus").textContent = ev.message || "Terjadi error koneksi.";
          // v4.3 (Neon): COBA LAGI cuma kalau ada kode room yang bisa di-retry.
          if (!AFOnline.isHost && AFOnline.roomCode) $("retryJoinBtn").classList.remove("hidden");
          toast(ev.message || "Terjadi error koneksi.");
          break;
        case "left":
          onlineLeaving = false;
          onlineResetRoomPanel();
          break;
      }
    };
  }

  // ---------------- ROOM UI ----------------
  $("onlineBtn").addEventListener("click", function () {
    sfx.click();
    if (typeof Peer === "undefined") { toast("Mode online tidak bisa dimuat — cek internet lalu refresh halaman."); return; }
    $("roomPanel").classList.toggle("hidden");
  });
  $("createRoomBtn").addEventListener("click", function () {
    sfx.click();
    var name = ($("playerNameInput").value || "").trim();
    if (window.AFOnline) AFOnline.createRoom(name);
    $("roomStatus").textContent = "Bikin room...";
  });
  $("joinRoomBtn").addEventListener("click", function () {
    sfx.click();
    var name = ($("playerNameInput").value || "").trim();
    var code = ($("roomCodeInput").value || "").trim();
    if (!code) { sfx.error(); toast("Masukin kode room dulu."); return; }
    $("retryJoinBtn").classList.add("hidden");
    $("roomStatus").className = "hint";
    // v4.3 (Neon): status DULU baru joinRoom — kalau joinRoom emit error
    // sinkron (mis. kode < 4 huruf), pesannya tidak ketimpa "Join room ...".
    $("roomStatus").textContent = "Join room " + code.toUpperCase() + "...";
    if (window.AFOnline) AFOnline.joinRoom(code, name);
  });
  $("retryJoinBtn").addEventListener("click", function () {
    sfx.click();
    $("retryJoinBtn").classList.add("hidden");
    $("roomStatus").className = "hint";
    $("roomStatus").textContent = "Mencoba gabung ulang ke room " + (AFOnline.roomCode || "") + "...";
    if (window.AFOnline) AFOnline.retryJoin();
  });
  $("copyLinkBtn").addEventListener("click", function () {
    sfx.click();
    var link = window.AFOnline ? AFOnline.inviteLink() : "";
    if (!link) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(function () { toast("Link invite disalin!"); }, function () { toast(link); });
    } else {
      toast(link);
    }
  });
  $("startOnlineBtn").addEventListener("click", function () {
    sfx.click();
    if (!window.AFOnline || !AFOnline.connected) { toast("Belum ada lawan di room."); return; }
    $("roomPanel").classList.add("hidden");
    startMatch("online");
    AFOnline.send({ t: "start" });
    onlineBeginRound();
  });
  $("leaveRoomBtn").addEventListener("click", function () {
    sfx.click();
    if (match && match.online) closeMatchUI();
    else if (window.AFOnline) AFOnline.leave();
    onlineResetRoomPanel();
  });

  // ---------------- START ----------------
  $("galleryCount").textContent = "(" + CHARACTERS.length + ")";
  onlineSetupHandlers();
  if (typeof Peer === "undefined") {
    $("onlineBtn").disabled = true;
    $("onlineBtn").textContent = "1VS1 ONLINE (BUTUH INTERNET)";
  }
  // Link invite: ?join=XXXXXX -> buka panel room + isi kode.
  var joinParam = null;
  try { joinParam = new URLSearchParams(location.search).get("join"); } catch (e) {}
  if (joinParam) {
    document.querySelector('.tab[data-tab="battle"]').click();
    $("roomPanel").classList.remove("hidden");
    $("roomCodeInput").value = joinParam.toUpperCase().replace(/[^A-Z0-9]/g, "");
    toast("Kode room " + joinParam.toUpperCase() + " terdeteksi — isi nama lalu tap GABUNG.");
  }
  renderAll();
})();
