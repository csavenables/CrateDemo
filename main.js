
import {
  MIRIS_ASSETS,
  MIRIS_INITIAL_VIEW,
  MIRIS_LIGHTING,
  MIRIS_ORBIT_PIVOT_OFFSET,
  MIRIS_VIEWER_KEY,
  SUPPRESS_MIRIS_LOD_WARNINGS,
  TELEMETRY_ENDPOINT,
  VIEWER_VERSION
} from "./splat-config.js";
import { createFeatureRegistry } from "./src/features/featureRegistry.js";
import { createViewerRuntime } from "./src/runtime/viewerRuntime.js";
import { loadBuilderConfig, saveBuilderConfig } from "./src/config/builderConfig.js";
import { createTelemetryClient } from "./src/telemetry/TelemetryClient.js";
import { createBuilderPanel } from "./src/ui/builderPanel.js";

const viewerStage = document.getElementById("viewer-stage");
const controlsRoot = document.getElementById("controls");

if (!viewerStage || !controlsRoot) {
  throw new Error("Missing required DOM elements.");
}

if (!MIRIS_VIEWER_KEY || !Array.isArray(MIRIS_ASSETS) || MIRIS_ASSETS.length !== 4) {
  throw new Error("Invalid Miris config. Check splat-config.js.");
}

const featureRegistry = createFeatureRegistry();
let builderConfig = loadBuilderConfig(featureRegistry);

if (SUPPRESS_MIRIS_LOD_WARNINGS) {
  const originalWarn = console.warn.bind(console);
  console.warn = (...args) => {
    const first = args[0];
    if (typeof first === "string" && first.includes("Received modified event for LOD") && first.includes("does not exist")) {
      return;
    }
    originalWarn(...args);
  };
}

const sceneEl = document.createElement("miris-scene");
sceneEl.setAttribute("key", MIRIS_VIEWER_KEY);
sceneEl.style.width = "100%";
sceneEl.style.height = "100%";
sceneEl.style.backgroundColor = "#ffffff";
if (Number.isFinite(Number(MIRIS_LIGHTING?.ambientBrightness)) && Number(MIRIS_LIGHTING.ambientBrightness) > 0) {
  sceneEl.style.filter = `brightness(${Number(MIRIS_LIGHTING.ambientBrightness)})`;
}

const ORBIT_PIVOT_OFFSET = {
  x: Number(MIRIS_ORBIT_PIVOT_OFFSET?.x) || 0,
  y: Number(MIRIS_ORBIT_PIVOT_OFFSET?.y) || 0,
  z: Number(MIRIS_ORBIT_PIVOT_OFFSET?.z) || 0
};
const STREAM_MODE_TAGGED_EVENTS = new Set([
  "perf_sample",
  "asset_load_timing",
  "asset_loaded",
  "scene_navigated",
  "scene_switch_latency"
]);

const orbitPivotEl = document.createElement("miris-group");
const pivotContentEl = document.createElement("miris-group");
pivotContentEl.style.position = "relative";
pivotContentEl.style.width = "100%";
pivotContentEl.style.height = "100%";
pivotContentEl.setAttribute(
  "position",
  `${-ORBIT_PIVOT_OFFSET.x} ${-ORBIT_PIVOT_OFFSET.y} ${-ORBIT_PIVOT_OFFSET.z}`
);

orbitPivotEl.appendChild(pivotContentEl);
sceneEl.appendChild(orbitPivotEl);
viewerStage.appendChild(sceneEl);

let activeAssetId = "";
let autoSpinEnabled = false;
let streamMode = "single";
let streamController = null;
const IS_COARSE_POINTER = window.matchMedia("(pointer: coarse)").matches;
let componentsReady = false;
const DEBUG_MODE = new URLSearchParams(window.location.search).get("debug") === "1";
let lastRuntimeError = "";
let lastSceneSwitchLatencyMs = null;
let lastMeasuredFps = 0;

const manualStateByAssetId = new Map();
const featureEnableStarts = new Map();

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 3.5;
const MIN_Z = -22;
const MAX_Z = -0.75;

const ROTATE_SPEED_X = 0.0065;
const ROTATE_SPEED_Y = 0.008;
const ROTATE_PITCH_MIN = -1.2;
const ROTATE_PITCH_MAX = 1.2;
const AUTO_SPIN_SPEED = 0.012;
const WHEEL_DOLLY_SPEED = 0.009;
const TOUCH_PINCH_DOLLY_SPEED = 0.018;

const RAGE_CLICK_WINDOW_MS = 1200;
const RAGE_CLICK_THRESHOLD = 4;
const DEG_TO_RAD = Math.PI / 180;

let renderCanvasCache = null;

const interactionCounts = { rotate: 0, zoom: 0, pan: 0 };
const interactionDurationsMs = { rotate: 0, zoom: 0, pan: 0 };
const interactionStarts = { rotate: null, zoom: null, pan: null };
const rageClicks = new Map();
let firstInteractionMs = null;
const viewerBootMs = performance.now();
let hasEndedSession = false;
let telemetrySendFailCount = 0;
let lastTelemetryFailMs = 0;

