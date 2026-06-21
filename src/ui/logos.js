// Procedural team logos + a trackside-billboard ad atlas. Logos are drawn to a
// 2D canvas context (so they work both as a 3D CanvasTexture on billboards and
// as a DOM badge in the garage). One bold neon mark per stable — no bitmaps.
import * as THREE from 'three';
import { TEAMS } from '../worlds/teams.js';

const hx = (c) => '#' + c.toString(16).padStart(6, '0');

// Draw a team's mark centered at (cx, cy) with radius r, in `accent` (CSS color).
// Neon look via shadowBlur — fine on a texture canvas (not the chat UI).
export function drawTeamLogo(ctx, id, cx, cy, r, accent) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = Math.max(2, r * 0.16);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = accent;
  ctx.shadowBlur = r * 0.45;
  if (id === 'vektor') {
    // Two nested upward chevrons — a sharp vector arrow.
    for (const s of [1, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.75 * s, r * 0.5 * s);
      ctx.lineTo(0, -r * 0.7 * s);
      ctx.lineTo(r * 0.75 * s, r * 0.5 * s);
      ctx.stroke();
    }
  } else if (id === 'halcyon') {
    // A swept wing — two mirrored arcs meeting at a forward point.
    ctx.beginPath();
    ctx.moveTo(0, r * 0.35);
    ctx.quadraticCurveTo(-r * 0.95, -r * 0.1, -r * 0.15, -r * 0.75);
    ctx.moveTo(0, r * 0.35);
    ctx.quadraticCurveTo(r * 0.95, -r * 0.1, r * 0.15, -r * 0.75);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, r * 0.05, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 'razorback') {
    // An aggressive razor zigzag.
    ctx.beginPath();
    ctx.moveTo(-r * 0.85, -r * 0.35);
    ctx.lineTo(-r * 0.25, r * 0.55);
    ctx.lineTo(0, -r * 0.15);
    ctx.lineTo(r * 0.25, r * 0.55);
    ctx.lineTo(r * 0.85, -r * 0.35);
    ctx.stroke();
  } else {
    // novasurge — a radiant nova starburst.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const r1 = i % 2 ? r * 0.55 : r * 0.92;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Faux sponsor boards — generic neon ad slogans that read as set dressing.
const SLOGANS = [
  ['SLIPSTREAM', 'LEAGUE'],
  ['TURBO', 'CLASS-S'],
  ['RACE THE', 'GRID'],
  ['NEON', 'CIRCUIT'],
];

function adPanel(ctx, x, y, w, h, bg, accent) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  // inner neon frame
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 10;
  ctx.strokeRect(x + 8, y + 8, w - 16, h - 16);
  ctx.restore();
}

// Build one atlas CanvasTexture: 4 team-logo boards + 4 sponsor boards, plus an
// array of UV cell rects (WebGL-oriented, v measured from the bottom).
export function buildBillboardAtlas() {
  const COLS = 4, ROWS = 2, CW = 256, CH = 128;
  const cv = document.createElement('canvas');
  cv.width = COLS * CW;
  cv.height = ROWS * CH;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0a0618';
  ctx.fillRect(0, 0, cv.width, cv.height);
  const cells = [];
  const pushCell = (col, row) => {
    cells.push({ u: (col * CW) / cv.width, v: 1 - ((row + 1) * CH) / cv.height, w: CW / cv.width, h: CH / cv.height });
  };

  // Row 0: the four team logo boards.
  TEAMS.forEach((team, i) => {
    const col = i;
    const x = col * CW, y = 0;
    const accent = hx(team.liveries[0].accent);
    adPanel(ctx, x, y, CW, CH, '#0d0a22', accent);
    drawTeamLogo(ctx, team.id, x + CH * 0.55, y + CH * 0.5, CH * 0.3, accent);
    ctx.save();
    ctx.fillStyle = accent;
    ctx.shadowColor = accent; ctx.shadowBlur = 8;
    ctx.font = '700 30px Orbitron, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(team.name, x + CH * 1.05, y + CH * 0.5);
    ctx.restore();
    pushCell(col, 0);
  });

  // Row 1: four sponsor / slogan boards in alternating neon.
  const accents = ['#00f0ff', '#ff2ec8', '#ffd23f', '#7df9ff'];
  SLOGANS.forEach((lines, i) => {
    const col = i;
    const x = col * CW, y = CH;
    const accent = accents[i % accents.length];
    adPanel(ctx, x, y, CW, CH, '#0d0a22', accent);
    ctx.save();
    ctx.fillStyle = accent;
    ctx.shadowColor = accent; ctx.shadowBlur = 8;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 34px Orbitron, sans-serif';
    ctx.fillText(lines[0], x + CW / 2, y + CH * 0.38);
    ctx.font = '800 40px Orbitron, sans-serif';
    ctx.fillText(lines[1], x + CW / 2, y + CH * 0.68);
    ctx.restore();
    pushCell(col, 1);
  });

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { texture: tex, cells };
}
