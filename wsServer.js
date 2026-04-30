// ─── WebSocket Server Module ────────────────────────────────────────────
// Provides real-time push to connected dashboard clients.
// Works alongside the existing http.createServer (upgrade handshake).
// No external deps — implements RFC 6455 WebSocket framing natively.

const crypto = require("crypto");

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-5AB4286F35CC";

class WebSocketServer {
  constructor() {
    this.clients = new Map(); // id -> { socket, subscriptions, user, lastPing }
    this.channels = new Set(["incidents", "sla", "notifications", "escalations", "dashboard", "zendesk", "ai_actions", "ai_cards", "system"]);
    // Heartbeat: every 30s, remove dead connections
    this.heartbeatTimer = setInterval(() => this._heartbeat(), 30000);
  }

  // Handle HTTP upgrade request
  handleUpgrade(req, socket) {
    const key = req.headers["sec-websocket-key"];
    if (!key) { socket.destroy(); return; }

    const accept = crypto.createHash("sha1").update(key + WS_MAGIC).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      "\r\n"
    );

    const clientId = crypto.randomUUID();
    const client = {
      id: clientId,
      socket,
      subscriptions: new Set(["system", "notifications"]), // default channels
      user: null,
      lastPing: Date.now(),
    };
    this.clients.set(clientId, client);
    console.log(`[WS] Client connected: ${clientId} (total: ${this.clients.size})`);

    // Send welcome message
    this._send(client, { type: "connected", clientId, channels: [...this.channels] });

    // Handle incoming frames
    let buffer = Buffer.alloc(0);
    socket.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 2) {
        const frame = this._parseFrame(buffer);
        if (!frame) break;
        buffer = buffer.slice(frame.totalLength);

        if (frame.opcode === 0x8) {
          // Close frame
          this._removeClient(clientId);
          return;
        }
        if (frame.opcode === 0x9) {
          // Ping — respond with pong
          this._sendRawFrame(socket, 0xA, frame.payload);
          client.lastPing = Date.now();
          continue;
        }
        if (frame.opcode === 0xA) {
          // Pong — update last activity
          client.lastPing = Date.now();
          continue;
        }
        if (frame.opcode === 0x1) {
          // Text frame
          try {
            const msg = JSON.parse(frame.payload.toString("utf8"));
            this._handleMessage(clientId, msg);
          } catch { /* ignore bad JSON */ }
        }
      }
    });

    socket.on("close", () => this._removeClient(clientId));
    socket.on("error", () => this._removeClient(clientId));
  }

  // Parse a WebSocket frame from buffer
  _parseFrame(buf) {
    if (buf.length < 2) return null;
    const firstByte = buf[0];
    const secondByte = buf[1];
    const opcode = firstByte & 0x0F;
    const masked = !!(secondByte & 0x80);
    let payloadLength = secondByte & 0x7F;
    let offset = 2;

    if (payloadLength === 126) {
      if (buf.length < 4) return null;
      payloadLength = buf.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (buf.length < 10) return null;
      payloadLength = Number(buf.readBigUInt64BE(2));
      offset = 10;
    }

    const maskLength = masked ? 4 : 0;
    const totalLength = offset + maskLength + payloadLength;
    if (buf.length < totalLength) return null;

    let payload;
    if (masked) {
      const mask = buf.slice(offset, offset + maskLength);
      payload = Buffer.alloc(payloadLength);
      for (let i = 0; i < payloadLength; i++) {
        payload[i] = buf[offset + maskLength + i] ^ mask[i & 3];
      }
    } else {
      payload = buf.slice(offset, offset + payloadLength);
    }

    return { opcode, payload, totalLength };
  }

  // Send a raw WebSocket frame
  _sendRawFrame(socket, opcode, payload) {
    if (socket.destroyed) return;
    const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const len = payloadBuf.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    try { socket.write(Buffer.concat([header, payloadBuf])); } catch { /* connection dead */ }
  }

  // Send JSON message to a single client
  _send(client, data) {
    this._sendRawFrame(client.socket, 0x1, JSON.stringify(data));
  }

  // Handle incoming client message
  _handleMessage(clientId, msg) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (msg.type) {
      case "subscribe":
        if (msg.channels && Array.isArray(msg.channels)) {
          msg.channels.forEach(ch => {
            if (this.channels.has(ch)) client.subscriptions.add(ch);
          });
          this._send(client, { type: "subscribed", channels: [...client.subscriptions] });
        }
        break;

      case "unsubscribe":
        if (msg.channels && Array.isArray(msg.channels)) {
          msg.channels.forEach(ch => client.subscriptions.delete(ch));
          this._send(client, { type: "unsubscribed", channels: [...client.subscriptions] });
        }
        break;

      case "auth":
        // Client sends user info for identification
        client.user = msg.user || null;
        this._send(client, { type: "authenticated", user: msg.user?.email || "anonymous" });
        break;

      case "ping":
        client.lastPing = Date.now();
        this._send(client, { type: "pong", timestamp: Date.now() });
        break;
    }
  }

  // Remove a client
  _removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;
    try { client.socket.destroy(); } catch { /* already closed */ }
    this.clients.delete(clientId);
    console.log(`[WS] Client disconnected: ${clientId} (total: ${this.clients.size})`);
  }

  // Heartbeat — ping clients and remove stale ones
  _heartbeat() {
    const now = Date.now();
    const staleTimeout = 90000; // 90s without pong = dead
    for (const [id, client] of this.clients) {
      if (now - client.lastPing > staleTimeout) {
        console.log(`[WS] Removing stale client: ${id}`);
        this._removeClient(id);
      } else {
        // Send ping
        this._sendRawFrame(client.socket, 0x9, Buffer.alloc(0));
      }
    }
  }

  // ─── Public API: Broadcast to channel ─────────────────────────────
  broadcast(channel, data) {
    const message = { type: "event", channel, data, timestamp: Date.now() };
    let sent = 0;
    for (const client of this.clients.values()) {
      if (client.subscriptions.has(channel)) {
        this._send(client, message);
        sent++;
      }
    }
    return sent;
  }

  // Broadcast to all connected clients (system-wide)
  broadcastAll(data) {
    return this.broadcast("system", data);
  }

  // ─── Proactive AI Card Push — send interactive cards to chat panels ───
  broadcastCards(cardPayload, targetEmail) {
    // cardPayload: { text, cards, suggestions, toast, toastType }
    const data = { collection: "ai_cards", data: cardPayload };
    if (targetEmail) {
      this.sendToUser(targetEmail, "ai_cards", cardPayload);
    } else {
      this.broadcast("ai_cards", cardPayload);
    }
  }

  // Send to a specific user by email
  sendToUser(email, channel, data) {
    const message = { type: "event", channel, data, timestamp: Date.now() };
    for (const client of this.clients.values()) {
      if (client.user?.email === email) {
        this._send(client, message);
      }
    }
  }

  getStats() {
    return {
      totalConnections: this.clients.size,
      clients: [...this.clients.values()].map(c => ({
        id: c.id,
        user: c.user?.email || "anonymous",
        subscriptions: [...c.subscriptions],
        lastPing: c.lastPing,
      })),
    };
  }

  stop() {
    clearInterval(this.heartbeatTimer);
    for (const client of this.clients.values()) {
      try { client.socket.destroy(); } catch { /* ignore */ }
    }
    this.clients.clear();
  }
}

module.exports = { WebSocketServer };
