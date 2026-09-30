export const EXPORT_MAX_DIMENSION = 3840;
export const EXPORT_MAX_PIXELS = 3840 * 2160;

export type ShareFormat = {
  id: "landscape" | "vertical" | "square" | "portrait";
  label: string;
  width: number;
  height: number;
};

export const shareFormats = [
  { id: "landscape", label: "Landscape 16:9", width: 1920, height: 1080 },
  { id: "vertical", label: "Vertical 9:16 (Reels, TikTok, Stories)", width: 1080, height: 1920 },
  { id: "square", label: "Square 1:1", width: 1080, height: 1080 },
  { id: "portrait", label: "Portrait 4:5 (feed)", width: 1080, height: 1350 },
] as const satisfies readonly ShareFormat[];

export type ShareFormatId = (typeof shareFormats)[number]["id"];

export function shareFormat(formatId: ShareFormatId): ShareFormat {
  const format = shareFormats.find((item) => item.id === formatId);
  if (!format) throw new Error(`Unknown share format: ${formatId}`);
  return format;
}

function evenFloor(value: number) {
  return Math.max(2, Math.floor(value / 2) * 2);
}

export function exportSizeFor(formatId: ShareFormatId, scale = 1): [number, number] {
  const format = shareFormat(formatId);
  const requestedScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const cappedScale = Math.min(
    requestedScale,
    EXPORT_MAX_DIMENSION / format.width,
    EXPORT_MAX_DIMENSION / format.height,
    Math.sqrt(EXPORT_MAX_PIXELS / (format.width * format.height)),
  );
  return [evenFloor(format.width * cappedScale), evenFloor(format.height * cappedScale)];
}
