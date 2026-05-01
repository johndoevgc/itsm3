import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createZendeskRoutes = require("../routes/zendesk.js");
const { buildZendeskSafeSolveDecision, buildZendeskSafeSolveApplyPayload } = createZendeskRoutes._internals;

describe("Zendesk AI Safe Solve policy", () => {
  it("allows high-confidence routine Sev-C tickets", () => {
    const decision = buildZendeskSafeSolveDecision({
      triage: {
        category: "Access/Identity",
        priority: "normal",
        sla_priority: "Sev-C",
        confidence: 94,
        auto_sendable: true,
        routine: true,
        sentiment: "neutral",
        sentimentScore: 5,
        resolution: "Password reset was completed and MFA enrollment steps were verified with the standard access recovery procedure.",
        customer_response: "Your password reset request has been completed. Please sign in and confirm MFA when prompted.",
      },
      ticket: { id: 8388, subject: "Password reset request", priority: "normal", created_at: new Date(Date.now() - 10 * 60_000).toISOString(), tags: ["access"] },
      requester: { email: "real.customer@example.com" },
      customerRedirectTarget: "johndoe@vgcsg.com",
      emailRedirectMode: true,
      options: { confidenceThreshold: 90, sendCustomerEmail: true },
    });

    expect(decision.eligible).toBe(true);
    expect(decision.decision).toBe("safe_pending");
    expect(decision.blockedReasons).toEqual([]);
    expect(decision.safeCustomerContact.publicZendeskComment).toBe(false);
    expect(decision.safeCustomerContact.customerEmailTarget).toBe("johndoe@vgcsg.com");
    expect(decision.plannedActions).toContain("send_customer_email_to_johndoe@vgcsg.com");
  });

  it("blocks security or high-priority tickets from auto-solve", () => {
    const decision = buildZendeskSafeSolveDecision({
      triage: {
        category: "Security",
        priority: "urgent",
        sla_priority: "Sev-A",
        confidence: 98,
        auto_sendable: true,
        routine: true,
        sentiment: "neutral",
        sentimentScore: 5,
        resolution: "A security issue was detected and needs containment steps before any customer-facing closure can happen.",
      },
      ticket: { id: 8388, subject: "Possible phishing breach", priority: "urgent", created_at: new Date().toISOString(), tags: ["phishing"] },
      requester: { email: "real.customer@example.com" },
      customerRedirectTarget: "johndoe@vgcsg.com",
    });

    expect(decision.eligible).toBe(false);
    expect(decision.blockedReasons).toContain("major_priority_requires_review");
    expect(decision.blockedReasons).toContain("sensitive_or_high_risk_keywords");
    expect(decision.plannedActions).toContain("queue_for_engineer_review");
  });

  it("builds an internal-only Zendesk apply payload", () => {
    const decision = buildZendeskSafeSolveDecision({
      triage: {
        category: "Email",
        priority: "normal",
        sla_priority: "Sev-C",
        confidence: 96,
        auto_sendable: true,
        routine: true,
        resolution: "The shared mailbox access was verified and the standard Outlook profile refresh steps were completed successfully.",
        customer_response: "Shared mailbox access has been refreshed. Please restart Outlook and confirm the mailbox appears.",
      },
      ticket: { id: 8388, subject: "Shared mailbox access", priority: "normal", created_at: new Date().toISOString() },
      customerRedirectTarget: "johndoe@vgcsg.com",
      options: { confidenceThreshold: 90 },
    });
    const payload = buildZendeskSafeSolveApplyPayload(decision, { requestedBy: "AI Test" });

    expect(payload.ticket.status).toBe("solved");
    expect(payload.ticket.comment.public).toBe(false);
    expect(payload.ticket.comment.body).toContain("Customer contact: no public Zendesk comment");
    expect(payload.ticket.comment.body).toContain("johndoe@vgcsg.com");
  });
});