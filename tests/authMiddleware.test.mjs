import { describe, it, expect } from "vitest";

// authMiddleware.js uses CommonJS (require), so we import accordingly
const {
  decodeJWT,
  checkPermission,
  resolveRole,
  RBAC_PERMISSIONS,
  COLLECTION_TO_MODULE,
  checkRateLimit,
  isPublicRoute,
  isReadOnlyPostRoute,
} = require("../authMiddleware.js");

// ─── decodeJWT ──────────────────────────────────────────────────────────
describe("decodeJWT", () => {
  function makeToken(header, payload) {
    const h = Buffer.from(JSON.stringify(header)).toString("base64url");
    const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${h}.${p}.fake-signature`;
  }

  it("decodes a valid 3-part JWT", () => {
    const token = makeToken({ alg: "RS256", kid: "key1" }, { sub: "user1", exp: 9999999999 });
    const result = decodeJWT(token);
    expect(result).not.toBeNull();
    expect(result.header.alg).toBe("RS256");
    expect(result.payload.sub).toBe("user1");
    expect(result.signature).toBe("fake-signature");
  });

  it("returns null for token with fewer than 3 parts", () => {
    expect(decodeJWT("only.two")).toBeNull();
    expect(decodeJWT("single")).toBeNull();
    expect(decodeJWT("")).toBeNull();
  });

  it("returns null for invalid base64 payload", () => {
    expect(decodeJWT("!!!.!!!.!!!")).toBeNull();
  });

  it("handles token with complex payload claims", () => {
    const payload = {
      preferred_username: "user@example.com",
      name: "Test User",
      roles: ["Admin"],
      tid: "tenant-123",
      oid: "object-456",
    };
    const token = makeToken({ alg: "RS256" }, payload);
    const result = decodeJWT(token);
    expect(result.payload.preferred_username).toBe("user@example.com");
    expect(result.payload.roles).toEqual(["Admin"]);
    expect(result.payload.tid).toBe("tenant-123");
  });
});

// ─── resolveRole ────────────────────────────────────────────────────────
describe("resolveRole", () => {
  it('returns "VGC Dev Admin" for dev admin emails', () => {
    expect(resolveRole("hlaing@vgctechnology.com")).toBe("VGC Dev Admin");
    expect(resolveRole("qing@vgctechnology.com")).toBe("VGC Dev Admin");
  });

  it("is case-insensitive", () => {
    expect(resolveRole("HLAING@VGCTECHNOLOGY.COM")).toBe("VGC Dev Admin");
  });

  it('returns "Administrator" for admin emails not in dev list', () => {
    expect(resolveRole("hamidi@vgctechnology.com")).toBe("Administrator");
    expect(resolveRole("adrian@vgctechnology.com")).toBe("Administrator");
  });

  it('returns "L1 Support Engineer" for unknown emails', () => {
    expect(resolveRole("random@example.com")).toBe("L1 Support Engineer");
  });

  it('returns "L1 Support Engineer" for null/undefined/empty', () => {
    expect(resolveRole(null)).toBe("L1 Support Engineer");
    expect(resolveRole(undefined)).toBe("L1 Support Engineer");
    expect(resolveRole("")).toBe("L1 Support Engineer");
  });
});

// ─── checkPermission ────────────────────────────────────────────────────
describe("checkPermission", () => {
  // Full access roles
  it("grants Administrator full access to all methods on incidents", () => {
    expect(checkPermission("Administrator", "incidents", "GET")).toBe(true);
    expect(checkPermission("Administrator", "incidents", "POST")).toBe(true);
    expect(checkPermission("Administrator", "incidents", "PUT")).toBe(true);
    expect(checkPermission("Administrator", "incidents", "DELETE")).toBe(true);
  });

  it("grants VGC Dev Admin full access everywhere", () => {
    expect(checkPermission("VGC Dev Admin", "admin", "DELETE")).toBe(true);
    expect(checkPermission("VGC Dev Admin", "changes", "POST")).toBe(true);
  });

  // Limited access roles
  it("grants L1 Support Engineer read access but not delete on incidents", () => {
    expect(checkPermission("L1 Support Engineer", "incidents", "GET")).toBe(true);
    expect(checkPermission("L1 Support Engineer", "incidents", "POST")).toBe(true); // edit includes POST
    expect(checkPermission("L1 Support Engineer", "incidents", "PUT")).toBe(true);  // edit includes PUT
    expect(checkPermission("L1 Support Engineer", "incidents", "DELETE")).toBe(false); // edit does NOT include DELETE
  });

  it("denies End User write access to incidents", () => {
    // End User has "create" on incidents → POST allowed but PUT/DELETE denied
    expect(checkPermission("End User", "incidents", "POST")).toBe(true);  // create includes POST
    expect(checkPermission("End User", "incidents", "DELETE")).toBe(false);
  });

  it('denies End User access to admin module', () => {
    expect(checkPermission("End User", "users", "GET")).toBe(false); // "none"
    expect(checkPermission("End User", "users", "POST")).toBe(false);
  });

  it("denies Read Only role write operations", () => {
    expect(checkPermission("Read Only", "incidents", "GET")).toBe(true);
    expect(checkPermission("Read Only", "incidents", "DELETE")).toBe(false);
  });

  // Unknown collection → allow (handled by VALID_COLLECTIONS upstream)
  it("returns true for unknown collection", () => {
    expect(checkPermission("L1 Support Engineer", "unknown_collection", "GET")).toBe(true);
  });

  // Unknown role → deny
  it("returns false for unknown role", () => {
    expect(checkPermission("NonExistentRole", "incidents", "GET")).toBe(false);
  });

  // Cross-module checks
  it("Change Manager can approve but not delete incidents", () => {
    expect(checkPermission("Change Manager", "changes", "DELETE")).toBe(true);  // full on changes
    expect(checkPermission("Change Manager", "incidents", "GET")).toBe(true);   // view on incidents
    expect(checkPermission("Change Manager", "incidents", "DELETE")).toBe(false); // view doesn't allow DELETE
  });

  it("maps zendesk_tickets to incidents module", () => {
    expect(checkPermission("L1 Support Engineer", "zendesk_tickets", "GET")).toBe(true);
  });

  it("maps kb to knowledge module", () => {
    expect(checkPermission("L1 Support Engineer", "kb", "POST")).toBe(true); // contribute level
  });
});

// ─── RBAC_PERMISSIONS structure ─────────────────────────────────────────
describe("RBAC_PERMISSIONS", () => {
  it("contains all 12 expected roles", () => {
    const expectedRoles = [
      "VGC Dev Admin", "Tenant Admin", "Administrator", "Service Desk Lead",
      "L1 Support Engineer", "L2 Support Engineer", "Network Engineer",
      "Change Manager", "Problem Manager", "Asset Manager", "End User", "Read Only",
    ];
    for (const role of expectedRoles) {
      expect(RBAC_PERMISSIONS).toHaveProperty(role);
    }
  });

  it("every role has all 14 modules defined", () => {
    const modules = [
      "dashboard", "incidents", "problems", "changes", "requests",
      "catalog", "knowledge", "assets", "approvals", "sla", "ai", "admin",
      "customers", "reports",
    ];
    for (const role of Object.keys(RBAC_PERMISSIONS)) {
      for (const mod of modules) {
        expect(RBAC_PERMISSIONS[role]).toHaveProperty(mod);
      }
    }
  });
});

// ─── COLLECTION_TO_MODULE mapping ───────────────────────────────────────
describe("COLLECTION_TO_MODULE", () => {
  it("maps core collections correctly", () => {
    expect(COLLECTION_TO_MODULE.incidents).toBe("incidents");
    expect(COLLECTION_TO_MODULE.problems).toBe("problems");
    expect(COLLECTION_TO_MODULE.changes).toBe("changes");
    expect(COLLECTION_TO_MODULE.kb).toBe("knowledge");
    expect(COLLECTION_TO_MODULE.assets).toBe("assets");
    expect(COLLECTION_TO_MODULE.users).toBe("admin");
    expect(COLLECTION_TO_MODULE.customers).toBe("customers");
  });

  it("maps Zendesk collections", () => {
    expect(COLLECTION_TO_MODULE.zendesk_tickets).toBe("incidents");
    expect(COLLECTION_TO_MODULE.zendesk_users).toBe("admin");
    expect(COLLECTION_TO_MODULE.zendesk_orgs).toBe("customers");
  });

  it("maps AI collections", () => {
    expect(COLLECTION_TO_MODULE.ai_actions).toBe("ai");
    expect(COLLECTION_TO_MODULE.ai_triage_history).toBe("ai");
    expect(COLLECTION_TO_MODULE.ai_briefings).toBe("ai");
  });
});

// ─── checkRateLimit ─────────────────────────────────────────────────────
describe("checkRateLimit", () => {
  it("allows requests under the limit", () => {
    const result = checkRateLimit("test-ip-unique-1", false, false);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it("returns resetAt timestamp", () => {
    const result = checkRateLimit("test-ip-unique-2", false, false);
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });
});

// ─── isPublicRoute ──────────────────────────────────────────────────────
describe("isPublicRoute", () => {
  it("identifies /api/health as public", () => {
    expect(isPublicRoute("/api/health")).toBe(true);
  });

  it("identifies /api/auth/local as public", () => {
    expect(isPublicRoute("/api/auth/local")).toBe(true);
  });

  it("identifies zendesk webhook prefix as public", () => {
    expect(isPublicRoute("/api/zendesk/webhook/callback")).toBe(true);
  });

  it("identifies normal API routes as non-public", () => {
    expect(isPublicRoute("/api/incidents")).toBe(false);
    expect(isPublicRoute("/api/admin/users")).toBe(false);
  });
});

// ─── isReadOnlyPostRoute ────────────────────────────────────────────────
describe("isReadOnlyPostRoute", () => {
  it("treats AI error resolver as read-only POST", () => {
    expect(isReadOnlyPostRoute("/api/ai/resolve-error", "POST")).toBe(true);
  });

  it("does not treat mutating AI endpoints as read-only POST", () => {
    expect(isReadOnlyPostRoute("/api/ai/auto-resolve", "POST")).toBe(false);
    expect(isReadOnlyPostRoute("/api/ai/resolve-error", "GET")).toBe(false);
  });
});
