// Generates SYNTHETIC, ILLUSTRATED intraoral photos for demo seed data (no real patient imagery).
// Renders parametric SVG scenes (projected dental arch, gingiva, aligner overlay, attachments) with headless Chromium.
// Usage: node scripts/generate-seed-images.mjs   → writes JPEGs to seed-assets/
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed-assets');
fs.mkdirSync(OUT, { recursive: true });
const W = 1200, H = 900;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Arch angles (deg) for teeth 1..7 in a quadrant and base crown sizes.
const ANG = [6, 19, 33, 47, 60, 72, 84];
const UW = [96, 78, 84, 72, 70, 92, 86], UH = [170, 150, 172, 140, 132, 118, 108];
const LW = [66, 68, 76, 72, 72, 96, 90], LH = [128, 132, 150, 132, 126, 110, 104];

const tooth = (q, n) => q * 10 + n;

function crownPath(x, y, w, h, up) {
  // Crown with rounded incisal edge; `up` = upper tooth (gum at top).
  const r = Math.min(w * 0.42, 34);
  if (up) return `M${x},${y} L${x + w},${y} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x + r},${y + h} Q${x},${y + h} ${x},${y + h - r} Z`;
  return `M${x},${y + h} L${x + w},${y + h} L${x + w},${y + r} Q${x + w},${y} ${x + w - r},${y} L${x + r},${y} Q${x},${y} ${x},${y + r} Z`;
}