let frameCountWindow = 0;
let frameElapsedWindow = 0;
let lastPerfSampleMs = performance.now();
let lastFrameTimeMs = performance.now();
let fpsBucket = "unknown";
let longFrameCount = 0;
let webglContextLostCount = 0;
let webglContextRestoredCount = 0;
let webglListenersAttached = false;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function inferFpsBucket(fps) {
  if (!Number.isFinite(fps)) return "unknown";
  if (fps < 20) return "lt20";
  if (fps < 40) return "20_40";
  if (fps < 55) return "40_55";
  return "gt55";
}

function cloneState(state) {
  return {
    x: Number(state.x) || 0,
    y: Number(state.y) || 0,
    z: Number(state.z) || -5,
    zoom: clamp(Number(state.zoom) || 1, MIN_ZOOM, MAX_ZOOM),
    rotationX: clamp(Number(state.rotationX) || 0, ROTATE_PITCH_MIN, ROTATE_PITCH_MAX),
    rotationY: Number(state.rotationY) || 0,
    rotationZ: Number(state.rotationZ) || 0
  };
}

function getTelemetryEndpoint() {
  return builderConfig.telemetry.endpoint || TELEMETRY_ENDPOINT || "";
}

function emitTelemetry(name, payload = {}, category = "viewer") {
  const nextPayload = STREAM_MODE_TAGGED_EVENTS.has(name)
    ? { ...payload, stream_mode: streamMode }
    : payload;
  telemetryClient.track(name, nextPayload, category);
}

function handleTelemetrySendFailure({ eventName, reason }) {
  telemetrySendFailCount += 1;
  const now = Date.now();
  if (eventName === "telemetry_send_failed") return;
  if ((now - lastTelemetryFailMs) < 15000) return;
  lastTelemetryFailMs = now;
  emitTelemetry("telemetry_send_failed", { event_name: eventName, reason }, "error");
}

let telemetryClient = createTelemetryClient({
  endpoint: getTelemetryEndpoint(),
  viewerVersion: VIEWER_VERSION,
  enabled: builderConfig.telemetry.enabled,
  onSendFailure: handleTelemetrySendFailure
});

function rebuildTelemetryClient() {
  telemetryClient = createTelemetryClient({
    endpoint: getTelemetryEndpoint(),
    viewerVersion: VIEWER_VERSION,
    enabled: builderConfig.telemetry.enabled,
    onSendFailure: handleTelemetrySendFailure
  });

  if (componentsReady) {
    void telemetryClient.startSession({
      asset_id: activeAssetId || null,
      device_type: IS_COARSE_POINTER ? "mobile" : "desktop"
    });
  }
}

function hasStreamTransformApi() {
  return Boolean(
    orbitPivotEl.position &&
    typeof orbitPivotEl.position.set === "function" &&
    orbitPivotEl.rotation &&
    typeof orbitPivotEl.rotation.set === "function"
  );
}

function setControlsEnabled(enabled) {
  controlsRoot.querySelectorAll("button, input[type=\"checkbox\"]").forEach((el) => {
    el.disabled = !enabled;
  });
}

let debugHud = null;
function ensureDebugHud() {
  if (!DEBUG_MODE || debugHud) return;
  debugHud = document.createElement("pre");
  debugHud.style.position = "fixed";
  debugHud.style.left = "8px";
  debugHud.style.bottom = "8px";
  debugHud.style.zIndex = "9999";
  debugHud.style.margin = "0";
  debugHud.style.padding = "8px";
  debugHud.style.background = "rgba(0,0,0,0.7)";
  debugHud.style.color = "#b7f7c1";
  debugHud.style.font = "11px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  debugHud.style.border = "1px solid rgba(183,247,193,0.35)";
  debugHud.style.borderRadius = "8px";
  debugHud.style.pointerEvents = "none";
  document.body.appendChild(debugHud);
}

function updateDebugHud() {
  if (!DEBUG_MODE) return;
  ensureDebugHud();
  if (!debugHud) return;
  const hasCanvas = Boolean(getRenderCanvas());
  const telemetryState = telemetryClient.getDebugState?.() || null;

  debugHud.textContent = [
    `ready: ${componentsReady}`,
    `asset: ${activeAssetId || "-"}`,
    `canvas: ${hasCanvas}`,
    `coarse: ${IS_COARSE_POINTER}`,
    `session: ${telemetryState?.sessionId || "-"}`,
    `status: ${telemetryState?.lastStatus || "-"}`,
    `queue: ${telemetryState?.queueLength ?? 0}`,
    `fpsBucket: ${fpsBucket}`,
    `longFrames: ${longFrameCount}`,
    `error: ${lastRuntimeError || "-"}`
  ].join("\n");
}
function markInteraction(type, pointer) {
  interactionCounts[type] = (interactionCounts[type] || 0) + 1;
  if (!interactionStarts[type]) {
    interactionStarts[type] = performance.now();
    emitTelemetry("interaction_start", { type, pointer }, "viewer");
  }

  if (firstInteractionMs == null) {
    firstInteractionMs = Math.max(0, Math.round(performance.now() - viewerBootMs));
    emitTelemetry("time_to_first_interaction", { type, ms: firstInteractionMs }, "viewer");
  }
}

function endInteraction(type) {
  if (!interactionStarts[type]) return;
  const durationMs = Math.max(0, Math.round(performance.now() - interactionStarts[type]));
  interactionStarts[type] = null;
  interactionDurationsMs[type] += durationMs;
  emitTelemetry("interaction_end", { type, duration_ms: durationMs }, "viewer");
}

