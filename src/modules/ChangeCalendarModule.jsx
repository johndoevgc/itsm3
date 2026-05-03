import { useState, useMemo, useEffect } from "react";
import {
  COLORS, STATUS_COLORS, PRIORITY_COLORS, inputStyle, btnStyle,
} from "../constants/theme.js";
import {
  Badge, useStableComponent,
} from "../components/SharedComponents.jsx";

// Change Calendar — extracted from itsm-tool.jsx
export default function ChangeCalendarModule({ ctx }) {
  const {
    changes, setDetailItem, setModal, calendarView, setCalendarView,
    calendarMonth, setCalendarMonth, calendarYear, setCalendarYear,
    showCalendarForm, setShowCalendarForm, calendarData, fetchCalendarData,
    calendarSelectedDay, setCalendarSelectedDay,
    createFreezeWindow = () => {},
    deleteFreezeWindow = () => {},
  } = ctx;
  const [freezeForm, setFreezeForm] = useState({ name: "", start: "", end: "", reason: "" });
  const [calendarLoading, setCalendarLoading] = useState(false);
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const TYPE_COLORS = { Emergency: "#FF4444", Normal: "#64B5F6", Standard: "#81C784" };

  useEffect(() => { fetchCalendarData(calendarMonth, calendarYear); }, [calendarMonth, calendarYear]);

  const daysInMonth = new Date(calendarYear, calendarMonth, 0).getDate();
  const firstDayOfWeek = new Date(calendarYear, calendarMonth - 1, 1).getDay();

  const getChangesForDay = (day) => {
    if (!calendarData?.changes) return [];
    return calendarData.changes.filter(c => {
      if (!c.scheduledStart) return false;
      const s = new Date(c.scheduledStart);
      const e = c.scheduledEnd ? new Date(c.scheduledEnd) : s;
      const dayStart = new Date(calendarYear, calendarMonth - 1, day);
      const dayEnd = new Date(calendarYear, calendarMonth - 1, day, 23, 59, 59);
      return s <= dayEnd && e >= dayStart;
    });
  };

  const isFreezeDay = (day) => {
    if (!calendarData?.freezeWindows) return null;
    const dayDate = new Date(calendarYear, calendarMonth - 1, day);
    return calendarData.freezeWindows.find(fw => {
      const s = new Date(fw.startDate);
      const e = new Date(fw.endDate);
      return dayDate >= new Date(s.getFullYear(), s.getMonth(), s.getDate()) && dayDate <= new Date(e.getFullYear(), e.getMonth(), e.getDate());
    });
  };

  const navMonth = (dir) => {
    let m = calendarMonth + dir;
    let y = calendarYear;
    if (m > 12) { m = 1; y++; } else if (m < 1) { m = 12; y--; }
    setCalendarMonth(m); setCalendarYear(y); setCalendarSelectedDay(null);
  };

  const today = new Date();
  const isToday = (day) => today.getDate() === day && today.getMonth() + 1 === calendarMonth && today.getFullYear() === calendarYear;

  const selectedDayChanges = calendarSelectedDay ? getChangesForDay(calendarSelectedDay) : [];
  const selectedDayFreeze = calendarSelectedDay ? isFreezeDay(calendarSelectedDay) : null;

  return (
    <div>
      {/* Calendar Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button style={{ ...btnStyle("transparent"), border: "1px solid #1E2130", padding: "6px 12px", fontSize: 16 }} onClick={() => navMonth(-1)}>◀</button>
          <h3 style={{ margin: 0, color: "#E8ECF4", fontSize: 18, fontWeight: 700 }}>{MONTHS[calendarMonth - 1]} {calendarYear}</h3>
          <button style={{ ...btnStyle("transparent"), border: "1px solid #1E2130", padding: "6px 12px", fontSize: 16 }} onClick={() => navMonth(1)}>▶</button>
          <button style={{ ...btnStyle("#1E2130"), fontSize: 11, padding: "6px 14px" }} onClick={() => { setCalendarMonth(today.getMonth() + 1); setCalendarYear(today.getFullYear()); }}>Today</button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btnStyle("#DC2626")} onClick={() => setFreezeForm(f => ({ ...f, show: !f.show }))}>❄️ {freezeForm.show ? "Cancel" : "Add Freeze Window"}</button>
          {calendarLoading && <span style={{ color: "#6366F1", fontSize: 11, alignSelf: "center" }}>⟳ Loading...</span>}
        </div>
      </div>

      {/* Stats Row */}
      {calendarData?.stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 16 }}>
          {[
            { label: "Total Changes", value: calendarData.stats.total, accent: "#FFB347", icon: "📅" },
            { label: "Emergency", value: calendarData.stats.emergency, accent: "#FF4444", icon: "🚨" },
            { label: "Normal", value: calendarData.stats.normal, accent: "#64B5F6", icon: "🔄" },
            { label: "Standard", value: calendarData.stats.standard, accent: "#81C784", icon: "✅" },
            { label: "Freeze Windows", value: calendarData.stats.freezeDays, accent: "#06B6D4", icon: "❄️" },
            { label: "Conflicts", value: calendarData.stats.conflictCount, accent: calendarData.stats.conflictCount > 0 ? "#FF4444" : "#81C784", icon: calendarData.stats.conflictCount > 0 ? "⚠️" : "✓" },
          ].map((s, i) => (
            <div key={i} style={{ padding: "10px 14px", background: "#0F1117", borderRadius: 8, border: `1px solid ${s.accent}33` }}>
              <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.accent }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Freeze Window Form */}
      {freezeForm.show && (
        <div style={{ padding: 16, background: "#0F1117", borderRadius: 10, border: "1px solid #DC262644", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#F87171", marginBottom: 12 }}>❄️ Create Change Freeze Window</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 12, alignItems: "end" }}>
            <div>
              <label style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 4 }}>Start Date</label>
              <input type="datetime-local" value={freezeForm.startDate} onChange={e => setFreezeForm(f => ({ ...f, startDate: e.target.value }))} style={{ width: "100%", padding: "8px 10px", background: "#0A0C14", border: "1px solid #1E2130", borderRadius: 6, color: "#E8ECF4", fontSize: 12 }} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 4 }}>End Date</label>
              <input type="datetime-local" value={freezeForm.endDate} onChange={e => setFreezeForm(f => ({ ...f, endDate: e.target.value }))} style={{ width: "100%", padding: "8px 10px", background: "#0A0C14", border: "1px solid #1E2130", borderRadius: 6, color: "#E8ECF4", fontSize: 12 }} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 4 }}>Reason</label>
              <input type="text" value={freezeForm.reason} onChange={e => setFreezeForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. Year-end freeze, Production release weekend..." style={{ width: "100%", padding: "8px 10px", background: "#0A0C14", border: "1px solid #1E2130", borderRadius: 6, color: "#E8ECF4", fontSize: 12 }} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button style={btnStyle("#DC2626")} onClick={createFreezeWindow} disabled={!freezeForm.startDate || !freezeForm.endDate || !freezeForm.reason}>❄️ Create Freeze Window</button>
          </div>
        </div>
      )}

      {/* Conflicts Banner */}
      {calendarData?.conflicts?.length > 0 && (
        <div style={{ padding: "10px 16px", background: "#1A0A0A", borderRadius: 8, border: "1px solid #FF444444", marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#FF6B6B", marginBottom: 6 }}>⚠️ {calendarData.conflicts.length} Conflict{calendarData.conflicts.length > 1 ? "s" : ""} Detected</div>
          {calendarData.conflicts.slice(0, 3).map((c, i) => (
            <div key={i} style={{ fontSize: 11, color: "#A0AEC0", marginBottom: 3, paddingLeft: 12 }}>
              {c.type === "freeze_violation" ? (
                <span>🧊 <span style={{ color: "#FFB347" }}>{c.changeId}</span> conflicts with freeze: {c.freezeReason}</span>
              ) : (
                <span>🔄 <span style={{ color: "#FFB347" }}>{c.changes?.[0]}</span> overlaps with <span style={{ color: "#FFB347" }}>{c.changes?.[1]}</span></span>
              )}
            </div>
          ))}
          {calendarData.conflicts.length > 3 && <div style={{ fontSize: 10, color: "#5A6178", paddingLeft: 12 }}>+{calendarData.conflicts.length - 3} more...</div>}
        </div>
      )}

      {/* Calendar Grid */}
      <div style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", overflow: "hidden" }}>
        {/* Day headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid #1E2130" }}>
          {DAYS.map(d => (
            <div key={d} style={{ padding: "8px 0", textAlign: "center", fontSize: 10, fontWeight: 700, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, fontFamily: "'JetBrains Mono', monospace" }}>{d}</div>
          ))}
        </div>
        {/* Calendar cells */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {/* Empty cells before first day */}
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} style={{ minHeight: 80, background: "#0A0C14", borderRight: "1px solid #1E213033", borderBottom: "1px solid #1E213033" }} />
          ))}
          {/* Day cells */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dayChanges = getChangesForDay(day);
            const freeze = isFreezeDay(day);
            const isSelected = calendarSelectedDay === day;
            const isTodayCell = isToday(day);
            return (
              <div
                key={day}
                onClick={() => setCalendarSelectedDay(isSelected ? null : day)}
                style={{
                  minHeight: 80, padding: "4px 6px", cursor: "pointer", position: "relative",
                  background: freeze ? "#0A1520" : isSelected ? "#12141E" : isTodayCell ? "#0D0F1A" : "transparent",
                  borderRight: "1px solid #1E213033", borderBottom: "1px solid #1E213033",
                  border: isSelected ? "2px solid #6366F1" : isTodayCell ? "1px solid #6366F133" : undefined,
                  transition: "all 0.15s ease",
                }}
              >
                {/* Day number */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{
                    fontSize: 12, fontWeight: isTodayCell ? 800 : 600, fontFamily: "'JetBrains Mono', monospace",
                    color: isTodayCell ? "#6366F1" : freeze ? "#06B6D4" : "#E8ECF4",
                    background: isTodayCell ? "#6366F122" : "transparent",
                    padding: isTodayCell ? "1px 5px" : 0, borderRadius: 4,
                  }}>{day}</span>
                  {freeze && <span style={{ fontSize: 8, color: "#06B6D4" }} title={freeze.reason}>❄️</span>}
                </div>
                {/* Change dots */}
                {dayChanges.slice(0, 3).map((c, ci) => (
                  <div key={ci} style={{ fontSize: 8, color: TYPE_COLORS[c.type] || "#A0AEC0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.4, padding: "1px 4px", background: `${TYPE_COLORS[c.type] || "#A0AEC0"}15`, borderRadius: 3, marginBottom: 2 }} title={`${c.id}: ${c.title}`}>
                    {c.type === "Emergency" ? "🚨" : "●"} {c.id}
                  </div>
                ))}
                {dayChanges.length > 3 && <div style={{ fontSize: 7, color: "#5A6178", textAlign: "center" }}>+{dayChanges.length - 3}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 10, padding: "6px 12px", fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", flexWrap: "wrap" }}>
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <span key={type} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />{type}
          </span>
        ))}
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>❄️ Freeze Window</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>⚠️ Conflict</span>
      </div>

      {/* Selected Day Detail */}
      {calendarSelectedDay && (
        <div style={{ marginTop: 16, padding: 16, background: "#0F1117", borderRadius: 10, border: "1px solid #6366F133" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h4 style={{ margin: 0, color: "#E8ECF4", fontSize: 14, fontWeight: 700 }}>
              📅 {MONTHS[calendarMonth - 1]} {calendarSelectedDay}, {calendarYear}
              {selectedDayFreeze && <span style={{ marginLeft: 8, fontSize: 11, color: "#06B6D4" }}>❄️ FREEZE: {selectedDayFreeze.reason}</span>}
            </h4>
            <button style={{ ...btnStyle("transparent"), fontSize: 14, padding: "2px 8px" }} onClick={() => setCalendarSelectedDay(null)}>✕</button>
          </div>
          {selectedDayChanges.length === 0 ? (
            <div style={{ color: "#5A6178", fontSize: 12, textAlign: "center", padding: 20 }}>No changes scheduled for this day</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {selectedDayChanges.map(c => (
                <div key={c.id} style={{ padding: "10px 14px", background: "#0A0C14", borderRadius: 8, border: `1px solid ${TYPE_COLORS[c.type] || "#1E2130"}33`, cursor: "pointer" }}
                  onClick={() => { setDetailItem(c); setModal("changeDetail"); }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#FFB347" }}>{c.id}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Badge color={c.type === "Emergency" ? PRIORITY_COLORS["Sev-A"] : c.type === "Normal" ? { bg: "#0D2137", text: "#64B5F6" } : { bg: "#0A2D1A", text: "#81C784" }}>{c.type}</Badge>
                      <Badge color={STATUS_COLORS[c.status]}>{c.status}</Badge>
                      <Badge color={PRIORITY_COLORS[c.risk === "High" ? "Sev-A" : c.risk === "Medium" ? "Sev-B" : "Sev-D"]}>{c.risk} Risk</Badge>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "#E8ECF4", marginBottom: 4 }}>{c.title}</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>
                    <span>⏰ {c.scheduledStart} → {c.scheduledEnd || "TBD"}</span>
                    <span>👤 {c.assignee}</span>
                    <span>📁 {c.category}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Freeze Windows List */}
      {calendarData?.freezeWindows?.length > 0 && (
        <div style={{ marginTop: 16, padding: 16, background: "#0F1117", borderRadius: 10, border: "1px solid #06B6D433" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#06B6D4", marginBottom: 12 }}>❄️ Active Freeze Windows</div>
          {calendarData.freezeWindows.map(fw => (
            <div key={fw.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "#0A0C14", borderRadius: 6, marginBottom: 6, border: "1px solid #06B6D422" }}>
              <div>
                <div style={{ fontSize: 12, color: "#E8ECF4" }}>{fw.reason}</div>
                <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>
                  {new Date(fw.startDate).toLocaleDateString("en-SG")} → {new Date(fw.endDate).toLocaleDateString("en-SG")}
                  <span style={{ marginLeft: 8 }}>by {fw.createdBy}</span>
                </div>
              </div>
              <button style={{ ...btnStyle("#DC262644"), fontSize: 10, padding: "4px 10px" }} onClick={(e) => { e.stopPropagation(); deleteFreezeWindow(fw.id); }}>🗑️ Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
