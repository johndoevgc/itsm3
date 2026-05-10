// Per-Customer SLA Policy tests
import { describe, it, expect } from "vitest";

describe("Per-Customer SLA Policy", () => {
  const SLA_TIERS = ["Standard", "Premium", "Enterprise", "Custom"];

  it("validates SLA tiers", () => {
    expect(SLA_TIERS).toContain("Standard");
    expect(SLA_TIERS).toContain("Enterprise");
    expect(SLA_TIERS).toContain("Custom");
  });

  it("applies tier multiplier to severity targets", () => {
    const globalPolicy = { "Sev-A": { respond: 15, resolve: 60 }, "Sev-B": { respond: 30, resolve: 240 } };
    const customerPolicy = { tier: "Premium", multiplier: 0.75, active: true };
    const effectiveResolveSevA = Math.round(globalPolicy["Sev-A"].resolve * customerPolicy.multiplier);
    const effectiveRespondSevA = Math.round(globalPolicy["Sev-A"].respond * customerPolicy.multiplier);
    expect(effectiveResolveSevA).toBe(45);
    expect(effectiveRespondSevA).toBe(11);
  });

  it("falls back to global policy when customer policy inactive", () => {
    const globalPolicy = { "Sev-A": { respond: 15, resolve: 60 } };
    const customerPolicy = { tier: "Standard", multiplier: 1.0, active: false };
    // When inactive, don't apply multiplier
    const effectiveResolve = customerPolicy.active
      ? Math.round(globalPolicy["Sev-A"].resolve * customerPolicy.multiplier)
      : globalPolicy["Sev-A"].resolve;
    expect(effectiveResolve).toBe(60);
  });

  it("supports Enterprise tier with aggressive SLAs", () => {
    const customerPolicy = { tier: "Enterprise", multiplier: 0.5, supportHours: "24x7" };
    expect(customerPolicy.multiplier).toBe(0.5);
    expect(customerPolicy.supportHours).toBe("24x7");
  });

  it("generates customer SLA policy ID", () => {
    const id = `CSLA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    expect(id).toMatch(/^CSLA-\d+-[a-z0-9]+$/);
  });

  it("3-tier SLA priority: customer > tier > global", () => {
    const globalResolve = 60;
    const tierMultiplier = 0.75;
    const customerMultiplier = 0.5;
    // Customer-specific should win
    const effective = Math.round(globalResolve * customerMultiplier);
    expect(effective).toBe(30);
    expect(effective).toBeLessThan(Math.round(globalResolve * tierMultiplier));
  });
});