function finalizeOpenInteractions() {
  endInteraction("rotate");
  endInteraction("zoom");
  endInteraction("pan");
}

function trackRageClick(target) {
  const key = target?.id || target?.dataset?.assetId || target?.className || target?.nodeName || "unknown";
  const now = Date.now();
  const item = rageClicks.get(key) || { count: 0, firstTs: now };
  if ((now - item.firstTs) > RAGE_CLICK_WINDOW_MS) {
    item.count = 0;
    item.firstTs = now;
  }
  item.count += 1;
  rageClicks.set(key, item);

  if (item.count >= RAGE_CLICK_THRESHOLD) {
    emitTelemetry("rage_click_detected", {
      target_id: String(key),
      burst_count: item.count,
      window_ms: now - item.firstTs
    }, "ui");
    rageClicks.set(key, { count: 0, firstTs: now });
  }
}

async function loadMirisComponents() {
  const componentModuleUrls = [
    "https://cdn.jsdelivr.net/npm/@miris-inc/components/components.mjs",
    "https://unpkg.com/@miris-inc/components/components.mjs"
  ];

  let lastError = null;
  for (const moduleUrl of componentModuleUrls) {
    try {
      await import(moduleUrl);
      return;
    } catch (error) {
      lastError = error;
      const msg = typeof error?.message === "string" ? error.message : String(error);
      lastRuntimeError = `components import failed: ${moduleUrl} :: ${msg}`;
      emitTelemetry("failed_asset_load", {
        stage: "component_import",
        url: moduleUrl,
        message: msg
      }, "error");
      updateDebugHud();
    }
  }

  throw lastError || new Error("Failed to load Miris components.");
}

function getAssetById(assetId) {
  return MIRIS_ASSETS.find((asset) => asset.id === assetId);
}

function clearPivotStreams() {
  pivotContentEl.querySelectorAll("miris-stream").forEach((node) => node.remove());
}

function applyBaseRotationToStream(streamEl, asset) {
  if (!streamEl || !asset) return;
  const base = getAssetBaseRotationRadians(asset);
  if (streamEl.rotation && typeof streamEl.rotation.set === "function") {
    streamEl.rotation.set(base.x, base.y, base.z);
  }
  streamEl.setAttribute("rotation", `${base.x} ${base.y} ${base.z}`);
}

function createSingleStreamController() {
  let streamEl = null;
  return {
    mode: "single",
    init() {
      streamEl = document.createElement("miris-stream");
      streamEl.className = "stream-single-item";
      pivotContentEl.appendChild(streamEl);
    },
    destroy() {
      if (streamEl?.parentNode) streamEl.parentNode.removeChild(streamEl);
      streamEl = null;
    },
    setActiveAsset(asset) {
      if (!streamEl || !asset) return;
      streamEl.uuid = asset.uuid;
      applyBaseRotationToStream(streamEl, asset);
    },
    getMountedStreamCount() {
      return streamEl ? 1 : 0;
    }
  };
}

function createStreamController(mode) {
  return createSingleStreamController();
}

function getAssetBaseRotationRadians(asset) {
  if (Array.isArray(asset?.baseRotationDegrees) && asset.baseRotationDegrees.length === 3) {
    return {
      x: (Number(asset.baseRotationDegrees[0]) || 0) * DEG_TO_RAD,
      y: (Number(asset.baseRotationDegrees[1]) || 0) * DEG_TO_RAD,
      z: (Number(asset.baseRotationDegrees[2]) || 0) * DEG_TO_RAD
    };
  }

  const legacyY = Number(asset?.baseRotationY);
  return {
    x: 0,
    y: Number.isFinite(legacyY) ? legacyY : 0,
    z: 0
  };
}

function getConfiguredInitialViewState() {
  if (!MIRIS_INITIAL_VIEW || typeof MIRIS_INITIAL_VIEW !== "object") return null;

  const rotationDegrees = Array.isArray(MIRIS_INITIAL_VIEW.rotationDegrees) && MIRIS_INITIAL_VIEW.rotationDegrees.length === 3
    ? MIRIS_INITIAL_VIEW.rotationDegrees
    : [0, 0, 0];

  return {
    x: Number(MIRIS_INITIAL_VIEW.x) || 0,
    y: Number(MIRIS_INITIAL_VIEW.y) || 0,
    z: Number(MIRIS_INITIAL_VIEW.z) || -6,
    zoom: clamp(Number(MIRIS_INITIAL_VIEW.zoom) || 1, MIN_ZOOM, MAX_ZOOM),
    rotationX: (Number(rotationDegrees[0]) || 0) * DEG_TO_RAD,
    rotationY: (Number(rotationDegrees[1]) || 0) * DEG_TO_RAD,
    rotationZ: (Number(rotationDegrees[2]) || 0) * DEG_TO_RAD
  };
}

function setActiveButton(assetId) {
  controlsRoot.dataset.activeAssetId = assetId || "";
  controlsRoot.querySelectorAll("button[data-asset-id]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.assetId === assetId);
  });
}

function getActiveAssetIndex() {
  const selectedId = activeAssetId || MIRIS_ASSETS[0]?.id;
  const index = MIRIS_ASSETS.findIndex((asset) => asset.id === selectedId);
  return index >= 0 ? index : 0;
}

