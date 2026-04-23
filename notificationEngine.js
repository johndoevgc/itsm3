// ─── Notification Delivery Engine ───────────────────────────────────────
// Delivers notifications via multiple channels: Email, Teams, Slack, In-App, Webhook.
// Called from server.js when events occur (SLA breach, escalation, incident update, etc.)

const https = require("https");

class NotificationEngine {
  constructor(options = {}) {
    this.graphSendMail = options.graphSendMail; // injected from server.js
    this.wsServer = options.wsServer; // WebSocket server for in-app push
    this.db = options.db; // for storing notification history
    this.config = {
      teamsWebhookUrl: process.env.TEAMS_WEBHOOK_URL || "",
      slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || "",
      defaultFrom: process.env.MAIL_FROM || "itsupport@vgctechnology.com",
    };
    this.stats = { sent: 0, failed: 0, byChannel: {} };
  }

  // ─── Send notification through configured channels ────────────────
  async send(notification) {
    const {
      channels = ["inapp"], // array of: email, teams, slack, inapp, webhook
      title,
      body,
      severity = "info", // info, warning, critical
      type = "general", // incident_update, sla_breach, escalation, assignment, system
      recipients = [], // email addresses for email channel
      incidentId,
      data = {},
    } = notification;

    const results = [];
    const record = {
      id: `NOTIF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title, body, severity, type, channels,
      recipients, incidentId, data,
      createdAt: new Date().toISOString(),
      results: [],
    };

    for (const channel of channels) {
      try {
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
        }
        this.stats.byChannel[channel] = (this.stats.byChannel[channel] || 0) + 1;
      } catch (err) {
        results.push({ channel, success: false, error: err.message });
        this.stats.failed++;
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
    const { title, body, recipients, severity, incidentId } = notification;
    if (!recipients || recipients.length === 0) return { channel: "email", success: false, error: "No recipients" };

    const sevColor = severity === "critical" ? "#FF4444" : severity === "warning" ? "#FFB347" : "#4CAF50";
    const htmlBody = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:${sevColor};padding:16px 24px;border-radius:10px 10px 0 0;">
          <h2 style="margin:0;color:#fff;font-size:16px;">${severity === "critical" ? "🚨" : severity === "warning" ? "⚠️" : "ℹ️"} ${title}</h2>
        </div>
        <div style="background:#ffffff;padding:20px 24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 10px 10px;">
          <p style="margin:0 0 12px;color:#333;font-size:14px;line-height:1.6;">${body}</p>
          ${incidentId ? `<p style="margin:8px 0;color:#666;font-size:12px;">Incident: <strong>${incidentId}</strong></p>` : ""}
          <hr style="border:none;border-top:1px solid #eee;margin:16px 0;"/>
          <p style="margin:0;color:#999;font-size:11px;">VGC ITSM Notification Engine — Automated Alert</p>
        </div>
      </div>`;

    await this.graphSendMail({
      to: recipients,
      subject: `[VGC ITSM] ${severity === "critical" ? "🚨 CRITICAL: " : severity === "warning" ? "⚠️ " : ""}${title}`,
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
    return { ...this.stats };
  }
}

module.exports = { NotificationEngine };
