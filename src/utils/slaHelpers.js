// ─── Dynamic SLA Business Hours Calculator ──────────────────────────
export const getBusinessHoursElapsed = (createdAt, endTime, slaPauseHistory) => {
  if (!createdAt) return 0;
  const start = new Date(createdAt);
  const end = endTime ? new Date(endTime) : new Date();
  if (isNaN(start.getTime())) return 0;
  if (endTime && isNaN(end.getTime())) return 0;
  const BH_START = 9, BH_END = 18; // 9AM-6PM SGT
  const calcBH = (from, to) => {
    let elapsed = 0;
    let cursor = new Date(from);
    while (cursor < to) {
      const day = cursor.getDay(); // 0=Sun, 6=Sat
      if (day >= 1 && day <= 5) { // Mon-Fri
        const hrs = cursor.getHours() + cursor.getMinutes() / 60;
        if (hrs >= BH_START && hrs < BH_END) {
          const endOfBH = new Date(cursor); endOfBH.setHours(BH_END, 0, 0, 0);
          const chunkEnd = endOfBH < to ? endOfBH : to;
          elapsed += (chunkEnd - cursor) / 3600000;
          cursor = new Date(chunkEnd);
        } else if (hrs < BH_START) {
          cursor.setHours(BH_START, 0, 0, 0);
        } else {
          cursor.setDate(cursor.getDate() + 1); cursor.setHours(BH_START, 0, 0, 0);
        }
      } else {
        // Skip to next Monday
        const daysToMon = day === 0 ? 1 : 8 - day;
        cursor.setDate(cursor.getDate() + daysToMon); cursor.setHours(BH_START, 0, 0, 0);
      }
      if (cursor >= to) break;
    }
    return elapsed;
  };
  let elapsed = calcBH(start, end);
  // Subtract paused business hours
  if (Array.isArray(slaPauseHistory) && slaPauseHistory.length > 0) {
    for (const pause of slaPauseHistory) {
      if (!pause.pausedAt) continue;
      const pStart = new Date(pause.pausedAt);
      const pEnd = pause.resumedAt ? new Date(pause.resumedAt) : end; // still paused → count to now
      if (pStart < end && pEnd > start) {
        const effStart = pStart < start ? start : pStart;
        const effEnd = pEnd > end ? end : pEnd;
        elapsed -= calcBH(effStart, effEnd);
      }
    }
  }
  return Math.max(0, Math.round(elapsed * 100) / 100);
};

export const formatSlaCountdown = (hoursLeft) => {
  if (hoursLeft <= 0) { const over = Math.abs(hoursLeft); return over >= 1 ? `${Math.floor(over)}h ${Math.round((over % 1) * 60)}m over` : `${Math.round(over * 60)}m over`; }
  if (hoursLeft >= 1) return `${Math.floor(hoursLeft)}h ${Math.round((hoursLeft % 1) * 60)}m left`;
  return `${Math.round(hoursLeft * 60)}m left`;
};

// ─── Unified SLA Computation Helper ─────────────────────────────────
// Single source of truth for all SLA calculations across the app.
// Uses business hours (Mon-Fri 9AM-6PM SGT) when createdAt is available,
// falls back to static 'created' field for legacy seed data.
export const computeIncidentSla = (inc) => {
  const slaTarget = inc.slaTarget || 0;
  if (slaTarget <= 0) return { hoursElapsed: 0, slaTarget: 0, pctUsed: 0, isBreached: false, isAtRisk: false, remainingHours: 0, hasValidSla: false };
  let hoursElapsed = 0;
  if (inc.createdAt) {
    const d = new Date(inc.createdAt);
    if (!isNaN(d.getTime())) {
      // For resolved/closed incidents, stop the SLA clock at resolvedAt
      const endTime = (inc.status === "Resolved" || inc.status === "Closed") && inc.resolvedAt ? inc.resolvedAt : undefined;
      hoursElapsed = getBusinessHoursElapsed(inc.createdAt, endTime, inc.slaPauseHistory);
    } else hoursElapsed = inc.created || 0;
  } else {
    hoursElapsed = inc.created || 0;
  }
  const pctUsed = Math.round((hoursElapsed / slaTarget) * 100);
  return {
    hoursElapsed,
    slaTarget,
    pctUsed,
    isBreached: hoursElapsed > slaTarget,
    isAtRisk: pctUsed >= 75 && pctUsed < 100,
    remainingHours: Math.max(0, slaTarget - hoursElapsed),
    hasValidSla: true,
  };
};

// Compute real MTTR (Mean Time To Resolve) using business hours
export const computeMTTR = (resolvedIncidents) => {
  const withTimestamps = resolvedIncidents.filter(i => i.createdAt && i.resolvedAt);
  if (withTimestamps.length === 0) {
    // Fallback: use created field for legacy incidents
    const withCreated = resolvedIncidents.filter(i => typeof i.created === "number" && i.created > 0);
    if (withCreated.length === 0) return 0;
    return Math.round((withCreated.reduce((s, i) => s + i.created, 0) / withCreated.length) * 10) / 10;
  }
  let totalHours = 0;
  for (const inc of withTimestamps) {
    const start = new Date(inc.createdAt);
    const end = new Date(inc.resolvedAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
    // Calculate business hours between createdAt and resolvedAt
    const BH_START = 9, BH_END = 18;
    let elapsed = 0, cursor = new Date(start);
    while (cursor < end) {
      const day = cursor.getDay();
      if (day >= 1 && day <= 5) {
        const hrs = cursor.getHours() + cursor.getMinutes() / 60;
        if (hrs >= BH_START && hrs < BH_END) {
          const endOfBH = new Date(cursor); endOfBH.setHours(BH_END, 0, 0, 0);
          const chunkEnd = endOfBH < end ? endOfBH : end;
          elapsed += (chunkEnd - cursor) / 3600000;
          cursor = new Date(chunkEnd);
        } else if (hrs < BH_START) {
          cursor.setHours(BH_START, 0, 0, 0);
        } else {
          cursor.setDate(cursor.getDate() + 1); cursor.setHours(BH_START, 0, 0, 0);
        }
      } else {
        const daysToMon = day === 0 ? 1 : 8 - day;
        cursor.setDate(cursor.getDate() + daysToMon); cursor.setHours(BH_START, 0, 0, 0);
      }
      if (cursor >= end) break;
    }
    totalHours += elapsed;
  }
  return Math.round((totalHours / withTimestamps.length) * 10) / 10;
};

// ─── Utility Functions ──────────────────────────────────────────────────
export const genId = (prefix) => `${prefix}${String(Math.floor(Math.random() * 9000) + 1000)}`;

export const timeAgo = (h) => {
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

// ─── Security: HTML Sanitiser ────────────────────────────────────────────
export const sanitizeHTML = (html) => {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,iframe,object,embed,link,style,form,svg").forEach(el => el.remove());
  doc.querySelectorAll("*").forEach(el => {
    [...el.attributes].forEach(attr => {
      if (attr.name.startsWith("on") || attr.value.trim().toLowerCase().startsWith("javascript:")) el.removeAttribute(attr.name);
    });
  });
  return doc.body.innerHTML;
};