function getWrappedIndex(index) {
  if (!MIRIS_ASSETS.length) return -1;
  return ((index % MIRIS_ASSETS.length) + MIRIS_ASSETS.length) % MIRIS_ASSETS.length;
}

function navigateScene(direction) {
  if (!MIRIS_ASSETS.length) return;

  const fromIndex = getWrappedIndex(getActiveAssetIndex());
  const delta = direction === "right" ? 1 : -1;
  const toIndex = getWrappedIndex(fromIndex + delta);

  const fromAssetId = MIRIS_ASSETS[fromIndex]?.id || null;
  const nextAsset = MIRIS_ASSETS[toIndex];
  if (!nextAsset) return;

  const wrapped = direction === "right"
    ? fromIndex === MIRIS_ASSETS.length - 1
    : fromIndex === 0;

  emitTelemetry("scene_navigated", {
    from_asset_id: fromAssetId,
    to_asset_id: nextAsset.id,
    from_index: fromIndex,
    to_index: toIndex,
    direction,
    wrapped
  }, "ui");

  setActiveAsset(nextAsset.id);
}

function getDistanceFromAssetDefaults(asset) {
  const cam = Array.isArray(asset?.defaultCameraPosition) ? asset.defaultCameraPosition : [0, 1, 5];
  const target = Array.isArray(asset?.defaultTarget) ? asset.defaultTarget : [0, 0, 0];
  const dx = Number(cam[0]) - Number(target[0]);
  const dy = Number(cam[1]) - Number(target[1]);
  const dz = Number(cam[2]) - Number(target[2]);
  const distance = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
  return Number.isFinite(distance) && distance > 0 ? distance : 5;
}

function getDefaultViewState(asset) {
  const configuredPosition = Array.isArray(asset?.defaultStreamPosition) && asset.defaultStreamPosition.length === 3
    ? asset.defaultStreamPosition
    : null;
  const configuredZoom = Number.isFinite(Number(asset?.defaultStreamZoom))
    ? Number(asset.defaultStreamZoom)
    : null;

  if (configuredPosition) {
    const state = {
      x: Number(configuredPosition[0]) || 0,
      y: Number(configuredPosition[1]) || 0,
      z: Number(configuredPosition[2]) || -6,
      zoom: clamp(configuredZoom ?? 0.62, MIN_ZOOM, MAX_ZOOM),
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0
    };
    return state;
  }

  const defaultTargetY = Array.isArray(asset?.defaultTarget) && Number.isFinite(Number(asset.defaultTarget[1]))
    ? Number(asset.defaultTarget[1])
    : 0;
  const defaultDistance = getDistanceFromAssetDefaults(asset);
  const defaultZ = -clamp(defaultDistance * 1.1, 4.2, 9.8);

  const state = {
    x: 0,
    y: -defaultTargetY * 0.65,
    z: defaultZ,
    zoom: 0.62,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0
  };
  return state;
}

function readCurrentViewState() {
  return {
    x: (Number(orbitPivotEl.position?.x) || 0) - ORBIT_PIVOT_OFFSET.x,
    y: (Number(orbitPivotEl.position?.y) || 0) - ORBIT_PIVOT_OFFSET.y,
    z: clamp((Number(orbitPivotEl.position?.z) || -5) - ORBIT_PIVOT_OFFSET.z, MIN_Z, MAX_Z),
    zoom: clamp(Number(orbitPivotEl.zoom) || 1, MIN_ZOOM, MAX_ZOOM),
    rotationX: Number(orbitPivotEl.rotation?.x) || 0,
    rotationY: Number(orbitPivotEl.rotation?.y) || 0,
    rotationZ: Number(orbitPivotEl.rotation?.z) || 0
  };
}

const viewerRuntime = createViewerRuntime({
  constants: {
    ROTATE_PITCH_MIN,
    ROTATE_PITCH_MAX
  },
  getActiveAssetId: () => activeAssetId,
  getCurrentViewState: () => readCurrentViewState(),
  setViewState: (state) => applyViewState(state),
  emitTelemetry
});

function enforceRuntimeConstraints(state) {
  const constrained = cloneState(state);
  for (const feature of featureRegistry) {
    const featureConfig = builderConfig.features[feature.id];
    if (!featureConfig || typeof feature.apply !== "function") continue;
    feature.apply(featureConfig, viewerRuntime, constrained);
  }
  return constrained;
}

function applyViewState(state) {
  if (!hasStreamTransformApi()) return;
  const safe = enforceRuntimeConstraints(state);
  orbitPivotEl.position.set(
    safe.x + ORBIT_PIVOT_OFFSET.x,
    safe.y + ORBIT_PIVOT_OFFSET.y,
    clamp(safe.z + ORBIT_PIVOT_OFFSET.z, MIN_Z, MAX_Z)
  );
  orbitPivotEl.zoom = safe.zoom;
  orbitPivotEl.rotation.set(safe.rotationX, safe.rotationY, safe.rotationZ);
}

function saveActiveManualState() {
  if (!activeAssetId) return;
  manualStateByAssetId.set(activeAssetId, cloneState(readCurrentViewState()));
}

function saveManualStateForActive(state) {
  if (!activeAssetId) return;
  manualStateByAssetId.set(activeAssetId, cloneState(state));
}

