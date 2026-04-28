// ─── Theme: Named Color & Style Constants ───────────────────────────────
export const COLORS = {
  // Primary palette
  primary:       "#818CF8",  // Indigo 400 — brand accent, active states, links
  primaryDark:   "#6366F1",  // Indigo 500 — hover states
  primaryMuted:  "#6366F120", // Translucent indigo for backgrounds
  accent:        "#22D3EE",  // Cyan 400 — secondary accent, info badges
  // Severity / status
  critical:      "#FF4444",  // Sev-A, errors, breaches
  high:          "#FF6B6B",  // Sev-B, warnings
  warning:       "#FFB347",  // Amber — Sev-C, caution, pending
  success:       "#81C784",  // Green — resolved, healthy, Sev-D
  successDark:   "#4CAF50",  // Darker green for buttons
  info:          "#64B5F6",  // Light blue — informational
  pink:          "#EC4899",  // Pink — admin, approvals
  purple:        "#CE93D8",  // Purple — problem management
  // Surface / background
  bgDeep:        "#09090B",  // Zinc 950 — deepest background
  bgDark:        "#0C0D12",  // Slightly lifted dark background
  bgCard:        "#141419",  // Card background
  bgPanel:       "#18181B",  // Zinc 900 — panel / sidebar background
  bgInput:       "#111114",  // Input field background
  bgHover:       "#1C1C22",  // Hover state background
  // Text
  textPrimary:   "#FAFAFA",  // Zinc 50 — primary text
  textSecondary: "#A1A1AA",  // Zinc 400 — secondary / muted text
  textDim:       "#71717A",  // Zinc 500 — dimmer text
  textSubtle:    "#D4D4D8",  // Zinc 300 — subtle / placeholder text
  textMuted:     "#D4D4D8",  // Medium-emphasis text
  // Borders
  border:        "#27272A",  // Zinc 800 — default border
  borderLight:   "#3F3F4622", // Semi-transparent border
  borderAccent:  "#6366F133", // Accent border for focus states
  // External brand colors
  microsoft:     "#0078D4",  // Microsoft blue
  teams:         "#6264A7",  // Teams purple
  white:         "#FFFFFF",
  black:         "#000000",
};

// ─── Style Constants ─────────────────────────────────────────────────────
export const PRIORITY_COLORS = {
  "Sev-A": { bg: "#2D0A0A", text: "#FF6B6B", border: "#FF6B6B", dot: "#FF4444", label: "CRITICAL" },
  "Sev-B": { bg: "#2D1F0A", text: "#FFB347", border: "#FFB347", dot: "#FF9500", label: "HIGH" },
  "Sev-C": { bg: "#0A1E2D", text: "#64B5F6", border: "#64B5F6", dot: "#2196F3", label: "MEDIUM" },
  "Sev-D": { bg: "#0A2D1A", text: "#81C784", border: "#81C784", dot: "#4CAF50", label: "LOW / INQUIRY" },
};

export const STATUS_COLORS = {
  "New": { bg: "#1A0A2D", text: "#CE93D8" },
  "Open": { bg: "#1A1A2E", text: "#A0AEC0" },
  "In Progress": { bg: "#0D2137", text: "#64B5F6" },
  "Pending": { bg: "#2D1F0A", text: "#FFB347" },
  "On Hold": { bg: "#2D0A0A", text: "#FF6B6B" },
  "Resolved": { bg: "#0D2D1A", text: "#81C784" },
  "Closed": { bg: "#1A1A1A", text: "#666" },
  "Reopened": { bg: "#2D0A2D", text: "#EC4899" },
  "Pending Approval": { bg: "#2D1F0A", text: "#FFB347" },
  "Awaiting Approval": { bg: "#2D1F0A", text: "#FFB347" },
  "Approved": { bg: "#0D2D1A", text: "#81C784" },
  "Implementing": { bg: "#0D2137", text: "#64B5F6" },
  "Fulfilled": { bg: "#0D2D1A", text: "#81C784" },
  "Under Investigation": { bg: "#0D2137", text: "#64B5F6" },
  "Root Cause Identified": { bg: "#2D1F0A", text: "#FFB347" },
  "Known Error": { bg: "#2D0A2D", text: "#CE93D8" },
  "Active": { bg: "#0D2D1A", text: "#81C784" },
  "In Use": { bg: "#0D2137", text: "#64B5F6" },
  "In Stock": { bg: "#1A1A2E", text: "#A0AEC0" },
  "Retired": { bg: "#1A1A1A", text: "#666" },
  "Running": { bg: "#0D2D1A", text: "#81C784" },
};

export const PERM_COLORS = {
  full: { bg: "#0D2D1A", text: "#81C784" }, manage: { bg: "#0D2137", text: "#64B5F6" },
  edit: { bg: "#2D1F0A", text: "#FFB347" }, publish: { bg: "#1A0A2D", text: "#CE93D8" },
  contribute: { bg: "#0A1E2D", text: "#06B6D4" }, approve: { bg: "#2D0A2D", text: "#EC4899" },
  submit: { bg: "#1A1A2E", text: "#A0AEC0" }, fulfill: { bg: "#0D2D1A", text: "#81C784" },
  use: { bg: "#6366F111", text: "#6366F1" }, create: { bg: "#0A2D1A", text: "#81C784" },
  view: { bg: "#1A1A2E", text: "#A0AEC0" }, limited: { bg: "#2D1F0A", text: "#FFB347" },
  none: { bg: "#2D0A0A", text: "#FF6B6B33" },
};

export const inputStyle = {
  width: "100%", padding: "9px 12px", background: "#09090B",
  border: "1px solid #27272A", borderRadius: "8px", color: "#FAFAFA",
  fontSize: "13px", outline: "none", fontFamily: "inherit", boxSizing: "border-box",
  transition: "border-color 0.15s"
};

export const btnStyle = (accent = "#818CF8") => ({
  padding: "9px 20px", background: accent, color: "#fff",
  border: "none", borderRadius: "8px", cursor: "pointer",
  fontSize: "13px", fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif",
  transition: "opacity 0.15s, transform 0.15s, box-shadow 0.15s",
  boxShadow: `0 2px 8px ${accent}33`,
});
