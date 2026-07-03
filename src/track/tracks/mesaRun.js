// World 1, track 2: a fast flowing figure-8. Two open loops joined by a
// diagonal that crosses OVER the start straight — pure speed, few pinches.
export const MESA_RUN = {
  id: 'mesa-run',
  name: 'Mesa Run',
  world: 'desert',
  laps: 3,
  // Width is the lever for stakes: wide on straights/stunts (room to breathe and
  // land), hard pinches at the real apex so the brave inside line is committed and
  // the wall is reachable. Centerline (x/y/z) is untouched — only widths changed —
  // so the corkscrew/jump/pad cp-references all stay valid.
  points: [
    { x: -300, y: 6, z: 0, width: 18 },   //  0 start/finish, heading east (corkscrew — keep room)
    { x: -180, y: 4, z: 0, width: 18 },   //  1 | corkscrew roll
    { x: -60, y: 3, z: 0, width: 18 },    //  2 | launch straight / corkscrew end (jump ahead)
    { x: 60, y: 4, z: -20, width: 16 },   //  3 jump landing (keep room)
    { x: 180, y: 8, z: -60, width: 13 },  //  4 left sweep begins — narrowing in
    { x: 260, y: 12, z: -150, width: 9 }, //  5 sweep tightening — PINCH
    { x: 280, y: 16, z: -260, width: 7 }, //  6 sweep apex — PINCH HARD (the commit)
    { x: 200, y: 18, z: -340, width: 7 }, //  7 apex held — TIGHT
    { x: 80, y: 14, z: -350, width: 10 }, //  8 opening on exit (exit pad rewards the apex)
    { x: -10, y: 10, z: -280, width: 14 },//  9 sweep exit opens, exiting north-west
    { x: -40, y: 8, z: -180, width: 11 }, // 10 short kink — light pinch
    { x: 0, y: 12, z: -90, width: 14 },   // 11 climbing toward the crossover (opens)
    { x: 60, y: 16, z: 20, width: 15 },   // 12 FLYOVER above the launch straight (wide deck)
    { x: 90, y: 14, z: 130, width: 19 },  // 13 right sweep: FORK splits here (roomy lanes each side)
    { x: 60, y: 10, z: 240, width: 20 },  // 14 fork apex — island divides inside/outside
    { x: -40, y: 6, z: 300, width: 19 },  // 15 fork merges, lanes rejoin
    { x: -160, y: 5, z: 310, width: 14 }, // 16 sweeper apex — PINCH (post-merge commit)
    { x: -260, y: 6, z: 250, width: 13 }, // 17 holding the long right
    { x: -320, y: 6, z: 150, width: 15 }, // 18 unwinding
    { x: -360, y: 6, z: 60, width: 18 },  // 19 final right onto the straight (opens wide)
  ],
  boostPads: [
    { cp: 0.5, d: 4 },   // launch chain on the right risk line
    { cp: 0.9, d: 4 },
    { cp: 1.3, d: 4 },
    { cp: 7.5, d: 0 },   // sweep apex/exit
    { cp: 9.4, d: 0 },
    { cp: 12.0, d: 0 },  // top of the flyover
    { cp: 13.6, d: 8 },  // FORK fast lane: pad chain down the inside (right) line
    { cp: 14.2, d: 8 },
    { cp: 14.8, d: 8 },
    { cp: 15.5, d: 0 },  // sweeper merge exit
    { cp: 17.6, d: -3 }, // outer line through the long right
  ],
  // Weapon pickups (gold): straights, offset from the boost lines.
  weaponPads: [
    { cp: 2.2, d: -4 },
    { cp: 8.4, d: 3 },
    { cp: 10.6, d: -3 },
    { cp: 16.4, d: 3 },
    { cp: 18.4, d: 3 },
  ],
  // Route forks: a raised island splits the road into two committed lanes over
  // [from,to] (cp indices, same space as boostPads). `gap` is the island
  // half-width; `fast` is the side (+1 right / -1 left) that's shorter and
  // carries the pad chain — the brave line. The other side is longer and open.
  splits: [
    // The right sweep off the flyover: inside (right) is the shorter line through
    // the bend + boosted, but pinned against the island; outside (left) is the
    // safe long way round.
    { from: 13.2, to: 15.4, gap: 4.5, fast: 1 },
  ],
  features: [
    // Barrel-roll the launch straight — the road rolls a full turn under you.
    { type: 'corkscrew', from: 1.0, to: 2.1, turns: 1, dir: 1 },
    // ...then a jump right off the end of it, into the first sweep.
    { type: 'jump', cp: 2.5, gap: 20, lift: 11 },
  ],
};
