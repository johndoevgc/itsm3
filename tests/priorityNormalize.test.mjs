import { describe, it, expect } from "vitest";
import {
  normalizePriority,
  priorityToPCode,
  priorityToZendesk,
  isMajorPriority,
  FALLBACK_PRIORITY,
  SEV_VALUES,
} from "../src/utils/priorityNormalize.cjs";

describe("normalizePriority", () => {
  it("returns canonical Sev-* unchanged", () => {
    for (const sev of SEV_VALUES) expect(normalizePriority(sev)).toBe(sev);
  });

  it("maps P-codes to Sev-*", () => {
    expect(normalizePriority("P1")).toBe("Sev-A");
    expect(normalizePriority("P2")).toBe("Sev-B");
    expect(normalizePriority("P3")).toBe("Sev-C");
    expect(normalizePriority("P4")).toBe("Sev-D");
  });

  it("maps human/Zendesk-style names", () => {
    expect(normalizePriority("Critical")).toBe("Sev-A");
    expect(normalizePriority("urgent")).toBe("Sev-A");
    expect(normalizePriority("HIGH")).toBe("Sev-B");
    expect(normalizePriority("Normal")).toBe("Sev-C");
    expect(normalizePriority("Medium")).toBe("Sev-C");
    expect(normalizePriority("low")).toBe("Sev-D");
    expect(normalizePriority("informational")).toBe("Sev-D");
  });

  it("maps numeric and Sev1..4 forms", () => {
    expect(normalizePriority("Sev1")).toBe("Sev-A");
    expect(normalizePriority("sev-2")).toBe("Sev-B");
    expect(normalizePriority(3)).toBe("Sev-C");
    expect(normalizePriority("4")).toBe("Sev-D");
  });

  it("handles whitespace, casing and punctuation variants", () => {
    expect(normalizePriority("  p1 ")).toBe("Sev-A");
    expect(normalizePriority("p-2")).toBe("Sev-B");
    expect(normalizePriority("Priority3")).toBe("Sev-C");
    expect(normalizePriority(" Sev A ")).toBe("Sev-A");
  });

  it("falls back to Sev-C for missing or unknown input", () => {
    expect(normalizePriority(null)).toBe(FALLBACK_PRIORITY);
    expect(normalizePriority(undefined)).toBe(FALLBACK_PRIORITY);
    expect(normalizePriority("")).toBe(FALLBACK_PRIORITY);
    expect(normalizePriority("   ")).toBe(FALLBACK_PRIORITY);
    expect(normalizePriority("nonsense")).toBe(FALLBACK_PRIORITY);
    expect(normalizePriority({})).toBe(FALLBACK_PRIORITY);
    expect(normalizePriority([])).toBe(FALLBACK_PRIORITY);
  });
});

describe("priorityToPCode", () => {
  it("returns the P-code for any input", () => {
    expect(priorityToPCode("Sev-A")).toBe("P1");
    expect(priorityToPCode("urgent")).toBe("P1");
    expect(priorityToPCode("high")).toBe("P2");
    expect(priorityToPCode("normal")).toBe("P3");
    expect(priorityToPCode("low")).toBe("P4");
    expect(priorityToPCode(undefined)).toBe("P3");
  });
});

describe("priorityToZendesk", () => {
  it("returns Zendesk-style name", () => {
    expect(priorityToZendesk("P1")).toBe("urgent");
    expect(priorityToZendesk("Sev-B")).toBe("high");
    expect(priorityToZendesk("Sev-C")).toBe("normal");
    expect(priorityToZendesk("Sev-D")).toBe("low");
    expect(priorityToZendesk(null)).toBe("normal");
  });
});

describe("isMajorPriority", () => {
  it("is true only for Sev-A/B class inputs", () => {
    expect(isMajorPriority("P1")).toBe(true);
    expect(isMajorPriority("Critical")).toBe(true);
    expect(isMajorPriority("Sev-B")).toBe(true);
    expect(isMajorPriority("high")).toBe(true);
    expect(isMajorPriority("P3")).toBe(false);
    expect(isMajorPriority("low")).toBe(false);
    expect(isMajorPriority(null)).toBe(false);
  });
});
