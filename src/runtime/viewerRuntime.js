export function createViewerRuntime(options) {
  const yawReferenceByAssetId = new Map();

  return {
    constants: options.constants,
    getActiveAssetId: options.getActiveAssetId,
    getCurrentViewState: options.getCurrentViewState,
    setViewState: options.setViewState,
    emitTelemetry: options.emitTelemetry,
    getYawReference(assetId) {
      return yawReferenceByAssetId.get(assetId);
    },
    setYawReference(assetId, yaw) {
      if (!assetId) return;
      yawReferenceByAssetId.set(assetId, Number(yaw) || 0);
    },
    ensureYawReference(assetId, fallbackYaw = 0) {
      if (!assetId) return Number(fallbackYaw) || 0;
      if (!yawReferenceByAssetId.has(assetId)) {
        yawReferenceByAssetId.set(assetId, Number(fallbackYaw) || 0);
      }
      return yawReferenceByAssetId.get(assetId);
    },
    resetYawReference(assetId) {
      if (!assetId) return;
      yawReferenceByAssetId.delete(assetId);
    }
  };
}
