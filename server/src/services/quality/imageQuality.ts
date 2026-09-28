import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

/**
 * Deterministic image-quality service (quality-v1.2).
 * Mirrors the on-device Kotlin implementation so patients get the same verdict before upload.
 * No LLM involved: this is signal processing, and results are fully reproducible.
 */
export const QUALITY_VERSION = 'quality-v1.2';

export type QualityStatus = 'usable' | 'limited' | 'unusable';
export interface QualityCheck { id: 'resolution' | 'exposure' | 'clipping' | 'contrast' | 'sharpness' | 'framing'; passed: boolean; severity: 'hard' | 'soft'; value: number; threshold: string; message: string }
export interface QualityResult { version: string; status: QualityStatus; width: number; height: number; metrics: Record<string, number>; checks: QualityCheck[]; retakeTip?: string }

export const THRESHOLDS = {
  minShortEdge: 720,
  lumaMin: 70, lumaMax: 215,           // mean luma, 0–255
  clipMax: 0.12,                       // share of pixels ≥ 250 or ≤ 5
  contrastMin: 28,                     // std-dev of luma
  sharpHard: 25, sharpSoft: 60,        // Laplacian variance at 256-px analysis size
  framingMin: 0.12,                    // share of tooth-like pixels in the centre ellipse
};

export interface Raster { width: number; height: number; data: Uint8Array | Buffer } // RGBA

export function decodeImage(buf: Buffer, mime?: string): Raster {
  const isPng = mime === 'image/png' || buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (isPng) { const p = PNG.sync.read(buf); return { width: p.width, height: p.height, data: p.data }; }
  const d = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512, formatAsRGBA: true });
  return { width: d.width, height: d.height, data: d.data };
}

/** Box-downsample to analysis size, returning luma plus a tooth-likeness mask. */
function analysisPlanes(img: Raster, target = 256) {
  const scale = Math.max(img.width, img.height) / target;
  const w = Math.max(8, Math.round(img.width / scale)), h = Math.max(8, Math.round(img.height / scale));
  const luma = new Float32Array(w * h), tooth = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * scale), sy0 = Math.floor(y * scale);
      const sx1 = Math.min(img.width, Math.floor((x + 1) * scale)), sy1 = Math.min(img.height, Math.floor((y + 1) * scale));
      let r = 0, g = 0, b = 0, n = 0;
      const step = Math.max(1, Math.floor((sx1 - sx0) / 3));
      for (let yy = sy0; yy < sy1; yy += step) for (let xx = sx0; xx < sx1; xx += step) {
        const i = (yy * img.width + xx) * 4; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
      }
      if (!n) { const i = (sy0 * img.width + sx0) * 4; r = img.data[i]; g = img.data[i + 1]; b = img.data[i + 2]; n = 1; }
      r /= n; g /= n; b /= n;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      luma[y * w + x] = l;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      // Enamel/aligner heuristic: bright, low saturation, slightly warm or neutral.
      tooth[y * w + x] = l > 150 && sat < 0.28 && r >= b - 10 ? 1 : 0;
    }
  }
  return { w, h, luma, tooth };
}

/** Occlusal (arch) views are framed as a U-shaped ring by the capture overlay; buccal views as a central ellipse. */
export const isOcclusal = (view?: string | null) => view === 'upper' || view === 'lower';

