// HUD minimap: the track outline (drawn once from the spline LUT to an
// offscreen canvas) with the ship as a glowing dot. North-up, top-right.
import { TUNING as T } from '../config.js';

const HEIGHT = 190;      // CSS pixels, width follows the track's aspect
const PAD = 14;          // inner padding so glow strokes aren't clipped

export class Minimap {
  constructor(spline, canvas) {
    this.canvas = canvas;
    this.dpr = Math.min(devicePixelRatio || 1, 2);

    // Bounds of the track in the XZ plane.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < spline.n; i++) {
      const x = spline.pos[i * 3], z = spline.pos[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const spanX = maxX - minX, spanZ = maxZ - minZ;
    const innerH = HEIGHT - PAD * 2;
    const scale = innerH / spanZ;
    const w = Math.round(spanX * scale) + PAD * 2;
    const h = HEIGHT;

    canvas.width = w * this.dpr;
    canvas.height = h * this.dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    this.w = w; this.h = h;

    // World XZ -> map pixels. Canvas y grows downward and world z grows
    // southward, so -Z (the start straight's heading) is naturally "up".
    this.toMap = (x, z) => [
      PAD + (x - minX) * scale,
      PAD + (z - minZ) * scale,
    ];

    this.base = document.createElement('canvas');
    this.base.width = canvas.width;
    this.base.height = canvas.height;
    this._drawBase(spline);

    this.ctx = canvas.getContext('2d');
  }

  _drawBase(spline) {
    const ctx = this.base.getContext('2d');
    ctx.scale(this.dpr, this.dpr);

    // Backdrop panel.
    ctx.fillStyle = 'rgba(10, 4, 28, 0.55)';
    roundRect(ctx, 0, 0, this.w, this.h, 8);
    ctx.fill();

    // Track path from the LUT, every ~6m is plenty.
    ctx.beginPath();
    const step = Math.max(1, Math.round(6 / spline.step));
    for (let i = 0; i <= spline.n; i += step) {
      const j = (i % spline.n) * 3;
      const [mx, my] = this.toMap(spline.pos[j], spline.pos[j + 2]);
      if (i === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
    }
    ctx.closePath();
    // Body underlay, then neon core.
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(36, 16, 82, 0.95)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.6;
    ctx.shadowColor = 'rgba(0, 240, 255, 0.9)';
    ctx.shadowBlur = 5;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Boost pads.
    ctx.fillStyle = '#7df9ff';
    for (const pad of spline.pads) {
      const f = this._frameXZ(spline, pad.s);
      const [mx, my] = this.toMap(f[0], f[1]);
      ctx.beginPath();
      ctx.arc(mx, my, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }

    // Start/finish tick, perpendicular to the track.
    const i0 = 0;
    const tx = spline.tan[i0 * 3], tz = spline.tan[i0 * 3 + 2];
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len, nz = tx / len;
    const [sx, sy] = this.toMap(spline.pos[0], spline.pos[2]);
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 2.4;
    ctx.shadowColor = 'rgba(255, 210, 63, 0.9)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(sx - nx * 5, sy - nz * 5);
    ctx.lineTo(sx + nx * 5, sy + nz * 5);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Route forks: the centerline splays into two bowed arcs that rejoin (a
    // "lens") — the only place on the map where one line becomes two, so it
    // reads instantly as a fork. The real ~4.5m gap is sub-pixel here, so the
    // separation is deliberately exaggerated to a fixed ~5px. The safe arc
    // matches the track body; the fast/boost arc runs a notch hotter in cyan.
    const OFF = 5.0;  // px half-separation (diagrammatic, not to scale)
    const NS = 16;
    for (const sp of (spline.splits || [])) {
      const fast = [], safe = [];
      const fSide = sp.fast >= 0 ? 1 : -1;
      for (let k = 0; k <= NS; k++) {
        const t = k / NS;
        const s = spline.wrap(sp.s0 + t * sp.span);
        const i = Math.round(spline.wrap(s) / spline.step) % spline.n;
        const wx = spline.pos[i * 3], wz = spline.pos[i * 3 + 2];
        const [cx, cy] = this.toMap(wx, wz);
        const [rxp, ryp] = this.toMap(wx + spline.right[i * 3], wz + spline.right[i * 3 + 2]);
        let dx = rxp - cx, dy = ryp - cy;             // map-space RIGHT (px)
        const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
        // Bow: 0 at both noses, fat in the middle (echoes the in-world wedge).
        const bow = Math.pow(Math.sin(t * Math.PI), 0.7) * OFF * fSide;
        fast.push([cx + dx * bow, cy + dy * bow]);
        safe.push([cx - dx * bow, cy - dy * bow]);
      }
      strokeArc(ctx, safe, 'rgba(36, 16, 82, 0.95)', 5);
      strokeArc(ctx, safe, 'rgba(255, 255, 255, 0.8)', 1.6, 'rgba(0, 240, 255, 0.9)', 5);
      strokeArc(ctx, fast, 'rgba(36, 16, 82, 0.95)', 5);
      strokeArc(ctx, fast, 'rgba(125, 249, 255, 0.95)', 1.8, 'rgba(0, 240, 255, 1)', 6);
      // Entry-nose anchor: a dark-backed cyan dot where the choice begins.
      const ni = Math.round(spline.wrap(sp.s0) / spline.step) % spline.n;
      const [nx2, ny2] = this.toMap(spline.pos[ni * 3], spline.pos[ni * 3 + 2]);
      ctx.beginPath();
      ctx.arc(nx2, ny2, 2.0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10, 4, 28, 0.9)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#7df9ff';
      ctx.shadowColor = 'rgba(0, 240, 255, 0.9)';
      ctx.shadowBlur = 4;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  _frameXZ(spline, s) {
    const i = Math.round(spline.wrap(s) / spline.step) % spline.n;
    return [spline.pos[i * 3], spline.pos[i * 3 + 2]];
  }

  // shipPos: world Vector3 (the visual root). boosting: pulse the dot cyan.
  // others: [{x, z, color}] — the AI field, drawn under the player dot.
  update(shipPos, boosting, time, others) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (others) {
      for (const o of others) {
        const [ox, oy] = this.toMap(o.x, o.z);
        ctx.fillStyle = o.color;
        ctx.beginPath();
        ctx.arc(ox, oy, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const [mx, my] = this.toMap(shipPos.x, shipPos.z);
    const pulse = boosting ? 1 + 0.25 * Math.sin(time * 18) : 1;
    ctx.shadowColor = boosting ? 'rgba(0, 240, 255, 1)' : 'rgba(255, 46, 200, 1)';
    ctx.shadowBlur = 9 * pulse;
    ctx.fillStyle = boosting ? '#7df9ff' : '#ff2ec8';
    ctx.beginPath();
    ctx.arc(mx, my, 3.4 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(mx, my, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Stroke a pixel polyline, optionally with a neon glow. Used for the fork lens.
function strokeArc(ctx, pts, color, w, glow, blur) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = blur; } else { ctx.shadowBlur = 0; }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
