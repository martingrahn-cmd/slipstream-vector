// Rival AI difficulty — the player-picked tier, DECOUPLED from which track is
// being raced. Picking a tier raises only DRIVER skill (corner-speed
// confidence, line tightness, boost-pad usage) IDENTICALLY for the whole
// field — it never touches ship speed, so fairness (no rubber-banding) is
// untouched. `level` feeds the same skill formula the roster index used to,
// so the old per-track range maps cleanly onto an explicit choice.
//
// Unlike speed classes, every tier is available from the start: difficulty is
// a challenge you choose, not a reward you earn.
export const DIFFICULTIES = [
  {
    id: 'rookie', name: 'ROOKIE', level: 0.6,
    tag: 'FORGIVING', color: 0x3fae6b,
    blurb: 'A patient field. Room to learn the lines.',
  },
  {
    id: 'pro', name: 'PRO', level: 3.1,
    tag: 'TOUGH', color: 0xffd23f,
    blurb: 'A real fight. Mistakes hand them the place.',
  },
  {
    id: 'ace', name: 'ACE', level: 5.4,
    tag: 'BRUTAL', color: 0xff3b3b,
    blurb: 'Ruthless lines, late brakes. No mercy.',
  },
  {
    id: 'apex', name: 'APEX', level: 6.5,
    tag: 'MERCILESS', color: 0xb14dff,
    blurb: 'The field races like it hates you.',
  },
];
