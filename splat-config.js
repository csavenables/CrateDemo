export const MIRIS_VIEWER_KEY = "SCpKAMoKc-mLURyO0DJQnSUIHYBmEclh5j5i1a_qteA";

export const VIEWER_VERSION = "builder-v1";
export const TELEMETRY_ENDPOINT = "https://ungmzkpvubdtsewpdgfu.supabase.co/functions/v1/ingest-event";

export const MIRIS_CAMERA = {
  x: 0,
  y: 1,
  z: 5,
  fov: 50
};

// Keep this list to exactly 3 items for the demo.
export const MIRIS_ASSETS = [
  {
    id: "splat-1",
    label: "Splat 1",
    uuid: "7a6ce045-8dc7-4698-94c7-c0b9070903cd",
    defaultTarget: [0, -0.08, 0],
    defaultCameraPosition: [0, 0.95, 3.9],
    defaultFov: 50,
    defaultStreamPosition: [0, -0.18, -9.6],
    defaultStreamZoom: 0.9
  },
  {
    id: "splat-2",
    label: "Splat 2",
    uuid: "4534662a-18bb-4bf0-a1c7-3bf3dab5d507",
    defaultTarget: [0, -0.6, 0],
    defaultCameraPosition: [0, 1.05, 5.1],
    defaultFov: 50,
    defaultStreamPosition: [0, 0.22, -22.4],
    defaultStreamZoom: 0.84
  },
  {
    id: "splat-3",
    label: "Splat 3",
    uuid: "ecb4d97b-d339-41c5-94ef-e7b72e700883",
    defaultTarget: [0, -0.58, 0],
    defaultCameraPosition: [0, 1, 5.15],
    defaultFov: 50,
    defaultStreamPosition: [0, 0.2, -21.6],
    defaultStreamZoom: 0.84
  }
];
