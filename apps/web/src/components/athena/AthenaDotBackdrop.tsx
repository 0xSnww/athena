import { useLayoutEffect, useRef } from "react";

import { useRenderedAppearance } from "~/hooks/useTheme";
import { observeResize } from "~/lib/observeResize";

const GRID_STEP = 4;
const DOT_SIZE = 2;
const ALPHA_BUCKETS = 24;

// 8x8 Bayer ordered-dither threshold matrix (0..63).
const BAYER_8X8 = new Uint8Array([
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7,
  39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
]);

const GRAD_X = new Float32Array(16);
const GRAD_Y = new Float32Array(16);
for (let i = 0; i < 16; i += 1) {
  const angle = (i * Math.PI) / 8;
  GRAD_X[i] = Math.cos(angle);
  GRAD_Y[i] = Math.sin(angle);
}

// Sculpted cumulus puff anchors [cx, cy, rx, ry, weight] framing the chat lane.
const CLOUD_PUFFS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  // Left wing: upper-mid billowing cumulus bank + misty lower bank.
  [0.01, 0.24, 0.11, 0.15, 0.94],
  [0.09, 0.33, 0.095, 0.13, 0.92],
  [0.04, 0.44, 0.11, 0.13, 0.86],
  [0.14, 0.47, 0.095, 0.11, 0.82],
  [0.21, 0.54, 0.08, 0.09, 0.54],
  [0.08, 0.58, 0.09, 0.1, 0.62],
  [0.03, 0.83, 0.12, 0.14, 0.78],
  [0.13, 0.89, 0.11, 0.11, 0.72],
  [0.23, 0.95, 0.1, 0.085, 0.48],
  // Right wing: cohesive towering cumulus crown, mid cauliflower head, and lower dome.
  [0.91, 0.12, 0.16, 0.17, 0.98],
  [0.79, 0.18, 0.13, 0.15, 0.9],
  [0.72, 0.29, 0.11, 0.13, 0.8],
  [0.86, 0.31, 0.15, 0.16, 0.96],
  [0.94, 0.46, 0.15, 0.18, 1.02],
  [0.81, 0.49, 0.14, 0.16, 1.05],
  [0.71, 0.57, 0.12, 0.14, 0.96],
  [0.64, 0.65, 0.095, 0.11, 0.74],
  [0.88, 0.74, 0.18, 0.18, 1.08],
  [0.75, 0.75, 0.14, 0.15, 1.04],
  [0.66, 0.83, 0.12, 0.13, 0.92],
  [0.82, 0.91, 0.2, 0.15, 1.02],
  [0.56, 0.92, 0.12, 0.095, 0.58],
];

const DARK_PALETTE = Array.from({ length: ALPHA_BUCKETS }, (_, index) => {
  const alpha = ((index + 1) / ALPHA_BUCKETS) * 0.88;
  return `rgba(232, 236, 244, ${alpha.toFixed(3)})`;
});

const LIGHT_PALETTE = Array.from({ length: ALPHA_BUCKETS }, (_, index) => {
  const alpha = ((index + 1) / ALPHA_BUCKETS) * 0.44;
  return `rgba(30, 36, 48, ${alpha.toFixed(3)})`;
});

function clamp(value: number, lo = 0, hi = 1): number {
  return value < lo ? lo : value > hi ? hi : value;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hashInt(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
}

function gradDot(ix: number, iy: number, dx: number, dy: number, seed: number): number {
  const g = hashInt(ix, iy, seed) & 15;
  return (GRAD_X[g] ?? 1) * dx + (GRAD_Y[g] ?? 0) * dy;
}

function gradNoise2d(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const n00 = gradDot(ix, iy, fx, fy, seed);
  const n10 = gradDot(ix + 1, iy, fx - 1, fy, seed);
  const n01 = gradDot(ix, iy + 1, fx, fy - 1, seed);
  const n11 = gradDot(ix + 1, iy + 1, fx - 1, fy - 1, seed);
  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return (nx0 + (nx1 - nx0) * v) * 0.72 + 0.5;
}

function fbm2d(x: number, y: number, seed: number, octaves: number, persistence = 0.55): number {
  let val = 0;
  let amp = 0.5;
  let norm = 0;
  let px = x;
  let py = y;
  for (let i = 0; i < octaves; i += 1) {
    val += gradNoise2d(px, py, seed + i * 31) * amp;
    norm += amp;
    // Rotate between octaves so cloud silhouettes stay isotropic instead of grid-aligned.
    const nx = 1.62 * px - 1.24 * py + 3.17;
    const ny = 1.24 * px + 1.62 * py - 2.41;
    px = nx;
    py = ny;
    amp *= persistence;
  }
  return val / norm;
}

function worleyPuff(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  let minD2 = 9;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const h1 = hashInt(ix + dx, iy + dy, seed) / 4294967295;
      const h2 = hashInt(ix + dx, iy + dy, seed + 131) / 4294967295;
      const px = dx + h1 * 0.76 + 0.12 - fx;
      const py = dy + h2 * 0.76 + 0.12 - fy;
      const d2 = px * px + py * py;
      if (d2 < minD2) minD2 = d2;
    }
  }
  return smoothstep(1.06, 0.04, Math.sqrt(minD2));
}