function buccalScene(o) {
  const r = rng(o.seed);
  const yaw = (o.yaw ?? 0) * Math.PI / 180;
  const cx = W / 2 + (r() - 0.5) * 24, R = 620;
  const upperGum = 262 + (r() - 0.5) * 16, overbite = 36;
  const lowerGum = upperGum + UH[0] + LH[0] - overbite + (r() - 0.5) * 8;
  const hue = 350 + (r() - 0.5) * 12;
  const shade = 232 + Math.round((r() - 0.5) * 10);
  const teeth = [];
  for (const [q, sign, upper] of [[1, -1, true], [2, 1, true], [4, -1, false], [3, 1, false]]) {
    for (let n = 1; n <= 7; n++) {
      const th = sign * ANG[n - 1] * Math.PI / 180 - yaw;
      const vis = Math.cos(th);
      if (vis < 0.12) continue;
      const w = (upper ? UW : LW)[n - 1] * (0.35 + 0.75 * vis) * 1.32;
      const hgt = (upper ? UH : LH)[n - 1] * (0.82 + 0.18 * vis);
      const x = cx + R * Math.sin(th) * 0.92 - w / 2;
      const y = upper ? upperGum : lowerGum - hgt;
      teeth.push({ fdi: tooth(q, n), q, n, upper, x, y, w, h: hgt, vis });
    }
  }
  teeth.sort((a, b) => a.vis - b.vis);
  const lowers = teeth.filter((t) => !t.upper), uppers = teeth.filter((t) => t.upper);
  const enamel = (t) => `url(#enamel${t.upper ? 'U' : 'L'})`;
  let s = '';
  const drawTooth = (t) => {
    let g = `<path d="${crownPath(t.x, t.y, t.w, t.h, t.upper)}" fill="${enamel(t)}" stroke="#b9ae98" stroke-width="1.5"/>`;
    // Enamel sheen
    g += `<path d="M${t.x + t.w * 0.28},${t.y + t.h * (t.upper ? 0.15 : 0.35)} q${t.w * 0.08},${t.h * 0.3} 0,${t.h * 0.45}" stroke="rgba(255,255,255,0.55)" stroke-width="${Math.max(3, t.w * 0.07)}" fill="none" stroke-linecap="round"/>`;
    const att = (o.attachments ?? []).includes(t.fdi) && t.vis > 0.35;
    const missing = (o.missingAttachments ?? []).includes(t.fdi);
    if (att && !missing) {
      const aw = t.w * 0.38, ah = t.h * 0.2, ax = t.x + t.w / 2 - aw / 2, ay = t.y + t.h * (t.upper ? 0.42 : 0.4);
      g += `<rect x="${ax + 3}" y="${ay + 4}" width="${aw}" height="${ah}" rx="6" fill="rgba(80,60,40,0.25)"/><rect x="${ax}" y="${ay}" width="${aw}" height="${ah}" rx="6" fill="#fbf8ef" stroke="#cfc3a8" stroke-width="1.5"/>`;
    }
    if (att && missing) {
      const aw = t.w * 0.38, ah = t.h * 0.2, ax = t.x + t.w / 2 - aw / 2, ay = t.y + t.h * (t.upper ? 0.42 : 0.4);
      g += `<rect x="${ax}" y="${ay}" width="${aw}" height="${ah}" rx="6" fill="none" stroke="rgba(170,150,120,0.35)" stroke-width="1.2" stroke-dasharray="3 3"/>`;
    }
    if (o.aligner) {
      const gap = (o.gapTeeth ?? []).includes(t.fdi) ? (o.gapPx ?? 16) : 0;
      const pad = 4;
      const ay = t.upper ? t.y - 8 : t.y - pad - gap;
      const ah = t.h + 8 + pad + gap;
      if (gap) g += `<rect x="${t.x - 1}" y="${t.upper ? t.y + t.h - 2 : t.y - gap}" width="${t.w + 2}" height="${gap + 2}" fill="rgba(215,225,232,0.42)"/>`;
      g += `<path d="${crownPath(t.x - pad, ay, t.w + pad * 2, ah, t.upper)}" fill="rgba(255,255,255,0.13)" stroke="rgba(255,255,255,0.7)" stroke-width="2"/>`;
      g += `<path d="M${t.x + t.w * 0.62},${t.y + t.h * 0.2} l${t.w * 0.05},${t.h * 0.5}" stroke="rgba(255,255,255,0.8)" stroke-width="3" stroke-linecap="round"/>`;
      if ((o.crackTeeth ?? []).includes(t.fdi)) g += `<path d="M${t.x + t.w * 0.2},${t.upper ? t.y + t.h + 4 : t.y} l${t.w * 0.25},${t.upper ? -t.h * 0.35 : t.h * 0.35} l${t.w * 0.18},${t.upper ? -t.h * 0.12 : t.h * 0.12} l${t.w * 0.2},${t.upper ? -t.h * 0.3 : t.h * 0.3}" stroke="rgba(255,255,255,0.95)" stroke-width="2.5" fill="none"/>`;
    }
    return g;
  };
  // Scalloped gingiva drawn over the crown necks (papillae between teeth, zenith over each crown).
  const scallop = (row, upper) => {
    const ts = [...row].sort((a, b) => a.x - b.x);
    const base = upper ? upperGum : lowerGum, dir = upper ? 1 : -1;
    let d = upper ? `M0,0 L0,${base + 36 * dir}` : `M0,${H} L0,${base + 36 * dir}`;
    for (const t of ts) {
      const zen = base + 10 * dir, pap = base + 38 * dir;
      d += ` L${t.x},${pap} Q${t.x + t.w / 2},${zen - 8 * dir} ${t.x + t.w},${pap}`;
    }
    d += upper ? ` L${W},${base + 36 * dir} L${W},0 Z` : ` L${W},${base + 36 * dir} L${W},${H} Z`;
    return `<path d="${d}" fill="url(#gum${upper ? 'U' : 'L'})"/>`;
  };
  s += lowers.map(drawTooth).join('') + scallop(lowers, false) + uppers.map(drawTooth).join('') + scallop(uppers, true);
  // Retractor + lips frame
  s += `<path fill-rule="evenodd" d="M0,0 H${W} V${H} H0 Z M${W / 2},${70} C${W * 1.02},${70} ${W * 1.02},${H - 70} ${W / 2},${H - 70} C${-W * 0.02},${H - 70} ${-W * 0.02},${70} ${W / 2},${70} Z" fill="hsl(${hue},38%,34%)"/>`;
  s += `<ellipse cx="${W / 2}" cy="${H / 2}" rx="${W * 0.52}" ry="${H * 0.45}" fill="none" stroke="rgba(205,232,245,0.45)" stroke-width="46"/>`;
  s += `<ellipse cx="${W / 2}" cy="${H / 2}" rx="${W * 0.52}" ry="${H * 0.45}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="3"/>`;
  s += watermark;
  const defs = `<defs>
    <linearGradient id="enamelU" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${shade - 20},${shade - 30},${shade - 48})"/><stop offset="0.35" stop-color="rgb(${shade},${shade - 6},${shade - 20})"/><stop offset="1" stop-color="rgb(${shade + 8},${shade + 4},${shade - 6})"/></linearGradient>
    <linearGradient id="enamelL" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="rgb(${shade - 22},${shade - 32},${shade - 50})"/><stop offset="0.4" stop-color="rgb(${shade - 4},${shade - 10},${shade - 24})"/><stop offset="1" stop-color="rgb(${shade + 6},${shade + 2},${shade - 8})"/></linearGradient>
    <linearGradient id="gumU" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},48%,48%)"/><stop offset="1" stop-color="hsl(${hue},58%,66%)"/></linearGradient>
    <linearGradient id="gumL" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="hsl(${hue},48%,46%)"/><stop offset="1" stop-color="hsl(${hue},58%,65%)"/></linearGradient>
    <radialGradient id="mouth"><stop offset="0" stop-color="#3a1216"/><stop offset="1" stop-color="#1c0708"/></radialGradient>
  </defs>`;
  return `${defs}<rect width="${W}" height="${H}" fill="url(#mouth)"/>${s}`;
}