export function assessRaster(img: Raster, view?: string | null): QualityResult {
  const { w, h, luma, tooth } = analysisPlanes(img);
  const n = w * h;
  let sum = 0, clipped = 0;
  for (let i = 0; i < n; i++) { sum += luma[i]; if (luma[i] >= 250 || luma[i] <= 5) clipped++; }
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) varSum += (luma[i] - mean) ** 2;
  const contrast = Math.sqrt(varSum / n);

  let lapSum = 0, lapSq = 0, lapN = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const v = luma[i - w] + luma[i + w] + luma[i - 1] + luma[i + 1] - 4 * luma[i];
    lapSum += v; lapSq += v * v; lapN++;
  }
  const lapMean = lapSum / lapN;
  const sharpness = lapSq / lapN - lapMean * lapMean;

  // Framing: share of tooth-like pixels inside the central ellipse used by the capture overlay.
  let inEllipse = 0, toothIn = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x - w / 2) / (w * 0.42), dy = (y - h / 2) / (h * 0.36);
    const r2 = dx * dx + dy * dy;
    const inside = isOcclusal(view) ? r2 >= 0.3 && r2 <= 1.25 : r2 <= 1;
    if (inside) { inEllipse++; toothIn += tooth[y * w + x]; }
  }
  const framing = inEllipse ? toothIn / inEllipse : 0;
  const shortEdge = Math.min(img.width, img.height);
  const T = THRESHOLDS;

  const checks: QualityCheck[] = [
    { id: 'resolution', severity: 'hard', value: shortEdge, threshold: `≥ ${T.minShortEdge}px`, passed: shortEdge >= T.minShortEdge,
      message: shortEdge >= T.minShortEdge ? 'Resolution sufficient' : 'Image resolution too low for comparison' },
    { id: 'exposure', severity: 'hard', value: round(mean), threshold: `${T.lumaMin}–${T.lumaMax}`, passed: mean >= T.lumaMin && mean <= T.lumaMax,
      message: mean < T.lumaMin ? 'Too dark' : mean > T.lumaMax ? 'Overexposed' : 'Exposure OK' },
    { id: 'clipping', severity: 'soft', value: round(clipped / n, 3), threshold: `≤ ${T.clipMax}`, passed: clipped / n <= T.clipMax,
      message: clipped / n <= T.clipMax ? 'Highlights and shadows OK' : 'Strong glare or deep shadows hide detail' },
    { id: 'contrast', severity: 'soft', value: round(contrast), threshold: `≥ ${T.contrastMin}`, passed: contrast >= T.contrastMin,
      message: contrast >= T.contrastMin ? 'Contrast OK' : 'Low contrast (haze, fog or flat light)' },
    { id: 'sharpness', severity: sharpness < T.sharpHard ? 'hard' : 'soft', value: round(sharpness), threshold: `≥ ${T.sharpSoft}`, passed: sharpness >= T.sharpSoft,
      message: sharpness >= T.sharpSoft ? 'In focus' : sharpness >= T.sharpHard ? 'Slightly soft focus' : 'Blurry' },
    { id: 'framing', severity: 'soft', value: round(framing, 3), threshold: `≥ ${T.framingMin}`, passed: framing >= T.framingMin,
      message: framing >= T.framingMin ? 'Teeth centred in frame' : 'Teeth not centred or too small in frame' },
  ];
  const hardFail = checks.some((c) => !c.passed && c.severity === 'hard');
  const softFails = checks.filter((c) => !c.passed && c.severity === 'soft').length;
  const status: QualityStatus = hardFail || softFails >= 3 ? 'unusable' : softFails > 0 ? 'limited' : 'usable';
  return {
    version: QUALITY_VERSION, status, width: img.width, height: img.height,
    metrics: { meanLuma: round(mean), clippedShare: round(clipped / n, 3), contrast: round(contrast), sharpness: round(sharpness), framing: round(framing, 3) },
    checks, retakeTip: status === 'usable' ? undefined : retakeTip(checks),
  };
}

export function assessImage(buf: Buffer, mime?: string, view?: string | null): QualityResult { return assessRaster(decodeImage(buf, mime), view); }

function retakeTip(checks: QualityCheck[]): string {
  const failed = new Set(checks.filter((c) => !c.passed).map((c) => c.id));
  const tips: string[] = [];
  const exp = checks.find((c) => c.id === 'exposure')!;
  if (failed.has('exposure')) tips.push(exp.message === 'Too dark' ? 'Face a window or turn on a bright light' : 'Move away from direct light or turn off the flash');
  if (failed.has('sharpness')) tips.push('Hold the phone steady with both hands and wait for the focus ring');
  if (failed.has('clipping')) tips.push('Tilt the phone slightly to avoid glare on the aligner');
  if (failed.has('framing')) tips.push('Fill the outline with your teeth and keep the retractor wide open');
  if (failed.has('resolution')) tips.push('Use the in-app camera rather than a screenshot');
  if (failed.has('contrast')) tips.push('Wipe the camera lens and dry your teeth with a tissue');
  return tips.join('. ') + '.';
}

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