function puffEnvelope(nx: number, ny: number): number {
  let maxVal = 0;
  let softSum = 0;
  for (const [cx, cy, rx, ry, weight] of CLOUD_PUFFS) {
    const ux = (nx - cx) / rx;
    const uy = (ny - cy) / ry;
    const d2 = ux * ux + uy * uy;
    if (d2 > 4) continue;
    const v = Math.exp(-d2 * 1.12) * weight;
    if (v > maxVal) maxVal = v;
    softSum += v;
  }
  return clamp(maxVal * 0.74 + softSum * 0.14);
}

function drawCloudMatrix(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  appearance: "dark" | "light",
) {
  if (width <= 0 || height <= 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetWidth = Math.round(width * dpr);
  const targetHeight = Math.round(height * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const cols = Math.ceil(width / GRID_STEP);
  const rows = Math.ceil(height / GRID_STEP);
  const cellCount = rows * cols;
  const aspect = width / Math.max(height, 1);
  const centerX = width * 0.5;
  const clearHalf = Math.min(width * 0.27, 355);
  const fadeSpan = Math.max(170, Math.min(280, width * 0.22));

  const density = new Float32Array(cellCount);
  const puffHeight = new Float32Array(cellCount);
  const mistField = new Float32Array(cellCount);
  const laneMask = new Float32Array(cellCount);

  for (let row = 0; row < rows; row += 1) {
    const y = row * GRID_STEP + 1;
    const ny = y / height;
    const py = ny * 3.15;
    const rowOff = row * cols;
    const bottomRelief = smoothstep(0.75, 1, ny) * 44;
    const effClear = Math.max(55, clearHalf - bottomRelief);

    for (let col = 0; col < cols; col += 1) {
      const x = col * GRID_STEP + 1;
      const nx = x / width;
      const px = nx * aspect * 3.15;

      const w1x = (fbm2d(px * 0.58 + 3.4, py * 0.58 - 2.1, 19, 3, 0.52) - 0.5) * 0.56;
      const w1y = (fbm2d(px * 0.58 - 4.1, py * 0.58 + 4.8, 61, 3, 0.52) - 0.5) * 0.56;

      // Warp the center reading lane so clouds taper organically instead of clipping vertically.
      const distC = Math.abs(x - centerX) + w1x * 85;
      const lane = smoothstep(effClear * 0.8, effClear * 0.8 + fadeSpan, distC);
      if (lane <= 0.012) continue;

      const env = puffEnvelope(nx + w1x * 0.085, ny + w1y * 0.085);
      if (env < 0.03) continue;

      const qx = px + w1x;
      const qy = py + w1y;

      const w2x = (fbm2d(qx * 1.45 + 1.3, qy * 1.45 + 5.9, 83, 2, 0.54) - 0.5) * 0.22;
      const w2y = (fbm2d(qx * 1.45 - 5.2, qy * 1.45 - 1.9, 107, 2, 0.54) - 0.5) * 0.22;
      const rx = qx + w2x;
      const ry = qy + w2y;

      const macroFbm = fbm2d(rx * 0.9, ry * 0.9, 149, 5, 0.56);
      const wLarge = worleyPuff(qx * 1.45 + 1.1, qy * 1.45 - 0.7, 311);
      const wMed = worleyPuff(rx * 2.85 - 2.2, ry * 2.85 + 2.5, 401);
      const wFine = worleyPuff(rx * 5.4 + 3.9, ry * 5.4 - 3.6, 463);
      const wisps = fbm2d(rx * 2.65 + 7.4, ry * 2.65 - 4.1, 509, 4, 0.58);

      const puffField = wLarge * 0.42 + wMed * 0.34 + wFine * 0.24;
      const cloudMass = env * 0.6 + macroFbm * 0.34 + puffField * 0.36;
      const mist = clamp((env * 0.62 + macroFbm * 0.48 + wisps * 0.22 - 0.52) * 1.35);
      const eroded = cloudMass - (1 - wisps) * 0.24 - 0.47;
      const d = clamp(eroded * 2.3);
      if (d <= 0.008 && mist <= 0.02) continue;

      const idx = rowOff + col;
      density[idx] = d;
      puffHeight[idx] = d * (0.36 + 0.64 * puffField);
      mistField[idx] = mist * wisps;
      laneMask[idx] = lane;
    }
  }

  const buckets: number[][] = Array.from({ length: ALPHA_BUCKETS }, () => []);
  const sampleField = (field: Float32Array, c: number, r: number): number => {
    const cc = c < 0 ? 0 : c >= cols ? cols - 1 : c;
    const rr = r < 0 ? 0 : r >= rows ? rows - 1 : r;
    return field[rr * cols + cc] ?? 0;
  };

  for (let row = 0; row < rows; row += 1) {
    const y = row * GRID_STEP + 1;
    const rowOff = row * cols;
    const bayerRow = (row & 7) << 3;

    for (let col = 0; col < cols; col += 1) {
      const idx = rowOff + col;
      const d = density[idx] ?? 0;
      const mist = mistField[idx] ?? 0;
      if (d <= 0.008 && mist <= 0.02) continue;

      const lane = laneMask[idx] ?? 0;
      const h = puffHeight[idx] ?? 0;
      const x = col * GRID_STEP + 1;
      const isLeft = x < centerX;
      const sx = isLeft ? 1 : -1;

      const hUpNear = sampleField(puffHeight, col + sx, row - 2);
      const hUpMid = sampleField(puffHeight, col + sx * 2, row - 6);
      const dShadow1 = sampleField(density, col + sx * 3, row - 9);
      const dShadow2 = sampleField(density, col + sx * 5, row - 17);

      const microSlope = clamp((h - hUpNear) * 2.8 + 0.34);
      const mesoSlope = clamp((h - hUpMid) * 1.9 + 0.36);
      const transmittance = Math.exp(-(dShadow1 * 0.55 + dShadow2 * 0.72) * 1.25);
      const domeCrown = Math.pow(clamp(h * 1.22), 1.18);
      const edgeScat = 1 - Math.exp(-d * 4.5);

      const coreLight =
        (domeCrown * 0.52 + microSlope * 0.24 + mesoSlope * 0.24) * (0.24 + 0.76 * transmittance);
      const silverRim =
        Math.pow(clamp(microSlope * (0.4 + 0.6 * transmittance) * 1.34), 1.48) * 0.52 * edgeScat;
      const halo = mist * 0.24;

      const wingBalance = isLeft ? 0.92 : 1.05;
      const rawLum = clamp((coreLight * edgeScat * 0.95 + silverRim + halo) * wingBalance);
      const lum = clamp(Math.pow(rawLum, 1.05) * 1.2) * lane;

      const bayer = ((BAYER_8X8[bayerRow + (col & 7)] ?? 0) + 0.5) / 64;
      const gate = lum * 1.22 - bayer * 0.88;
      if (gate <= 0) continue;

      const headroom = clamp(gate / 0.28);
      const tone = clamp((0.09 + Math.pow(lum, 0.85) * 0.91) * (0.44 + 0.56 * headroom));
      const bucketIdx = Math.min(ALPHA_BUCKETS - 1, Math.floor(tone * ALPHA_BUCKETS));
      const bucket = buckets[bucketIdx];
      if (bucket) {
        bucket.push(x, y);
      }
    }
  }

  const palette = appearance === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
  for (let i = 0; i < ALPHA_BUCKETS; i += 1) {
    const coords = buckets[i];
    if (!coords || coords.length === 0) continue;
    ctx.fillStyle = palette[i] ?? palette[0]!;
    ctx.beginPath();
    for (let j = 0; j < coords.length; j += 2) {
      ctx.rect(coords[j]!, coords[j + 1]!, DOT_SIZE, DOT_SIZE);
    }
    ctx.fill();
  }
}

/**
 * Static procedural Bayer-dithered cumulus cloud backdrop for the chat canvas.
 * Redraws only on container resize or appearance change so idle GPU usage stays zero.
 */
export function AthenaDotBackdrop() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const appearance = useRenderedAppearance();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- draws the static cloud backdrop on mount, container resize, and appearance change
  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let frame: number | null = null;
    const paint = () => {
      frame = null;
      drawCloudMatrix(canvas, container.clientWidth, container.clientHeight, appearance);
    };

    paint();
    const stopObserving = observeResize(container, () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      stopObserving();
    };
  }, [appearance]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      data-athena-dot-backdrop
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
