function nowIso() {
  return new Date().toISOString();
}

function createUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `sid_${Date.now()}_${Math.floor(Math.random() * 1e8)}`;
}

function getAnonymousUserId() {
  const key = "myris.anonymous_user_id.v1";
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const created = createUuid();
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return createUuid();
  }
}

function detectDeviceType() {
  const ua = navigator.userAgent || "";
  const mobile = /Mobi|Android|iPhone|iPod/i.test(ua);
  const tablet = /Tablet|iPad/i.test(ua);
  if (tablet) return "tablet";
  if (mobile) return "mobile";
  return "desktop";
}

function detectOs() {
  const ua = navigator.userAgent || "";
  if (/Windows NT/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown";
}

function detectBrowser() {
  const ua = navigator.userAgent || "";
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\//i.test(ua)) return "Opera";
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";
  if (/Firefox\//i.test(ua)) return "Firefox";
  return "Unknown";
}

function readClientContext() {
  const query = new URLSearchParams(window.location.search);
  const screenResolution = `${window.screen?.width || 0}x${window.screen?.height || 0}`;
  const viewportSize = `${window.innerWidth || 0}x${window.innerHeight || 0}`;

  return {
    entry_page: `${window.location.pathname}${window.location.search}`,
    referrer: document.referrer || null,
    utm_source: query.get("utm_source"),
    utm_medium: query.get("utm_medium"),
    utm_campaign: query.get("utm_campaign"),
    language: navigator.language || null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    os: detectOs(),
    browser: detectBrowser(),
    device_type: detectDeviceType(),
    touch_capable: navigator.maxTouchPoints > 0,
    pixel_ratio: Number(window.devicePixelRatio || 1),
    screen_resolution: screenResolution,
    viewport_size: viewportSize,
    device_memory_gb: Number.isFinite(Number(navigator.deviceMemory)) ? Number(navigator.deviceMemory) : null
  };
}

export class NoopTelemetryClient {
  constructor() {
    this.sessionId = null;
  }

  async startSession() {
    this.sessionId = createUuid();
    return this.sessionId;
  }

  track() {}

  async endSession() {}

  getDebugState() {
    return {
      sessionId: this.sessionId,
      queueLength: 0,
      lastStatus: "noop",
      lastError: "",
      recentEvents: []
    };
  }
}

export class EdgeFunctionTelemetryClient {
  constructor({ endpoint, viewerVersion, onSendFailure }) {
    this.endpoint = endpoint;
    this.viewerVersion = viewerVersion || "dev";
    this.anonymousUserId = getAnonymousUserId();
    this.onSendFailure = typeof onSendFailure === "function" ? onSendFailure : null;

    this.sessionId = null;
    this.startedAtMs = 0;
    this.baseContext = {};

    this.queue = [];
    this.flushing = false;

    this.lastStatus = "idle";
    this.lastError = "";
    this.recentEvents = [];
  }

  get isEnabled() {
    return Boolean(this.endpoint);
  }

  setEndpoint(endpoint) {
    this.endpoint = endpoint;
  }

  rememberEvent(event) {
    this.recentEvents.push({
      name: event.name,
      action: event.action,
      ts: event.ts
    });
    if (this.recentEvents.length > 10) {
      this.recentEvents.shift();
    }
  }

  setSessionContext(partial = {}) {
    this.baseContext = {
      ...this.baseContext,
      ...(partial || {})
    };
  }

  async startSession(context = {}) {
    this.sessionId = this.sessionId || createUuid();
    this.startedAtMs = Date.now();

    this.baseContext = {
      viewer_version: this.viewerVersion,
      asset_id: context.assetId || null,
      anonymous_user_id: this.anonymousUserId,
      ...readClientContext(),
      ...(context || {})
    };

    this.enqueue({
      action: "start",
      name: "viewer_opened",
      category: "viewer",
      payload: {
        asset_id: this.baseContext.asset_id
      }
    });

    this.enqueue({
      action: "track",
      name: "session_context",
      category: "viewer",
      payload: {
        entry_page: this.baseContext.entry_page,
        referrer: this.baseContext.referrer,
        utm_source: this.baseContext.utm_source,
        utm_medium: this.baseContext.utm_medium,
        utm_campaign: this.baseContext.utm_campaign,
        language: this.baseContext.language,
        timezone: this.baseContext.timezone,
        os: this.baseContext.os,
        browser: this.baseContext.browser,
        device_type: this.baseContext.device_type,
        touch_capable: this.baseContext.touch_capable,
        pixel_ratio: this.baseContext.pixel_ratio,
        screen_resolution: this.baseContext.screen_resolution,
        viewport_size: this.baseContext.viewport_size,
        device_memory_gb: this.baseContext.device_memory_gb
      }
    });

    return this.sessionId;
  }

  track(name, payload = {}, category = "viewer") {
    if (!this.sessionId) return;
    this.enqueue({
      action: "track",
      name,
      category,
      payload
    });
  }

  async endSession(reason = "unload", extraPayload = {}) {
    if (!this.sessionId) return;

    const durationMs = Math.max(0, Date.now() - this.startedAtMs);
    const event = {
      action: "end",
      name: "session_ended",
      category: "viewer",
      payload: {
        reason,
        duration_ms: durationMs,
        exit_page: `${window.location.pathname}${window.location.search}`,
        ...extraPayload
      },
      ts: nowIso()
    };

    this.rememberEvent(event);

    if (navigator.sendBeacon && this.endpoint) {
      try {
        const body = JSON.stringify(this.makeRequest(event));
        navigator.sendBeacon(this.endpoint, body);
        this.lastStatus = "beacon_sent";
      } catch (error) {
        this.lastError = error?.message || String(error);
      }
    }

    this.enqueue({
      action: "end",
      name: "session_ended",
      category: "viewer",
      payload: event.payload
    });

    await this.flush();
  }

  enqueue(item) {
    const event = {
      ...item,
      ts: nowIso()
    };
    this.queue.push(event);
    this.rememberEvent(event);
    void this.flush();
  }

  makeRequest(event) {
    return {
      action: event.action,
      session: {
        id: this.sessionId,
        started_at: new Date(this.startedAtMs || Date.now()).toISOString(),
        ...this.baseContext
      },
      event: {
        name: event.name,
        category: event.category,
        ts: event.ts,
        payload: event.payload || {}
      }
    };
  }

  async flush() {
    if (this.flushing) return;
    if (!this.queue.length) return;

    this.flushing = true;
    while (this.queue.length) {
      const next = this.queue[0];
      if (!this.isEnabled) {
        this.lastStatus = "no_endpoint";
        this.queue.shift();
        continue;
      }

      try {
        const response = await fetch(this.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(this.makeRequest(next))
        });

        if (!response.ok) {
          const message = await response.text();
          throw new Error(`HTTP ${response.status}: ${message}`);
        }

        this.queue.shift();
        this.lastStatus = "sent";
        this.lastError = "";
      } catch (error) {
        this.lastStatus = "error";
        this.lastError = error?.message || String(error);
        if (this.onSendFailure && next.name !== "telemetry_send_failed") {
          this.onSendFailure({
            eventName: next.name,
            reason: this.lastError
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
        break;
      }
    }

    this.flushing = false;
  }

  getDebugState() {
    return {
      sessionId: this.sessionId,
      queueLength: this.queue.length,
      lastStatus: this.lastStatus,
      lastError: this.lastError,
      recentEvents: [...this.recentEvents]
    };
  }
}

export function createTelemetryClient({ endpoint, viewerVersion, enabled = true, onSendFailure }) {
  if (!enabled) {
    return new NoopTelemetryClient();
  }
  return new EdgeFunctionTelemetryClient({ endpoint, viewerVersion, onSendFailure });
}
