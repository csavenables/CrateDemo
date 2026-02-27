const LOCAL_STORAGE_KEY = "myris.builder.config.v1";

function clampNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getDefaultFeatureState(feature) {
  const settings = {};
  for (const control of feature.controls || []) {
    if (Object.prototype.hasOwnProperty.call(control, "default")) {
      settings[control.key] = control.default;
    }
  }
  return {
    enabled: false,
    settings: {
      ...(feature.defaultSettings || {}),
      ...settings
    }
  };
}

export function buildDefaultConfig(registry) {
  const features = {};
  for (const feature of registry) {
    features[feature.id] = getDefaultFeatureState(feature);
  }

  return {
    features,
    cta: {
      viewProductUrl: "",
      enquireUrl: "",
      buyNowUrl: "",
      shareUrl: "",
      contactEmail: "",
      promoCode: "",
      openInNewTab: true
    },
    telemetry: {
      enabled: true,
      endpoint: ""
    }
  };
}

export function mergeWithDefaults(registry, saved) {
  const defaults = buildDefaultConfig(registry);
  if (!saved || typeof saved !== "object") return defaults;

  for (const feature of registry) {
    const incomingFeature = saved.features?.[feature.id] || {};
    const merged = {
      ...defaults.features[feature.id],
      ...incomingFeature,
      settings: {
        ...defaults.features[feature.id].settings,
        ...(incomingFeature.settings || {})
      }
    };

    merged.enabled = Boolean(merged.enabled);

    for (const control of feature.controls || []) {
      if (control.type === "slider") {
        const fallback = defaults.features[feature.id].settings[control.key];
        const nextValue = clampNumber(merged.settings[control.key], fallback);
        merged.settings[control.key] = Math.min(control.max, Math.max(control.min, nextValue));
      }
    }

    defaults.features[feature.id] = merged;
  }

  defaults.cta = {
    ...defaults.cta,
    ...(saved.cta || {}),
    openInNewTab: saved.cta?.openInNewTab ?? defaults.cta.openInNewTab
  };

  defaults.telemetry = {
    ...defaults.telemetry,
    ...(saved.telemetry || {}),
    enabled: saved.telemetry?.enabled ?? defaults.telemetry.enabled
  };

  return defaults;
}

export function loadBuilderConfig(registry) {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return buildDefaultConfig(registry);
    const parsed = JSON.parse(raw);
    return mergeWithDefaults(registry, parsed);
  } catch {
    return buildDefaultConfig(registry);
  }
}

export function saveBuilderConfig(config) {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage can fail in private modes; keep runtime state in memory.
  }
}

export { LOCAL_STORAGE_KEY };
