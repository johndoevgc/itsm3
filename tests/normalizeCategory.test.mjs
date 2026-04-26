import { describe, it, expect } from "vitest";

// Extract normalizeCategory for testing — mirrors server.js implementation
function normalizeCategory(cat) {
  const c = (cat || "General").toLowerCase();
  if (c.includes("network") || c.includes("connectivity") || c.includes("vpn") || c.includes("firewall") || c.includes("dns") || c.includes("dhcp") || c.includes("ip address") || /\blan\b/.test(c) || /\bwan\b/.test(c)) return "Network";
  if (c.includes("hardware") || c.includes("laptop") || c.includes("desktop") || c.includes("device") || c.includes("monitor") || c.includes("keyboard") || c.includes("mouse") || c.includes("dock")) return "Hardware";
  if (c.includes("security") || c.includes("phishing") || c.includes("malware") || c.includes("virus") || c.includes("vulnerability") || c.includes("attack") || c.includes("threat") || c.includes("defender")) return "Security";
  if (c.includes("print") || c.includes("scanner") || c.includes("fax")) return "Printing";
  if (c.includes("email") || c.includes("outlook") || c.includes("exchange") || c.includes("mail")) return "Email";
  if (c.includes("access") || c.includes("password") || c.includes("login") || c.includes("locked") || c.includes("permission") || c.includes("mfa") || c.includes("identity") || c.includes("certificate")) return "Access/Identity";
  if (c.includes("cloud") || c.includes("azure") || c.includes("m365") || c.includes("microsoft") || c.includes("saas") || c.includes("subscription") || c.includes("license") || c.includes("licensing")) return "Cloud";
  if (c.includes("service request") || c.includes("service catalog") || c.includes("service level") || c.includes("service management") || c.includes("change enablement") || c.includes("change management") || c.includes("request fulfilment") || c.includes("request fulfillment")) return "Service Request";
  if (c.includes("software") || c.includes("application") || c.includes("install") || c.includes("update") || c.includes("patch") || c.includes("browser")) return "Software";
  if (c.includes("end user") || c.includes("workstation") || c.includes("onboard") || c.includes("setup") || c.includes("provisioning") || c.includes("user account")) return "End User Computing";
  return "General";
}

describe("normalizeCategory", () => {
  it("maps network-related freeform categories to Network", () => {
    expect(normalizeCategory("VPN Connectivity Issue")).toBe("Network");
    expect(normalizeCategory("DNS Resolution Failure")).toBe("Network");
    expect(normalizeCategory("Firewall Rule Change")).toBe("Network");
    expect(normalizeCategory("LAN port not working")).toBe("Network");
    expect(normalizeCategory("WAN link down")).toBe("Network");
    expect(normalizeCategory("DHCP lease expired")).toBe("Network");
  });

  it("maps hardware-related freeform categories to Hardware", () => {
    expect(normalizeCategory("Laptop Screen Broken")).toBe("Hardware");
    expect(normalizeCategory("Desktop won't boot")).toBe("Hardware");
    expect(normalizeCategory("Monitor Flickering")).toBe("Hardware");
    expect(normalizeCategory("Keyboard not responding")).toBe("Hardware");
    expect(normalizeCategory("Docking Station Issue")).toBe("Hardware");
  });

  it("maps printing-related freeform categories to Printing", () => {
    expect(normalizeCategory("Printer Offline")).toBe("Printing");
    expect(normalizeCategory("Scanner not detected")).toBe("Printing");
    expect(normalizeCategory("Fax transmission failure")).toBe("Printing");
    expect(normalizeCategory("Print queue stuck")).toBe("Printing");
  });

  it("maps security-related freeform categories to Security", () => {
    expect(normalizeCategory("Phishing Email Reported")).toBe("Security");
    expect(normalizeCategory("Malware Detected on Endpoint")).toBe("Security");
    expect(normalizeCategory("Vulnerability Scan Failed")).toBe("Security");
    expect(normalizeCategory("Threat Detection Alert")).toBe("Security");
    expect(normalizeCategory("Windows Defender issue")).toBe("Security");
  });

  it("maps email-related freeform categories to Email", () => {
    expect(normalizeCategory("Outlook Crash on Startup")).toBe("Email");
    expect(normalizeCategory("Exchange Mailbox Full")).toBe("Email");
    expect(normalizeCategory("Email delivery delayed")).toBe("Email");
  });

  it("maps access-related freeform categories to Access/Identity", () => {
    expect(normalizeCategory("Password Reset Request")).toBe("Access/Identity");
    expect(normalizeCategory("Account Locked Out")).toBe("Access/Identity");
    expect(normalizeCategory("MFA Token Expired")).toBe("Access/Identity");
    expect(normalizeCategory("Login Failed")).toBe("Access/Identity");
    expect(normalizeCategory("Permission Denied")).toBe("Access/Identity");
    expect(normalizeCategory("Certificate Renewal")).toBe("Access/Identity");
  });

  it("maps cloud-related freeform categories to Cloud", () => {
    expect(normalizeCategory("Azure VM Not Responding")).toBe("Cloud");
    expect(normalizeCategory("M365 License Assignment")).toBe("Cloud");
    expect(normalizeCategory("SaaS Application Down")).toBe("Cloud");
    expect(normalizeCategory("Licensing Issue")).toBe("Cloud");
  });

  it("maps software-related freeform categories to Software", () => {
    expect(normalizeCategory("Application Installation Failed")).toBe("Software");
    expect(normalizeCategory("Browser Extension Conflict")).toBe("Software");
    expect(normalizeCategory("Software Update Required")).toBe("Software");
    expect(normalizeCategory("Patch Deployment Failed")).toBe("Software");
  });

  it("maps end-user-computing freeform categories", () => {
    expect(normalizeCategory("End User Workstation Setup")).toBe("End User Computing");
    expect(normalizeCategory("New Employee Onboarding IT")).toBe("End User Computing");
    expect(normalizeCategory("User Account Provisioning")).toBe("End User Computing");
  });

  it("maps service-request freeform categories", () => {
    expect(normalizeCategory("Service Request Fulfilment")).toBe("Service Request");
    expect(normalizeCategory("Change Management Approval")).toBe("Service Request");
    expect(normalizeCategory("Service Catalog Update")).toBe("Service Request");
  });

  it("returns General for unknown categories", () => {
    expect(normalizeCategory("Miscellaneous")).toBe("General");
    expect(normalizeCategory("Unknown Issue Type")).toBe("General");
    expect(normalizeCategory("")).toBe("General");
    expect(normalizeCategory(null)).toBe("General");
    expect(normalizeCategory(undefined)).toBe("General");
  });

  it("is case-insensitive", () => {
    expect(normalizeCategory("NETWORK OUTAGE")).toBe("Network");
    expect(normalizeCategory("hardware failure")).toBe("Hardware");
    expect(normalizeCategory("PHISHING Attack")).toBe("Security");
  });
});
