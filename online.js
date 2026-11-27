// Anime Fighter — Online 1v1 (PeerJS / WebRTC, P2P).
// Host = wasit: host yang gacha sepasang tiap ronde + pegang timer + auto-place
// buat yang belum pasang. Tamu tidak pernah auto-place sendiri — semua state
// ronde datang dari host lewat pesan `round` (berisi parts kedua sisi, jadi
// tampilan tamu selalu sinkron ulang tiap ronde).
// Pesan (JSON, DataConnection reliable):
//   tamu -> host: join {name} | place {round, slot, charId} | reroll {} | rematch {} | leave {}
//   host -> tamu: welcome {name, inMatch} | start {} | round {n, pair, endsAt, a, b}
//                 | place {round, slot, charId} | finish {a, b} | rematch {} | leave {}
// Room = peer id "af-XXXXXX" (kode 6 huruf, tanpa 0/O/1/I/L).
(function () {
  "use strict";

  var PREFIX = "af-";
  var CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // tanpa 0/O/1/I/L

  var Online = {
    peer: null,
    conn: null,
    isHost: false,
    myName: "",
    oppName: "",
    roomCode: "",
    connected: false,
    onEvent: null, // function (ev) — ev = {type, ...}
  };

  function emit(ev) {
    if (typeof Online.onEvent === "function") {
      try { Online.onEvent(ev); } catch (e) { /* jangan matikan koneksi karena handler */ }
    }
  }

  function makeCode() {
    var code = "";
    for (var i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return code;
  }

  function peerReady() {
    return typeof Peer !== "undefined";
  }

  function wireConn(conn) {
    Online.conn = conn;
    conn.on("open", function () {
      Online.connected = true;
      emit({ type: "connected" });
    });
    conn.on("data", function (data) {
      var msg = null;
      try { msg = typeof data === "string" ? JSON.parse(data) : data; } catch (e) { return; }
      if (msg && msg.t) emit({ type: "message", msg: msg });
    });
    conn.on("close", function () {
      Online.connected = false;
      emit({ type: "disconnected" });
    });
    conn.on("error", function (err) {
      emit({ type: "error", message: "Koneksi ke lawan error." });
    });
  }

  // Host: buat room, tunggu tamu.
  Online.createRoom = function (name) {
    if (!peerReady()) { emit({ type: "error", message: "PeerJS tidak bisa dimuat — cek internet lalu refresh." }); return; }
    Online.destroy();
    Online.isHost = true;
    Online.myName = name || "Pemain 1";
    Online.roomCode = makeCode();
    var peer = new Peer(PREFIX + Online.roomCode, { debug: 0 });
    Online.peer = peer;
    peer.on("open", function () {
      emit({ type: "waiting", code: Online.roomCode });
    });
    peer.on("connection", function (conn) {
      if (Online.conn) { conn.close(); return; } // room cuma 2 orang
      wireConn(conn);
    });
    peer.on("error", function (err) {
      if (err && err.type === "unavailable-id") {
        Online.roomCode = makeCode();
        Online.peer = new Peer(PREFIX + Online.roomCode, { debug: 0 });
        return;
      }
      emit({ type: "error", message: "Gagal buat room. Coba lagi." });
    });
  };

  // Tamu: join room pakai kode.
  Online.joinRoom = function (code, name) {
    if (!peerReady()) { emit({ type: "error", message: "PeerJS tidak bisa dimuat — cek internet lalu refresh." }); return; }
    Online.destroy();
    Online.isHost = false;
    Online.myName = name || "Pemain 2";
    Online.roomCode = (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (Online.roomCode.length < 4) { emit({ type: "error", message: "Kode room tidak valid." }); return; }
    var peer = new Peer({ debug: 0 });
    Online.peer = peer;
    peer.on("open", function () {
      var conn = peer.connect(PREFIX + Online.roomCode, { reliable: true });
      wireConn(conn);
    });
    peer.on("error", function (err) {
      if (err && err.type === "peer-unavailable") {
        emit({ type: "error", message: "Room " + Online.roomCode + " tidak ketemu — cek kodenya." });
        return;
      }
      emit({ type: "error", message: "Gagal join room. Coba lagi." });
    });
  };

  Online.send = function (msg) {
    if (Online.conn && Online.connected) {
      try { Online.conn.send(JSON.stringify(msg)); } catch (e) {}
    }
  };

  // Keluar room (kirim leave dulu kalau masih terhubung).
  Online.leave = function (quiet) {
    if (!quiet) Online.send({ t: "leave" });
    Online.destroy();
    emit({ type: "left" });
  };

  Online.destroy = function () {
    try { if (Online.conn) Online.conn.close(); } catch (e) {}
    try { if (Online.peer) Online.peer.destroy(); } catch (e) {}
    Online.peer = null;
    Online.conn = null;
    Online.connected = false;
    Online.roomCode = "";
    Online.oppName = "";
  };

  Online.inviteLink = function () {
    if (!Online.roomCode) return "";
    return location.origin + location.pathname + "?join=" + Online.roomCode;
  };

  window.AFOnline = Online;
})();