function occlusalScene(o) {
  const r = rng(o.seed);
  const upper = o.arch === 'upper';
  const hue = 350 + (r() - 0.5) * 10;
  const shade = 232 + Math.round((r() - 0.5) * 10);
  const cx = W / 2 + (r() - 0.5) * 20, top = upper ? 150 : 170, depth = 560, half = 390;
  let s = '';
  // Palate/tongue
  s += `<rect width="${W}" height="${H}" fill="hsl(${hue},40%,30%)"/>`;
  s += `<path d="M${cx - half - 60},${top + depth + 80} C${cx - half - 40},${top - 60} ${cx + half + 40},${top - 60} ${cx + half + 60},${top + depth + 80} Z" fill="hsl(${hue},${upper ? 52 : 46}%,${upper ? 64 : 58}%)"/>`;
  if (upper) for (let i = 0; i < 5; i++) s += `<path d="M${cx - 150 + i * 8},${top + 110 + i * 42} q150,${-26} 300,0" stroke="hsl(${hue},45%,57%)" stroke-width="7" fill="none" stroke-linecap="round"/>`;
  else s += `<ellipse cx="${cx}" cy="${top + depth * 0.62}" rx="${half * 0.62}" ry="${depth * 0.45}" fill="hsl(${hue + 5},55%,60%)"/>`;
  const qs = upper ? [[1, -1], [2, 1]] : [[4, -1], [3, 1]];
  const teeth = [];
  for (const [q, sign] of qs) for (let n = 1; n <= 7; n++) {
    const t = (ANG[n - 1] / 90);
    const x = cx + sign * half * Math.sin(t * Math.PI / 2) * 1.02;
    const y = top + depth * (1 - Math.cos(t * Math.PI / 2)) * 1.05 + 40;
    const size = [58, 50, 56, 56, 58, 80, 76][n - 1] * (upper ? 1.5 : 1.45);
    teeth.push({ fdi: q * 10 + n, x, y, size, n, angle: sign * t * 80 });
  }
  for (const t of teeth) {
    const rx = t.n <= 3 ? t.size * 0.62 : t.size * 0.58, ry = t.n <= 3 ? t.size * 0.34 : t.size * 0.55;
    s += `<g transform="translate(${t.x},${t.y}) rotate(${t.angle})">`;
    s += `<ellipse rx="${rx + 4}" ry="${ry + 4}" fill="rgba(120,90,70,0.35)"/><ellipse rx="${rx}" ry="${ry}" fill="url(#occ)" stroke="#b8ac92" stroke-width="1.5"/>`;
    if (t.n >= 4) s += `<path d="M${-rx * 0.5},0 Q0,${-ry * 0.25} ${rx * 0.5},0" stroke="rgba(140,120,95,0.55)" stroke-width="3" fill="none"/>`;
    if (t.n >= 6) s += `<path d="M0,${-ry * 0.5} L0,${ry * 0.5}" stroke="rgba(140,120,95,0.45)" stroke-width="2.5"/>`;
    const att = (o.attachments ?? []).includes(t.fdi), missing = (o.missingAttachments ?? []).includes(t.fdi);
    if (att) {
      // Attachment bump on the buccal (outer) surface: outward direction depends on the side of the arch.
      const bx = 0, by = ry * 0.92 * (upper ? -1 : -1);
      s += missing ? `<rect x="${bx - 12}" y="${by - 8}" width="24" height="14" rx="5" fill="none" stroke="rgba(170,150,120,0.35)" stroke-dasharray="3 3"/>`
        : `<rect x="${bx - 12}" y="${by - 8}" width="24" height="14" rx="5" fill="#fbf8ef" stroke="#cbbd9f" stroke-width="1.5"/>`;
    }
    if (o.aligner) s += `<ellipse rx="${rx + 7}" ry="${ry + 7}" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.65)" stroke-width="2"/>`;
    s += `</g>`;
  }
  if (o.glare) s += `<ellipse cx="${W * 0.46}" cy="${H * 0.42}" rx="${W * 0.3}" ry="${H * 0.26}" fill="url(#glare)"/>`;
  s += watermark;
  // Mirror edge
  s += `<rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="60" fill="none" stroke="rgba(230,238,245,0.5)" stroke-width="22"/>`;
  const defs = `<defs><radialGradient id="glare"><stop offset="0" stop-color="#fff"/><stop offset="0.75" stop-color="#fff"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient><radialGradient id="occ" cx="0.4" cy="0.35"><stop offset="0" stop-color="rgb(${shade + 10},${shade + 6},${shade - 4})"/><stop offset="1" stop-color="rgb(${shade - 18},${shade - 26},${shade - 44})"/></radialGradient></defs>`;
  return defs + s;
}

