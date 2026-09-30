const DEFAULT_MAX_PIXELS = 2560 * 1440;
const MIN_SIZE = 8;

function finitePositive(value: number, fallback = MIN_SIZE) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function roundMultipleOf8(value: number) {
  return Math.max(MIN_SIZE, Math.round(value / 8) * 8);
}

function floorMultipleOf8(value: number) {
  return Math.max(MIN_SIZE, Math.floor(value / 8) * 8);
}

export function outputSize(opts: {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  maxDimension: number;
  maxPixels?: number;
}): [number, number] {
  const cssWidth = finitePositive(opts.cssWidth);
  const cssHeight = finitePositive(opts.cssHeight);
  const dpr = finitePositive(opts.dpr, 1);
  const maxDimension = finitePositive(opts.maxDimension, MIN_SIZE);
  const maxPixels = finitePositive(opts.maxPixels ?? DEFAULT_MAX_PIXELS);
  const nativeWidth = cssWidth * dpr;
  const nativeHeight = cssHeight * dpr;
  const scale = Math.min(
    1,
    maxDimension / nativeWidth,
    maxDimension / nativeHeight,
    Math.sqrt(maxPixels / (nativeWidth * nativeHeight)),
  );
  const aspect = nativeWidth / nativeHeight;
  let width = roundMultipleOf8(nativeWidth * scale);
  let height = roundMultipleOf8(nativeHeight * scale);

  while (
    (width * height > maxPixels ||
      width > maxDimension ||
      height > maxDimension) &&
    (width > MIN_SIZE || height > MIN_SIZE)
  ) {
    const nextScale = Math.min(
      (width - (width > MIN_SIZE ? 8 : 0)) / aspect,
      height - (height > MIN_SIZE ? 8 : 0),
    );
    height = floorMultipleOf8(nextScale);
    width = floorMultipleOf8(height * aspect);
  }

  return [width, height];
}

export function sizeLadder(size: [number, number]): [number, number][] {
  const [width, height] = size;
  const seen = new Set<string>();
  return [1, Math.sqrt(0.75), Math.sqrt(0.5), 0.5]
    .map((scale) => [roundMultipleOf8(width * scale), roundMultipleOf8(height * scale)] as [number, number])
    .filter(([w, h]) => {
      const key = `${w}x${h}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
