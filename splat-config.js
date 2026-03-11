export const MIRIS_VIEWER_KEY = "SCpKAMoKc-mLURyO0DJQnSUIHYBmEclh5j5i1a_qteA";

export const VIEWER_VERSION = "builder-v1";
export const TELEMETRY_ENDPOINT = "https://ungmzkpvubdtsewpdgfu.supabase.co/functions/v1/ingest-event";
export const MIRIS_LIGHTING = {
  ambientBrightness: 1.5
};
export const SUPPRESS_MIRIS_LOD_WARNINGS = true;
export const MIRIS_ORBIT_PIVOT_OFFSET = {
  x: 0,
  y: 0.3,
  z: 0
};
export const MIRIS_INITIAL_VIEW = {
  // Shared startup camera view (applies once at experience start).
  // Rotation is in degrees [x, y, z].
  x: 0,
  y: -1,
  z: -6,
  zoom: 7,
  rotationDegrees: [25, 140, 0]
};

export const MIRIS_CAMERA = {
  x: 0,
  y: 1,
  z: 5,
  fov: 50
};

// Keep this list to exactly 4 items for scene navigation.
export const MIRIS_ASSETS = [
  {
    id: "splat-1",
    label: "Splat 1",
    uuid: "9656ab93-b283-4eae-94c9-511947be3ddd",
    defaultTarget: [0, -0.08, 0],
    defaultCameraPosition: [0, 0.95, 3.9],
    defaultFov: 50,
    defaultStreamPosition: [0, -0.18, -9.6],
    defaultStreamZoom: 0.9
  },
  {
    id: "splat-2",
    label: "Splat 2",
    uuid: "ea27a899-410e-4d94-8743-fe1c54c782c4",
    baseRotationDegrees: [0, 270, 0],
    defaultTarget: [0, -0.6, 0],
    defaultCameraPosition: [0, 1.05, 5.1],
    defaultFov: 50,
    defaultStreamPosition: [0, 0.22, -22.4],
    defaultStreamZoom: 0.84
  },
  {
    id: "splat-3",
    label: "Splat 3",
    uuid: "113bbc8b-fa61-4c8c-8264-fad125309598",
    defaultTarget: [0, -0.58, 0],
    defaultCameraPosition: [0, 1, 5.15],
    defaultFov: 50,
    defaultStreamPosition: [0, 0.2, -21.6],
    defaultStreamZoom: 0.84
  },
  {
    id: "splat-4",
    label: "Splat 4",
    uuid: "cfdfd501-78e1-46d0-9315-99463ee54b88",
    defaultTarget: [0, -0.58, 0],
    defaultCameraPosition: [0, 1, 5.15],
    defaultFov: 50,
    defaultStreamPosition: [0, 0.2, -21.6],
    defaultStreamZoom: 0.84
  }
];
