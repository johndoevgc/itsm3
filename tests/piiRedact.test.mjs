import { describe, it, expect } from "vitest";
import { redact, restore, summary } from "../piiRedact.js";

describe("piiRedact", () => {
  // ─── redact() ─────────────────────────────────────────────────────────
  describe("redact", () => {
    it("redacts email addresses", () => {
      const { redacted, map } = redact("Contact john.doe@example.com for help");
      expect(redacted).toBe("Contact [EMAIL_1] for help");
      expect(map["[EMAIL_1]"]).toBe("john.doe@example.com");
    });

    it("redacts multiple emails with incrementing tokens", () => {
      const { redacted, map } = redact("From alice@test.com to bob@test.com");
      expect(redacted).toBe("From [EMAIL_1] to [EMAIL_2]");
      expect(map["[EMAIL_1]"]).toBe("alice@test.com");
      expect(map["[EMAIL_2]"]).toBe("bob@test.com");
    });

    it("redacts SG NRIC numbers (S/T/F/G prefix)", () => {
      const { redacted, map } = redact("NRIC: S1234567A and T9876543B");
      expect(redacted).toBe("NRIC: [NRIC_1] and [NRIC_2]");
      expect(map["[NRIC_1]"]).toBe("S1234567A");
      expect(map["[NRIC_2]"]).toBe("T9876543B");
    });

    it("redacts lowercase NRIC prefixes", () => {
      const { redacted } = redact("nric is f1234567x");
      expect(redacted).toBe("nric is [NRIC_1]");
    });

    it("redacts IPv4 addresses", () => {
      const { redacted, map } = redact("Server at 192.168.1.100 is down");
      expect(redacted).toBe("Server at [IP_1] is down");
      expect(map["[IP_1]"]).toBe("192.168.1.100");
    });

    it("redacts international phone numbers with + prefix", () => {
      const { redacted, map } = redact("Call +65 9123 4567 now");
      expect(redacted).toContain("[PHONE_1]");
      expect(Object.values(map)).toContainEqual(expect.stringContaining("65"));
    });

    it("redacts SG mobile numbers (8/9 prefix, 8 digits)", () => {
      const { redacted } = redact("Mobile: 91234567");
      expect(redacted).toBe("Mobile: [PHONE_1]");
    });

    it("redacts SG numbers with space separator", () => {
      const { redacted } = redact("Phone 8123 4567 is mine");
      expect(redacted).toBe("Phone [PHONE_1] is mine");
    });

    it("redacts long digit runs (≥9 digits) as NUM", () => {
      const { redacted, map } = redact("Badge ID: 123456789");
      expect(redacted).toBe("Badge ID: [NUM_1]");
      expect(map["[NUM_1]"]).toBe("123456789");
    });

    it("does NOT redact short digit runs (<9 digits)", () => {
      const { redacted } = redact("Port 8080 and year 2025");
      expect(redacted).toBe("Port 8080 and year 2025");
    });

    it("redacts mixed PII in a single string", () => {
      const input = "User john@acme.com (NRIC S9876543Z) called from +65 9111 2222, IP 10.0.0.5, badge 123456789012";
      const { redacted, map } = redact(input);
      expect(redacted).toContain("[EMAIL_1]");
      expect(redacted).toContain("[NRIC_1]");
      expect(redacted).toContain("[PHONE_1]");
      expect(redacted).toContain("[IP_1]");
      expect(redacted).toContain("[NUM_1]");
      expect(Object.keys(map).length).toBe(5);
    });

    it("returns empty string and empty map for null input", () => {
      const { redacted, map } = redact(null);
      expect(redacted).toBe("");
      expect(map).toEqual({});
    });

    it("returns empty string and empty map for undefined input", () => {
      const { redacted, map } = redact(undefined);
      expect(redacted).toBe("");
      expect(map).toEqual({});
    });

    it("returns same text and empty map when no PII present", () => {
      const { redacted, map } = redact("Hello world, no PII here!");
      expect(redacted).toBe("Hello world, no PII here!");
      expect(map).toEqual({});
    });

    it("handles empty string input", () => {
      const { redacted, map } = redact("");
      expect(redacted).toBe("");
      expect(map).toEqual({});
    });
  });

  // ─── restore() ────────────────────────────────────────────────────────
  describe("restore", () => {
    it("round-trips: redact then restore returns original", () => {
      const original = "Email admin@vgc.com, NRIC S1234567A, phone +65 9123 4567";
      const { redacted, map } = redact(original);
      const restored = restore(redacted, map);
      expect(restored).toBe(original);
    });

    it("restores tokens that AI repeats multiple times", () => {
      const map = { "[EMAIL_1]": "user@test.com" };
      const aiOutput = "Contact [EMAIL_1] or forward to [EMAIL_1]";
      const restored = restore(aiOutput, map);
      expect(restored).toBe("Contact user@test.com or forward to user@test.com");
    });

    it("returns empty string for null input", () => {
      expect(restore(null, {})).toBe("");
    });

    it("returns text unchanged when map is null", () => {
      expect(restore("hello [EMAIL_1]", null)).toBe("hello [EMAIL_1]");
    });

    it("returns text unchanged when map is empty", () => {
      expect(restore("no tokens here", {})).toBe("no tokens here");
    });
  });

  // ─── summary() ────────────────────────────────────────────────────────
  describe("summary", () => {
    it("counts tags correctly", () => {
      const map = {
        "[EMAIL_1]": "a@b.com",
        "[EMAIL_2]": "c@d.com",
        "[NRIC_1]": "S1234567A",
        "[IP_1]": "10.0.0.1",
      };
      const result = summary(map);
      expect(result).toEqual({ EMAIL: 2, NRIC: 1, IP: 1 });
    });

    it("returns empty object for null map", () => {
      expect(summary(null)).toEqual({});
    });

    it("returns empty object for empty map", () => {
      expect(summary({})).toEqual({});
    });
  });
});
