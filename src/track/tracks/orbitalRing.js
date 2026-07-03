// World 3, track 1: the elevated ring road around downtown — vast banked
// sweepers with an inner cut between the towers. Top-speed test.
export const ORBITAL_RING = {
  id: 'orbital-ring',
  name: 'Orbital Ring',
  world: 'city',
  laps: 3,
  // Width is the lever for stakes: wide on the long entries so there's room to
  // breathe + set up, hard pinches at every apex so the committed inside line is
  // genuinely earned and the wall is reachable. Centerline (x/y/z) is untouched —
  // only widths changed — so the jump/loop/pad cp-references all stay valid. The
  // inner cut (cps 8-11) carries the jump + loop, so it's kept WIDE for airtime
  // and the vertical circle; the back sweeper (cps 5-7) is widened to fit the fork.
  points: [
    { x: 0, y: 8, z: 360, width: 16 },    //  0 start/finish, heading east (wide launch)
    { x: 235, y: 10, z: 280, width: 9 },  //  1 first ring apex — PINCH (commit the entry)
    { x: 360, y: 14, z: 65, width: 8 },   //  2 east apex — PINCH (the towers loom)
    { x: 325, y: 18, z: -185, width: 13 },//  3 opening onto the high back straight
    { x: 125, y: 22, z: -340, width: 16 },//  4 back of the ring, high — fork approach (room)
    { x: -120, y: 24, z: -340, width: 19 },// 5 back sweeper: FORK splits here (roomy lanes)
    { x: -310, y: 20, z: -175, width: 20 },// 6 sweeper apex — island divides inside/outside
    { x: -375, y: 16, z: 40, width: 18 }, //  7 lanes merge, sweeper exit (still opening)
    { x: -275, y: 12, z: 200, width: 14 },//  8 leaving the ring inward (jump run-up — keep room)
    { x: -170, y: 10, z: 260, width: 15 },//  9 inner cut, between the towers (jump — wide)
    { x: -90, y: 9, z: 310, width: 15 },  // 10 sweeping left (loop — keep room for the circle)
    { x: -30, y: 8, z: 345, width: 16 },  // 11 onto the line from the west (loop exit, wide)
  ],
  boostPads: [
    { cp: 0.4, d: 0 },   // ring chain — carry speed all the way around
    { cp: 1.5, d: 0 },
    { cp: 3.5, d: 4 },   // high-side risk line at the back
    { cp: 4.5, d: 4 },
    { cp: 5.5, d: -8 },  // FORK fast lane: pad chain down the inside (left) line
    { cp: 6.1, d: -8 },
    { cp: 6.7, d: -8 },
    { cp: 8.5, d: 0 },   // inner cut entry
    { cp: 10.5, d: 0 },  // cut exit
  ],
  // Weapon pickups (gold): straights, offset from the boost lines.
  weaponPads: [
    { cp: 0.9, d: -3 },
    { cp: 2.5, d: -3 },
    { cp: 4, d: -4 },
    { cp: 7.8, d: 3 },
    { cp: 9.5, d: -3 },
  ],
  // Route forks: a raised island splits the road into two committed lanes over
  // [from,to] (cp indices). `gap` is the island half-width; `fast` is the side
  // (+1 right / -1 left) that's shorter and carries the pad chain — the brave
  // line. The other side is longer and open — the safe line.
  splits: [
    // The back sweeper: the ring bends clockwise, but in the road's d-space the
    // inside (toward the centre of the ring) is the LEFT (-1) side — the shorter
    // line, boosted, but pinned against the island; the outside (right) is the
    // safe long way round.
    { from: 4.9, to: 7.0, gap: 4.5, fast: -1 },
  ],
  features: [
    // A jump between the towers on the inner cut, then a loop onto the line.
    { type: 'jump', cp: 9.1, gap: 20, lift: 11 },
    { type: 'loop', cp: 10, dir: 1 },
  ],
};
