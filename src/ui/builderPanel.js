function makeSettingControl(control, value, onChange) {
  const row = document.createElement("label");
  row.className = "builder-control-row";

  const top = document.createElement("span");
  top.className = "builder-control-label";
  top.textContent = control.label;
  row.appendChild(top);

  if (control.type === "slider") {
    const valueLabel = document.createElement("span");
    valueLabel.className = "builder-control-value";
    valueLabel.textContent = `${value}${control.unit ? ` ${control.unit}` : ""}`;

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(control.min);
    input.max = String(control.max);
    input.step = String(control.step ?? 1);
    input.value = String(value);

    input.addEventListener("input", () => {
      const next = Number(input.value);
      valueLabel.textContent = `${next}${control.unit ? ` ${control.unit}` : ""}`;
      onChange(next);
    });

    row.appendChild(valueLabel);
    row.appendChild(input);
    return row;
  }

  if (control.type === "select") {
    const select = document.createElement("select");
    for (const option of control.options || []) {
      const optionEl = document.createElement("option");
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      select.appendChild(optionEl);
    }
    select.value = String(value);
    select.addEventListener("change", () => {
      onChange(select.value);
    });

    row.appendChild(select);
    return row;
  }

  if (control.type === "checkbox") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(value);
    input.addEventListener("change", () => {
      onChange(input.checked);
    });
    row.appendChild(input);
    return row;
  }

  return row;
}

function makeTextSetting(labelText, value, onChange) {
  const row = document.createElement("label");
  row.className = "builder-control-row";

  const label = document.createElement("span");
  label.className = "builder-control-label";
  label.textContent = labelText;

  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.placeholder = "https://...";
  input.addEventListener("change", () => onChange(input.value));

  row.appendChild(label);
  row.appendChild(input);
  return row;
}

function makeCtaButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "builder-cta-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

