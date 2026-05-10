// ─── Notification Delivery Engine ───────────────────────────────────────
// Delivers notifications via multiple channels: Email, Teams, Slack, In-App, Webhook.
// Called from server.js when events occur (SLA breach, escalation, incident update, etc.)

const https = require("https");

class NotificationEngine {
  constructor(options = {}) {
    this.graphSendMail = options.graphSendMail; // injected from server.js
    this.buildEmailTemplate = options.buildEmailTemplate; // enterprise template builder
    this.wsServer = options.wsServer; // WebSocket server for in-app push
    this.db = options.db; // for storing notification history
    this.config = {
      teamsWebhookUrl: process.env.TEAMS_WEBHOOK_URL || "",
      slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || "",
      defaultFrom: process.env.MAIL_FROM || "itsupport@vgctechnology.com",
    };
    this.stats = { sent: 0, failed: 0, byChannel: { email: 0, teams: 0, slack: 0, inapp: 0, webhook: 0 }, retries: 0, batchesSent: 0 };

    // v3.36: Retry queue — exponential backoff, max 3 attempts
    this._retryQueue = [];
    this._retryTimer = null;
    this._maxRetries = 3;
    this._retryBaseDelayMs = 5000; // 5s → 10s → 20s

    // v3.36: Batch buffer — group notifications by recipient within a window
    this._batchBuffer = new Map(); // key: recipientEmail → { items[], timer }
    this._batchWindowMs = parseInt(process.env.NOTIFY_BATCH_WINDOW_MS || "60000", 10); // 60s default
  }

