// Speed classes — the player-picked global tier, à la WipEout's
// Venom/Rapier/Phantom. A class scales top speed + acceleration + AI skill
// IDENTICALLY for everyone, so it changes the whole race's pace and
// difficulty without breaking fairness (no rubber-banding). Unlocked in
// order by winning the championship at the current class.
export const CLASSES = [
  {
    id: 'pulse',
    name: 'PULSE',
    vmax: 0.82, accel: 0.9, aiSkill: -0.06,
    color: 0xffb13d,
    blurb: 'Find the rhythm. Learn the lines.',
  },
  {
    id: 'surge',
    name: 'SURGE',
    vmax: 1.0, accel: 1.0, aiSkill: 0.0,
    color: 0x00f0ff,
    blurb: 'Full racing speed. The real test.',
  },
  {
    id: 'overdrive',
    name: 'OVERDRIVE',
    vmax: 1.18, accel: 1.15, aiSkill: 0.06,
    color: 0xff2ec8,
    blurb: 'Redlined. No room for error.',
  },
];

// Headline top speed of a class at the baseline hull, in km/h.
export function classKmh(cls, baseVmax) {
  return Math.round(baseVmax * cls.vmax * 3.6);
}
