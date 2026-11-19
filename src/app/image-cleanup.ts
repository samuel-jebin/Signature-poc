/**
 * Signature -> trimmed PNG with transparent background.
 *
 * Drawn (hasAlpha = true): the canvas is already transparent, so we only trim the empty margin.
 *   Full resolution, no recolouring, nothing removed -> exactly what the user drew.
 *
 * Uploaded photo/scan (hasAlpha = false):
 *   1. estimate the paper background (max filter + blur) and divide it out -> removes shadows / uneven light
 *   2. Otsu threshold (+ user "sensitivity") -> soft alpha so edges stay smooth
 *   3. remove tiny specks (dust)
 *   4. keep the pen's real colour (average of the solid ink pixels)
 *   5. trim to the signature
 */
export interface CleanupOptions {
  hasAlpha: boolean;
  sensitivity?: number; // about -40..40. Higher = more (lighter) strokes kept as ink.
  maxWidth?: number;    // uploads only
  padding?: number;
}

export function cleanupSignature(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  opts: CleanupOptions,
): string | null {
  const pad = opts.padding ?? 12;
  return opts.hasAlpha ? trimDrawn(source, srcW, srcH, pad) : extractFromPhoto(source, srcW, srcH, opts, pad);
}

function trimDrawn(source: CanvasImageSource, w: number, h: number, pad: number): string | null {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0);
  const d = ctx.getImageData(0, 0, w, h).data;
  const box = bounds((i) => d[i * 4 + 3] > 8, w, h);
  return box ? crop(c, box, pad) : null;
}

function extractFromPhoto(source: CanvasImageSource, srcW: number, srcH: number, o: CleanupOptions, pad: number): string | null {
  const scale = Math.min(1, (o.maxWidth ?? 1200) / srcW);
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const work = document.createElement('canvas');
  work.width = w; work.height = h;
  const ctx = work.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);          // transparent uploads are composited on white
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;

  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];

  const bg = estimateBackground(lum, w, h);
  const hist = new Array(256).fill(0);
  const norm = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const v = Math.min(255, Math.max(0, Math.round((lum[i] / Math.max(bg[i], 1)) * 255)));
    norm[i] = v; hist[v]++;
  }

  const t = otsu(hist, n) + (o.sensitivity ?? 0);
  const lo = t - 30, hi = t + 10;
  const alpha = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) alpha[i] = Math.round(255 * Math.min(1, Math.max(0, (hi - norm[i]) / (hi - lo))));

  removeSpecks(alpha, w, h, Math.max(10, Math.round(n * 0.00001)));

  const box = bounds((i) => alpha[i] > 20, w, h);
  if (!box) return null;

  // pen colour = average of solid ink pixels (keeps blue pens blue)
  let r = 0, g = 0, b = 0, cnt = 0;
  for (let i = 0; i < n; i++) if (alpha[i] >= 200) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; cnt++; }
  const ink = cnt ? [r / cnt, g / cnt, b / cnt] : [10, 31, 68];

  for (let i = 0; i < n; i++) { d[i * 4] = ink[0]; d[i * 4 + 1] = ink[1]; d[i * 4 + 2] = ink[2]; d[i * 4 + 3] = alpha[i]; }
  ctx.putImageData(img, 0, 0);
  return crop(work, box, pad);
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function bounds(test: (i: number) => boolean, w: number, h: number): Box | null {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (test(y * w + x)) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

function crop(src: HTMLCanvasElement, b: Box, pad: number): string {
  const out = document.createElement('canvas');
  out.width = b.maxX - b.minX + 1 + pad * 2;
  out.height = b.maxY - b.minY + 1 + pad * 2;
  out.getContext('2d')!.drawImage(src, pad - b.minX, pad - b.minY);
  return out.toDataURL('image/png');
}

/** Paper brightness map: shrink, max-filter (erases thin dark strokes), blur, upscale bilinearly. */
function estimateBackground(lum: Float32Array, w: number, h: number): Float32Array {
  const f = Math.max(1, Math.round(Math.max(w, h) / 300));
  const sw = Math.ceil(w / f), sh = Math.ceil(h / f);
let small: Float32Array = new Float32Array(sw * sh);
  const cnt = new Uint16Array(sw * sh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = ((y / f) | 0) * sw + ((x / f) | 0);
    small[j] += lum[y * w + x]; cnt[j]++;
  }
  for (let j = 0; j < small.length; j++) small[j] /= cnt[j] || 1;

  const r = Math.max(5, Math.round(sw / 40));
  small = sep(sep(small, sw, sh, r, 'max'), sw, sh, r, 'mean');

  const bg = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5));
    const y0 = Math.floor(gy), y1 = Math.min(sh - 1, y0 + 1), fy = gy - y0;
    for (let x = 0; x < w; x++) {
      const gx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5));
      const x0 = Math.floor(gx), x1 = Math.min(sw - 1, x0 + 1), fx = gx - x0;
      const top = small[y0 * sw + x0] * (1 - fx) + small[y0 * sw + x1] * fx;
      const bot = small[y1 * sw + x0] * (1 - fx) + small[y1 * sw + x1] * fx;
      bg[y * w + x] = top * (1 - fy) + bot * fy;
    }
  }
  return bg;
}

function sep(src: Float32Array, w: number, h: number, r: number, mode: 'max' | 'mean'): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = mode === 'max' ? -Infinity : 0, c = 0;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) {
      const v = src[y * w + k];
      if (mode === 'max') { if (v > acc) acc = v; } else { acc += v; c++; }
    }
    tmp[y * w + x] = mode === 'max' ? acc : acc / c;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = mode === 'max' ? -Infinity : 0, c = 0;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
      const v = tmp[k * w + x];
      if (mode === 'max') { if (v > acc) acc = v; } else { acc += v; c++; }
    }
    out[y * w + x] = mode === 'max' ? acc : acc / c;
  }
  return out;
}

function otsu(hist: number[], total: number): number {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = i; }
  }
  return thr;
}

/** Zero out 8-connected blobs smaller than minArea (dust). */
function removeSpecks(alpha: Uint8ClampedArray, w: number, h: number, minArea: number) {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || alpha[s] <= 20) continue;
    const comp: number[] = [];
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!; comp.push(p);
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (!seen[q] && alpha[q] > 20) { seen[q] = 1; stack.push(q); }
      }
    }
    if (comp.length < minArea) for (const p of comp) alpha[p] = 0;
  }
}