function getRenderCanvas() {
  if (renderCanvasCache && renderCanvasCache.isConnected) {
    return renderCanvasCache;
  }

  const direct = viewerStage.querySelector("canvas");
  if (direct) {
    renderCanvasCache = direct;
    return renderCanvasCache;
  }

  if (sceneEl.shadowRoot) {
    const shadowCanvas = sceneEl.shadowRoot.querySelector("canvas");
    if (shadowCanvas) {
      renderCanvasCache = shadowCanvas;
      return renderCanvasCache;
    }
  }

  return null;
}

function attachWebglContextListenersIfNeeded() {
  if (webglListenersAttached) return;
  const canvas = getRenderCanvas();
  if (!canvas) return;

  canvas.addEventListener("webglcontextlost", () => {
    webglContextLostCount += 1;
    emitTelemetry("webgl_context_lost", { count: webglContextLostCount }, "error");
  });

  canvas.addEventListener("webglcontextrestored", () => {
    webglContextRestoredCount += 1;
    emitTelemetry("webgl_context_restored", { count: webglContextRestoredCount }, "viewer");
  });

  webglListenersAttached = true;
}

function getAssetTimingMetrics(loadStart, assetId) {
  const readyMs = Math.round(performance.now() - loadStart);
  const entry = performance.getEntriesByType("resource")
    .find((resource) => String(resource.name || "").includes(assetId));

  if (!entry) {
    return { asset_id: assetId, dns_ms: null, connect_ms: null, download_ms: null, ready_ms: readyMs };
  }

  return {
    asset_id: assetId,
    dns_ms: entry.domainLookupEnd > 0 ? Math.round(entry.domainLookupEnd - entry.domainLookupStart) : null,
    connect_ms: entry.connectEnd > 0 ? Math.round(entry.connectEnd - entry.connectStart) : null,
    download_ms: entry.responseEnd > 0 ? Math.round(entry.responseEnd - entry.responseStart) : null,
    ready_ms: readyMs
  };
}
function setActiveAsset(assetId) {
  const selected = getAssetById(assetId);
  if (!selected) return;
  const loadStart = performance.now();
  const switchStart = performance.now();
  const isFirstActivation = !activeAssetId;
  const previousActiveAssetId = activeAssetId || null;
  const carriedViewState = activeAssetId ? cloneState(readCurrentViewState()) : null;

  if (!componentsReady) {
    setActiveButton(assetId);
    activeAssetId = assetId;
    return;
  }

  if (activeAssetId === assetId) {
    return;
  }

  saveActiveManualState();
  setActiveButton(assetId);
  streamController?.setActiveAsset?.(selected);
  activeAssetId = assetId;

  const defaultView = getDefaultViewState(selected);
  const manualView = manualStateByAssetId.get(assetId);
  const configuredInitialView = getConfiguredInitialViewState();

  if (carriedViewState) {
    applyViewState(carriedViewState);
    saveManualStateForActive(carriedViewState);
  } else {
    const nextView = isFirstActivation
      ? (configuredInitialView ?? manualView ?? defaultView)
      : (manualView ?? defaultView);
    applyViewState(nextView);
    saveManualStateForActive(nextView);
  }

  viewerRuntime.ensureYawReference(assetId, readCurrentViewState().rotationY);

  const switchLatencyMs = Math.round(performance.now() - switchStart);
  lastSceneSwitchLatencyMs = switchLatencyMs;
  emitTelemetry("scene_switch_latency", {
    from_asset_id: previousActiveAssetId,
    to_asset_id: assetId,
    latency_ms: switchLatencyMs
  }, "perf");

  const timing = getAssetTimingMetrics(loadStart, assetId);
  emitTelemetry("asset_loaded", {
    asset_id: assetId,
    load_ms: timing.ready_ms
  }, "viewer");
  emitTelemetry("asset_load_timing", timing, "perf");
  telemetryClient.setSessionContext?.({ asset_id: assetId });
  updateDebugHud();
}

function createSceneNavButton({ text, ariaLabel, buttonId, direction, className }) {
  const button = document.createElement("button");
  button.type = "button";
  button.disabled = true;
  button.className = `scene-nav ${className}`;
  button.textContent = text;
  button.setAttribute("aria-label", ariaLabel);
  button.addEventListener("click", (event) => {
    trackRageClick(event.currentTarget);
    emitTelemetry("button_pressed", {
      button_id: buttonId,
      context: "top_controls"
    }, "ui");
    navigateScene(direction);
  });
  controlsRoot.appendChild(button);
}

createSceneNavButton({
  text: "←",
  ariaLabel: "Previous scene",
  buttonId: "scene_prev",
  direction: "left",
  className: "scene-nav--left"
});

createSceneNavButton({
  text: "→",
  ariaLabel: "Next scene",
  buttonId: "scene_next",
  direction: "right",
  className: "scene-nav--right"
});

function createSceneNumberButtons() {
  const wrap = document.createElement("div");
  wrap.className = "scene-index-nav";

  MIRIS_ASSETS.forEach((asset, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "scene-index-btn";
    button.dataset.assetId = asset.id;
    button.textContent = String(index + 1);
    button.addEventListener("click", (event) => {
      trackRageClick(event.currentTarget);
      emitTelemetry("button_pressed", {
        button_id: `scene_${index + 1}`,
        context: "bottom_controls"
      }, "ui");
      setActiveAsset(asset.id);
    });
    wrap.appendChild(button);
  });

  controlsRoot.appendChild(wrap);
}

