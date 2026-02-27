function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function degToRad(value) {
  return value * (Math.PI / 180);
}

export function createFeatureRegistry() {
  return [
    {
      id: "lateralRestriction",
      label: "Lateral restriction",
      description: "Clamp left-right orbit range relative to a lock reference.",
      defaultSettings: {
        minYawDeg: -90,
        maxYawDeg: 90,
        lockReference: "initialHeading"
      },
      controls: [
        {
          type: "slider",
          key: "minYawDeg",
          label: "Min yaw",
          min: -180,
          max: 0,
          step: 1,
          default: -90,
          unit: "deg"
        },
        {
          type: "slider",
          key: "maxYawDeg",
          label: "Max yaw",
          min: 0,
          max: 180,
          step: 1,
          default: 90,
          unit: "deg"
        },
        {
          type: "select",
          key: "lockReference",
          label: "Reference",
          default: "initialHeading",
          options: [
            { label: "Initial heading", value: "initialHeading" },
            { label: "World forward", value: "worldForward" }
          ]
        }
      ],
      apply(featureConfig, viewerRuntime, state) {
        if (!featureConfig?.enabled) return;

        const activeAssetId = viewerRuntime.getActiveAssetId();
        if (!activeAssetId) return;

        const minYawDeg = Number(featureConfig.settings?.minYawDeg ?? -90);
        const maxYawDeg = Number(featureConfig.settings?.maxYawDeg ?? 90);
        const lowerDeg = Math.min(minYawDeg, maxYawDeg);
        const upperDeg = Math.max(minYawDeg, maxYawDeg);
        const lockReference = featureConfig.settings?.lockReference || "initialHeading";

        const referenceYaw = lockReference === "worldForward"
          ? 0
          : viewerRuntime.ensureYawReference(activeAssetId, state.rotationY);

        const minYaw = referenceYaw + degToRad(lowerDeg);
        const maxYaw = referenceYaw + degToRad(upperDeg);
        state.rotationY = clamp(state.rotationY, minYaw, maxYaw);
      }
    }
  ];
}
