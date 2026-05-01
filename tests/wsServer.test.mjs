import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { WebSocketServer } = require("../wsServer.js");

describe("WebSocketServer", () => {
  it("uses the RFC 6455 GUID when building Sec-WebSocket-Accept", () => {
    const key = "dGhlIHNhbXBsZSBub25jZQ==";
    const expected = crypto
      .createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");

    const writes = [];
    const socket = {
      destroyed: false,
      write(chunk) { writes.push(Buffer.isBuffer(chunk) ? chunk.toString("latin1") : String(chunk)); },
      on() {},
      destroy() { this.destroyed = true; },
    };

    const wsServer = new WebSocketServer();
    try {
      wsServer.handleUpgrade({ headers: { "sec-websocket-key": key } }, socket);
      const header = writes[0] || "";
      const actual = header.match(/Sec-WebSocket-Accept: (.*)\r\n/)?.[1];
      expect(actual).toBe(expected);
    } finally {
      wsServer.stop();
    }
  });
});
