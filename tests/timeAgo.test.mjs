import { describe, expect, it } from "vitest";
import { timeAgo } from "../src/utils/slaHelpers.js";

describe("timeAgo", () => {
  it("accepts a number of hours", () => {
    expect(timeAgo(0.5)).toBe("30m ago");
    expect(timeAgo(2)).toBe("2h ago");
    expect(timeAgo(48)).toBe("2d ago");
  });

  it("accepts an ISO date string (most callers pass inc.created)", () => {
    const iso = new Date(Date.now() - 3 * 86400000).toISOString();
    expect(timeAgo(iso)).toBe("3d ago");
  });

  it("accepts a Date instance", () => {
    expect(timeAgo(new Date(Date.now() - 5 * 3600000))).toBe("5h ago");
  });

  it("returns '—' for null/undefined/invalid (was 'NaNd ago')", () => {
    expect(timeAgo(null)).toBe("—");
    expect(timeAgo(undefined)).toBe("—");
    expect(timeAgo("")).toBe("—");
    expect(timeAgo("not-a-date")).toBe("—");
    expect(timeAgo(NaN)).toBe("—");
  });

  it("clamps negative to 0m", () => {
    expect(timeAgo(-1)).toBe("0m ago");
  });
});
