// World 2, track 2: tight technical island-hopper — two true hairpins, ridge
// esses, and a full F-Zero LOOP on the south straight (cp 2-8: a 40m-radius
// circle in the direction of travel, corkscrewed 30m sideways so the exit leg
// clears the entry leg).
export const CORAL_KEYS = {
  id: 'coral-keys',
  name: 'Coral Keys',
  world: 'tropic',
  laps: 3,
  // Width is half-width in metres (full road = 2x). It's the stakes lever: wide
  // on straights (room to breathe + set up), hard pinches at every apex so the
  // brave inside line is genuinely committed and the wall is reachable. The
  // loop (cp 2-8) and the corkscrew straight (cp 9-11) are kept WIDE so the
  // stunts have room. Centerline (x/y/z) is untouched — only widths changed —
  // so the loop/corkscrew/pad/fork cp-references all stay valid.
  points: [
    { x: -270, y: 4, z: 0, width: 16 },   //  0 start/finish, heading east (wide launch)
    { x: -110, y: 3, z: -10, width: 16 }, //  1 south straight (room to set up the loop)
    { x: -60, y: 3, z: -22, width: 13 },  //  2 LOOP entry (bottom — keep room)
    { x: -25, y: 23, z: -17, width: 13 }, //  3 climbing the face
    { x: -25, y: 63, z: -12, width: 13 }, //  4
    { x: -60, y: 83, z: -7, width: 13 },  //  5 the top — sky below you
    { x: -95, y: 63, z: -2, width: 13 },  //  6
    { x: -95, y: 23, z: 3, width: 13 },   //  7
    { x: -60, y: 3, z: 8, width: 13 },    //  8 LOOP exit (bottom, 30m over)
    { x: 55, y: 4, z: 10, width: 14 },    //  9 straight resumes (corkscrew — keep room)
    { x: 215, y: 5, z: -10, width: 14 },  // 10 (barrel roll — keep room for the roll)
    { x: 350, y: 3, z: 30, width: 13 },   // 11 east hairpin entry (braking, off the roll)
    { x: 405, y: 2, z: 120, width: 7 },   // 12 hairpin apex in the dip — PINCH (right-hand)
    { x: 325, y: 6, z: 200, width: 16 },  // 13 hairpin exit: FORK starts (right sweep onto the ridge)
    { x: 175, y: 11, z: 230, width: 18 }, // 14 ridge run — island divides inside/outside, then merges
    { x: 40, y: 16, z: 200, width: 8 },   // 15 ridge ess apex — PINCH (left flick)
    { x: -95, y: 18, z: 250, width: 9 },  // 16 ridge ess — PINCH (right flick)
    { x: -230, y: 16, z: 220, width: 8 }, // 17 ridge ess apex — PINCH (left flick)
    { x: -365, y: 12, z: 250, width: 11 },// 18 west hairpin entry (braking)
    { x: -445, y: 8, z: 180, width: 7 },  // 19 hairpin apex, diving — PINCH (the signature commit)
    { x: -460, y: 6, z: 80, width: 9 },   // 20 hairpin holds (exit pad rewards a clean apex)
    { x: -380, y: 4, z: 20, width: 15 },  // 21 exit onto the straight (wide run home)
  ],
  boostPads: [
    { cp: 0.6, d: 0 },   // launch
    { cp: 1.1, d: 0 },
    { cp: 1.6, d: 0 },   // carry speed into the loop
    { cp: 10.3, d: 3 },  // outside line before the east hairpin
    { cp: 13.5, d: 8 },  // FORK fast lane: pad chain down the inside (right) line
    { cp: 13.9, d: 8 },
    { cp: 14.3, d: 8 },
    { cp: 16.5, d: 0 },  // ridge esses exit
    { cp: 21.2, d: 0 },  // west hairpin exit
  ],
  // Weapon pickups (gold): straights, offset from the boost lines.
  weaponPads: [
    { cp: 5.2, d: -3 },
    { cp: 9.6, d: -3 },
    { cp: 11.2, d: 3 },
    { cp: 17.2, d: -3 },
    { cp: 20.4, d: 3 },
  ],
  // Route forks: a raised island splits the road into two committed lanes over
  // [from,to] (cp indices, same space as boostPads). `gap` is the island
  // half-width; `fast` is the side (+1 right / -1 left) that's shorter and
  // carries the pad chain — the brave line. The other side is longer and open.
  splits: [
    // The east-hairpin exit onto the ridge — a clean right-hand sweep, so the
    // inside (right, +1) is the shorter line + boosted but pinned against the
    // island; the outside (left) is the safe long way onto the ridge run.
    { from: 13.0, to: 14.6, gap: 4.5, fast: 1 },
  ],
  features: [
    // Loop (cp 2-8) plus a barrel roll on the long straight after it.
    { type: 'corkscrew', from: 9.3, to: 10.4, turns: 1, dir: -1 },
  ],
};
