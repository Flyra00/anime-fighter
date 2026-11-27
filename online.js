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

  // v4.2 — join timeout (tamu): joinRoom TIDAK PUNYA TIMEOUT di v4/v4.1,
  // jadi kalau peer tidak pernah "open" atau conn tidak pernah "open",
  // status "Join room ..." menggantung selamanya tanpa error + tanpa
  // COBA LAGI (tes live room 9BJE6K, 27 Nov 15:08-15:12: 4x hang 60+ dtk).
  // Timer tahap-1: peer belum "open" dalam 12 dtk. Timer tahap-2: peer
  // sudah "open" tapi conn belum "open" dalam 10 dtk. Keduanya dibersihkan
  // saat conn "open" atau saat error apapun fire, dan dijaga dengan
  // stale-peer guard (pola yang sama seperti fix race v4.1).
  var JOIN_TIMEOUT_MS = 12000;
  var CONN_TIMEOUT_MS = 10000;
  // v4.4 (TURN test): pesan timeout DIBEDAKAN per tahap supaya kegagalan
  // berikutnya ketahuan persis di mana — tahap-1 = signaling (peer tidak
  // pernah "open"), tahap-2 = ICE (conn tidak pernah "open").
  var JOIN_STAGE1_MSG = "Tidak bisa nyambung ke server PeerJS (tahap 1) — cek internet lalu tap COBA LAGI.";
  var JOIN_STAGE2_MSG = "Tidak bisa nyambung langsung ke host (tahap 2) — pastikan host masih buka tab gamenya & belum pindah aplikasi, lalu tap COBA LAGI.";
  var joinTimer = null;
  var connTimer = null;

  // v4.4 (TURN test, Neon): factory opsi Peer — SELALU objek baru per Peer
  // (RTCPeerConnection boleh memutasi config). STUN Google + TURN bawaan
  // PeerJS ditulis ulang eksplisit karena config MENGGANTIKAN iceServers
  // default — kalau tidak ditulis, TURN bawaan hilang diam-diam (koreksi
  // 27 Nov: klaim "PeerJS tanpa TURN" SALAH; bundle 1.5.4 membuktikan ada
  // turn:eu-0 + us-0.turn.peerjs.com:3478, peerjs/peerjsp).
  // TURN tambahan = OpenRelay (Metered, publik, tanpa signup, 20 GB/bln)
  // — UDP + TCP + TLS di port 80/443, karena browser cloud sering
  // memblokir UDP dan port 3478.
  function peerOptions() {
    return {
      debug: 0,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"], username: "peerjs", credential: "peerjsp" },
          { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
          { urls: "turn:openrelay.metered.ca:80?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
          { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
          { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
          { urls: "turns:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" }
        ]
      }
    };
  }

  function clearJoinTimers() {
    clearTimeout(joinTimer);
    clearTimeout(connTimer);
    joinTimer = null;
    connTimer = null;
  }

  // Dipanggil saat join gagal karena timeout: bersihkan peer yang menggantung,
  // tapi PERTAHANKAN roomCode + myName supaya COBA LAGI (retryJoin) tetap bisa
  // jalan — Online.destroy() sendiri mengosongkan roomCode, jadi tanpa ini
  // tombol COBA LAGI tidak akan berbuat apa-apa.
  function failJoinTimeout(peer, msg) {
    // v4.3 (Neon): + guard Online.connected — kalau entah bagaimana sudah
    // terhubung, timer basi tidak boleh emit error timeout.
    if (Online.peer !== peer || Online.connected) return; // join baru sudah jalan — abaikan timer basi
    var code = Online.roomCode;
    var name = Online.myName;
    clearJoinTimers();
    Online.destroy();
    Online.roomCode = code;
    Online.myName = name;
    emit({ type: "error", message: msg || JOIN_STAGE2_MSG });
  }

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
      clearJoinTimers(); // join berhasil — matikan kedua timer tahap-1/2
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
      clearJoinTimers(); // v4.3 (Neon): error conn juga matikan timer — jangan dobel emit
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
        wireHostPeer(new Peer(PREFIX + Online.roomCode, peerOptions()));
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
    wireHostPeer(new Peer(PREFIX + Online.roomCode, peerOptions()));
  };

  // Tamu: join room pakai kode.
  Online.joinRoom = function (code, name) {
    if (!peerReady()) { emit({ type: "error", message: "PeerJS tidak bisa dimuat — cek internet lalu refresh." }); return; }
    Online.destroy();
    Online.isHost = false;
    Online.myName = name || "Pemain 2";
    Online.roomCode = (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (Online.roomCode.length < 4) { emit({ type: "error", message: "Kode room tidak valid." }); return; }
    var peer = new Peer(peerOptions());
    Online.peer = peer;
    clearJoinTimers();
    // Tahap-1: peer tidak pernah "open" (mis. WebSocket ke PeerJS cloud tidak
    // nyambung dari jaringan tamu) — jangan gantung diam selamanya.
    joinTimer = setTimeout(function () { failJoinTimeout(peer, JOIN_STAGE1_MSG); }, JOIN_TIMEOUT_MS);
    peer.on("open", function () {
      if (Online.peer !== peer) return; // peer lama yang telat buka — abaikan
      clearTimeout(joinTimer);
      joinTimer = null;
      // Tahap-2: peer "open" tapi conn tidak pernah "open" (mis. host
      // ke-suspend saat pindah aplikasi) — jangan gantung diam selamanya.
      connTimer = setTimeout(function () { failJoinTimeout(peer, JOIN_STAGE2_MSG); }, CONN_TIMEOUT_MS);
      var conn = peer.connect(PREFIX + Online.roomCode, { reliable: true });
      wireConn(conn);
    });
    peer.on("disconnected", function () {
      if (Online.peer !== peer) return;
      tryReconnect();
    });
    peer.on("error", function (err) {
      if (Online.peer !== peer) return;
      clearJoinTimers(); // error apapun mematikan timer — jangan dobel emit
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
    clearJoinTimers();
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
