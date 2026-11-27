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
    reconnecting: false,
    onEvent: null, // function (ev) — ev = {type, ...}
  };

  var reconnectTimer = null;

  // Daftar ulang ke signaling server dengan ID yang sama (af-XXXXXX) kalau
  // WebSocket ke cloud putus (mis. tab host di-suspend Android saat pindah
  // aplikasi). Guard wajib PeerJS 1.5.4: jangan reconnect peer yang destroyed.
  function tryReconnect() {
    var p = Online.peer;
    if (!p || p.destroyed || !p.disconnected) return;
    if (Online.reconnecting) return;
    Online.reconnecting = true;
    emit({ type: "peer-disconnected", code: Online.roomCode });
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(function () {
      Online.reconnecting = false;
      if (Online.peer && !Online.peer.destroyed && Online.peer.disconnected) {
        try { Online.peer.reconnect(); } catch (e) {}
      }
    }, 1500);
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") tryReconnect();
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("online", function () { tryReconnect(); });
  }

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
      if (Online.conn !== conn) return; // conn lama yang telat — abaikan
      Online.connected = true;
      emit({ type: "connected" });
    });
    conn.on("data", function (data) {
      if (Online.conn !== conn) return;
      var msg = null;
      try { msg = typeof data === "string" ? JSON.parse(data) : data; } catch (e) { return; }
      if (msg && msg.t) emit({ type: "message", msg: msg });
    });
    conn.on("close", function () {
      if (Online.conn !== conn) return; // close telat dari conn lama — jangan bunuh join baru
      Online.connected = false;
      emit({ type: "disconnected" });
    });
    conn.on("error", function (err) {
      if (Online.conn !== conn) return;
      emit({ type: "error", message: "Koneksi ke lawan error." });
    });
  }

  function wireHostPeer(peer) {
    Online.peer = peer;
    var openedOnce = false;
    peer.on("open", function () {
      if (Online.peer !== peer) return; // peer lama yang telat buka — abaikan
      Online.reconnecting = false;
      if (openedOnce) {
        emit({ type: "peer-reconnected", code: Online.roomCode });
      } else {
        openedOnce = true;
        emit({ type: "waiting", code: Online.roomCode });
      }
    });
    peer.on("connection", function (conn) {
      if (Online.peer !== peer) { conn.close(); return; }
      if (Online.conn && Online.connected) { conn.close(); return; } // room cuma 2 orang
      wireConn(conn);
    });
    peer.on("disconnected", function () {
      if (Online.peer !== peer) return;
      tryReconnect();
    });
    peer.on("error", function (err) {
      if (Online.peer !== peer) return;
      if (err && err.type === "unavailable-id") {
        try { peer.destroy(); } catch (e) {}
        Online.roomCode = makeCode();
        wireHostPeer(new Peer(PREFIX + Online.roomCode, { debug: 0 }));
        return;
      }
      emit({ type: "error", message: "Gagal buat room. Coba lagi." });
    });
  }

  // Host: buat room, tunggu tamu.
  Online.createRoom = function (name) {
    if (!peerReady()) { emit({ type: "error", message: "PeerJS tidak bisa dimuat — cek internet lalu refresh." }); return; }
    Online.destroy();
    Online.isHost = true;
    Online.myName = name || "Pemain 1";
    Online.roomCode = makeCode();
    wireHostPeer(new Peer(PREFIX + Online.roomCode, { debug: 0 }));
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
      if (Online.peer !== peer) return; // peer lama yang telat buka — abaikan
      var conn = peer.connect(PREFIX + Online.roomCode, { reliable: true });
      wireConn(conn);
    });
    peer.on("disconnected", function () {
      if (Online.peer !== peer) return;
      tryReconnect();
    });
    peer.on("error", function (err) {
      if (Online.peer !== peer) return;
      if (err && err.type === "peer-unavailable") {
        emit({
          type: "peer-unavailable",
          code: Online.roomCode,
          message: "Room " + Online.roomCode + " tidak ketemu. Pastikan host masih buka tab gamenya & belum pindah aplikasi, lalu tap COBA LAGI."
        });
        return;
      }
      emit({ type: "error", message: "Gagal join room. Coba lagi." });
    });
  };

  Online.retryJoin = function () {
    if (!Online.roomCode || Online.isHost) return;
    Online.joinRoom(Online.roomCode, Online.myName);
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
    clearTimeout(reconnectTimer);
    Online.reconnecting = false;
    // Null-kan dulu SEBELUM close/destroy: close conn lama itu async, dan
    // handler "close"-nya harus diabaikan kalau join baru sudah jalan.
    var c = Online.conn, p = Online.peer;
    Online.conn = null;
    Online.peer = null;
    try { if (c) c.close(); } catch (e) {}
    try { if (p) p.destroy(); } catch (e) {}
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