createSceneNumberButtons();

function navigateTo(url) {
  if (!url) return;
  const openInNewTab = Boolean(builderConfig.cta.openInNewTab);
  if (openInNewTab) {
    window.open(url, "_blank", "noopener,noreferrer");
  } else {
    window.location.href = url;
  }
}

function copyToClipboard(text) {
  if (!text) return Promise.resolve(false);
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  const input = document.createElement("textarea");
  input.value = text;
  document.body.appendChild(input);
  input.select();
  const success = document.execCommand("copy");
  document.body.removeChild(input);
  return Promise.resolve(Boolean(success));
}

function trackAndNavigate(eventName, ctaId, destination) {
  emitTelemetry("button_pressed", {
    button_id: ctaId,
    context: "builder_cta"
  }, "cta");

  emitTelemetry(eventName, {
    cta_id: ctaId,
    destination,
    context: "builder_cta",
    asset_id: activeAssetId || null
  }, "cta");

  if (!destination) return;
  setTimeout(() => {
    navigateTo(destination);
  }, 120);
}

const builderPanel = createBuilderPanel({
  registry: featureRegistry,
  getConfig: () => builderConfig,
  onToggleFeature(featureId, enabled) {
    builderConfig.features[featureId].enabled = enabled;
    saveBuilderConfig(builderConfig);
    emitTelemetry("feature_toggled", {
      feature_id: featureId,
      enabled
    }, "viewer");

    if (enabled) {
      featureEnableStarts.set(featureId, performance.now());
    } else if (featureEnableStarts.has(featureId)) {
      const startedAt = featureEnableStarts.get(featureId);
      const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
      featureEnableStarts.delete(featureId);
      emitTelemetry("feature_usage_window", {
        feature_id: featureId,
        duration_ms: durationMs
      }, "viewer");
    }

    if (activeAssetId) {
      const state = readCurrentViewState();
      applyViewState(state);
      saveManualStateForActive(state);
    }
  },
  onChangeSetting(featureId, key, value) {
    const prevValue = builderConfig.features[featureId].settings[key];
    builderConfig.features[featureId].settings[key] = value;
    saveBuilderConfig(builderConfig);
    emitTelemetry("setting_changed", {
      feature_id: featureId,
      key,
      previous: prevValue,
      value
    }, "viewer");

    if (activeAssetId) {
      const state = readCurrentViewState();
      applyViewState(state);
      saveManualStateForActive(state);
    }
  },
  onChangeCta(key, value) {
    builderConfig.cta[key] = value;
    saveBuilderConfig(builderConfig);
    builderPanel.render();
  },
  onTelemetryChange(key, value) {
    builderConfig.telemetry[key] = value;
    saveBuilderConfig(builderConfig);
    rebuildTelemetryClient();
    builderPanel.render();
  },
  onCtaClick(ctaId, url) {
    if (ctaId === "view_product") {
      trackAndNavigate("view_product_clicked", ctaId, url);
      return;
    }

    if (ctaId === "enquire") {
      trackAndNavigate("enquiry_clicked", ctaId, url);
      return;
    }

    if (ctaId === "buy_now") {
      trackAndNavigate("purchase_link_clicked", ctaId, url);
    }
  },
  onUtilityAction(actionId, value) {
    if (actionId === "share_clicked") {
      const destination = value || window.location.href;
      emitTelemetry("share_clicked", { destination, context: "builder_cta" }, "cta");
      void copyToClipboard(destination);
      return;
    }

    void copyToClipboard(value).then((ok) => {
      emitTelemetry(actionId, { context: "builder_cta", success: ok }, "cta");
    });
  }
});

document.body.appendChild(builderPanel.element);
builderPanel.element.classList.add("is-hidden");
builderPanel.element.setAttribute("aria-hidden", "true");

const builderToggleButton = document.createElement("button");
builderToggleButton.type = "button";
builderToggleButton.className = "builder-toggle";
builderToggleButton.textContent = "Builder";
builderToggleButton.setAttribute("aria-expanded", "false");
builderToggleButton.setAttribute("aria-controls", "builder-panel");
builderPanel.element.id = "builder-panel";

builderToggleButton.addEventListener("click", (event) => {
  trackRageClick(event.currentTarget);
  const nextVisible = builderPanel.element.classList.contains("is-hidden");
  builderPanel.element.classList.toggle("is-hidden", !nextVisible);
  builderPanel.element.setAttribute("aria-hidden", String(!nextVisible));
  builderToggleButton.setAttribute("aria-expanded", String(nextVisible));
  emitTelemetry("button_pressed", {
    button_id: "builder_toggle",
    context: "top_controls",
    visible: nextVisible
  }, "ui");
});

document.body.appendChild(builderToggleButton);

viewerStage.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

let isPanning = false;
let isRotating = false;
let panPointerId = null;
let rotatePointerId = null;
let lastPanX = 0;
let lastPanY = 0;
let lastRotateX = 0;
let lastRotateY = 0;
const touchPoints = new Map();
let lastTouchDistance = 0;
let lastTouchCenterX = 0;
let lastTouchCenterY = 0;

function getTouchPointsArray() {
  return Array.from(touchPoints.values());
}