const watermark = `<text x="${W - 40}" y="${H - 34}" text-anchor="end" font-family="Helvetica, Arial" font-size="18" letter-spacing="3" fill="rgba(255,255,255,0.4)">SYNTHETIC DEMO IMAGE</text>`;
const FRONT_ATT = [13, 23, 33, 43, 14, 24, 15, 25, 34, 44];
const OCC_U = [13, 14, 15, 23, 24, 25, 16, 26], OCC_L = [33, 34, 35, 43, 44, 45];

const specs = [];
const add = (name, kind, o, filter = '') => specs.push({ name, kind, o, filter });
for (const [i, seed] of [[0, 11], [1, 23], [2, 37]]) {
  const v = 'abc'[i];
  add(`front_aligner_${v}`, 'buccal', { seed, yaw: 0, aligner: true, attachments: FRONT_ATT });
  add(`left_aligner_${v}`, 'buccal', { seed: seed + 1, yaw: 42, aligner: true, attachments: FRONT_ATT });
  add(`right_aligner_${v}`, 'buccal', { seed: seed + 2, yaw: -42, aligner: true, attachments: FRONT_ATT });
  add(`upper_noaligner_${v}`, 'occlusal', { seed: seed + 3, arch: 'upper', attachments: OCC_U });
  add(`lower_noaligner_${v}`, 'occlusal', { seed: seed + 4, arch: 'lower', attachments: OCC_L });
}
add('front_noaligner_a', 'buccal', { seed: 51, yaw: 0, attachments: FRONT_ATT });
add('front_noaligner_b', 'buccal', { seed: 52, yaw: 0, attachments: FRONT_ATT });
add('front_gap_a', 'buccal', { seed: 61, yaw: 0, aligner: true, attachments: FRONT_ATT, gapTeeth: [11, 21], gapPx: 16 });
add('front_gap_b', 'buccal', { seed: 62, yaw: 0, aligner: true, attachments: FRONT_ATT, gapTeeth: [11, 21, 12], gapPx: 18 });
add('left_gap_a', 'buccal', { seed: 63, yaw: 42, aligner: true, attachments: FRONT_ATT, gapTeeth: [23, 24], gapPx: 14 });
add('upper_attach_missing_a', 'occlusal', { seed: 71, arch: 'upper', attachments: OCC_U, missingAttachments: [13] });
add('left_attach_missing_a', 'buccal', { seed: 72, yaw: 42, aligner: false, attachments: FRONT_ATT, missingAttachments: [23] });
add('front_crack_a', 'buccal', { seed: 81, yaw: 0, aligner: true, attachments: FRONT_ATT, crackTeeth: [21] });
add('front_dark_a', 'buccal', { seed: 91, yaw: 0, aligner: true, attachments: FRONT_ATT }, 'brightness(0.24)');
add('left_blurry_a', 'buccal', { seed: 92, yaw: 42, aligner: true, attachments: FRONT_ATT }, 'blur(9px)');
add('upper_glare_a', 'occlusal', { seed: 93, arch: 'upper', attachments: OCC_U, glare: true }, 'brightness(1.5)');
for (const [view, kind, o] of [['front', 'buccal', { yaw: 0 }], ['left', 'buccal', { yaw: 42 }], ['right', 'buccal', { yaw: -42 }], ['upper', 'occlusal', { arch: 'upper' }], ['lower', 'occlusal', { arch: 'lower' }]])
  add(`baseline_${view}`, kind, { seed: 100 + view.length, ...o, attachments: kind === 'buccal' ? FRONT_ATT : o.arch === 'upper' ? OCC_U : OCC_L });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: W, height: H } });
for (const sp of specs) {
  const body = sp.kind === 'buccal' ? buccalScene(sp.o) : occlusalScene(sp.o);
  await page.setContent(`<html><body style="margin:0;background:#000"><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;filter:${sp.filter || 'none'}">${body}</svg></body></html>`);
  await page.screenshot({ path: path.join(OUT, `${sp.name}.jpg`), type: 'jpeg', quality: 80 });
  process.stdout.write('.');
}
await browser.close();
console.log(`\n${specs.length} images written to ${OUT}`);
