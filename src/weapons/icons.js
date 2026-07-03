// Weapon icons — Martin's picked set ("HUD Badge — Cut-Corner Plate", chosen
// 2026-07-03 in the weapon-icons lab). One cohesive cut-corner plate family for
// the HUD weapon slot and the track-side weapon pads.
// Monochrome by design: every stroke uses currentColor, so the UI tints them
// per state (armed / firing / disabled) and per accent. viewBox 0 0 64 64.

export const WEAPON_ICONS = {
  homing: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><polygon points="14,6 50,6 58,14 58,50 50,58 14,58 6,50 6,14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><circle cx="32" cy="32" r="16" fill="none" stroke="currentColor" stroke-width="4"/><path d="M32 41 L32 23 M25 30 L32 23 L39 30" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  missiles: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><polygon points="14,6 50,6 58,14 58,50 50,58 14,58 6,50 6,14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M18 46 L18 24 M13 30 L18 24 L23 30" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M32 38 L32 16 M26 23 L32 16 L38 23" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M46 46 L46 24 M41 30 L46 24 L51 30" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  boost: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><polygon points="14,6 50,6 58,14 58,50 50,58 14,58 6,50 6,14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><polyline points="20,28 32,16 44,28" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><polyline points="20,42 32,30 44,42" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><line x1="22" y1="50" x2="42" y2="50" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`,
  shield: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><polygon points="14,6 50,6 58,14 58,50 50,58 14,58 6,50 6,14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><polygon points="18,14 46,14 46,30 32,50 18,30" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>`,
  mine: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><polygon points="14,6 50,6 58,14 58,50 50,58 14,58 6,50 6,14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><circle cx="32" cy="32" r="11" fill="none" stroke="currentColor" stroke-width="4"/><path d="M32 13 L32 19 M32 45 L32 51 M13 32 L19 32 M45 32 L51 32 M19 19 L23 23 M45 19 L41 23 M19 45 L23 41 M45 45 L41 41" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`,
};

// Display order for HUD/pickup cycling.
export const WEAPON_ORDER = ['homing', 'missiles', 'boost', 'shield', 'mine'];
