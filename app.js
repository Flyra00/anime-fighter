// Anime Fighter (web) — spin, gabung, battle. Save di localStorage.
(function () {
  "use strict";

  var SAVE_KEY = "animeFighterSaveV1";
  var SPIN_COST = 50;
  var FREE_SPIN_INTERVAL = 60000; // 1 free spin tiap 60 detik
  var MAX_FREE_SPINS = 3;
  var WIN_REWARD = 100;
  var LOSE_REWARD = 15;

  var save = loadSave();
  var selected = [];      // id karakter dipilih buat gabung (maks 2)
  var duelSelected = [];  // id karakter dipilih teman buat duel
  var battle = null;      // state battle aktif
  var soundOn = save.soundOn !== false;

  // ---------------- SAVE ----------------
  function defaultSave() {
    return { cash: 200, freeSpins: 3, lastRefill: Date.now(), owned: {}, fighter: null, wins: 0, battles: 0, soundOn: true };
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
  function dmgOf(atk, def) { return Math.max(2, atk - Math.floor(def / 3)); }
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(t._timer); t._timer = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }
  function imgHtml(c, cls) {
    if (c.img) return '<img class="' + (cls || "") + '" src="' + esc(c.img) + '" alt="' + esc(c.name) + '" loading="lazy" onerror="this.outerHTML=\'<div class=&quot;img-fallback&quot; style=&quot;background:' + esc(c.color) + '&quot;>' + esc(c.name.charAt(0)) + '</div>\'">';
    return '<div class="img-fallback" style="background:' + esc(c.color) + '">' + esc(c.name.charAt(0)) + "</div>";
  }
  function statLine(c) {
    return "ATK " + c.atk + " &nbsp;DEF " + c.def + " &nbsp;SPD " + c.spd + " &nbsp;HP " + c.hp;
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

  function renderFighter() {
    var box = $("fighterBox");
    var f = save.fighter;
    if (!f) { box.innerHTML = '<p class="hint">Belum ada fighter. Spin, pilih 2 karakter di koleksi, terus GABUNG.</p>'; return; }
    var c = charById(f.parts[0]) || { color: "#888", img: "", name: "?" };
    box.innerHTML = '<div class="fighter-card">' + imgHtml({ img: c.img, color: f.color || c.color, name: f.name }) +
      '<div><div style="font-weight:800;font-size:17px">' + esc(f.name) + '</div>' +
      '<div class="muted">Dari: ' + esc(f.fromNames) + '</div>' +
      '<div>' + statLine(f) + '</div>' +
      '<div style="color:#ffd479">Jurus: ' + esc(f.move) + '</div></div></div>';
  }

  function cardHtml(c, count, isSelected) {
    return '<button class="card rarity-' + c.rarity + (isSelected ? " selected" : "") + '" data-id="' + c.id + '">' +
      imgHtml(c) +
      '<span class="card-body"><span class="rarity-tag">' + c.rarity.toUpperCase() + '</span>' +
      '<span class="card-name">' + esc(c.name) + '</span>' +
      '<span class="card-anime">' + esc(c.anime) + '</span>' +
      '<span class="card-move">Jurus: ' + esc(c.move) + '</span>' +
      '<span class="card-stats">' + statLine(c) + '</span>' +
      (count ? '<span class="card-count">Punya x' + count + '</span>' : "") +
      "</span></button>";
  }

  function renderCollection() {
    var grid = $("collectionGrid");
    var ids = Object.keys(save.owned).filter(function (id) { return save.owned[id] > 0; });
    var total = 0; ids.forEach(function (id) { total += save.owned[id]; });
    $("collectionCount").textContent = "(" + total + " karakter)";
    if (!ids.length) { grid.innerHTML = '<p class="hint">Koleksi masih kosong. Spin dulu!</p>'; return; }
    ids.sort(function (a, b) {
      var ra = ["Common", "Rare", "Epic", "Legendary"].indexOf(charById(a).rarity);
      var rb = ["Common", "Rare", "Epic", "Legendary"].indexOf(charById(b).rarity);
      return rb - ra || charById(a).name.localeCompare(charById(b).name);
    });
    grid.innerHTML = ids.map(function (id) {
      return cardHtml(charById(id), save.owned[id], selected.indexOf(id) !== -1);
    }).join("");
    grid.querySelectorAll(".card").forEach(function (el) {
      el.addEventListener("click", function () {
        sfx.click();
        var id = el.getAttribute("data-id");
        var i = selected.indexOf(id);
        if (i !== -1) selected.splice(i, 1);
        else {
          if (selected.length >= 2) { toast("Maksimal 2 karakter. Klik lagi buat batalin pilihan."); return; }
          selected.push(id);
        }
        renderCollection(); renderSlots();
      });
    });
  }

  function renderSlots() {
    function slotText(i) {
      var c = selected[i] ? charById(selected[i]) : null;
      return "Slot " + (i + 1) + ": " + (c ? c.name + " [" + c.rarity + "]" : "-");
    }
    $("slot1").textContent = slotText(0);
    $("slot2").textContent = slotText(1);
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

  function renderAll() { renderBadges(); renderFighter(); renderCollection(); renderSlots(); renderGallery(); }

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

  // ---------------- GABUNG ----------------
  $("combineBtn").addEventListener("click", function () {
    sfx.click();
    if (selected.length < 2) { toast("Pilih 2 karakter dulu di koleksi."); return; }
    var c1 = charById(selected[0]), c2 = charById(selected[1]);
    if (!c1 || !c2 || (save.owned[c1.id] || 0) < 1 || (save.owned[c2.id] || 0) < 1) {
      toast("Karakter tidak ditemukan di koleksi."); return;
    }
    save.owned[c1.id]--; save.owned[c2.id]--;
    var name = ($("fighterName").value || "").trim().slice(0, 20) || (c1.name + "-" + c2.name);
    var stronger = c1.atk >= c2.atk ? c1 : c2;
    save.fighter = {
      name: name, atk: Math.max(c1.atk, c2.atk), def: Math.max(c1.def, c2.def),
      spd: Math.max(c1.spd, c2.spd), hp: Math.max(c1.hp, c2.hp),
      move: stronger.move, color: c1.color, parts: [c1.id, c2.id],
      fromNames: c1.name + " + " + c2.name
    };
    selected = []; $("fighterName").value = "";
    persist(); sfx.levelup();
    toast("Fighter baru: " + save.fighter.name + "! ATK " + save.fighter.atk + " DEF " + save.fighter.def + " SPD " + save.fighter.spd + " HP " + save.fighter.hp);
    renderAll();
  });

  // ---------------- BATTLE ----------------
  function makeFighterFrom(c1, c2, name) {
    var stronger = c1.atk >= c2.atk ? c1 : c2;
    return {
      name: name, atk: Math.max(c1.atk, c2.atk), def: Math.max(c1.def, c2.def),
      spd: Math.max(c1.spd, c2.spd), hp: Math.max(c1.hp, c2.hp),
      move: stronger.move, color: c1.color, parts: [c1.id, c2.id],
      fromNames: c1.name + " + " + c2.name
    };
  }
  function botFighter() {
    var a = rollCharacter(), b = rollCharacter();
    return makeFighterFrom(a, b, "BOT " + a.name + "-" + b.name);
  }
  function fighterImg(f) {
    var c = charById(f.parts[0]);
    return { img: c ? c.img : "", color: f.color || "#888", name: f.name };
  }
  function startBattle(fA, fB, mode) {
    battle = {
      a: fA, b: fB, hpA: fA.hp, hpB: fB.hp, maxA: fA.hp, maxB: fB.hp,
      turn: "A", mode: mode, over: false
    };
    save.battles++; persist();
    $("arena").classList.remove("hidden");
    $("duelPicker").classList.add("hidden");
    $("battleLog").innerHTML = "";
    $("attackB").classList.toggle("hidden", mode !== "duel");
    renderBattle();
    log("Battle mulai: " + fA.name + " vs " + fB.name + "!");
    if (mode === "duel") log("Giliran P1 dulu. Tap tombol SERANG masing-masing pas giliran lo.");
    else log("Tap SERANG (P1) buat mukul. Bot nyerang balik tiap giliran.");
  }
  function renderBattle() {
    if (!battle) return;
    renderBattleCard("cardA", battle.a, battle.hpA, battle.maxA);
    renderBattleCard("cardB", battle.b, battle.hpB, battle.maxB);
    $("turnLabel").textContent = battle.over ? "" :
      (battle.mode === "duel" ? (battle.turn === "A" ? "Giliran: P1 — " + battle.a.name : "Giliran: P2 — " + battle.b.name)
        : (battle.turn === "A" ? "Giliran lo! Tap SERANG." : "Bot nyerang..."));
    $("attackA").disabled = battle.over || battle.turn !== "A";
    $("attackB").disabled = battle.over || battle.turn !== "B";
  }
  function renderBattleCard(id, f, hp, max) {
    var el = $(id);
    var pct = Math.max(0, Math.round(hp / max * 100));
    el.innerHTML = imgHtml(fighterImg(f)) +
      "<h3>" + esc(f.name) + "</h3>" +
      '<div class="muted">' + statLine(f) + '</div>' +
      '<div style="color:#ffd479;font-size:13px">Jurus: ' + esc(f.move) + '</div>' +
      '<div class="hp-bar"><div class="hp-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="hp-text">HP ' + Math.max(0, hp) + " / " + max + '</div><div class="dmg"></div>';
  }
  function log(msg) {
    var l = $("battleLog");
    l.innerHTML += "<div>" + esc(msg) + "</div>";
    l.scrollTop = l.scrollHeight;
  }
  function showDmg(cardId, dmg) {
    var el = document.querySelector("#" + cardId + " .dmg");
    if (el) el.textContent = "-" + dmg;
    var card = $(cardId);
    card.classList.remove("hit"); void card.offsetWidth; card.classList.add("hit");
    setTimeout(function () { if (el) el.textContent = ""; }, 700);
  }
  function doAttack(side) {
    if (!battle || battle.over || battle.turn !== side) return;
    var atkF = side === "A" ? battle.a : battle.b;
    var defF = side === "A" ? battle.b : battle.a;
    var dmg = dmgOf(atkF.atk, defF.def);
    sfx.swing();
    setTimeout(function () {
      if (!battle || battle.over) return;
      sfx.punch();
      if (side === "A") { battle.hpB -= dmg; showDmg("cardB", dmg); }
      else { battle.hpA -= dmg; showDmg("cardA", dmg); }
      log(atkF.name + " pakai " + atkF.move + " — " + dmg + " damage ke " + defF.name + "!");
      if (battle.hpB <= 0 || battle.hpA <= 0) { endBattle(side === "A" ? "A" : "B"); return; }
      battle.turn = side === "A" ? "B" : "A";
      renderBattle();
      if (battle.mode === "bot" && battle.turn === "B") {
        setTimeout(function () { doAttack("B"); }, 750);
      }
    }, 180);
    renderBattle();
  }
  function endBattle(winner) {
    battle.over = true;
    var winF = winner === "A" ? battle.a : battle.b;
    var loseF = winner === "A" ? battle.b : battle.a;
    if (battle.mode === "bot") {
      if (winner === "A") { save.cash += WIN_REWARD; save.wins++; sfx.win(); sfx.coin(); toast("MENANG! +" + WIN_REWARD + " Cash"); }
      else { save.cash += LOSE_REWARD; toast("Kalah. +" + LOSE_REWARD + " Cash"); }
      persist();
    } else {
      sfx.win();
      toast(winner === "A" ? "P1 MENANG!" : "P2 MENANG!");
    }
    log(winF.name + " MENANG lawan " + loseF.name + "!");
    renderBattle(); renderBadges();
  }

  $("botBtn").addEventListener("click", function () {
    sfx.click();
    if (!save.fighter) { toast("Gabung 2 karakter dulu buat bikin fighter!"); return; }
    startBattle(save.fighter, botFighter(), "bot");
  });
  $("attackA").addEventListener("click", function () { doAttack("A"); });
  $("attackB").addEventListener("click", function () { doAttack("B"); });
  $("backBtn").addEventListener("click", function () {
    sfx.click();
    battle = null;
    $("arena").classList.add("hidden");
    $("duelPicker").classList.add("hidden");
  });

  // ---------------- DUEL TEMAN ----------------
  $("duelBtn").addEventListener("click", function () {
    sfx.click();
    if (!save.fighter) { toast("Lo harus punya fighter dulu (gabung 2 karakter)."); return; }
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
          if (duelSelected.length >= 2) { toast("Maksimal 2 karakter."); return; }
          duelSelected.push(id);
        }
        renderDuelGrid(); renderDuelSlots();
      });
    });
  }
  function renderDuelSlots() {
    function t(i) {
      var c = duelSelected[i] ? charById(duelSelected[i]) : null;
      return "Slot " + (i + 1) + ": " + (c ? c.name + " [" + c.rarity + "]" : "-");
    }
    $("duelSlot1").textContent = t(0);
    $("duelSlot2").textContent = t(1);
  }
  $("duelSearch").addEventListener("input", renderDuelGrid);
  $("duelStartBtn").addEventListener("click", function () {
    sfx.click();
    if (duelSelected.length < 2) { toast("Teman pilih 2 karakter dulu."); return; }
    var c1 = charById(duelSelected[0]), c2 = charById(duelSelected[1]);
    var p2 = makeFighterFrom(c1, c2, "P2 " + c1.name + "-" + c2.name);
    startBattle(save.fighter, p2, "duel");
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
