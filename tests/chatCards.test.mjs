import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const chatCards = require("../src/utils/chatCards.cjs");

const { buildAdaptiveCard, buildSmsText, resolveSmsReply, _internal } = chatCards;

describe("chatCards.buildAdaptiveCard", () => {
  it("renders a plain text message as a TextBlock", () => {
    const card = buildAdaptiveCard({ text: "Hello there", type: "text" });
    expect(card.type).toBe("AdaptiveCard");
    expect(card.version).toBe("1.5");
    expect(card.body).toEqual([{ type: "TextBlock", text: "Hello there", wrap: true, size: "Default" }]);
    expect(card.actions).toEqual([]);
  });

  it("renders ≤6 quick-reply options as Action.Submit buttons", () => {
    const card = buildAdaptiveCard({
      text: "Pick one",
      type: "quick-reply",
      kind: "pick-priority",
      options: [
        { value: "high", label: "High", icon: "🔴" },
        { value: "low", label: "Low" },
      ],
    });
    expect(card.actions).toHaveLength(2);
    expect(card.actions[0]).toEqual({
      type: "Action.Submit",
      title: "🔴 High",
      data: { verb: "submit", kind: "pick-priority", value: "high" },
    });
    expect(card.actions[1].data.value).toBe("low");
  });

  it("renders >6 options as a ChoiceSet", () => {
    const opts = Array.from({ length: 9 }, (_, i) => ({ value: `v${i}`, label: `Label ${i}` }));
    const card = buildAdaptiveCard({ text: "Many", type: "category-grid", kind: "select-category", options: opts });
    const choiceSet = card.body.find(b => b.type === "Input.ChoiceSet");
    expect(choiceSet).toBeTruthy();
    expect(choiceSet.choices).toHaveLength(9);
    expect(card.actions).toHaveLength(1);
    expect(card.actions[0].data.kind).toBe("select-category");
  });

  it("caps options to MAX_OPTIONS", () => {
    const opts = Array.from({ length: 30 }, (_, i) => ({ value: `v${i}`, label: `Label ${i}` }));
    const card = buildAdaptiveCard({ text: "Cap me", type: "category-grid", kind: "x", options: opts });
    const choiceSet = card.body.find(b => b.type === "Input.ChoiceSet");
    expect(choiceSet.choices.length).toBe(_internal.MAX_OPTIONS);
  });

  it("auto-renders csat-rate as five star buttons when no options provided", () => {
    const card = buildAdaptiveCard({ text: "Rate us", kind: "csat-rate" });
    expect(card.actions).toHaveLength(5);
    expect(card.actions[0].title).toBe("★★★★★");
    expect(card.actions[4].data.value).toBe("1");
  });

  it("returns null for empty/invalid input", () => {
    expect(buildAdaptiveCard(null)).toBeNull();
    expect(buildAdaptiveCard({})).toBeNull();
  });

  it("truncates body text to maxReplyChars", () => {
    const long = "x".repeat(5000);
    const card = buildAdaptiveCard({ text: long, type: "text" }, { maxReplyChars: 100 });
    expect(card.body[0].text.length).toBeLessThanOrEqual(100);
    expect(card.body[0].text.endsWith("…")).toBe(true);
  });

  it("filters malformed options", () => {
    const card = buildAdaptiveCard({
      text: "Pick", type: "quick-reply", kind: "k",
      options: [null, { value: "" }, { label: "ok" }, { value: "v", label: "Yes" }],
    });
    // Only "ok" (label-only → value=label) and "v"/"Yes" should remain.
    expect(card.actions).toHaveLength(2);
  });
});

describe("chatCards.buildSmsText", () => {
  it("collapses options to a numbered list with reply prompt", () => {
    const out = buildSmsText({
      text: "What's wrong?", type: "quick-reply",
      options: [{ value: "vpn", label: "VPN issue" }, { value: "email", label: "Email problem" }],
    });
    expect(out.text).toMatch(/Reply with a number/);
    expect(out.text).toMatch(/1\)\. VPN issue/);
    expect(out.text).toMatch(/2\)\. Email problem/);
    expect(out.options).toHaveLength(2);
    expect(out.options[0].smsIndex).toBe(1);
  });

  it("returns plain text with no options when none provided", () => {
    const out = buildSmsText({ text: "Acknowledged.", type: "text" });
    expect(out.options).toEqual([]);
    expect(out.text).toBe("Acknowledged.");
  });

  it("respects maxLen budget", () => {
    const out = buildSmsText({ text: "x".repeat(2000), type: "text" }, { maxLen: 200 });
    expect(out.text.length).toBeLessThanOrEqual(200);
  });

  it("caps at 9 numbered options (single-digit fit)", () => {
    const opts = Array.from({ length: 12 }, (_, i) => ({ value: `v${i}`, label: `Opt${i}` }));
    const out = buildSmsText({ text: "Pick", type: "quick-reply", options: opts });
    expect(out.options.length).toBeLessThanOrEqual(9);
  });
});

describe("chatCards.resolveSmsReply", () => {
  const opts = [
    { value: "a", label: "Apple", smsIndex: 1 },
    { value: "b", label: "Banana", smsIndex: 2 },
  ];

  it("returns the matching option for a numeric reply", () => {
    expect(resolveSmsReply("1", opts).value).toBe("a");
    expect(resolveSmsReply("2 thanks", opts).value).toBe("b");
  });

  it("returns null for invalid replies", () => {
    expect(resolveSmsReply("xyz", opts)).toBeNull();
    expect(resolveSmsReply("3", opts)).toBeNull();
    expect(resolveSmsReply("0", opts)).toBeNull();
    expect(resolveSmsReply("", opts)).toBeNull();
    expect(resolveSmsReply("1", [])).toBeNull();
  });
});
