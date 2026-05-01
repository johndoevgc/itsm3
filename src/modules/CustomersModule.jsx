import React, { useState } from "react";
import {
  COLORS, inputStyle, btnStyle,
} from "../constants/theme.js";
import {
  RBAC_PERMISSIONS,
} from "../constants/rbac.js";
import { sanitizeHTML } from "../utils/slaHelpers.js";
import {
  Badge, Modal, FormField, SearchBar,
} from "../components/SharedComponents.jsx";

// Customer Management module — extracted from itsm-tool.jsx
export default function CustomersModule({ ctx }) {
  const {
    currentUser, showToast, _save,
    customers, setCustomers,
    incidents, requests,
    customerSearch, setCustomerSearch,
    customerCategoryFilter, setCustomerCategoryFilter,
    customerStatusFilter, setCustomerStatusFilter,
    showAddCustomer, setShowAddCustomer,
    customerForm, setCustomerForm,
    editingCustomerId, setEditingCustomerId,
    softDelete = () => {},
    isLocalDemoUser = false,
  } = ctx;
  const [customerViewMode, setCustomerViewMode] = useState("list");

const perms = RBAC_PERMISSIONS[currentUser?.rbacRole] || {};
const canEdit = ["full","manage","edit"].includes(perms.customers);
const filtered = customers.filter(c => {
  const matchSearch = !customerSearch || (c.name || "").toLowerCase().includes(customerSearch.toLowerCase()) || (c.contactPerson || "").toLowerCase().includes(customerSearch.toLowerCase()) || (c.email || "").toLowerCase().includes(customerSearch.toLowerCase());
  const matchCat = customerCategoryFilter === "All" || c.category === customerCategoryFilter;
  const matchStatus = customerStatusFilter === "All" || c.status === customerStatusFilter;
  return matchSearch && matchCat && matchStatus;
});
const adHocCount = customers.filter(c => c.category === "Ad-Hoc").length;
const cspCount = customers.filter(c => c.category === "CSP").length;
const activeCount = customers.filter(c => c.status === "Active").length;
const resetForm = () => setCustomerForm({ name: "", category: "Ad-Hoc", contactPerson: "", email: "", phone: "", address: "", status: "Active", contractStart: "", contractEnd: "", services: [], notes: "" });
const openAdd = () => { resetForm(); setEditingCustomerId(null); setShowAddCustomer(true); };
const openEdit = (cust) => {
  setCustomerForm({ name: cust.name, category: cust.category, contactPerson: cust.contactPerson, email: cust.email, phone: cust.phone, address: cust.address, status: cust.status, contractStart: cust.contractStart || "", contractEnd: cust.contractEnd || "", services: cust.services || [], notes: cust.notes || "" });
  setEditingCustomerId(cust.id); setShowAddCustomer(true);
};
const handleSave = () => {
  if (!customerForm.name || !customerForm.contactPerson || !customerForm.email) return;
  if (editingCustomerId) {
    setCustomers(prev => prev.map(c => c.id === editingCustomerId ? { ...c, ...customerForm } : c));
  } else {
    const newId = "CUS" + String(customers.length + 1).padStart(3, "0");
    setCustomers(prev => [...prev, { id: newId, ...customerForm, createdBy: currentUser?.name || "System", createdAt: new Date().toISOString().slice(0, 10) }]);
  }
  setShowAddCustomer(false); resetForm(); setEditingCustomerId(null);
};
const handleDelete = (id) => { const item = customers.find(c => c.id === id); if (item) softDelete("customers", item, setCustomers, "vgc_customers"); };
const [svcInput, setSvcInput] = useState("");

return (
  <div style={{ padding: 0 }}>
    {/* Stats Row */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
      {[
        { label: "Total Customers", value: customers.length, accent: "#6366F1", icon: "🏢" },
        { label: "Ad-Hoc Customers", value: adHocCount, accent: "#FFB347", icon: "⚡" },
        { label: "CSP Customers", value: cspCount, accent: "#06B6D4", icon: "☁️" },
        { label: "Active", value: activeCount, accent: "#81C784", icon: "✓" },
      ].map((s, i) => (
        <div key={i} style={{ padding: "16px 18px", background: "#0F1117", borderRadius: 10, border: `1px solid ${s.accent}33` }}>
          <div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>{s.icon} {s.label}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: s.accent }}>{s.value}</div>
        </div>
      ))}
    </div>

    {/* Toolbar */}
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
      <SearchBar value={customerSearch} onChange={setCustomerSearch} placeholder="Search customers..." />
      <select value={customerCategoryFilter} onChange={e => setCustomerCategoryFilter(e.target.value)} style={{ ...inputStyle, width: 140 }}>
        <option value="All">All Categories</option>
        <option value="Ad-Hoc">Ad-Hoc</option>
        <option value="CSP">CSP</option>
      </select>
      <select value={customerStatusFilter} onChange={e => setCustomerStatusFilter(e.target.value)} style={{ ...inputStyle, width: 130 }}>
        <option value="All">All Status</option>
        <option value="Active">Active</option>
        <option value="Inactive">Inactive</option>
      </select>
      <div style={{ display: "flex", gap: 4, background: "#0F1117", borderRadius: 6, border: "1px solid #1E2130", padding: 2 }}>
        {["table","cards"].map(v => (
          <button key={v} onClick={() => setCustomerViewMode(v)} style={{ padding: "5px 12px", borderRadius: 4, border: "none", background: customerViewMode === v ? "#6366F1" : "transparent", color: customerViewMode === v ? "#fff" : "#5A6178", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>{v === "table" ? "☰ Table" : "▦ Cards"}</button>
        ))}
      </div>
      {canEdit && <button onClick={openAdd} style={{ ...btnStyle("#6366F1"), fontSize: 12, padding: "8px 16px" }}>+ Add Customer</button>}
      <button onClick={() => {
        if (isLocalDemoUser) { showToast("Demo mode — Zendesk import unavailable", "info"); return; }
        fetch("/api/zendesk/organizations").then(r => r.json()).then(data => {
          const orgs = data.organizations || [];
          if (orgs.length === 0) return;
          let imported = 0;
          orgs.forEach(org => {
            const exists = customers.some(c => c.zdOrgId === org.id || (c.name || "").toLowerCase() === (org.name || "").toLowerCase());
            if (!exists) {
              imported++;
              const newCust = {
                id: "CUS" + String(customers.length + imported).padStart(3, "0"),
                name: org.name, category: org.tags?.includes("csp") ? "CSP" : "Ad-Hoc",
                contactPerson: org.details || "—", email: org.domain_names?.[0] ? `contact@${org.domain_names[0]}` : "—",
                phone: "—", address: "—", status: "Active",
                contractStart: "", contractEnd: "",
                services: org.tags || [], notes: org.notes || "",
                createdBy: "Zendesk Sync", createdAt: new Date().toISOString().slice(0, 10),
                zdOrgId: org.id, zdOrgUrl: org.url
              };
              setCustomers(prev => [...prev, newCust]);
            }
          });
          // Update existing customers with zdOrgId for future syncs
          orgs.forEach(org => {
            setCustomers(prev => prev.map(c => {
              if (!c.zdOrgId && (c.name || "").toLowerCase() === (org.name || "").toLowerCase()) {
                return { ...c, zdOrgId: org.id, zdOrgUrl: org.url };
              }
              return c;
            }));
          });
        }).catch(() => {});
      }} style={{ ...btnStyle("#EC4899"), fontSize: 11, padding: "8px 14px", display: "flex", alignItems: "center", gap: 4 }}>🎫 Sync Zendesk Orgs</button>
    </div>

    {/* Table View */}
    {customerViewMode === "table" ? (
      <div style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1E2130" }}>
              {["ID","Company Name","Category","Contact Person","Email","Phone","Status","Actions"].map(h => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "#5A6178", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} style={{ borderBottom: "1px solid #1E213066" }}>
                <td style={{ padding: "10px 12px", color: "#6366F1", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                  {c.id}
                  {c.zdOrgId && <span style={{ marginLeft: 4, fontSize: 8, padding: "1px 4px", borderRadius: 3, background: "#EC489918", color: "#EC4899", fontWeight: 600 }}>ZD</span>}
                </td>
                <td style={{ padding: "10px 12px", color: "#E8ECF4", fontWeight: 600 }}>{sanitizeHTML(c.name)}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: 10, fontWeight: 600, background: c.category === "CSP" ? "#06B6D422" : "#FFB34722", color: c.category === "CSP" ? "#06B6D4" : "#FFB347", border: `1px solid ${c.category === "CSP" ? "#06B6D444" : "#FFB34744"}` }}>{c.category}</span>
                </td>
                <td style={{ padding: "10px 12px", color: "#C4CAD6" }}>{sanitizeHTML(c.contactPerson)}</td>
                <td style={{ padding: "10px 12px", color: "#8B8FA3", fontSize: 11 }}>{sanitizeHTML(c.email)}</td>
                <td style={{ padding: "10px 12px", color: "#8B8FA3", fontSize: 11 }}>{sanitizeHTML(c.phone)}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: 10, fontWeight: 600, background: c.status === "Active" ? "#81C78422" : "#FF6B6B22", color: c.status === "Active" ? "#81C784" : "#FF6B6B" }}>{c.status}</span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {canEdit && <button onClick={() => openEdit(c)} style={{ padding: "3px 8px", borderRadius: 4, background: "#6366F111", border: "1px solid #6366F133", color: "#6366F1", fontSize: 10, cursor: "pointer" }}>✏️ Edit</button>}
                    {canEdit && <button onClick={() => handleDelete(c.id)} style={{ padding: "3px 8px", borderRadius: 4, background: "#FF6B6B11", border: "1px solid #FF6B6B33", color: "#FF6B6B", fontSize: 10, cursor: "pointer" }}>🗑️</button>}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={8} style={{ padding: 30, textAlign: "center", color: "#5A6178" }}>No customers found</td></tr>}
          </tbody>
        </table>
      </div>
    ) : (
      /* Card View */
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
        {filtered.map(c => (
          <div key={c.id} style={{ background: "#0F1117", borderRadius: 10, border: `1px solid ${c.category === "CSP" ? "#06B6D433" : "#FFB34733"}`, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", marginBottom: 2 }}>{sanitizeHTML(c.name)}</div>
                <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{c.id}</div>
              </div>
              <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: 10, fontWeight: 600, background: c.category === "CSP" ? "#06B6D422" : "#FFB34722", color: c.category === "CSP" ? "#06B6D4" : "#FFB347" }}>{c.category}</span>
            </div>
            <div style={{ fontSize: 11, color: "#C4CAD6", marginBottom: 4 }}>👤 {sanitizeHTML(c.contactPerson)}</div>
            <div style={{ fontSize: 11, color: "#8B8FA3", marginBottom: 4 }}>📧 {sanitizeHTML(c.email)}</div>
            <div style={{ fontSize: 11, color: "#8B8FA3", marginBottom: 4 }}>📞 {sanitizeHTML(c.phone)}</div>
            <div style={{ fontSize: 11, color: "#8B8FA3", marginBottom: 8 }}>📍 {sanitizeHTML(c.address)}</div>
            {c.services && c.services.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {c.services.map((s, i) => <span key={i} style={{ padding: "2px 8px", borderRadius: 10, fontSize: 9, background: "#6366F122", color: "#6366F1", border: "1px solid #6366F133" }}>{s}</span>)}
              </div>
            )}
            {c.category === "CSP" && c.contractStart && (
              <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 8 }}>📅 {c.contractStart} → {c.contractEnd}</div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: 10, fontWeight: 600, background: c.status === "Active" ? "#81C78422" : "#FF6B6B22", color: c.status === "Active" ? "#81C784" : "#FF6B6B" }}>{c.status}</span>
              {canEdit && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => openEdit(c)} style={{ padding: "3px 8px", borderRadius: 4, background: "#6366F111", border: "1px solid #6366F133", color: "#6366F1", fontSize: 10, cursor: "pointer" }}>✏️ Edit</button>
                  <button onClick={() => handleDelete(c.id)} style={{ padding: "3px 8px", borderRadius: 4, background: "#FF6B6B11", border: "1px solid #FF6B6B33", color: "#FF6B6B", fontSize: 10, cursor: "pointer" }}>🗑️</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    )}

    {/* Add/Edit Modal */}
    {showAddCustomer && (
      <Modal title={editingCustomerId ? "Edit Customer" : "Add New Customer"} onClose={() => { setShowAddCustomer(false); resetForm(); setEditingCustomerId(null); }} width={560}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <FormField label="Company Name *">
            <input value={customerForm.name} onChange={e => setCustomerForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} placeholder="Company legal name" />
          </FormField>
          <FormField label="Category *">
            <select value={customerForm.category} onChange={e => setCustomerForm(f => ({ ...f, category: e.target.value }))} style={inputStyle}>
              <option value="Ad-Hoc">Ad-Hoc</option>
              <option value="CSP">CSP</option>
            </select>
          </FormField>
          <FormField label="Contact Person *">
            <input value={customerForm.contactPerson} onChange={e => setCustomerForm(f => ({ ...f, contactPerson: e.target.value }))} style={inputStyle} placeholder="Primary contact" />
          </FormField>
          <FormField label="Email *">
            <input value={customerForm.email} onChange={e => setCustomerForm(f => ({ ...f, email: e.target.value }))} type="email" style={inputStyle} placeholder="business email" />
          </FormField>
          <FormField label="Phone">
            <input value={customerForm.phone} onChange={e => setCustomerForm(f => ({ ...f, phone: e.target.value }))} style={inputStyle} placeholder="+65 9xxx xxxx" />
          </FormField>
          <FormField label="Status">
            <select value={customerForm.status} onChange={e => setCustomerForm(f => ({ ...f, status: e.target.value }))} style={inputStyle}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </FormField>
        </div>
        <FormField label="Address">
          <input value={customerForm.address} onChange={e => setCustomerForm(f => ({ ...f, address: e.target.value }))} style={inputStyle} placeholder="Registered business address" />
        </FormField>
        {customerForm.category === "CSP" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <FormField label="Contract Start">
              <input type="date" value={customerForm.contractStart} onChange={e => setCustomerForm(f => ({ ...f, contractStart: e.target.value }))} style={inputStyle} />
            </FormField>
            <FormField label="Contract End">
              <input type="date" value={customerForm.contractEnd} onChange={e => setCustomerForm(f => ({ ...f, contractEnd: e.target.value }))} style={inputStyle} />
            </FormField>
          </div>
        )}
        <FormField label="Services">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {(customerForm.services || []).map((s, i) => (
              <span key={i} style={{ padding: "3px 10px", borderRadius: 12, fontSize: 11, background: "#6366F122", color: "#6366F1", border: "1px solid #6366F133", display: "flex", alignItems: "center", gap: 4 }}>
                {s} <button onClick={() => setCustomerForm(f => ({ ...f, services: f.services.filter((_, j) => j !== i) }))} style={{ background: "none", border: "none", color: "#FF6B6B", cursor: "pointer", fontSize: 11, padding: 0 }}>✕</button>
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={svcInput} onChange={e => setSvcInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && svcInput.trim()) { setCustomerForm(f => ({ ...f, services: [...f.services, svcInput.trim()] })); setSvcInput(""); } }} style={{ ...inputStyle, flex: 1 }} placeholder="Type service and press Enter" />
            <button onClick={() => { if (svcInput.trim()) { setCustomerForm(f => ({ ...f, services: [...f.services, svcInput.trim()] })); setSvcInput(""); } }} style={{ ...btnStyle("#333"), fontSize: 11, padding: "8px 12px" }}>Add</button>
          </div>
        </FormField>
        <FormField label="Notes">
          <textarea value={customerForm.notes} onChange={e => setCustomerForm(f => ({ ...f, notes: e.target.value }))} rows={3} style={{ ...inputStyle, resize: "vertical" }} placeholder="Additional notes..." />
        </FormField>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
          <button onClick={() => { setShowAddCustomer(false); resetForm(); setEditingCustomerId(null); }} style={{ ...btnStyle("#333"), color: "#8B8FA3" }}>Cancel</button>
          <button onClick={handleSave} style={btnStyle("#6366F1")}>{editingCustomerId ? "Save Changes" : "Add Customer"}</button>
        </div>
      </Modal>
    )}
  </div>
);
}