export function createBuilderPanel(options) {
  const {
    registry,
    getConfig,
    onToggleFeature,
    onChangeSetting,
    onChangeCta,
    onTelemetryChange,
    onCtaClick,
    onUtilityAction
  } = options;

  const panel = document.createElement("aside");
  panel.className = "builder-panel";

  const title = document.createElement("h2");
  title.className = "builder-title";
  title.textContent = "Builder Panel";
  panel.appendChild(title);

  const featureContainer = document.createElement("div");
  featureContainer.className = "builder-feature-list";
  panel.appendChild(featureContainer);

  function renderFeatures() {
    const config = getConfig();
    featureContainer.innerHTML = "";

    for (const feature of registry) {
      const state = config.features[feature.id];

      const card = document.createElement("section");
      card.className = "builder-feature";

      const header = document.createElement("label");
      header.className = "builder-feature-header";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(state.enabled);
      checkbox.addEventListener("change", () => {
        onToggleFeature(feature.id, checkbox.checked);
        renderFeatures();
      });

      const labelWrap = document.createElement("div");
      const label = document.createElement("div");
      label.className = "builder-feature-label";
      label.textContent = feature.label;

      const description = document.createElement("div");
      description.className = "builder-feature-description";
      description.textContent = feature.description || "";

      labelWrap.appendChild(label);
      labelWrap.appendChild(description);

      header.appendChild(checkbox);
      header.appendChild(labelWrap);
      card.appendChild(header);

      const settings = document.createElement("div");
      settings.className = "builder-feature-settings";
      settings.hidden = !state.enabled;

      for (const control of feature.controls || []) {
        const value = state.settings[control.key];
        settings.appendChild(makeSettingControl(control, value, (next) => {
          onChangeSetting(feature.id, control.key, next);
        }));
      }

      card.appendChild(settings);
      featureContainer.appendChild(card);
    }
  }

  const ctaSection = document.createElement("section");
  ctaSection.className = "builder-section";

  const ctaTitle = document.createElement("h3");
  ctaTitle.textContent = "CTA";
  ctaSection.appendChild(ctaTitle);

  const ctaSettings = document.createElement("div");
  ctaSettings.className = "builder-feature-settings";
  ctaSection.appendChild(ctaSettings);

  const ctaButtons = document.createElement("div");
  ctaButtons.className = "builder-cta-actions";
  ctaSection.appendChild(ctaButtons);

  function renderCta() {
    const config = getConfig();
    ctaSettings.innerHTML = "";
    ctaButtons.innerHTML = "";

    ctaSettings.appendChild(makeTextSetting("View product URL", config.cta.viewProductUrl, (value) => onChangeCta("viewProductUrl", value)));
    ctaSettings.appendChild(makeTextSetting("Enquire URL", config.cta.enquireUrl, (value) => onChangeCta("enquireUrl", value)));
    ctaSettings.appendChild(makeTextSetting("Buy now URL", config.cta.buyNowUrl, (value) => onChangeCta("buyNowUrl", value)));
    ctaSettings.appendChild(makeTextSetting("Share URL", config.cta.shareUrl, (value) => onChangeCta("shareUrl", value)));
    ctaSettings.appendChild(makeTextSetting("Contact email", config.cta.contactEmail, (value) => onChangeCta("contactEmail", value)));
    ctaSettings.appendChild(makeTextSetting("Promo code", config.cta.promoCode, (value) => onChangeCta("promoCode", value)));

    const openRow = document.createElement("label");
    openRow.className = "builder-control-row";
    const openLabel = document.createElement("span");
    openLabel.className = "builder-control-label";
    openLabel.textContent = "Open in new tab";
    const openInput = document.createElement("input");
    openInput.type = "checkbox";
    openInput.checked = Boolean(config.cta.openInNewTab);
    openInput.addEventListener("change", () => onChangeCta("openInNewTab", openInput.checked));
    openRow.appendChild(openLabel);
    openRow.appendChild(openInput);
    ctaSettings.appendChild(openRow);

    ctaButtons.appendChild(makeCtaButton("View product", () => onCtaClick("view_product", config.cta.viewProductUrl)));
    ctaButtons.appendChild(makeCtaButton("Enquire", () => onCtaClick("enquire", config.cta.enquireUrl)));

    if (config.cta.buyNowUrl) {
      ctaButtons.appendChild(makeCtaButton("Buy now", () => onCtaClick("buy_now", config.cta.buyNowUrl)));
    }
    ctaButtons.appendChild(makeCtaButton("Copy email", () => onUtilityAction("copy_email", config.cta.contactEmail)));
    ctaButtons.appendChild(makeCtaButton("Copy code", () => onUtilityAction("copy_code", config.cta.promoCode)));
    ctaButtons.appendChild(makeCtaButton("Share link", () => onUtilityAction("share_clicked", config.cta.shareUrl || config.cta.viewProductUrl)));
  }

  const telemetrySection = document.createElement("section");
  telemetrySection.className = "builder-section";

  const telemetryTitle = document.createElement("h3");
  telemetryTitle.textContent = "Telemetry";
  telemetrySection.appendChild(telemetryTitle);

  const telemetryControls = document.createElement("div");
  telemetryControls.className = "builder-feature-settings";
  telemetrySection.appendChild(telemetryControls);

  function renderTelemetry() {
    const config = getConfig();
    telemetryControls.innerHTML = "";

    const enabledRow = document.createElement("label");
    enabledRow.className = "builder-control-row";

    const enabledLabel = document.createElement("span");
    enabledLabel.className = "builder-control-label";
    enabledLabel.textContent = "Enabled";

    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.checked = Boolean(config.telemetry.enabled);
    enabledInput.addEventListener("change", () => onTelemetryChange("enabled", enabledInput.checked));

    enabledRow.appendChild(enabledLabel);
    enabledRow.appendChild(enabledInput);
    telemetryControls.appendChild(enabledRow);

    telemetryControls.appendChild(makeTextSetting("Edge endpoint", config.telemetry.endpoint, (value) => onTelemetryChange("endpoint", value)));
  }

  panel.appendChild(ctaSection);
  panel.appendChild(telemetrySection);

  function render() {
    renderFeatures();
    renderCta();
    renderTelemetry();
  }

  render();

  return {
    element: panel,
    render
  };
}