function getTouchCenter(points) {
  if (!points.length) return null;
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function getTouchDistance(points) {
  if (points.length < 2) return 0;
  const a = points[0];
  const b = points[1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt((dx * dx) + (dy * dy));
}

viewerStage.addEventListener("pointerdown", (event) => {
  trackRageClick(event.target);

  if (event.pointerType === "touch") {
    markInteraction("rotate", "touch");
    touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    viewerStage.setPointerCapture(event.pointerId);

    const points = getTouchPointsArray();
    const center = getTouchCenter(points);
    lastTouchCenterX = center?.x ?? event.clientX;
    lastTouchCenterY = center?.y ?? event.clientY;
    lastTouchDistance = getTouchDistance(points);
    event.preventDefault();
    return;
  }

  if (event.button === 0) {
    markInteraction("rotate", "mouse");
    isRotating = true;
    rotatePointerId = event.pointerId;
    lastRotateX = event.clientX;
    lastRotateY = event.clientY;
    viewerStage.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }

  if (event.button !== 2) return;
  markInteraction("pan", "mouse");
  isPanning = true;
  panPointerId = event.pointerId;
  lastPanX = event.clientX;
  lastPanY = event.clientY;
  viewerStage.setPointerCapture(event.pointerId);
  event.preventDefault();
});

viewerStage.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch" && touchPoints.has(event.pointerId) && activeAssetId) {
    touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = getTouchPointsArray();
    const current = readCurrentViewState();

    if (points.length === 1) {
      const point = points[0];
      const dx = point.x - lastTouchCenterX;
      const dy = point.y - lastTouchCenterY;
      current.rotationY += dx * ROTATE_SPEED_Y;
      current.rotationX = clamp(current.rotationX + (dy * ROTATE_SPEED_X), ROTATE_PITCH_MIN, ROTATE_PITCH_MAX);
      lastTouchCenterX = point.x;
      lastTouchCenterY = point.y;
    } else if (points.length >= 2) {
      markInteraction("zoom", "touch");
      const center = getTouchCenter(points);
      const distance = getTouchDistance(points);
      const dx = center.x - lastTouchCenterX;
      const dy = center.y - lastTouchCenterY;
      const panScale = clamp(Math.abs(current.z) * 0.0018, 0.002, 0.014);
      current.x += dx * panScale;
      current.y -= dy * panScale;

      if (lastTouchDistance > 0 && distance > 0) {
        const distDelta = distance - lastTouchDistance;
        const pinchSpeed = IS_COARSE_POINTER ? (TOUCH_PINCH_DOLLY_SPEED * 0.7) : TOUCH_PINCH_DOLLY_SPEED;
        current.z = clamp(current.z + (distDelta * pinchSpeed), MIN_Z, MAX_Z);
      }

      lastTouchCenterX = center.x;
      lastTouchCenterY = center.y;
      lastTouchDistance = distance;
    }

    applyViewState(current);
    saveManualStateForActive(current);
    event.preventDefault();
    return;
  }

  if (isRotating && event.pointerId === rotatePointerId && activeAssetId) {
    const dx = event.clientX - lastRotateX;
    const dy = event.clientY - lastRotateY;
    lastRotateX = event.clientX;
    lastRotateY = event.clientY;

    const current = readCurrentViewState();
    current.rotationY += dx * ROTATE_SPEED_Y;
    current.rotationX = clamp(current.rotationX + (dy * ROTATE_SPEED_X), ROTATE_PITCH_MIN, ROTATE_PITCH_MAX);

    applyViewState(current);
    saveManualStateForActive(current);
    event.preventDefault();
    return;
  }

  if (!isPanning || event.pointerId !== panPointerId || !activeAssetId) return;

  const dx = event.clientX - lastPanX;
  const dy = event.clientY - lastPanY;
  lastPanX = event.clientX;
  lastPanY = event.clientY;

  const current = readCurrentViewState();
  const panScale = clamp(Math.abs(current.z) * 0.0018, 0.002, 0.014);
  current.x += dx * panScale;
  current.y -= dy * panScale;

  applyViewState(current);
  saveManualStateForActive(current);
  event.preventDefault();
});

function endPointer(event) {
  if (event.pointerType === "touch" && touchPoints.has(event.pointerId)) {
    touchPoints.delete(event.pointerId);
    const remainingPoints = getTouchPointsArray();
    const center = getTouchCenter(remainingPoints);
    if (center) {
      lastTouchCenterX = center.x;
      lastTouchCenterY = center.y;
    }
    lastTouchDistance = getTouchDistance(remainingPoints);
    if (remainingPoints.length < 2) endInteraction("zoom");
    if (remainingPoints.length === 0) endInteraction("rotate");
    event.preventDefault();
    return;
  }

  if (isPanning && event.pointerId === panPointerId) {
    isPanning = false;
    panPointerId = null;
    endInteraction("pan");
  }

  if (isRotating && event.pointerId === rotatePointerId) {
    isRotating = false;
    rotatePointerId = null;
    endInteraction("rotate");
  }

  event.preventDefault();
}

viewerStage.addEventListener("pointerup", endPointer);
viewerStage.addEventListener("pointercancel", endPointer);

viewerStage.addEventListener("dblclick", () => {
  // Intentionally no auto-fit on double click; camera stays user-controlled.
});

