// Anime Fighter (web) v4.6 — ala Build An Anime Character.
// Match lokal (bot/duel 1 layar): 5 ronde, gacha sepasang, pasang sendiri,
// v4.2: join timeout (12 dtk peer open + 10 dtk conn open) + error case tampilkan COBA LAGI.
// v4.3: UI polish Neon HIGH (topbar/tabs/kartu/HUD/room/SHOWDOWN) + reorder joinRoomBtn + guard timeout.
// v4.4: TURN test (OpenRelay) + pesan timeout dibedakan tahap-1/tahap-2 (online.js peerOptions()).
// v4.5: diagnostik ICE (iceDiag: kandidat host/srflx/relay + err) + OpenRelay dihapus (kredensial bersama sudah tidak didokumentasikan Metered).
// v4.6: modal PENGATURAN (tombol ⚙ Atur di topbar) — musik latar (3 OST anime asli + upload MP3 + URL MP3, <audio> loop)
//       + latar belakang (4 gradien nuansa anime + kolase karakter + URL/upload gambar). Match flow / timer / roster / online.js TIDAK disentuh.
// stat DITAMPILIN selama match (chip di kartu + nilai per slot), timer acak
// 11-20 dtk, reroll sepasang 100 Cash. Gambar kartu object-fit contain
// (utuh, tidak kepotong). Battle menu disembunyiin saat match aktif.
// ONLINE 1v1 (PeerJS P2P): host buat room (kode 6 huruf), teman join pakai
// kode/link. Host = wasit: gacha sepasang tiap ronde, pegang timer (endsAt),
// auto-place buat yang belum pasang. Tamu tidak auto-place sendiri — state
// ronde selalu datang dari host (pesan `round` bawa parts kedua sisi).
// SHOWDOWN: dihapus v4.11 — diganti ADU KARTU: 5 duel sepasang, HP bar +
// rumus damage Roblox (max(2, ATK - floor(DEF/3))), pemenang = skor duel.
// Layar akhir nunjukin TIM LO; deck lawan di balik tombol. Save di localStorage.
// v4.11: showdown dihapus -> adu kartu (HP + damage Roblox) + layar akhir
// tim LO + tombol LIHAT DECK LAWAN + LEWATI. Rarity dari AVG (v4.10) tetap.
// v4.12: Obito pakai form terakhir (Juubi, gambar lokal) + efek dapet kartu
// langka naik per tier (jeda/suara/glow/banner/lompatan/kilat).
(function () {
  "use strict";

  var SAVE_KEY = "animeFighterSaveV1";
  var REROLL_COST = 100;
  var ROUND_TIME_MIN = 11; // timer acak per ronde, kayak Roblox (teramati 11-20)
  var ROUND_TIME_MAX = 20;
  var ROLL_BUFFER_MS = 2500; // v4.14: roll Secret ~2.45 dtk tidak boleh makan waktu
  // mikir tamu online — host menambahkan buffer ini ke endsAt tiap ronde.
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
  var soundOn = save.soundOn !== false;
  var match = null;     // match aktif: {mode, reverse, round, turn, a, b, pair, roll, timeLeft, timerId, over,
                          //   online, mySide, oppSide, myPlaced, oppPlaced, endsAt, startedAt}
  var cardBattle = null; // state adu kartu aktif
  var battleSeq = 0;     // token pembatal timer adu kartu
  var LOCK_IN_MS = 280;  // jeda lock-in agar kartu terlihat terkunci di slot
  var lockInTimer = null;

  // ---------------- SAVE ----------------
  function defaultSave() {
    return {
      cash: 200, wins: 0, battles: 0, soundOn: true,
      anim: "auto", motionBannerDismissed: false,
      music: { on: true, track: "overtaken", vol: 25, url: "" },
      bg: { preset: "jojo", url: "" }
    };
  }
  function loadSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultSave();
      var s = JSON.parse(raw);
      var d = defaultSave();
      for (var k in d) if (s[k] === undefined) s[k] = d[k];
      // Save lama tidak punya music/bg, atau nested-nya tidak lengkap — lengkapi.
      if (!s.music || typeof s.music !== "object") s.music = d.music;
      else for (var mk in d.music) if (s.music[mk] === undefined) s.music[mk] = d.music[mk];
      if (!s.bg || typeof s.bg !== "object") s.bg = d.bg;
      else for (var bk in d.bg) if (s.bg[bk] === undefined) s.bg[bk] = d.bg[bk];
      // v4.7.1: migrasi satu kali — save lama yang masih di default lama
      // ("malam") pindah ke default baru ("jojo"). Flag mencegah save yang
      // sengaja memilih "malam" ikut kepindah di load berikutnya.
      if (s.bg && typeof s.bg === "object" && !s.bg.v47migrated) {
        s.bg.v47migrated = true;
        if (s.bg.preset === "malam") s.bg.preset = "jojo";
      }
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
  function noiseBurst(dur, vol, freq, when, filterType) {
    if (!soundOn) return;
    var c = ctx(); if (!c) return;
    var t = c.currentTime + (when || 0);
    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = filterType || "lowpass"; f.frequency.value = freq || 800;
    var g = c.createGain(); g.gain.value = vol || 0.4;
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t);
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
    rollTick: function (step) { tone(480 + (step || 0) * 22, 0.05, "square", 0.08); },
    reroll: function () { noiseBurst(0.12, 0.14, 2000); tone(380, 0.12, "sine", 0.14, 0.04, 820); },
    battle: function () { var n = [392, 523, 659, 784]; for (var i = 0; i < n.length; i++) tone(n[i], 0.1, "sawtooth", 0.1, i * 0.07); },
    roomJoin: function () { tone(659, 0.09, "sine", 0.16, 0); tone(988, 0.14, "sine", 0.16, 0.09); },
    matchStart: function () { var n = [523, 659, 784]; for (var i = 0; i < n.length; i++) tone(n[i], 0.12, "triangle", 0.16, i * 0.08); },
    error: function () { tone(220, 0.12, "sawtooth", 0.12, 0); tone(180, 0.16, "sawtooth", 0.12, 0.12); },
    // v4.14: SFX Roll 5 Tier (synth WebAudio murni)
    rareChime: function () {
      tone(523, 0.09, "triangle", 0.18, 0); tone(523, 0.07, "square", 0.05, 0);
      tone(784, 0.14, "triangle", 0.2, 0.07); tone(784, 0.1, "square", 0.05, 0.07);
    },
    epicSwoosh: function () { noiseBurst(0.16, 0.16, 2200, 0, "highpass"); tone(340, 0.15, "triangle", 0.08, 0, 720); },
    epicImpact: function () {
      tone(140, 0.11, "sine", 0.24, 0, 55);
      var n = [659, 831, 988];
      for (var i = 0; i < n.length; i++) tone(n[i], 0.12, "triangle", 0.18, 0.03 + i * 0.065);
    },
    legRiser: function () { tone(260, 0.24, "sawtooth", 0.1, 0, 780); tone(520, 0.24, "triangle", 0.09, 0, 1040); },
    legImpact: function () {
      tone(130, 0.16, "sine", 0.28, 0, 45); noiseBurst(0.09, 0.2, 700, 0, "lowpass");
      var n = [523, 659, 784, 1047];
      for (var i = 0; i < n.length; i++) {
        tone(n[i], 0.22, "sawtooth", 0.09, i * 0.06);
        tone(n[i], 0.24, "triangle", 0.14, i * 0.06);
      }
    },
    mythRiser: function () { tone(300, 0.16, "sawtooth", 0.09, 0, 680); },
    mythCrack: function () {
      noiseBurst(0.08, 0.24, 2800, 0, "highpass");
      noiseBurst(0.11, 0.22, 4200, 0.06, "highpass");
      tone(1400, 0.09, "square", 0.09, 0.02, 420);
    },
    mythImpact: function () {
      tone(110, 0.26, "sine", 0.32, 0, 36); noiseBurst(0.13, 0.22, 650, 0, "lowpass");
      var n = [587, 740, 880, 1175];
      for (var i = 0; i < n.length; i++) {
        tone(n[i], 0.26, "sawtooth", 0.1, i * 0.055);
        tone(n[i] * 0.5, 0.24, "square", 0.07, i * 0.055);
      }
    },
    secHeartbeat: function () {
      tone(78, 0.11, "sine", 0.3, 0, 38);
      tone(82, 0.12, "sine", 0.32, 0.13, 36);
    },
    secSlash: function () {
      noiseBurst(0.09, 0.22, 4600, 0, "highpass");
      tone(2200, 0.09, "triangle", 0.12, 0, 880);
    },
    secImpact: function () {
      tone(95, 0.36, "sine", 0.36, 0, 28); noiseBurst(0.18, 0.24, 520, 0, "lowpass");
      // Minor (D-F-A) -> Major (D-F#-A-D5-A5)
      tone(294, 0.18, "sawtooth", 0.09, 0.02); tone(349, 0.16, "sawtooth", 0.09, 0.02); tone(440, 0.18, "sawtooth", 0.09, 0.02);
      var maj = [294, 370, 440, 587, 880];
      for (var i = 0; i < maj.length; i++) {
        tone(maj[i], 0.38, "triangle", 0.14, 0.15 + i * 0.035);
        tone(maj[i], 0.34, "sawtooth", 0.07, 0.15 + i * 0.035);
      }
    }
  };

  // ---------------- BANTU ----------------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(t._timer); t._timer = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }
  function imgHtml(c, cls, eager) {
    if (c.img) return '<img class="' + (cls || "") + '" src="' + esc(c.img) + '" alt="' + esc(c.name) + '"' + (eager ? "" : ' loading="lazy"') + ' onerror="this.outerHTML=\'<div class=&quot;img-fallback&quot; style=&quot;background:' + esc(c.color) + '&quot;>' + esc(c.name.charAt(0)) + '</div>\'">';
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
  function cardHtml(c, isSelected, staggerIdx) {
    var staggerCls = typeof staggerIdx === "number" ? " card-stagger" : "";
    var staggerStyle = typeof staggerIdx === "number" ? ' style="animation-delay:' + (Math.min(staggerIdx, 20) * 30) + 'ms"' : "";
    return '<button class="card rarity-' + rarityOf(c) + (isSelected ? " selected" : "") + staggerCls + '" data-id="' + c.id + '"' + staggerStyle + '>' +
      imgHtml(c) +
      '<div class="card-body"><div class="rarity-tag">' + rarityOf(c).toUpperCase() + '</div>' +
      '<div class="card-name">' + esc(c.name) + '</div>' +
      '<div class="card-anime">' + esc(c.anime) + '</div>' +
      '<div class="card-move">Jurus: ' + esc(c.move) + '</div>' +
      '<div class="card-stats">' + statLine(c) + '</div>' +
      "</div></button>";
  }
  var galleryDirty = true;
  function renderGallery() {
    var q = ($("gallerySearch").value || "").toLowerCase();
    var f = $("galleryFilter").value;
    var list = CHARACTERS.filter(function (c) {
      if (f && rarityOf(c) !== f) return false;
      if (!q) return true;
      return (c.name + " " + c.anime + " " + c.move).toLowerCase().indexOf(q) !== -1;
    });
    $("galleryGrid").innerHTML = list.map(function (c, idx) { return cardHtml(c, false, idx); }).join("") ||
      '<p class="hint">Tidak ketemu. Coba kata lain.</p>';
    galleryDirty = false;
  }
  function renderAll() {
    renderBadges();
    var galTab = $("tab-gallery");
    if (galTab && galTab.classList.contains("active")) renderGallery();
    if (match && !match.over) renderMatch();
  }

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
    clearTimeout(lockInTimer); lockInTimer = null;
    match = {
      mode: mode,
      reverse: $("battleMode").value === "reverse",
      round: 1, turn: "a",
      a: emptyParts(), b: emptyParts(),
      pair: { a: null, b: null }, roll: null, timeLeft: ROUND_TIME_MAX, timerId: null, over: false, locking: false,
      online: mode === "online",
      mySide: (mode === "online" && window.AFOnline) ? (AFOnline.isHost ? "a" : "b") : "a",
      oppSide: (mode === "online" && window.AFOnline) ? (AFOnline.isHost ? "b" : "a") : "b",
      myPlaced: false, oppPlaced: false, endsAt: 0, startedAt: Date.now()
    };
    cardBattle = null; battleSeq++;
    $("battleMenu").classList.add("hidden");
    $("roomPanel").classList.add("hidden");
    $("arena").classList.add("hidden");
    $("matchPanel").classList.remove("hidden");
    $("matchTitle").textContent = mode === "bot" ? "ADU KARTU VS BOT" : (mode === "duel" ? "DUEL TEMAN (1 LAYAR)" : "1VS1 ONLINE");
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
  var rollTimers = [];
  var rollSeq = 0;
  // ---------------- EFEK ANIMASI (v4.9.3) ----------------
  // save.anim: "auto" = ikut Windows; "on" = efek penuh walau Windows
  // reduce-motion; "off" = efek ringan (reveal bertahap, tanpa spin/shake/flash).
  function osPrefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function isReducedMotion() {
    if (save.anim === "on") return false;
    if (save.anim === "off") return true;
    return osPrefersReducedMotion();
  }
  function applyMotionPref() {
    if (document.body && document.body.classList) document.body.classList.toggle("reduce-motion", isReducedMotion());
    var b = $("motionBanner");
    if (b) {
      var show = save.anim === "auto" && osPrefersReducedMotion() && !save.motionBannerDismissed;
      b.classList.toggle("hidden", !show);
    }
  }
  function renderAnimUI() {
    var btn = $("animToggleBtn");
    if (btn) btn.textContent = save.anim === "on" ? "ON" : (save.anim === "off" ? "OFF" : "AUTO");
  }
  // Gambar roll di-preload supaya langkah 55-70ms tidak blank (Kitsu dsb.
  // belum tentu di-cache browser). Dijaga: headless/sim tidak punya Image.
  function preloadChars(list) {
    if (typeof Image === "undefined") return;
    (list || []).forEach(function (c) {
      if (c && c.img) { var im = new Image(); im.src = c.img; }
    });
  }
  function prewarmRollImages() {
    preloadChars(CHARACTERS.slice(0, 24));
  }
  // Pilih decoy roll: tidak ada dua gambar berurutan yang sama, dan decoy
  // terakhir bukan gambar kartu yang akan mendarat.
  function pickDecoys(n, notImg) {
    var list = [], lastImg = null, guard = 0;
    while (list.length < n && guard++ < 300) {
      var c = randomSpinChar();
      if (!c || !c.img) continue;
      if (c.img === lastImg) continue;
      if (list.length === n - 1 && notImg && c.img === notImg) continue;
      list.push(c); lastImg = c.img;
    }
    return list;
  }
  // ---------------- ROLL FX 5 TIER (v4.14, Neubrutalist + Stage Overlay) ----------------
  var TIER_RANK = { Common: 0, Rare: 1, Epic: 2, Legendary: 3, Mythical: 4, Secret: 5 };
  var RARE_FX = {
    Common:    { pause: 0,   sfx: ["pop"],        fullscreen: false },
    Rare:      { pause: 80,  sfx: ["rareChime"],  fullscreen: false },
    Epic:      { pause: 180, sfx: ["epicImpact"], fullscreen: false },
    Legendary: { pause: 280, sfx: ["legImpact"],  fullscreen: true },
    Mythical:  { pause: 420, sfx: ["mythImpact"], fullscreen: true },
    Secret:    { pause: 520, sfx: ["secImpact"],  fullscreen: true }
  };
  var PARTICLE_POOL_SIZE = 14;
  var particlePool = [];

  function initRollOverlay() {
    var box = $("rsoParticles");
    if (!box || !document.createElement) return;
    if (particlePool.length) return;
    box.innerHTML = "";
    for (var i = 0; i < PARTICLE_POOL_SIZE; i++) {
      var sp = document.createElement("span");
      sp.className = "fx-p";
      box.appendChild(sp);
      particlePool.push(sp);
    }
  }
  function clearStageOverlay() {
    var ov = $("rollStageOverlay");
    if (ov && ov.classList) {
      ov.className = "roll-stage-overlay";
    }
    for (var i = 0; i < particlePool.length; i++) {
      if (particlePool[i].classList) particlePool[i].className = "fx-p";
    }
    var rc = $("rollCard");
    if (rc && rc.querySelectorAll) {
      rc.querySelectorAll(".vs-side").forEach(function (s) {
        s.classList.remove("vs-spotlight", "vs-susp-epic", "vs-susp-legendary", "vs-fake-gold", "vs-flash-rare", "vs-recoil", "fx-shake-4", "fx-shake-6", "fx-shake-8");
        s.querySelectorAll(".vs-side-slash, .vs-crack-layer").forEach(function (n) {
          if (n.parentNode) n.parentNode.removeChild(n);
        });
      });
    }
    var mp = $("matchPanel");
    if (mp && mp.querySelectorAll) {
      mp.querySelectorAll(".fx-shake-4, .fx-shake-6, .fx-shake-8").forEach(function (el) {
        el.classList.remove("fx-shake-4", "fx-shake-6", "fx-shake-8");
      });
    }
  }
  function clearRollScene() {
    rollSeq++;
    while (rollTimers.length) clearTimeout(rollTimers.pop());
    clearStageOverlay();
    bgmDuckCancel(true);
    if (match) match.rolling = false;
  }
  function rareFx(c) { return RARE_FX[rarityOf(c)] || RARE_FX.Common; }
  function tierRank(c) { return c ? (TIER_RANK[rarityOf(c)] || 0) : 0; }
  function playRareSfx(c) {
    var fx = rareFx(c);
    fx.sfx.forEach(function (name) { if (sfx[name]) sfx[name](); });
  }
  function rarityEffects(c) {
    if (!c) return { wrapCls: "", sideCls: "", banner: "" };
    var r = rarityOf(c);
    if (r === "Secret") return { wrapCls: " vs-land-secret vs-secret-skin", sideCls: "vs-bg-secret", banner: '<span class="vs-rare-banner vs-banner-secret">[ SECRET ]</span>' };
    if (r === "Mythical") return { wrapCls: " vs-land-mythical", sideCls: "vs-bg-mythical", banner: '<span class="vs-rare-banner vs-banner-mythical">⚡ MYTHICAL ⚡</span>' };
    if (r === "Legendary") return { wrapCls: " vs-land-legendary", sideCls: "vs-bg-legendary", banner: '<span class="vs-rare-banner vs-banner-legendary">★ LEGENDARY ★</span>' };
    if (r === "Epic") return { wrapCls: " vs-land-epic", sideCls: "vs-bg-epic", banner: '<span class="vs-rare-banner vs-banner-epic">EPIC!</span>' };
    if (r === "Rare") return { wrapCls: " vs-land-rare", sideCls: "vs-bg-rare", banner: '<span class="vs-rare-banner vs-banner-rare">RARE</span>' };
    return { wrapCls: "", sideCls: "", banner: "" };
  }
  function vsCardWrapHtml(c, isLanding) {
    var fx = rarityEffects(c);
    return '<div class="vs-card-wrap' + (isLanding ? " vs-land" : "") + fx.wrapCls + '">' +
      fx.banner + cardHtml(c, false) + "</div>";
  }
  function triggerParticles(sideEl, tier) {
    if (isReducedMotion() || !particlePool.length) return;
    var cfg = {
      Rare:      { count: 4,  radius: 82,  colors: ["#2196F3", "#FFFFFF"], shapes: ["fx-diamond"] },
      Epic:      { count: 8,  radius: 105, colors: ["#8B5CF6", "#FFFFFF", "#111111"], shapes: ["fx-tri", "fx-star"] },
      Legendary: { count: 10, radius: 132, colors: ["#FACC15", "#111111", "#FFFFFF"], shapes: ["fx-star", "fx-diamond"] },
      Mythical:  { count: 12, radius: 155, colors: ["#EC4899", "#06B6D4", "#FFFFFF", "#111111"], shapes: ["fx-tri", "fx-star", "fx-bolt"] },
      Secret:    { count: 14, radius: 175, colors: ["#FFEB3B", "#FFFFFF", "#111111"], shapes: ["fx-bolt", "fx-star", "fx-diamond"] }
    }[tier];
    if (!cfg) return;
    var ox = "50%", oy = "42%";
    if (sideEl && typeof sideEl.getBoundingClientRect === "function") {
      var rect = sideEl.getBoundingClientRect();
      if (rect && rect.width > 0) {
        ox = Math.round(rect.left + rect.width / 2) + "px";
        oy = Math.round(rect.top + rect.height * 0.45) + "px";
      }
    }
    var ov = $("rollStageOverlay");
    if (ov && ov.classList) ov.classList.add("rso-active");
    for (var i = 0; i < particlePool.length; i++) {
      var p = particlePool[i];
      if (i >= cfg.count) { p.className = "fx-p"; continue; }
      var angle = (Math.PI * 2 * i) / cfg.count + (i % 2 ? 0.18 : -0.18);
      var dist = cfg.radius * (0.72 + ((i * 37) % 10) / 28);
      var tx = Math.round(Math.cos(angle) * dist) + "px";
      var ty = Math.round(Math.sin(angle) * dist) + "px";
      var rot = ((i % 2 ? 1 : -1) * (90 + i * 28)) + "deg";
      p.style.setProperty("--ox", ox);
      p.style.setProperty("--oy", oy);
      p.style.setProperty("--tx", tx);
      p.style.setProperty("--ty", ty);
      p.style.setProperty("--rot", rot);
      p.style.setProperty("--c", cfg.colors[i % cfg.colors.length]);
      p.className = "fx-p " + cfg.shapes[i % cfg.shapes.length];
    }
    if (particlePool[0]) void particlePool[0].offsetWidth;
    for (var j = 0; j < cfg.count; j++) particlePool[j].classList.add("fx-burst");
  }
  function triggerArenaShake(spotEl, levelCls) {
    if (isReducedMotion()) return;
    var targets = [spotEl, $("matchTitle"), $("turnLabel"), $("rerollBtn")];
    targets.forEach(function (el) {
      if (!el || !el.classList) return;
      el.classList.remove("fx-shake-4", "fx-shake-6", "fx-shake-8");
      void el.offsetWidth;
      el.classList.add(levelCls);
    });
  }
  function landSideCard(sideEl, label, ch, sideScopedOnly) {
    if (!sideEl || !ch) return;
    var fx = rarityEffects(ch);
    sideEl.classList.remove("vs-susp-epic", "vs-susp-legendary", "vs-fake-gold");
    if (fx.sideCls) sideEl.classList.add(fx.sideCls);
    sideEl.innerHTML = '<div class="vs-side-label">' + esc(label) + "</div>" + vsCardWrapHtml(ch, true);
    var r = rarityOf(ch);
    if (!isReducedMotion()) {
      if (r === "Rare") {
        sideEl.classList.add("vs-flash-rare");
        triggerParticles(sideEl, "Rare");
      } else if (r === "Epic") {
        var sl = document.createElement("div");
        sl.className = "vs-side-slash";
        sideEl.appendChild(sl);
        sideEl.classList.remove("vs-recoil"); void sideEl.offsetWidth; sideEl.classList.add("vs-recoil");
        triggerParticles(sideEl, "Epic");
      } else if (sideScopedOnly && (r === "Legendary" || r === "Mythical" || r === "Secret")) {
        triggerParticles(sideEl, "Epic");
      }
    }
  }
  function vsSpinCardHtml(c) {
    return '<div class="vs-card-wrap vs-spin"><button class="card" type="button" tabindex="-1">' +
      imgHtml(c, "", true) +
      '<div class="card-body"><div class="rarity-tag">ROLLING...</div>' +
      '<div class="card-name">' + esc(c.name) + "</div>" +
      '<div class="card-anime">' + esc(c.anime) + "</div>" +
      '<div class="card-move">Mengacak petarung...</div>' +
      '<div class="card-stats"><span class="stat-chip">STR <b>?</b></span><span class="stat-chip">SPD <b>?</b></span><span class="stat-chip">ABI <b>?</b></span><span class="stat-chip">IQ <b>?</b></span><span class="stat-chip">DUR <b>?</b></span></div>' +
      "</div></button></div>";
  }
  function randomSpinChar() {
    var pool = CHARACTERS.filter(function (c) { return !!c.img; });
    var arr = pool.length ? pool : CHARACTERS;
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function updateSpinSide(sideEl, ch) {
    if (!sideEl || !ch) return;
    var im = sideEl.querySelector("img");
    if (im && ch.img) { im.src = ch.img; im.alt = ch.name; }
    var nm = sideEl.querySelector(".card-name");
    if (nm) nm.textContent = ch.name;
    var an = sideEl.querySelector(".card-anime");
    if (an) an.textContent = ch.anime;
    var w = sideEl.querySelector(".vs-card-wrap");
    if (w && w.classList) {
      w.classList.remove("tick");
      void w.offsetWidth;
      w.classList.add("tick");
    }
  }
  // v4.9.3: kurva ease-out — burst cepat lalu rem yang kebaca, total 1127ms.
  var ROLL_STEPS = [55, 58, 62, 68, 76, 88, 110, 145, 195, 270];
  var ROLL_OPP_LAG_MS = 220; // BOT mendarat setelah LO (saat non-fullscreen)

  function runSpotlightSequence(mySeq, spotEl, spotLabel, spotChar, onFinish) {
    var r = rarityOf(spotChar);
    var ov = $("rollStageOverlay");
    function at(ms, fn) {
      rollTimers.push(setTimeout(function () {
        if (!match || match.over || rollSeq !== mySeq) return;
        fn();
      }, ms));
    }
    if (r === "Legendary") {
      // Antisipasi 280ms -> flash 60ms -> reveal 440ms (~2,05 dtk total)
      if (ov) ov.className = "roll-stage-overlay rso-active rso-scrim-on";
      if (spotEl) spotEl.classList.add("vs-spotlight", "vs-susp-legendary");
      bgmDuck(0.35, 60, 260, 300);
      sfx.legRiser();
      at(280, function () {
        if (ov) ov.className = "roll-stage-overlay rso-active rso-over rso-imp-leg";
      });
      at(340, function () {
        if (ov) ov.className = "roll-stage-overlay rso-active rso-scrim-on rso-speed-leg";
        landSideCard(spotEl, spotLabel, spotChar, false);
        triggerParticles(spotEl, "Legendary");
        triggerArenaShake(spotEl, "fx-shake-4");
        sfx.legImpact();
      });
      at(780, function () {
        clearStageOverlay();
        if (spotEl) spotEl.classList.add("vs-bg-legendary");
        onFinish();
      });
      return;
    }
    if (r === "Mythical") {
      // Fake-out emas 180ms -> crack 240ms -> impact frame 85ms -> reveal 440ms (~2,30 dtk total)
      if (ov) ov.className = "roll-stage-overlay rso-active rso-scrim-on";
      if (spotEl) spotEl.classList.add("vs-spotlight", "vs-fake-gold");
      bgmDuck(0.15, 50, 380, 350);
      sfx.mythRiser();
      at(180, function () {
        sfx.mythCrack();
        if (spotEl && document.createElement) {
          var ct = document.createElement("div"); ct.className = "vs-crack-layer vs-crack-top";
          var cb = document.createElement("div"); cb.className = "vs-crack-layer vs-crack-bot";
          spotEl.appendChild(ct); spotEl.appendChild(cb);
        }
      });
      at(420, function () {
        if (spotEl) spotEl.classList.remove("vs-spotlight", "vs-fake-gold");
        if (ov) ov.className = "roll-stage-overlay rso-active rso-over rso-imp-myth";
      });
      at(505, function () {
        if (ov) {
          ov.className = "roll-stage-overlay rso-active rso-myth-bg rso-speed-myth rso-banner-go";
          var bn = ov.querySelector(".rso-banner");
          if (bn) bn.textContent = "⚡ MYTHICAL ⚡";
        }
        if (spotEl) {
          spotEl.querySelectorAll(".vs-crack-layer").forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
          spotEl.classList.add("vs-spotlight");
        }
        landSideCard(spotEl, spotLabel, spotChar, false);
        triggerParticles(spotEl, "Mythical");
        triggerArenaShake(spotEl, "fx-shake-6");
        sfx.mythImpact();
      });
      at(1045, function () {
        clearStageOverlay();
        if (spotEl) spotEl.classList.add("vs-bg-mythical");
        onFinish();
      });
      return;
    }
    // SECRET: blackout 520ms (curtain 130 + tension 290 + slash 100) -> impact 70ms -> reveal 540ms (~2,45 dtk total)
    if (ov) ov.className = "roll-stage-overlay rso-active rso-over rso-curtain-closed";
    bgmDuck(0, 40, 480, 420);
    at(130, function () {
      if (ov) ov.classList.add("rso-secret-tension");
      sfx.secHeartbeat();
    });
    at(420, function () {
      if (ov) ov.classList.add("rso-secret-slash");
      sfx.secSlash();
    });
    at(520, function () {
      if (ov) ov.className = "roll-stage-overlay rso-active rso-over rso-imp-sec";
    });
    at(590, function () {
      if (ov) ov.className = "roll-stage-overlay rso-active rso-scrim-on rso-speed-sec";
      if (spotEl) spotEl.classList.add("vs-spotlight");
      landSideCard(spotEl, spotLabel, spotChar, false);
      triggerParticles(spotEl, "Secret");
      triggerArenaShake(spotEl, "fx-shake-8");
      sfx.secImpact();
    });
    at(1190, function () {
      clearStageOverlay();
      if (spotEl) spotEl.classList.add("vs-bg-secret");
      onFinish();
    });
  }

  function startRollScene(onDone) {
    clearRollScene();
    if (!match || match.over || !match.roll) return;
    var mySeq = rollSeq;
    var myChar = match.online ? match.pair[match.mySide] : match.pair[match.turn];
    var oppChar = match.online ? match.pair[match.oppSide] : match.pair[match.turn === "a" ? "b" : "a"];
    var rMy = tierRank(myChar), rOpp = tierRank(oppChar);
    var maxRank = Math.max(rMy, rOpp);

    // Reduced-motion: versi tenang per tier + semua audio & bgmDuck tetap jalan.
    if (isReducedMotion()) {
      match.rolling = true;
      renderMatch("landed");
      var rc0 = $("rollCard");
      var sides0 = rc0 ? rc0.querySelectorAll(".vs-side") : [];
      var ov0 = $("rollStageOverlay");
      var fxMy0 = rarityEffects(myChar), fxOpp0 = rarityEffects(oppChar);
      if (sides0[0] && fxMy0.sideCls) sides0[0].classList.add(fxMy0.sideCls);
      if (sides0[1] && fxOpp0.sideCls) sides0[1].classList.add(fxOpp0.sideCls);
      if (sides0[1]) sides0[1].style.visibility = "hidden";
      playRareSfx(myChar);
      var spotIdx0 = rMy >= rOpp ? 0 : 1;
      var spotChar0 = spotIdx0 === 0 ? myChar : oppChar;
      var spotR0 = rarityOf(spotChar0);
      if (maxRank >= 3 && ov0) {
        if (spotR0 === "Legendary") {
          bgmDuck(0.35, 60, 260, 300);
          ov0.className = "roll-stage-overlay rso-active rso-scrim-on rso-speed-leg";
        } else if (spotR0 === "Mythical") {
          bgmDuck(0.15, 50, 380, 350);
          ov0.className = "roll-stage-overlay rso-active rso-myth-bg";
          if (sides0[spotIdx0]) sides0[spotIdx0].classList.add("vs-rm-myth-frame");
        } else if (spotR0 === "Secret") {
          bgmDuck(0, 40, 480, 420);
          ov0.className = "roll-stage-overlay rso-active rso-secret-rm";
        }
        if (sides0[spotIdx0]) sides0[spotIdx0].classList.add("vs-spotlight");
      }
      rollTimers.push(setTimeout(function () {
        if (!match || match.over || rollSeq !== mySeq) return;
        if (sides0[1]) sides0[1].style.visibility = "visible";
        sfx.oppPlace();
        playRareSfx(oppChar);
      }, 320));
      var rmDoneMs = maxRank >= 3 ? (spotR0 === "Secret" ? 800 : 620) : 340;
      rollTimers.push(setTimeout(function () {
        if (!match || match.over || rollSeq !== mySeq) return;
        clearStageOverlay();
        if (sides0[0] && fxMy0.sideCls) sides0[0].classList.add(fxMy0.sideCls);
        if (sides0[1] && fxOpp0.sideCls) sides0[1].classList.add(fxOpp0.sideCls);
        match.rolling = false;
        if (rc0) rc0.setAttribute("data-roll-key", myChar.id + "|" + oppChar.id);
        syncMatchControls();
        if (onDone) onDone();
      }, rmDoneMs));
      return;
    }

    match.rolling = true;
    renderMatch("spin");
    if (!match.online) {
      var tl = $("timerLabel");
      if (tl) { tl.textContent = "ROLLING..."; tl.classList.remove("timer-danger"); }
    }
    var rc = $("rollCard");
    var sides = rc ? rc.querySelectorAll(".vs-side") : [];
    var leftSide = sides[0], rightSide = sides[1];
    var myLabel = leftSide ? (leftSide.querySelector(".vs-side-label") && leftSide.querySelector(".vs-side-label").textContent) || "LO" : "LO";
    var oppLabel = rightSide ? (rightSide.querySelector(".vs-side-label") && rightSide.querySelector(".vs-side-label").textContent) || "BOT" : "BOT";
    var leftDecoys = pickDecoys(ROLL_STEPS.length, myChar.img);
    var rightDecoys = pickDecoys(ROLL_STEPS.length, oppChar.img);
    preloadChars(leftDecoys.concat(rightDecoys).concat([myChar, oppChar]));

    function finishRoll() {
      var rb = rc ? rc.querySelector(".vs-rolling-banner") : null;
      if (rb) rb.remove();
      match.rolling = false;
      if (rc) rc.setAttribute("data-roll-key", myChar.id + "|" + oppChar.id);
      syncMatchControls();
      if (onDone) onDone();
    }

    // Spin ticks 0..8 (step terakhir idx=9 dipakai sebagai titik mendarat t=1127ms)
    var elapsed = 0;
    for (var i = 0; i < ROLL_STEPS.length - 1; i++) {
      elapsed += ROLL_STEPS[i];
      (function (idx, t) {
        rollTimers.push(setTimeout(function () {
          if (!match || match.over || rollSeq !== mySeq) return;
          sfx.rollTick(idx);
          if (leftSide && leftDecoys[idx]) updateSpinSide(leftSide, leftDecoys[idx]);
          if (rightSide && rightDecoys[idx]) updateSpinSide(rightSide, rightDecoys[idx]);
        }, t));
      })(i, elapsed);
    }
    var spinEndT = elapsed + ROLL_STEPS[ROLL_STEPS.length - 1]; // 1127ms

    // CABANG A: Salah satu/keduanya Legendary, Mythical, atau Secret (urutan berbasis tier)
    if (maxRank >= 3) {
      var spotIsMy = rMy >= rOpp; // seri -> LO pegang spotlight
      var spotSide = spotIsMy ? leftSide : rightSide;
      var spotLabel = spotIsMy ? myLabel : oppLabel;
      var spotChar = spotIsMy ? myChar : oppChar;
      var otherSide = spotIsMy ? rightSide : leftSide;
      var otherLabel = spotIsMy ? oppLabel : myLabel;
      var otherChar = spotIsMy ? oppChar : myChar;

      // Sisi non-spotlight mendarat DULU di t=1127ms (BOT tidak ketelan blackout!)
      rollTimers.push(setTimeout(function () {
        if (!match || match.over || rollSeq !== mySeq) return;
        landSideCard(otherSide, otherLabel, otherChar, true);
        if (spotIsMy) sfx.oppPlace(); else sfx.pop();
        if (tierRank(otherChar) === 1) sfx.rareChime();
        else if (tierRank(otherChar) >= 2) sfx.epicImpact();
        var rb = rc ? rc.querySelector(".vs-rolling-banner") : null;
        if (rb) rb.textContent = "MENAHAN...";
      }, spinEndT));

      // +120ms kemudian spotlight / fake-out / blackout dimulai
      rollTimers.push(setTimeout(function () {
        if (!match || match.over || rollSeq !== mySeq) return;
        runSpotlightSequence(mySeq, spotSide, spotLabel, spotChar, finishRoll);
      }, spinEndT + 120));
      return;
    }

    // CABANG B: Keduanya Common / Rare / Epic (side-scoped, LO dulu lalu BOT +220ms)
    var pauseMy = rareFx(myChar).pause;
    var pauseOpp = rareFx(oppChar).pause;
    if (rarityOf(myChar) === "Epic") {
      rollTimers.push(setTimeout(function () {
        if (!match || match.over || rollSeq !== mySeq) return;
        if (leftSide) leftSide.classList.add("vs-susp-epic");
        sfx.epicSwoosh();
      }, spinEndT));
    }
    var landMyT = spinEndT + pauseMy;
    rollTimers.push(setTimeout(function () {
      if (!match || match.over || rollSeq !== mySeq) return;
      landSideCard(leftSide, myLabel, myChar, true);
      playRareSfx(myChar);
      if (rightSide && rightDecoys[ROLL_STEPS.length - 1]) updateSpinSide(rightSide, rightDecoys[ROLL_STEPS.length - 1]);
    }, landMyT));

    if (rarityOf(oppChar) === "Epic") {
      rollTimers.push(setTimeout(function () {
        if (!match || match.over || rollSeq !== mySeq) return;
        if (rightSide) rightSide.classList.add("vs-susp-epic");
        sfx.epicSwoosh();
      }, landMyT + ROLL_OPP_LAG_MS));
    } else {
      rollTimers.push(setTimeout(function () {
        if (!match || match.over || rollSeq !== mySeq) return;
        if (rightSide && rightDecoys[ROLL_STEPS.length - 1]) updateSpinSide(rightSide, rightDecoys[ROLL_STEPS.length - 1]);
      }, landMyT + 110));
    }
    rollTimers.push(setTimeout(function () {
      if (!match || match.over || rollSeq !== mySeq) return;
      landSideCard(rightSide, oppLabel, oppChar, true);
      sfx.oppPlace();
      playRareSfx(oppChar);
      setTimeout(function () {
        if (!match || match.over || rollSeq !== mySeq) return;
        clearStageOverlay();
        var fMy = rarityEffects(myChar), fOpp = rarityEffects(oppChar);
        if (leftSide && fMy.sideCls) leftSide.classList.add(fMy.sideCls);
        if (rightSide && fOpp.sideCls) rightSide.classList.add(fOpp.sideCls);
      }, 460);
      finishRoll();
    }, landMyT + ROLL_OPP_LAG_MS + pauseOpp));
  }

  function beginTurn(side) {
    match.turn = side;
    match.roll = match.pair[side];
    // Online: timer ikut endsAt dari host. Lokal: acak 11-20 dtk.
    match.timeLeft = match.online
      ? Math.max(0, Math.ceil((match.endsAt - Date.now()) / 1000))
      : ROUND_TIME_MIN + Math.floor(Math.random() * (ROUND_TIME_MAX - ROUND_TIME_MIN + 1));
    if (match.online) startTimer();
    startRollScene(function () {
      if (match && !match.over && !match.online) startTimer();
    });
  }
  function startTimer() {
    stopTimer();
    var t0 = $("timerLabel");
    if (t0) { // v4.9.3: label langsung, jangan nunggu tick pertama (1 dtk).
      t0.textContent = "Waktu: " + match.timeLeft + " dtk";
      if (match.timeLeft <= 5) t0.classList.add("timer-danger"); else t0.classList.remove("timer-danger");
    }
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
    if (!match || match.over || !match.roll || match.locking) return;
    var parts = activeParts();
    var empty = SLOT_DEFS.filter(function (d) { return !parts[d.key]; });
    if (!empty.length) return;
    var key = empty[Math.floor(Math.random() * empty.length)].key;
    parts[key] = match.roll.id;
    toast("Waktu habis! " + match.roll.name + " otomatis masuk slot " + slotLabel(key) + ".");
    afterPlace();
  }
  function placeRoll(key) {
    if (!match || match.over || !match.roll || match.locking) return;
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
    match.locking = true;
    if (match.mode === "bot") {
      lockOpponent(); // lawan lock-in bareng
      sfx.oppPlace();
    }
    renderMatch();
    var mRef = match;
    clearTimeout(lockInTimer);
    lockInTimer = setTimeout(function () {
      lockInTimer = null;
      if (!match || match !== mRef || match.over) return;
      match.locking = false;
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
    }, LOCK_IN_MS);
  }
  function rerollCurrent() {
    if (!match || match.over || match.locking || !match.pair.a || !match.pair.b) return;
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
        AFOnline.send({ t: "round", n: match.round, reverse: match.reverse, pair: { a: pa.id, b: pb.id }, endsAt: match.endsAt, a: match.a, b: match.b });
        match.roll = match.pair[match.mySide];
        sfx.reroll();
        renderBadges();
        startRollScene();
        toast("Reroll: " + match.roll.name + " [" + rarityOf(match.roll) + "] — " + match.roll.move + "!");
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
    stopTimer();
    renderBadges();
    startRollScene(function () {
      if (match && !match.over && !match.online) startTimer();
    });
    toast("Reroll: " + match.roll.name + " [" + rarityOf(match.roll) + "] — " + match.roll.move + "!");
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
      oppName = match.turn === "a" ? "TEMAN" : "LO";
    }
    $("oppTitle").textContent = "LAWAN (" + oppName + ") — LIVE";
    var html = "";
    SLOT_DEFS.forEach(function (d) {
      var id = oppParts[d.key];
      var c = id ? charById(id) : null;
      // v4.9.3: struktur sama persis dengan slot lo (thumb + label/nama/jurus
      // + chip nilai) supaya baris kiri-kanan sejajar & sama tinggi.
      html += '<div class="opp-row">' +
        (c ? imgHtml(c) +
          '<span class="opp-info"><span class="opp-label">' + d.label + '</span>' +
          '<span class="opp-name">' + esc(c.name) + '</span>' +
          '<span class="opp-move">' + esc(c.move) + '</span></span>' +
          '<span class="opp-val">' + statOf(c, d.key) + '</span>' :
          '<span class="opp-info"><span class="opp-label">' + d.label + '</span>' +
          '<span class="opp-empty">— menunggu —</span></span>') +
        "</div>";
    });
    $("oppPanel").innerHTML = html;
  }
  function syncMatchControls() {
    if (!match) return;
    var rb = $("rerollBtn");
    if (rb) {
      rb.textContent = "REROLL (100 CASH)";
      rb.disabled = !!match.rolling || !!match.locking || save.cash < REROLL_COST ||
        (match.online && (match.myPlaced || match.oppPlaced || match.rerollPending));
    }
    var parts = match.online ? onlineMyParts() : activeParts();
    var box = $("matchSlots");
    if (!box) return;
    box.querySelectorAll(".match-slot").forEach(function (el) {
      var key = el.getAttribute("data-slot");
      var occupied = !!(parts && parts[key]);
      el.disabled = !!match.rolling || !!match.locking || occupied || !!(match.online && match.myPlaced);
    });
  }
  function renderMatch(modeHint) {
    if (!match) return;
    if (!match.roll) {
      // Online: menunggu ronde pertama dari host.
      $("roundLabel").textContent = "RONDE " + match.round + "/5";
      $("turnLabel").textContent = "Menunggu host mulai match...";
      $("rollCard").innerHTML = "";
      $("rollCard").removeAttribute("data-roll-key");
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
    var rc = $("rollCard");
    var rollKey = myChar.id + "|" + oppChar.id;
    if (modeHint === "spin") {
      rc.removeAttribute("data-roll-key");
      rc.innerHTML = '<div class="vs-rolling-banner">ROLLING...</div><div class="vs-pair">' +
        '<div class="vs-side"><div class="vs-side-label">' + esc(myLabel) + "</div>" + vsSpinCardHtml(randomSpinChar()) + "</div>" +
        '<div class="vs-mid">VS</div>' +
        '<div class="vs-side"><div class="vs-side-label">' + esc(oppLabel) + "</div>" + vsSpinCardHtml(randomSpinChar()) + "</div>" +
        "</div>";
    } else if (modeHint === "landed" || (!match.rolling && rc.getAttribute("data-roll-key") !== rollKey)) {
      rc.setAttribute("data-roll-key", rollKey);
      rc.innerHTML = '<div class="vs-pair">' +
        '<div class="vs-side"><div class="vs-side-label">' + esc(myLabel) + "</div>" + vsCardWrapHtml(myChar, true) + "</div>" +
        '<div class="vs-mid">VS</div>' +
        '<div class="vs-side"><div class="vs-side-label">' + esc(oppLabel) + "</div>" + vsCardWrapHtml(oppChar, true) + "</div>" +
        "</div>";
    }
    var parts = match.online ? onlineMyParts() : activeParts();
    var html = "";
    SLOT_DEFS.forEach(function (d) {
      var id = parts[d.key];
      var c = id ? charById(id) : null;
      html += '<button class="build-slot match-slot" data-slot="' + d.key + '"' + ((match.rolling || c || (match.online && match.myPlaced)) ? " disabled" : "") + ">";
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
        renderBadges();
      });
    });
    syncMatchControls();
  }
  function finishMatch(partsA, partsB) {
    if (!match) return;
    match.over = true;
    clearTimeout(lockInTimer); lockInTimer = null;
    stopTimer();
    clearRollScene();
    resetMatchBackBtn();
    var a = partsA || match.a, b = partsB || match.b, mode = match.mode, rev = match.reverse;
    var mySide = match.mySide || "a";
    match = null;
    $("matchPanel").classList.add("hidden");
    startCardBattle(a, b, mode, rev, mySide);
  }

  // ---------------- ADU KARTU (ala Roblox: HP bar + rumus damage) ----------------
  // Showdown dihapus (v4.11): setelah ronde 5, kartu langsung diadu sepasang
  // demi sepasang — HP berkurang per pukulan, yang HP-nya habis duluan kalah.
  // Damage = max(2, ATK penyerang - floor(DEF target / 3)) — rumus Roblox.
  // Urutan pukulan dihitung dulu dari stat combat (deterministik: hasil sama
  // di kedua device online, cuma timing tampilannya lokal).
  var BLOW_MS = 300;       // jeda antar pukulan
  var PAIR_GAP_MS = 700;   // jeda antar duel kartu
  function battleDmg(att, def) { return Math.max(2, att.atk - Math.floor(def.def / 3)); }
  // Siapa mukul duluan: SPD combat tertinggi; seri -> ATK tertinggi; seri
  // lagi -> id terkecil. Urutan TOTAL atas kartu (bukan atas sisi A/B) supaya
  // kedua device online menghitung urutan pukulan yang SAMA walau sisinya
  // ditukar — "A" di host = "B" di tamu.
  function firstStrikerIsA(a, b) {
    if (a.spd !== b.spd) return a.spd > b.spd;
    if (a.atk !== b.atk) return a.atk > b.atk;
    return a.id < b.id;
  }
  function simPairBlows(a, b) {
    var hpA = a.hp, hpB = b.hp, blows = [], turnA = firstStrikerIsA(a, b);
    while (hpA > 0 && hpB > 0) {
      if (turnA) { var d = battleDmg(a, b); hpB -= d; blows.push({ side: "A", dmg: d, hpA: hpA, hpB: hpB }); }
      else { var d2 = battleDmg(b, a); hpA -= d2; blows.push({ side: "B", dmg: d2, hpA: hpA, hpB: hpB }); }
      turnA = !turnA;
    }
    return { blows: blows, winner: hpA > 0 ? "A" : "B" };
  }
  function startCardBattle(aParts, bParts, mode, reverse, mySide) {
    // "A" = fighter LOKAL (tamu online = sisi b, jadi ditukar supaya kiri
    // selalu fighter lo dan kanan selalu lawan — menang/kalah tidak kebalik).
    var local = mySide === "b" ? bParts : aParts;
    var opp = mySide === "b" ? aParts : bParts;
    var pairs = SLOT_DEFS.map(function (d) {
      var ca = charById(local[d.key]), cb = charById(opp[d.key]);
      return { key: d.key, label: d.label, a: ca, b: cb, sim: simPairBlows(ca, cb), scored: false };
    });
    cardBattle = { a: local, b: opp, mode: mode, reverse: reverse,
      pairs: pairs, pairIdx: 0, scoreA: 0, scoreB: 0, seq: ++battleSeq,
      over: false, deckShown: false };
    $("arena").classList.remove("hidden");
    $("battleResult").innerHTML = "";
    $("skipBattleBtn").classList.remove("hidden");
    sfx.battle();
    playPair(0);
  }
  function cbFighterHtml(c, side, hp, maxHp) {
    var pct = Math.max(0, Math.round(hp / maxHp * 100));
    return '<div class="cb-fighter" id="cbCard' + side + '">' +
      (c ? imgHtml(c) : '<div class="img-fallback" style="background:#FFF6E5">?</div>') +
      '<div class="cb-name">' + esc(c ? c.name : "-") + '</div>' +
      '<div class="cb-hp"><span class="cb-hpbar"><span class="cb-hpfill" id="cbBar' + side + '" style="width:' + pct + '%"></span></span>' +
      '<span class="cb-hpnum" id="cbHp' + side + '">' + Math.max(0, hp) + '</span></div>' +
      '</div>';
  }
  function renderBattleFrame() {
    var cb = cardBattle;
    if (!cb) return;
    var p = cb.pairs[cb.pairIdx];
    $("battleBox").innerHTML =
      '<div class="cb-head"><span>ADU KARTU ' + (cb.pairIdx + 1) + '/5 — ' + esc(p.label) + '</span>' +
      '<span class="cb-score" id="cbScore">LO ' + cb.scoreA + ' – ' + cb.scoreB + ' LAWAN</span></div>' +
      '<div class="cb-duel">' +
      cbFighterHtml(p.a, "A", p.a.hp, p.a.hp) +
      '<div class="vs">VS</div>' +
      cbFighterHtml(p.b, "B", p.b.hp, p.b.hp) +
      '<div class="cb-dmgs" id="cbDmgs"></div>' +
      '</div>';
  }
  function cbBlowEl(side, dmg) {
    var box = $("cbDmgs");
    if (!box) return;
    var el = document.createElement("div");
    el.className = "cb-dmg cb-dmg-" + side;
    el.textContent = "-" + dmg;
    box.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 650);
  }
  function playPair(idx) {
    var cb = cardBattle;
    if (!cb || cb.over) return;
    var seq = cb.seq;
    cb.pairIdx = idx;
    renderBattleFrame();
    var p = cb.pairs[idx];
    p.sim.blows.forEach(function (blow, i) {
      setTimeout(function () {
        var c2 = cardBattle;
        if (!c2 || c2.over || c2.seq !== seq || c2.pairIdx !== idx) return;
        var atkEl = $("cbCard" + blow.side);
        var defSide = blow.side === "A" ? "B" : "A";
        var defEl = $("cbCard" + defSide);
        var defMax = defSide === "A" ? p.a.hp : p.b.hp;
        var defHp = defSide === "A" ? blow.hpA : blow.hpB;
        var bar = $("cbBar" + defSide), num = $("cbHp" + defSide);
        if (bar) {
          bar.style.width = Math.max(0, Math.round(defHp / defMax * 100)) + "%";
          bar.classList.toggle("cb-low", defHp / defMax < 0.25);
        }
        if (num) num.textContent = Math.max(0, defHp);
        if (!isReducedMotion()) {
          var lungeCls = blow.side === "A" ? "cb-lunge-a" : "cb-lunge-b";
          if (atkEl) { atkEl.classList.remove("cb-lunge-a"); atkEl.classList.remove("cb-lunge-b"); void atkEl.offsetWidth; atkEl.classList.add(lungeCls); }
          if (defEl) { defEl.classList.remove("cb-shake"); void defEl.offsetWidth; defEl.classList.add("cb-shake"); }
        }
        cbBlowEl(defSide, blow.dmg);
        sfx.punch();
      }, (i + 1) * BLOW_MS);
    });
    var total = p.sim.blows.length * BLOW_MS;
    setTimeout(function () {
      var c2 = cardBattle;
      if (!c2 || c2.over || c2.seq !== seq || c2.pairIdx !== idx) return;
      var winSide = p.sim.winner;
      var loseSide = winSide === "A" ? "B" : "A";
      var loseEl = $("cbCard" + loseSide);
      if (loseEl) loseEl.classList.add("cb-ko");
      var winEl = $("cbCard" + winSide);
      if (winEl) winEl.classList.add("cb-win");
      if (!p.scored) {
        p.scored = true;
        if (winSide === "A") c2.scoreA++; else c2.scoreB++;
        var scorePill = $("cbScore");
        if (scorePill) scorePill.textContent = "LO " + c2.scoreA + " – " + c2.scoreB + " LAWAN";
      }
      sfx.pop();
      setTimeout(function () {
        var c3 = cardBattle;
        if (!c3 || c3.over || c3.seq !== seq) return;
        if (c3.pairIdx < 4) playPair(c3.pairIdx + 1);
        else finishCardBattle();
      }, PAIR_GAP_MS);
    }, total + 250);
  }
  function skipBattle() {
    var cb = cardBattle;
    if (!cb || cb.over) return;
    cb.seq = ++battleSeq; // batalkan semua timer adu kartu yang masih antre
    cb.pairs.forEach(function (p) {
      if (p.scored) return;
      p.scored = true;
      if (p.sim.winner === "A") cb.scoreA++; else cb.scoreB++;
    });
    finishCardBattle();
  }
  function sdRevealGroupHtml(title, parts, oppParts, isWinner, isLoser, baseIdx, sideCls) {
    var cls = "sd-team " + sideCls + (isWinner ? " sd-team-win" : (isLoser ? " sd-team-lose" : ""));
    var cards = "";
    SLOT_DEFS.forEach(function (d, i) {
      var c = charById(parts[d.key]);
      var oc = charById(oppParts[d.key]);
      var v = c ? statOf(c, d.key) : 0;
      var ov = oc ? statOf(oc, d.key) : 0;
      var cmpCls = v > ov ? " sd-mini-win" : (v < ov ? " sd-mini-lose" : " sd-mini-draw");
      var delay = (baseIdx + i) * 35; // v4.9.3: fly-in 0-~500ms, stagger 35ms/baris
      cards += '<div class="sd-mini' + cmpCls + '" style="animation-delay:' + delay + 'ms">' +
        (c ? imgHtml(c) : '<div class="img-fallback" style="background:#FFF6E5">?</div>') +
        '<div class="sd-mini-slot">' + esc(d.label) + '</div>' +
        '<div class="sd-mini-name">' + esc(c ? c.name : "-") + '</div>' +
        '<div class="sd-mini-val">' + v + '</div>' +
        '</div>';
    });
    return '<div class="' + cls + '">' +
      '<div class="sd-team-head"><span>' + esc(title) + '</span>' +
      (isWinner ? '<span class="sd-win-chip">PEMENANG</span>' : '') +
      '</div><div class="sd-team-cards">' + cards + '</div></div>';
  }
  // Layar akhir: tim LO ditunjukin gede (kayak di Roblox, balik lobby liat
  // fighter sendiri); deck lawan cuma muncul kalau tombolnya ditekan.
  function finishCardBattle() {
    var cb = cardBattle;
    if (!cb || cb.over) return;
    cb.over = true;
    $("skipBattleBtn").classList.add("hidden");
    // Pill skor di frame duel terakhir masih nunjukin skor awal duel ke-5 —
    // update ke skor akhir supaya nggak beda sama banner hasil.
    var pill = $("cbScore");
    if (pill) pill.textContent = "LO " + cb.scoreA + " – " + cb.scoreB + " LAWAN";
    var a = partsStats(cb.a), b = partsStats(cb.b);
    var winner;
    if (cb.reverse) winner = cb.scoreA < cb.scoreB ? "A" : "B"; // reverse: skor duel TERENDAH menang
    else winner = cb.scoreA > cb.scoreB ? "A" : "B"; // 5 duel = seri mustahil
    var msg;
    if (winner === "A") {
      msg = "MENANG! " + cb.scoreA + "–" + cb.scoreB + ". +100 Cash, +1 Win!";
      if (cb.mode === "bot" || cb.mode === "online") { save.cash += WIN_REWARD; save.wins++; }
      sfx.win(); sfx.coin();
    } else {
      msg = "KALAH. " + cb.scoreA + "–" + cb.scoreB + ". +15 Cash.";
      if (cb.mode === "bot" || cb.mode === "online") save.cash += LOSE_REWARD;
      sfx.lose();
    }
    if (cb.mode === "bot" || cb.mode === "online") save.battles++;
    persist();
    var rematchHtml = "";
    if (cb.mode === "bot") rematchHtml = '<button id="rematchBtn" class="btn btn-red btn-big" style="margin-top:10px">REMATCH (BOT BARU)</button>';
    else if (cb.mode === "online") rematchHtml = '<button id="rematchBtn" class="btn btn-red btn-big" style="margin-top:10px">REMATCH (ONLINE)</button>';
    $("battleResult").innerHTML =
      '<div class="sd-result">' + esc(msg) + '</div>' +
      '<div class="cb-sub">Skor duel: ' + cb.scoreA + '–' + cb.scoreB + ' · AVG lo ' + a.avg.toFixed(1) + ' (Grade ' + a.grade + ') · AVG lawan ' + b.avg.toFixed(1) + '</div>' +
      sdRevealGroupHtml("TIM LO", cb.a, cb.b, winner === "A", winner === "B", 0, "sd-team-left") +
      '<div class="cb-deckrow"><button id="deckBtn" class="btn btn-blue btn-big">LIHAT DECK LAWAN</button></div>' +
      '<div id="oppDeckBox"></div>' +
      rematchHtml;
    var db = $("deckBtn");
    if (db) db.addEventListener("click", function () {
      sfx.click();
      var c2 = cardBattle;
      if (!c2) return;
      c2.deckShown = !c2.deckShown;
      var box = $("oppDeckBox");
      if (c2.deckShown) {
        if (box) box.innerHTML = sdRevealGroupHtml("DECK LAWAN", c2.b, c2.a, winner === "B", winner === "A", 5, "sd-team-right");
        db.textContent = "SEMBUNYIKAN DECK LAWAN";
      } else {
        if (box) box.innerHTML = "";
        db.textContent = "LIHAT DECK LAWAN";
      }
    });
    var rb = $("rematchBtn");
    if (rb) rb.addEventListener("click", function () {
      sfx.click();
      rb.disabled = true;
      if (cb.mode === "online") onlineRematch();
      else startMatch("bot");
    });
    renderBadges();
  }
  $("skipBattleBtn").addEventListener("click", function () {
    sfx.click();
    skipBattle();
  });
  var matchBackArmTimer = null;
  function resetMatchBackBtn() {
    clearTimeout(matchBackArmTimer);
    matchBackArmTimer = null;
    var b = $("matchBackBtn");
    if (b) {
      b.textContent = "KEMBALI";
      b.classList.remove("btn-danger-armed");
    }
  }
  function closeMatchUI(quiet) {
    sfx.click();
    clearTimeout(lockInTimer); lockInTimer = null;
    stopTimer();
    clearRollScene();
    resetMatchBackBtn();
    var isOnline = (match && match.online) || (cardBattle && cardBattle.mode === "online");
    if (isOnline && !quiet && window.AFOnline) { onlineLeaving = true; AFOnline.leave(); }
    match = null;
    cardBattle = null; battleSeq++;
    $("arena").classList.add("hidden");
    $("matchPanel").classList.add("hidden");
    $("battleMenu").classList.remove("hidden");
  }
  $("backBtn").addEventListener("click", function () { closeMatchUI(); });
  $("matchBackBtn").addEventListener("click", function () {
    var b = $("matchBackBtn");
    if (match && !match.over && !b.classList.contains("btn-danger-armed")) {
      sfx.click();
      b.textContent = "TAP LAGI UNTUK KELUAR";
      b.classList.add("btn-danger-armed");
      clearTimeout(matchBackArmTimer);
      matchBackArmTimer = setTimeout(resetMatchBackBtn, 3000);
      return;
    }
    closeMatchUI();
  });
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
      var tabId = tab.getAttribute("data-tab");
      $("tab-" + tabId).classList.add("active");
      if (tabId === "gallery" && galleryDirty) renderGallery();
    });
  });
  $("soundBtn").addEventListener("click", function () {
    soundOn = !soundOn; persist(); renderBadges();
    if (soundOn) sfx.click();
  });

  // v4.9.3: toggle efek animasi (AUTO -> ON -> OFF) + banner 1-klik.
  var animBtn = $("animToggleBtn");
  if (animBtn) animBtn.addEventListener("click", function () {
    save.anim = save.anim === "auto" ? "on" : (save.anim === "on" ? "off" : "auto");
    persist(); applyMotionPref(); renderAnimUI(); sfx.click();
  });
  var enableAnimBtn = $("enableAnimBtn");
  if (enableAnimBtn) enableAnimBtn.addEventListener("click", function () {
    save.anim = "on"; persist(); applyMotionPref(); renderAnimUI(); sfx.click();
    toast("Efek penuh aktif — roll & adu kartu sekarang jalan.");
  });
  var dismissAnimBtn = $("dismissAnimBannerBtn");
  if (dismissAnimBtn) dismissAnimBtn.addEventListener("click", function () {
    save.motionBannerDismissed = true; persist(); applyMotionPref();
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
    match.endsAt = Date.now() + (ROUND_TIME_MIN + Math.floor(Math.random() * (ROUND_TIME_MAX - ROUND_TIME_MIN + 1))) * 1000 + ROLL_BUFFER_MS;
    match.myPlaced = false;
    match.oppPlaced = false;
    AFOnline.send({ t: "round", n: match.round, reverse: match.reverse, pair: { a: pa.id, b: pb.id }, endsAt: match.endsAt, a: match.a, b: match.b });
    beginTurn(match.mySide);
  }

  // Terapkan pesan round dari host (ronde baru maupun reroll).
  function onlineApplyRound(msg) {
    if (!match) startMatch("online"); // rejoin tengah match
    if (!match || match.over) return;
    if (msg.n !== match.round && msg.n !== match.round + 1) return; // ronde basi
    match.reverse = !!msg.reverse;
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
    if (match.locking) return;
    match.locking = true;
    var fa = match.a, fb = match.b, mRef = match;
    AFOnline.send({ t: "finish", a: match.a, b: match.b });
    renderMatch();
    clearTimeout(lockInTimer);
    lockInTimer = setTimeout(function () {
      lockInTimer = null;
      if (!match || match !== mRef || match.over) return;
      finishMatch(fa, fb);
    }, LOCK_IN_MS);
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
            round: { n: match.round, reverse: match.reverse, pair: { a: match.pair.a.id, b: match.pair.b.id }, endsAt: match.endsAt, a: match.a, b: match.b } });
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
        match.reverse = !!msg.reverse;
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
          AFOnline.send({ t: "round", n: match.round, reverse: match.reverse, pair: { a: match.pair.a.id, b: match.pair.b.id }, endsAt: match.endsAt, a: match.a, b: match.b });
          break;
        }
        var rpa = rollUnique(match.a, []);
        var rpb = rollUnique(match.b, [rpa.id]);
        match.pair = { a: rpa, b: rpb };
        match.endsAt += ROLL_BUFFER_MS; // v4.9.3: roll reroll juga tidak makan timer
        AFOnline.send({ t: "round", n: match.round, reverse: match.reverse, pair: { a: rpa.id, b: rpb.id }, endsAt: match.endsAt, a: match.a, b: match.b });
        match.roll = match.pair[match.mySide];
        renderMatch();
        break;
      case "finish":
        if (match && !match.over) {
          match.a = msg.a; match.b = msg.b;
          match.locking = true;
          renderMatch();
          var fmRef = match, fA = msg.a, fB = msg.b;
          clearTimeout(lockInTimer);
          lockInTimer = setTimeout(function () {
            lockInTimer = null;
            if (!match || match !== fmRef || match.over) return;
            finishMatch(fA, fB);
          }, LOCK_IN_MS);
        }
        break;
      case "rematch":
        if (cardBattle && cardBattle.over) {
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
    AFOnline.send({ t: "start", reverse: match.reverse });
    onlineBeginRound();
  });
  $("leaveRoomBtn").addEventListener("click", function () {
    sfx.click();
    if (match && match.online) closeMatchUI();
    else if (window.AFOnline) AFOnline.leave();
    onlineResetRoomPanel();
  });

  // ---------------- MUSIK LATAR + LATAR BELAKANG (v4.6) ----------------
  // Desain Neon (dikritisi Dapus): modal ⚙ Atur, bukan tab ke-4 (tab sudah
  // sempit + volume harus bisa diubah di tengah match). Musik pakai <audio>
  // loop (hemat RAM vs WebAudio decode), file MP3 diunduh ke audio/ (bukan
  // hotlink). Background via #bgLayer fixed (bukan background-attachment:
  // fixed — rusak di iOS Safari). Upload tersimpan di IndexedDB; kalau
  // storage diblokir (incognito) fallback ke object URL sesi saja.
  var BGM_TRACKS = [
    { id: "overtaken", label: "Overtaken", sub: "One Piece", src: "audio/bgm-overtaken.mp3", gain: 1 },
    { id: "sadness", label: "Sadness & Sorrow", sub: "Naruto", src: "audio/bgm-sadness.mp3", gain: 1 },
    { id: "yousee", label: "YouSeeBIGGIRL/T:T", sub: "Attack on Titan", src: "audio/bgm-yousee.mp3", gain: 0.4 }
  ];
  var BG_PRESETS = [
    // v4.7: artwork anime asli (bukan gradien) — JoJo Duel default (gambar
    // kiriman Rafly, fan art Pixiv 369216) + 3 art resmi Kitsu terverifikasi.
    { id: "jojo", label: "JoJo Duel", img: "images/bg-jojo.jpg", pos: "center 35%" },
    { id: "gojo", label: "Gojo", img: "images/bg-gojo.jpg", pos: "center 30%" },
    { id: "goku", label: "Goku", img: "images/bg-goku.jpg", pos: "center 20%" },
    { id: "tanjiro", label: "Tanjiro", img: "images/bg-tanjiro.jpg", pos: "center 20%" },
    { id: "malam", label: "Arena Malam", css: "radial-gradient(circle at 50% 0%, #1d2038 0%, #0d0e17 65%)" },
    { id: "sakura", label: "Sakura Senja", css: "linear-gradient(160deg, #3b1d3a 0%, #7a2e4d 45%, #1c1030 100%)" },
    { id: "cyber", label: "Cyber Tokyo", css: "linear-gradient(160deg, #0a2a3a 0%, #123a6b 50%, #0d0e17 100%)" },
    { id: "api", label: "Api Shonen", css: "linear-gradient(160deg, #4a1503 0%, #8a2a0c 50%, #1c0a05 100%)" },
    { id: "kolase", label: "Kolase Karakter", collage: true }
  ];
  var COLLAGE_NAMES = ["Goku", "Monkey D. Luffy", "Naruto Uzumaki", "Satoru Gojo", "Tanjiro Kamado", "Levi Ackerman"];
  var MUSIC_MAX_MB = 15, BG_MAX_MB = 8;

  // --- IndexedDB kecil untuk file upload (musik + gambar) ---
  var idb = null, idbFailed = false;
  function idbOpen(cb) {
    if (idb) return cb(idb);
    if (idbFailed || !window.indexedDB) return cb(null);
    try {
      var req = window.indexedDB.open("animeFighterMedia", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("media"); };
      req.onsuccess = function () { idb = req.result; cb(idb); };
      req.onerror = function () { idbFailed = true; cb(null); };
    } catch (e) { idbFailed = true; cb(null); }
  }
  function idbPut(key, blob, cb) {
    idbOpen(function (db) {
      if (!db) return cb(false);
      try {
        var tx = db.transaction("media", "readwrite");
        tx.objectStore("media").put(blob, key);
        tx.oncomplete = function () { cb(true); };
        tx.onerror = function () { cb(false); };
      } catch (e) { cb(false); }
    });
  }
  function idbGet(key, cb) {
    idbOpen(function (db) {
      if (!db) return cb(null);
      try {
        var req = db.transaction("media", "readonly").objectStore("media").get(key);
        req.onsuccess = function () { cb(req.result || null); };
        req.onerror = function () { cb(null); };
      } catch (e) { cb(null); }
    });
  }

  // --- Musik latar (<audio> loop) ---
  var bgmAudio = null, bgmCustomBlobUrl = null, bgmCustomIsUrl = false;
  var bgmVolWritable = null;
  var bgmDuckSeq = 0, bgmDuckRaf = 0, bgmDuckTimer = null;
  var rafFn = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
  var cancelRafFn = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : null;
  function bgmEl() {
    if (bgmAudio) return bgmAudio;
    try {
      bgmAudio = new Audio();
      bgmAudio.loop = true;
      bgmAudio.preload = "metadata";
      bgmAudio.addEventListener("error", function () {
        if (save.music.track === "custom") {
          toast("Musik custom gagal dimuat — balik ke Overtaken.");
          save.music.track = "overtaken"; save.music.url = "";
          persist(); renderMusicUI(); bgmApply();
        }
      });
    } catch (e) { return null; }
    return bgmAudio;
  }
  function bgmTrack() {
    for (var i = 0; i < BGM_TRACKS.length; i++) if (BGM_TRACKS[i].id === save.music.track) return BGM_TRACKS[i];
    return BGM_TRACKS[0];
  }
  function bgmSrc() {
    if (save.music.track === "custom") {
      if (bgmCustomBlobUrl) return bgmCustomBlobUrl;
      if (save.music.url) return save.music.url;
      return BGM_TRACKS[0].src;
    }
    return bgmTrack().src;
  }
  function bgmBaseVol() {
    var gain = save.music.track === "custom" ? 1 : bgmTrack().gain;
    return Math.max(0, Math.min(1, (save.music.vol / 100) * gain));
  }
  function checkBgmVolWritable(a) {
    if (bgmVolWritable !== null) return bgmVolWritable;
    try {
      var prev = a.volume;
      var probe = prev > 0.5 ? prev - 0.02 : prev + 0.02;
      a.volume = probe;
      bgmVolWritable = Math.abs(a.volume - probe) < 0.005;
      a.volume = prev;
    } catch (e) { bgmVolWritable = false; }
    return bgmVolWritable;
  }
  function bgmDuckCancel(restore) {
    bgmDuckSeq++;
    if (bgmDuckRaf && cancelRafFn) cancelRafFn(bgmDuckRaf);
    bgmDuckRaf = 0;
    clearTimeout(bgmDuckTimer); bgmDuckTimer = null;
    if (restore && bgmAudio) {
      try { bgmAudio.muted = false; bgmAudio.volume = bgmBaseVol(); } catch (e) {}
    }
  }
  // targetVol = rasio 0..1 dari volume user saat ini (0 = hening total).
  function bgmDuck(targetVol, fadeMs, holdMs, restoreMs) {
    var a = bgmAudio;
    if (!a || !save.music.on || a.paused) return;
    bgmDuckCancel(false);
    var seq = bgmDuckSeq;
    var base = bgmBaseVol();
    if (base <= 0) return;
    var dst = Math.max(0, Math.min(1, base * targetVol));
    if (!checkBgmVolWritable(a)) {
      // iOS Safari: HTMLAudioElement.volume read-only -> mute singkat saat momen hening.
      if (targetVol <= 0.05) {
        bgmDuckTimer = setTimeout(function () {
          if (seq !== bgmDuckSeq || !bgmAudio) return;
          try { bgmAudio.muted = true; } catch (e) {}
          bgmDuckTimer = setTimeout(function () {
            if (seq !== bgmDuckSeq || !bgmAudio) return;
            try { bgmAudio.muted = false; } catch (e) {}
          }, Math.max(0, holdMs || 0));
        }, Math.max(0, fadeMs || 0));
      }
      return;
    }
    function ramp(from, to, dur, done) {
      if (!rafFn || !dur || dur <= 0) {
        try { a.volume = to; } catch (e) {}
        if (done) done();
        return;
      }
      var t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      function step(now) {
        if (seq !== bgmDuckSeq || !bgmAudio) return;
        var p = Math.min(1, ((now || Date.now()) - t0) / dur);
        try { a.volume = Math.max(0, Math.min(1, from + (to - from) * p)); } catch (e) {}
        if (p < 1) bgmDuckRaf = rafFn(step);
        else { bgmDuckRaf = 0; if (done) done(); }
      }
      bgmDuckRaf = rafFn(step);
    }
    var startVol = typeof a.volume === "number" ? a.volume : base;
    ramp(startVol, dst, fadeMs || 40, function () {
      if (seq !== bgmDuckSeq) return;
      bgmDuckTimer = setTimeout(function () {
        if (seq !== bgmDuckSeq || !bgmAudio) return;
        ramp(dst, bgmBaseVol(), restoreMs || 300);
      }, Math.max(0, holdMs || 0));
    });
  }
  function bgmApply() {
    var a = bgmEl(); if (!a) return;
    bgmDuckCancel(false);
    var src = bgmSrc();
    try {
      if (a.getAttribute("data-src") !== src) { a.src = src; a.setAttribute("data-src", src); }
      a.muted = false;
      a.volume = bgmBaseVol();
      if (save.music.on) { var p = a.play(); if (p && p.catch) p.catch(function () {}); }
      else a.pause();
    } catch (e) {}
  }
  function bgmArm() {
    // Autoplay: play() harus dipanggil sinkron di dalam gestur pertama.
    bgmApply();
    document.removeEventListener("pointerdown", bgmArm);
    document.removeEventListener("keydown", bgmArm);
  }
  function renderMusicUI() {
    var t = bgmTrack();
    var tog = $("musicToggleBtn"); if (tog) tog.textContent = save.music.on ? "ON" : "OFF";
    var vol = $("musicVol"); if (vol) vol.value = save.music.vol;
    var vl = $("musicVolLabel"); if (vl) vl.textContent = save.music.vol + "%";
    var st = $("musicStatus");
    if (st) st.textContent = save.music.track === "custom"
      ? (bgmCustomIsUrl ? "MP3 dari URL" : "MP3 upload lo") + (save.music.on ? "" : " (mati)")
      : t.label + " — " + t.sub + (save.music.on ? "" : " (mati)");
    var box = $("trackChips"); if (!box) return;
    var html = "";
    for (var i = 0; i < BGM_TRACKS.length; i++) {
      var tr = BGM_TRACKS[i];
      html += '<button class="track-chip' + (save.music.track === tr.id ? " active" : "") + '" data-track="' + tr.id + '"><b>' + esc(tr.label) + '</b><span>' + esc(tr.sub) + '</span></button>';
    }
    if (save.music.track === "custom" || bgmCustomBlobUrl || save.music.url)
      html += '<button class="track-chip' + (save.music.track === "custom" ? " active" : "") + '" data-track="custom"><b>MP3 Lo</b><span>' + (save.music.url && !bgmCustomBlobUrl ? "dari URL" : "upload") + '</span></button>';
    box.innerHTML = html;
    var chips = box.querySelectorAll(".track-chip");
    for (var j = 0; j < chips.length; j++) chips[j].addEventListener("click", function () {
      save.music.track = this.getAttribute("data-track");
      persist(); renderMusicUI(); bgmApply(); sfx.click();
    });
  }

  // --- Latar belakang (#bgLayer) ---
  var bgCustomBlobUrl = null;
  function collageUrls() {
    var urls = [];
    for (var i = 0; i < COLLAGE_NAMES.length; i++) {
      for (var j = 0; j < CHARACTERS.length; j++) {
        if (CHARACTERS[j].name === COLLAGE_NAMES[i] && CHARACTERS[j].img) { urls.push(CHARACTERS[j].img); break; }
      }
    }
    if (urls.length < 6) for (var k = 0; k < CHARACTERS.length && urls.length < 6; k++)
      if (CHARACTERS[k].img && urls.indexOf(CHARACTERS[k].img) === -1) urls.push(CHARACTERS[k].img);
    return urls;
  }
  function applyBg() {
    var layer = $("bgLayer"); if (!layer || !layer.style) return; // sim headless: stub DOM tanpa .style
    var preset = null;
    for (var i = 0; i < BG_PRESETS.length; i++) if (BG_PRESETS[i].id === save.bg.preset) preset = BG_PRESETS[i];
    if (!preset) preset = BG_PRESETS[0];
    var isArt = false; // v4.7: scrim/blur hanya untuk background gambar
    layer.style.backgroundImage = "";
    layer.style.backgroundSize = "";
    layer.style.backgroundPosition = "";
    layer.style.backgroundRepeat = "";
    layer.style.background = "";
    if (save.bg.preset === "custom") {
      var u = bgCustomBlobUrl || save.bg.url;
      if (u) {
        layer.style.backgroundImage = 'url("' + u.replace(/"/g, "") + '")';
        layer.style.backgroundSize = "cover";
        layer.style.backgroundPosition = "center";
        isArt = true;
      }
    } else if (preset.img) {
      layer.style.backgroundImage = 'url("' + preset.img + '")';
      layer.style.backgroundSize = "cover";
      layer.style.backgroundPosition = preset.pos || "center";
      layer.style.backgroundRepeat = "no-repeat";
      isArt = true;
    } else if (preset.collage) {
      var urls = collageUrls();
      if (!urls.length) { layer.style.background = "radial-gradient(circle at 50% 0%, #1d2038 0%, #0d0e17 65%)"; }
      else {
        var pos = ["0% 0%", "50% 0%", "100% 0%", "0% 100%", "50% 100%", "100% 100%"];
        layer.style.backgroundImage = urls.slice(0, 6).map(function (x) { return 'url("' + x + '")'; }).join(", ");
        layer.style.backgroundSize = "33.4% 50%";
        layer.style.backgroundPosition = pos.slice(0, urls.length).join(", ");
        layer.style.backgroundRepeat = "no-repeat";
        isArt = true;
      }
    } else {
      layer.style.background = preset.css;
    }
    if (layer.classList && layer.classList.toggle) layer.classList.toggle("is-art", isArt); // guard: stub sim tanpa classList
  }
  function renderBgUI() {
    var st = $("bgStatus");
    var label = "JoJo Duel";
    if (save.bg.preset === "custom") label = bgCustomBlobUrl ? "Gambar upload lo" : (save.bg.url ? "Gambar dari URL" : "JoJo Duel");
    else for (var i = 0; i < BG_PRESETS.length; i++) if (BG_PRESETS[i].id === save.bg.preset) label = BG_PRESETS[i].label;
    if (st) st.textContent = label;
    var box = $("bgSwatches"); if (!box) return;
    var html = "";
    for (var j = 0; j < BG_PRESETS.length; j++) {
      var p = BG_PRESETS[j];
      var style = p.img
        ? "background-image:url('" + p.img + "')" // v4.7.1: kutip tunggal — kutip ganda di dalam atribut style="..." merusak HTML (swatch blank putih)
        : p.collage
        ? "background:linear-gradient(135deg,#3b82f6 0%,#aa50ff 33%,#ff2d78 66%,#ffb400 100%)"
        : "background:" + p.css;
      html += '<button class="bg-swatch' + (save.bg.preset === p.id ? " active" : "") + '" data-bg="' + p.id + '" style="' + style + '"><span>' + esc(p.label) + '</span></button>';
    }
    html += '<button class="bg-swatch' + (save.bg.preset === "custom" ? " active" : "") + '" data-bg="custom" style="background:#23233a"><span>Custom</span></button>';
    box.innerHTML = html;
    var sw = box.querySelectorAll(".bg-swatch");
    for (var k = 0; k < sw.length; k++) sw[k].addEventListener("click", function () {
      var id = this.getAttribute("data-bg");
      if (id === "custom") {
        if (!bgCustomBlobUrl && !save.bg.url) { toast("Upload gambar atau tempel URL dulu."); return; }
        save.bg.preset = "custom";
      } else save.bg.preset = id;
      persist(); renderBgUI(); applyBg(); sfx.click();
    });
  }

  // --- Wiring modal + init ---
  function settingsInit() {
    var openBtn = $("settingsBtn");
    if (openBtn) openBtn.addEventListener("click", function () {
      sfx.click(); renderMusicUI(); renderBgUI();
      $("settingsModal").classList.remove("hidden");
    });
    var closeBtn = $("settingsCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", function () { sfx.click(); $("settingsModal").classList.add("hidden"); });
    var modal = $("settingsModal");
    if (modal) modal.addEventListener("click", function (e) { if (e.target === modal) modal.classList.add("hidden"); });
    var tog = $("musicToggleBtn");
    if (tog) tog.addEventListener("click", function () {
      save.music.on = !save.music.on; persist(); renderMusicUI(); bgmApply(); sfx.click();
    });
    var vol = $("musicVol");
    if (vol) vol.addEventListener("input", function () {
      save.music.vol = parseInt(vol.value, 10) || 0;
      var vl = $("musicVolLabel"); if (vl) vl.textContent = save.music.vol + "%";
      persist(); bgmApply();
    });
    var up = $("musicUploadInput");
    if (up) up.addEventListener("change", function () {
      var f = up.files && up.files[0]; up.value = "";
      if (!f) return;
      if (f.size > MUSIC_MAX_MB * 1024 * 1024) { toast("MP3 maks " + MUSIC_MAX_MB + " MB."); return; }
      idbPut("bgmCustom", f, function (ok) {
        bgmCustomBlobUrl = URL.createObjectURL(f); bgmCustomIsUrl = false;
        save.music.track = "custom"; save.music.url = "";
        persist(); renderMusicUI(); bgmApply();
        toast(ok ? "MP3 lo tersimpan — jadi backsound." : "MP3 jalan untuk sesi ini saja (penyimpanan browser diblokir).");
      });
    });
    var urlBtn = $("musicUrlBtn");
    var musicUrlRow = $("musicUrlRow");
    var musicUrlInput = $("musicUrlInput");
    var musicUrlApplyBtn = $("musicUrlApplyBtn");
    function applyMusicUrl() {
      var u = (musicUrlInput && musicUrlInput.value || "").trim();
      if (!/^https?:\/\/.+/i.test(u)) { toast("URL harus diawali http:// atau https://"); return; }
      bgmCustomBlobUrl = null; bgmCustomIsUrl = true;
      save.music.track = "custom"; save.music.url = u;
      if (musicUrlRow) musicUrlRow.classList.add("hidden");
      persist(); renderMusicUI(); bgmApply();
      toast("Backsound dari URL — kalau gagal dimuat, balik ke Overtaken.");
    }
    if (urlBtn && musicUrlRow) urlBtn.addEventListener("click", function () {
      var open = musicUrlRow.classList.toggle("hidden") === false;
      if (open && musicUrlInput) { musicUrlInput.value = save.music.url || ""; musicUrlInput.focus(); }
    });
    if (musicUrlApplyBtn) musicUrlApplyBtn.addEventListener("click", applyMusicUrl);
    if (musicUrlInput) musicUrlInput.addEventListener("keydown", function (e) { if (e.key === "Enter") applyMusicUrl(); });
    var bgUp = $("bgUploadInput");
    if (bgUp) bgUp.addEventListener("change", function () {
      var f = bgUp.files && bgUp.files[0]; bgUp.value = "";
      if (!f) return;
      if (f.size > BG_MAX_MB * 1024 * 1024) { toast("Gambar maks " + BG_MAX_MB + " MB."); return; }
      idbPut("bgCustom", f, function (ok) {
        bgCustomBlobUrl = URL.createObjectURL(f);
        save.bg.preset = "custom"; save.bg.url = "";
        persist(); renderBgUI(); applyBg();
        toast(ok ? "Gambar lo tersimpan — jadi background." : "Gambar jalan untuk sesi ini saja (penyimpanan browser diblokir).");
      });
    });
    var bgUrlBtn = $("bgUrlBtn");
    var bgUrlRow = $("bgUrlRow");
    var bgUrlInput = $("bgUrlInput");
    var bgUrlApplyBtn = $("bgUrlApplyBtn");
    function applyBgUrl() {
      var u = (bgUrlInput && bgUrlInput.value || "").trim();
      if (!/^https?:\/\/.+/i.test(u)) { toast("URL harus diawali http:// atau https://"); return; }
      var img = new Image();
      img.onload = function () {
        bgCustomBlobUrl = null;
        save.bg.preset = "custom"; save.bg.url = u;
        if (bgUrlRow) bgUrlRow.classList.add("hidden");
        persist(); renderBgUI(); applyBg();
        toast("Background dari URL terpasang.");
      };
      img.onerror = function () { toast("Gagal muat gambar — cek URL."); };
      img.src = u;
    }
    if (bgUrlBtn && bgUrlRow) bgUrlBtn.addEventListener("click", function () {
      var open = bgUrlRow.classList.toggle("hidden") === false;
      if (open && bgUrlInput) { bgUrlInput.value = save.bg.url || ""; bgUrlInput.focus(); }
    });
    if (bgUrlApplyBtn) bgUrlApplyBtn.addEventListener("click", applyBgUrl);
    if (bgUrlInput) bgUrlInput.addEventListener("keydown", function (e) { if (e.key === "Enter") applyBgUrl(); });
    var resetBtn = $("settingsResetBtn");
    if (resetBtn) resetBtn.addEventListener("click", function () {
      var d = defaultSave();
      save.music = d.music; save.bg = d.bg;
      save.anim = d.anim; save.motionBannerDismissed = d.motionBannerDismissed;
      applyMotionPref(); renderAnimUI();
      bgmCustomBlobUrl = null; bgmCustomIsUrl = false; bgCustomBlobUrl = null;
      persist(); renderMusicUI(); renderBgUI(); applyBg(); bgmApply();
      toast("Pengaturan direset.");
    });
    // Muat file custom dari IndexedDB (kalau ada), lalu terapkan semuanya.
    idbGet("bgmCustom", function (blob) {
      if (blob) { try { bgmCustomBlobUrl = URL.createObjectURL(blob); bgmCustomIsUrl = false; } catch (e) {} }
      idbGet("bgCustom", function (blob2) {
        if (blob2) { try { bgCustomBlobUrl = URL.createObjectURL(blob2); } catch (e) {} }
        applyBg();
        bgmApply();
      });
    });
    document.addEventListener("pointerdown", bgmArm);
    document.addEventListener("keydown", bgmArm);
    document.addEventListener("visibilitychange", function () {
      var a = bgmEl(); if (!a) return;
      if (document.hidden) a.pause();
      else if (save.music.on) { var p = a.play(); if (p && p.catch) p.catch(function () {}); }
    });
  }

  // ---------------- START ----------------
  (function reorderMatchLayout() {
    var mp = $("matchPanel"), oppTitle = $("oppTitle"), oppPanel = $("oppPanel");
    var rc = $("rollCard"), rb = $("rerollBtn"), ms = $("matchSlots"), back = $("matchBackBtn");
    if (!mp || !oppTitle || !oppPanel || !rc || !rb || !ms || !back) return;
    var slotsTitle = ms.previousElementSibling;
    mp.insertBefore(rc, oppTitle);
    mp.insertBefore(rb, oppTitle);
    var cols = document.createElement("div");
    cols.id = "matchCols";
    cols.className = "match-cols";
    var colSlots = document.createElement("div");
    colSlots.className = "match-col-slots";
    if (slotsTitle) colSlots.appendChild(slotsTitle);
    colSlots.appendChild(ms);
    var colOpp = document.createElement("div");
    colOpp.className = "match-col-opp";
    colOpp.appendChild(oppTitle);
    colOpp.appendChild(oppPanel);
    cols.appendChild(colSlots);
    cols.appendChild(colOpp);
    mp.insertBefore(cols, back);
  })();
  settingsInit(); // v4.6: modal pengaturan + musik latar + background
  initRollOverlay(); // v4.14: pre-render 14 partikel pool sekali saat startup
  applyMotionPref(); // v4.9.3: gate efek animasi (ikut Windows / toggle)
  renderAnimUI();
  prewarmRollImages(); // v4.9.3: gambar roll di-cache dulu supaya tidak blank
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