  // ─── Quiet hours filter (v3.25) ───────────────────────────────────
  // During quiet hours (default 22:00–07:00 Asia/Singapore + weekends),
  // suppress info/warning notifications to noisy channels (email/teams/slack)
  // for non-critical items. In-app notifications always pass (visible only when user is online).
  // Critical severity always bypasses the filter. Configurable via env:
  //   QUIET_HOURS_START=22  QUIET_HOURS_END=7  QUIET_HOURS_TZ=Asia/Singapore
  //   QUIET_HOURS_ENABLED=true (default true)  QUIET_HOURS_WEEKEND=true (default true)
  _isQuietHours() {
    if (process.env.QUIET_HOURS_ENABLED === "false") return false;
    try {
      const tz = process.env.QUIET_HOURS_TZ || "Asia/Singapore";
      const now = new Date();
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour: "numeric", hour12: false, weekday: "short",
      }).formatToParts(now);
      const hour = parseInt(fmt.find(p => p.type === "hour")?.value || "0", 10);
      const weekday = fmt.find(p => p.type === "weekday")?.value || "";
      const isWeekend = (weekday === "Sat" || weekday === "Sun");
      if (process.env.QUIET_HOURS_WEEKEND !== "false" && isWeekend) return true;
      const startH = parseInt(process.env.QUIET_HOURS_START || "22", 10);
      const endH   = parseInt(process.env.QUIET_HOURS_END   || "7",  10);
      // Wraps midnight if start > end
      return startH > endH ? (hour >= startH || hour < endH) : (hour >= startH && hour < endH);
    } catch { return false; }
  }

  // ─── Send notification through configured channels ────────────────
  async send(notification) {
    const {
      channels: rawChannels = ["inapp"], // array of: email, teams, slack, inapp, webhook
      title,
      body,
      severity = "info", // info, warning, critical
      type = "general", // incident_update, sla_breach, escalation, assignment, system
      recipients = [], // email addresses for email channel
      incidentId,
      data = {},
    } = notification;

    // v3.25: Quiet-hours filter — suppress noisy channels for non-critical items.
    // Sev-A breach notifications (severity=critical) always go through.
    let channels = rawChannels;
    let suppressedDuringQuietHours = false;
    if (severity !== "critical" && this._isQuietHours()) {
      const noisyChannels = new Set(["email", "teams", "slack"]);
      const filtered = rawChannels.filter(c => !noisyChannels.has(c));
      if (filtered.length !== rawChannels.length) {
        suppressedDuringQuietHours = true;
        channels = filtered.length > 0 ? filtered : ["inapp"];
      }
    }

    const results = [];
    const record = {
      id: `NOTIF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title, body, severity, type, channels,
      recipients, incidentId, data,
      createdAt: new Date().toISOString(),
      results: [],
      suppressedDuringQuietHours,
    };

    for (const channel of channels) {
      try {
        // v3.36: Non-critical email batching — group into digest
        if (channel === "email" && severity !== "critical" && recipients && recipients.length > 0) {
          for (const r of recipients) this._addToBatch(r, notification);
          results.push({ channel: "email", success: true, batched: true });
          this.stats.byChannel.email = (this.stats.byChannel.email || 0) + 1;
          continue;
        }

        let result;
        switch (channel) {
          case "email":
            result = await this._sendEmail(notification);
            break;
          case "teams":
            result = await this._sendTeams(notification);
            break;
          case "slack":
            result = await this._sendSlack(notification);
            break;
          case "inapp":
            result = this._sendInApp(notification);
            break;
          case "webhook":
            result = await this._sendWebhook(notification);
            break;
          default:
            result = { channel, success: false, error: "Unknown channel" };
        }
        results.push(result);
        if (result && result.success) {
          this.stats.sent++;
        } else {
          this.stats.failed++;
          // v3.36: Enqueue failed sends for retry (except inapp which is fire-and-forget)
          if (channel !== "inapp") this._enqueueRetry(channel, notification, 0);
        }
        this.stats.byChannel[channel] = (this.stats.byChannel[channel] || 0) + 1;
      } catch (err) {
        results.push({ channel, success: false, error: err.message });
        this.stats.failed++;
        if (channel !== "inapp") this._enqueueRetry(channel, notification, 0);
      }
    }

    record.results = results;

    // Store notification in DB
    if (this.db) {
      try {
        await this.db.upsert("notifications", record.id, JSON.stringify(record));
      } catch (err) {
        console.warn("[Notify] Failed to store notification:", err.message);
      }
    }

    return record;
  }

  // ─── Email Channel ────────────────────────────────────────────────
  async _sendEmail(notification) {
    if (!this.graphSendMail) return { channel: "email", success: false, error: "Email not configured" };
    const { title, body, recipients, severity, incidentId, type, data } = notification;
    if (!recipients || recipients.length === 0) return { channel: "email", success: false, error: "No recipients" };

    const typeMap = { critical: "general_critical", warning: "general_warning", info: "general_info" };
    const emailType = typeMap[severity] || "general_info";

    let htmlBody;
    if (this.buildEmailTemplate) {
      htmlBody = this.buildEmailTemplate({
        type: emailType,
        title: title || "",
        incidentId: incidentId || "",
        resolution: body || "",
        ...(data || {}),
      });
    } else {
      // Fallback: basic HTML
      const sevColor = severity === "critical" ? "#FF4444" : severity === "warning" ? "#FFB347" : "#4CAF50";
      htmlBody = `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:${sevColor};padding:16px 24px;border-radius:10px 10px 0 0;">
          <h2 style="margin:0;color:#fff;font-size:16px;">${title}</h2>
        </div>
        <div style="background:#ffffff;padding:20px 24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 10px 10px;">
          <p style="margin:0 0 12px;color:#333;font-size:14px;line-height:1.6;">${body}</p>
          ${incidentId ? `<p style="margin:8px 0;color:#666;font-size:12px;">Incident: <strong>${incidentId}</strong></p>` : ""}
          <p style="margin:12px 0 0;color:#999;font-size:11px;">VGC ITSM Notification Engine — Automated Alert</p>
        </div>
      </div>`;
    }

    await this.graphSendMail({
      to: recipients,
      subject: `[VGC ITSM] ${severity === "critical" ? "CRITICAL: " : severity === "warning" ? "Warning: " : ""}${title}`,
      body: htmlBody,
    });
    return { channel: "email", success: true, sentTo: recipients };
  }

  // ─── Microsoft Teams Channel (Incoming Webhook) ───────────────────
  async _sendTeams(notification) {
    const webhookUrl = notification.data?.teamsWebhookUrl || this.config.teamsWebhookUrl;
    if (!webhookUrl) return { channel: "teams", success: false, error: "Teams webhook URL not configured" };

    const { title, body, severity, incidentId } = notification;
    const color = severity === "critical" ? "FF4444" : severity === "warning" ? "FFB347" : "4CAF50";

    // Adaptive Card payload for Teams Incoming Webhook
    const card = {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      themeColor: color,
      summary: title,
      sections: [{
        activityTitle: `${severity === "critical" ? "🚨" : severity === "warning" ? "⚠️" : "ℹ️"} ${title}`,
        activitySubtitle: incidentId ? `Incident: ${incidentId}` : "VGC ITSM",
        text: body,
        facts: [
          { name: "Severity", value: severity.toUpperCase() },
          { name: "Time", value: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore" }) },
        ],
      }],
    };

    return new Promise((resolve, reject) => {
      const url = new URL(webhookUrl);
      const payload = JSON.stringify(card);
      const req = https.request({
        hostname: url.hostname, path: url.pathname + url.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      }, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ channel: "teams", success: true });
          } else {
            resolve({ channel: "teams", success: false, error: `HTTP ${res.statusCode}` });
          }
        });
      });
      req.on("error", (err) => resolve({ channel: "teams", success: false, error: err.message }));
      req.setTimeout(10000, () => { req.destroy(); resolve({ channel: "teams", success: false, error: "Timeout" }); });
      req.write(payload);
      req.end();
    });
  }

  // ─── Slack Channel (Incoming Webhook) ─────────────────────────────
  async _sendSlack(notification) {
    const webhookUrl = notification.data?.slackWebhookUrl || this.config.slackWebhookUrl;
    if (!webhookUrl) return { channel: "slack", success: false, error: "Slack webhook URL not configured" };

    const { title, body, severity, incidentId } = notification;
    const emoji = severity === "critical" ? ":rotating_light:" : severity === "warning" ? ":warning:" : ":information_source:";

    const payload = JSON.stringify({
      text: `${emoji} *${title}*`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: `${severity === "critical" ? "🚨" : "⚠️"} ${title}` } },
        { type: "section", text: { type: "mrkdwn", text: body } },
        ...(incidentId ? [{ type: "context", elements: [{ type: "mrkdwn", text: `Incident: *${incidentId}* | Severity: *${severity.toUpperCase()}*` }] }] : []),
      ],
    });

    return new Promise((resolve, reject) => {
      const url = new URL(webhookUrl);
      const req = https.request({
        hostname: url.hostname, path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      }, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          resolve({ channel: "slack", success: res.statusCode === 200, error: res.statusCode !== 200 ? `HTTP ${res.statusCode}` : undefined });
        });
      });
      req.on("error", (err) => resolve({ channel: "slack", success: false, error: err.message }));
      req.setTimeout(10000, () => { req.destroy(); resolve({ channel: "slack", success: false, error: "Timeout" }); });
      req.write(payload);
      req.end();
    });
  }

  // ─── In-App Push (via WebSocket) ──────────────────────────────────
  _sendInApp(notification) {
    if (!this.wsServer) return { channel: "inapp", success: false, error: "WebSocket not available" };
    const { title, body, severity, type, incidentId, recipients } = notification;

    // If recipients specified, send to specific users; otherwise broadcast
    if (recipients && recipients.length > 0) {
      recipients.forEach(email => {
        this.wsServer.sendToUser(email, "notifications", { title, body, severity, type, incidentId });
      });
    } else {
      this.wsServer.broadcast("notifications", { title, body, severity, type, incidentId });
    }
    return { channel: "inapp", success: true };
  }

  // ─── Generic Webhook ──────────────────────────────────────────────
  async _sendWebhook(notification) {
    const webhookUrl = notification.data?.webhookUrl;
    if (!webhookUrl) return { channel: "webhook", success: false, error: "No webhook URL" };

    const payload = JSON.stringify({
      event: notification.type,
      title: notification.title,
      body: notification.body,
      severity: notification.severity,
      incidentId: notification.incidentId,
      timestamp: new Date().toISOString(),
      data: notification.data,
    });

    return new Promise((resolve) => {
      try {
        const url = new URL(webhookUrl);
        const mod = url.protocol === "https:" ? https : require("http");
        const req = mod.request({
          hostname: url.hostname, port: url.port, path: url.pathname + url.search,
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        }, (res) => {
          let data = "";
          res.on("data", c => data += c);
          res.on("end", () => resolve({ channel: "webhook", success: res.statusCode < 400 }));
        });
        req.on("error", (err) => resolve({ channel: "webhook", success: false, error: err.message }));
        req.setTimeout(10000, () => { req.destroy(); resolve({ channel: "webhook", success: false, error: "Timeout" }); });
        req.write(payload);
        req.end();
      } catch (err) {
        resolve({ channel: "webhook", success: false, error: err.message });
      }
    });
  }

  getStats() {
    return { ...this.stats, retryQueueSize: this._retryQueue.length, batchBufferSize: this._batchBuffer.size };
  }

  // ─── v3.36: Retry with exponential backoff ──────────────────────────
  _enqueueRetry(channel, notification, attempt) {
    if (attempt >= this._maxRetries) {
      console.warn(`[Notify] Max retries (${this._maxRetries}) reached for ${channel} – dropping`);
      return;
    }
    const delayMs = this._retryBaseDelayMs * Math.pow(2, attempt);
    this._retryQueue.push({ channel, notification, attempt, scheduledAt: Date.now() + delayMs });
    if (!this._retryTimer) {
      this._retryTimer = setTimeout(() => this._processRetryQueue(), delayMs);
    }
  }

  async _processRetryQueue() {
    this._retryTimer = null;
    const now = Date.now();
    const ready = this._retryQueue.filter(r => r.scheduledAt <= now);
    this._retryQueue = this._retryQueue.filter(r => r.scheduledAt > now);

    for (const item of ready) {
      try {
        let result;
        switch (item.channel) {
          case "email":  result = await this._sendEmail(item.notification); break;
          case "teams":  result = await this._sendTeams(item.notification); break;
          case "slack":  result = await this._sendSlack(item.notification); break;
          case "webhook": result = await this._sendWebhook(item.notification); break;
          default: continue;
        }
        this.stats.retries++;
        if (result && result.success) {
          this.stats.sent++;
          console.log(`[Notify] Retry #${item.attempt + 1} succeeded for ${item.channel}`);
        } else {
          this._enqueueRetry(item.channel, item.notification, item.attempt + 1);
        }
      } catch {
        this._enqueueRetry(item.channel, item.notification, item.attempt + 1);
      }
    }

    // Schedule next batch if items remain
    if (this._retryQueue.length > 0) {
      const nextDelay = Math.max(1000, Math.min(...this._retryQueue.map(r => r.scheduledAt - Date.now())));
      this._retryTimer = setTimeout(() => this._processRetryQueue(), nextDelay);
    }
  }

  // ─── v3.36: Notification batching (digest emails) ──────────────────
  // Groups info/warning email notifications to the same recipient into a single digest.
  // Critical notifications bypass batching entirely.
  _addToBatch(recipient, notification) {
    if (!this._batchBuffer.has(recipient)) {
      this._batchBuffer.set(recipient, { items: [], timer: null });
    }
    const bucket = this._batchBuffer.get(recipient);
    bucket.items.push(notification);

    if (!bucket.timer) {
      bucket.timer = setTimeout(() => this._flushBatch(recipient), this._batchWindowMs);
    }
  }

  async _flushBatch(recipient) {
    const bucket = this._batchBuffer.get(recipient);
    if (!bucket || bucket.items.length === 0) { this._batchBuffer.delete(recipient); return; }

    const items = bucket.items.splice(0);
    bucket.timer = null;
    this._batchBuffer.delete(recipient);

    if (items.length === 1) {
      // Single item – send normally
      const result = await this._sendEmail(items[0]);
      if (!result || !result.success) this._enqueueRetry("email", items[0], 0);
      else this.stats.sent++;
      return;
    }

    // Build digest email
    const title = `VGC ITSM — ${items.length} Notifications`;
    const itemsHtml = items.map(n =>
      `<div style="padding:8px 0;border-bottom:1px solid #eee;">
        <strong>${n.title || "Notification"}</strong>${n.incidentId ? ` (${n.incidentId})` : ""}
        <div style="color:#555;font-size:13px;margin-top:2px;">${n.body || ""}</div>
      </div>`
    ).join("");
    const digestNotification = {
      ...items[0],
      title,
      body: `You have ${items.length} recent notifications:\n\n${items.map(n => `• ${n.title}`).join("\n")}`,
      recipients: [recipient],
      data: { ...items[0].data, digest: true, itemCount: items.length, digestHtml: itemsHtml },
    };

    const result = await this._sendEmail(digestNotification);
    if (result && result.success) { this.stats.sent++; this.stats.batchesSent++; }
    else this._enqueueRetry("email", digestNotification, 0);
  }
}

module.exports = { NotificationEngine };
