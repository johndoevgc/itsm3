import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { WebSocketServer } = require("../wsServer.js");

function mockSocket() {
  const writes = [];
  return {
    destroyed: false,
    writes,
    write(chunk) { writes.push(Buffer.isBuffer(chunk) ? chunk.toString("latin1") : String(chunk)); },
    on() {},
    destroy() { this.destroyed = true; },
  };
}

describe("WebSocketServer", () => {
  it("uses the RFC 6455 GUID when building Sec-WebSocket-Accept", () => {
    const key = "dGhlIHNhbXBsZSBub25jZQ==";
    const expected = crypto
      .createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");

    const socket = mockSocket();

    const wsServer = new WebSocketServer();
    try {
      wsServer.handleUpgrade({ headers: { "sec-websocket-key": key } }, socket);
      const header = socket.writes[0] || "";
      const actual = header.match(/Sec-WebSocket-Accept: (.*)\r\n/)?.[1];
      expect(actual).toBe(expected);
    } finally {
      wsServer.stop();
    }
  });

  // ─── WebSocket JWT auth tests ─────────────────────────────────────
  it("rejects upgrade when no token is provided and validateToken is set", async () => {
    const validateToken = vi.fn();
    const wsServer = new WebSocketServer({ validateToken });
    const socket = mockSocket();

    try {
      await wsServer.handleUpgrade(
        { headers: { "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" }, url: "/ws" },
        socket,
      );
      expect(socket.destroyed).toBe(true);
      expect(socket.writes[0]).toContain("401");
      expect(validateToken).not.toHaveBeenCalled();
    } finally {
      wsServer.stop();
    }
  });

  it("rejects upgrade when validateToken returns invalid", async () => {
    const validateToken = vi.fn().mockResolvedValue({ valid: false, error: "bad token" });
    const wsServer = new WebSocketServer({ validateToken });
    const socket = mockSocket();

    try {
      await wsServer.handleUpgrade(
        { headers: { "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" }, url: "/ws?token=bad-jwt" },
        socket,
      );
      expect(socket.destroyed).toBe(true);
      expect(socket.writes[0]).toContain("401");
      expect(validateToken).toHaveBeenCalledWith("bad-jwt", "", "", []);
    } finally {
      wsServer.stop();
    }
  });

  it("accepts upgrade when validateToken returns valid", async () => {
    const user = { email: "user@test.com", name: "Test User" };
    const validateToken = vi.fn().mockResolvedValue({ valid: true, user });
    const wsServer = new WebSocketServer({ validateToken, tenantId: "t1", clientId: "c1" });
    const socket = mockSocket();

    try {
      await wsServer.handleUpgrade(
        { headers: { "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" }, url: "/ws?token=good-jwt" },
        socket,
      );
      expect(socket.destroyed).toBe(false);
      expect(socket.writes[0]).toContain("101 Switching Protocols");
      expect(validateToken).toHaveBeenCalledWith("good-jwt", "t1", "c1", []);
    } finally {
      wsServer.stop();
    }
  });

  it("accepts token from Authorization header", async () => {
    const user = { email: "user@test.com", name: "Test User" };
    const validateToken = vi.fn().mockResolvedValue({ valid: true, user });
    const wsServer = new WebSocketServer({ validateToken });
    const socket = mockSocket();

    try {
      await wsServer.handleUpgrade(
        {
          headers: { "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", authorization: "Bearer header-jwt" },
          url: "/ws",
        },
        socket,
      );
      expect(socket.destroyed).toBe(false);
      expect(socket.writes[0]).toContain("101");
      expect(validateToken).toHaveBeenCalledWith("header-jwt", "", "", []);
    } finally {
      wsServer.stop();
    }
  });

  it("allows connections without auth in dev mode (no validateToken)", async () => {
    const wsServer = new WebSocketServer();
    const socket = mockSocket();

    try {
      await wsServer.handleUpgrade(
        { headers: { "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" }, url: "/ws" },
        socket,
      );
      expect(socket.destroyed).toBe(false);
      expect(socket.writes[0]).toContain("101");
    } finally {
      wsServer.stop();
    }
  });
});
