/**
 * Device frames used by the canvas preview.  Values are CSS pixels so the
 * iframe gets the same viewport width and height that the generated screen
 * was designed for.  Canvas zoom is responsible for fitting those real-size
 * frames into the available workspace.
 */
export const DEVICE_PRESETS = [
  { id: "375x980", label: "375 × 980", width: 375, height: 980 },
  { id: "390x844", label: "390 × 844", width: 390, height: 844 },
  { id: "412x915", label: "412 × 915", width: 412, height: 915 },
  { id: "1366x768", label: "1366 × 768", width: 1366, height: 768 },
  { id: "1440x900", label: "1440 × 900", width: 1440, height: 900 },
  { id: "1920x1080", label: "1920 × 1080", width: 1920, height: 1080 },
] as const;

export type DevicePresetId = (typeof DEVICE_PRESETS)[number]["id"];
export type DevicePreset = (typeof DEVICE_PRESETS)[number];
export interface DeviceFrame {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const DEFAULT_DEVICE_PRESET_ID: DevicePresetId = DEVICE_PRESETS[0].id;
export const DEFAULT_DEVICE_PRESET = DEVICE_PRESETS[0];

export function getDevicePreset(id: string | undefined): DevicePreset {
  return DEVICE_PRESETS.find((preset) => preset.id === id) ?? DEFAULT_DEVICE_PRESET;
}

function formatDimension(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export function createCustomDeviceFrame(width: number, height: number): DeviceFrame {
  return {
    id: `custom:${width}x${height}`,
    label: `${formatDimension(width)} × ${formatDimension(height)}`,
    width,
    height,
  };
}