viewerStage.addEventListener("wheel", (event) => {
  if (!activeAssetId) return;

  markInteraction("zoom", "wheel");

  const current = readCurrentViewState();
  const wheelUnit = clamp(Math.abs(event.deltaY) / 120, 0.4, 3);

  if (event.shiftKey) {
    const zoomMultiplier = event.deltaY < 0 ? 1 + (0.08 * wheelUnit) : 1 / (1 + (0.08 * wheelUnit));
    current.zoom = clamp(current.zoom * zoomMultiplier, MIN_ZOOM, MAX_ZOOM);
  } else {
    const wheelSpeed = IS_COARSE_POINTER ? (WHEEL_DOLLY_SPEED * 0.75) : WHEEL_DOLLY_SPEED;
    current.z = clamp(current.z - (event.deltaY * wheelSpeed), MIN_Z, MAX_Z);
  }

  applyViewState(current);
  saveManualStateForActive(current);

  clearTimeout(viewerStage._zoomEndTimer);
  viewerStage._zoomEndTimer = setTimeout(() => endInteraction("zoom"), 140);

  event.preventDefault();
}, { passive: false });

function maybeEmitPerfSample(nowMs) {
  if ((nowMs - lastPerfSampleMs) < 5000) return;
  const elapsedSec = frameElapsedWindow / 1000;
  const fps = elapsedSec > 0 ? (frameCountWindow / elapsedSec) : 0;
  lastMeasuredFps = fps;
  fpsBucket = inferFpsBucket(fps);
  emitTelemetry("perf_sample", {
    fps_bucket: fpsBucket,
    fps: Number(fps.toFixed(2)),
    long_frame_count_delta: longFrameCount
  }, "perf");
  frameCountWindow = 0;
  frameElapsedWindow = 0;
  lastPerfSampleMs = nowMs;
}

function animate() {
  const nowMs = performance.now();
  const deltaMs = Math.max(0, nowMs - lastFrameTimeMs);
  lastFrameTimeMs = nowMs;

  frameCountWindow += 1;
  frameElapsedWindow += deltaMs;
  if (deltaMs > 50) longFrameCount += 1;

  attachWebglContextListenersIfNeeded();
  maybeEmitPerfSample(nowMs);

  if (autoSpinEnabled && activeAssetId && !isRotating) {
    const current = readCurrentViewState();
    current.rotationY += AUTO_SPIN_SPEED;
    applyViewState(current);
    saveManualStateForActive(current);
  }

  if (activeAssetId) {
    const current = readCurrentViewState();
    const constrained = enforceRuntimeConstraints(current);
    if (Math.abs(constrained.rotationY - current.rotationY) > 1e-6) {
      applyViewState(constrained);
      saveManualStateForActive(constrained);
    }
  }

  updateDebugHud();
  requestAnimationFrame(animate);
}
animate();

setActiveButton(MIRIS_ASSETS[0].id);
setControlsEnabled(false);

async function startViewer() {
  try {
    await loadMirisComponents();
    await Promise.all([
      customElements.whenDefined("miris-scene"),
      customElements.whenDefined("miris-stream")
    ]);
  } catch (error) {
    const msg = typeof error?.message === "string" ? error.message : String(error);
    lastRuntimeError = `viewer init failed: ${msg}`;
    updateDebugHud();
    emitTelemetry("viewer_error", { message: msg, stack: error?.stack || null, context: "startViewer" }, "error");
    return;
  }

  componentsReady = true;
  streamController = createStreamController("single");
  streamController.init();
  streamMode = "single";
  await telemetryClient.startSession({
    asset_id: activeAssetId || MIRIS_ASSETS[0].id,
    device_type: IS_COARSE_POINTER ? "mobile" : "desktop"
  });

  setControlsEnabled(true);
  const preferred = activeAssetId || MIRIS_ASSETS[0].id;
  setActiveAsset(preferred);
  updateDebugHud();
}

startViewer();

async function endTelemetry(reason) {
  if (hasEndedSession) return;
  hasEndedSession = true;
  finalizeOpenInteractions();

  await telemetryClient.endSession(reason, {
    interaction_counts: interactionCounts,
    interaction_durations_ms: interactionDurationsMs,
    first_interaction_ms: firstInteractionMs,
    fps_bucket: fpsBucket,
    long_frame_count: longFrameCount,
    telemetry_send_fail_count: telemetrySendFailCount,
    webgl_context_lost_count: webglContextLostCount,
    webgl_context_restored_count: webglContextRestoredCount
  });
}

window.addEventListener("beforeunload", () => {
  void endTelemetry("beforeunload");
});

window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void endTelemetry("hidden");
  }
});

window.addEventListener("error", (event) => {
  lastRuntimeError = event.message || "window error";
  emitTelemetry("viewer_error", {
    message: lastRuntimeError,
    stack: event.error?.stack || null,
    filename: event.filename || null,
    lineno: event.lineno || null,
    colno: event.colno || null
  }, "error");
  updateDebugHud();
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  lastRuntimeError = typeof reason === "string" ? reason : (reason?.message || "unhandled rejection");
  emitTelemetry("viewer_error", {
    message: lastRuntimeError,
    stack: reason?.stack || null,
    context: "unhandledrejection"
  }, "error");
  updateDebugHud();
});
