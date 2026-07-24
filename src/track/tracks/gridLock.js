// World 3 (Neon Sprawl), track 3: the STREET GP. Right-angle city corners in
// the grid, a climb onto the elevated skyway with a split around a whole
// tower block, a jump across the plaza gap, and a corkscrew INSIDE the
// arched tunnel — the camera rolls with the ribs strobing past. Contrast:
// Orbital Ring orbits, Skyline Rush dives — Grid Lock brakes.
export const GRID_LOCK = {
  id: 'grid-lock',
  name: 'Grid Lock',
  world: 'city',
  laps: 3,
  points: [
    { x: 0, y: 2, z: 300, width: 15 },     //  0 start — Main Street
    { x: 0, y: 2, z: 150, width: 14 },     //  1 | downtown straight
    { x: 0, y: 2, z: 0, width: 15 },       //  2 |
    { x: 0, y: 3, z: -140, width: 13 },    //  3 braking for the grid
    { x: -30, y: 4, z: -230, width: 10 },  //  4 corner 1 — 90° left
    { x: -140, y: 5, z: -260, width: 11 }, //  5 cross street
    { x: -250, y: 6, z: -250, width: 10 }, //  6 corner 2 — 90° right
    { x: -320, y: 8, z: -180, width: 12 }, //  7 on-ramp — the skyway climb
    { x: -360, y: 12, z: -70, width: 13 }, //  8 elevated curve
    { x: -370, y: 15, z: 60, width: 14 },  //  9 skyway straight
    { x: -350, y: 16, z: 190, width: 18 }, // 10 SPLIT — two lanes around a tower block
    { x: -300, y: 16, z: 300, width: 18 }, // 11 lanes parallel, city below
    { x: -230, y: 15, z: 380, width: 14 }, // 12 merge
    { x: -130, y: 13, z: 420, width: 12 }, // 13 descending ramp
    { x: -20, y: 10, z: 430, width: 12 },  // 14 plaza approach
    { x: 80, y: 8, z: 410, width: 13 },    // 15 JUMP the plaza gap
    { x: 180, y: 6, z: 370, width: 13 },   // 16 landing
    { x: 260, y: 5, z: 300, width: 10 },   // 17 corner 3 — 90°
    { x: 290, y: 4, z: 200, width: 9 },    // 18 the alley — PINCH
    { x: 300, y: 3, z: 90, width: 10 },    // 19 alley opens to the tunnel
    { x: 290, y: 2, z: -30, width: 12 },   // 20 TUNNEL straight (corkscrew in the ribs)
    { x: 260, y: 2, z: -150, width: 12 },  // 21 tunnel end
    { x: 200, y: 2, z: -240, width: 9 },   // 22 corner 4 — 90° — PINCH
    { x: 120, y: 2, z: -270, width: 11 },  // 23 back street
    { x: 70, y: 2, z: -200, width: 12 },   // 24 corner 5
    { x: 90, y: 2, z: -60, width: 12 },    // 25 northbound avenue
    { x: 95, y: 2, z: 150, width: 13 },    // 26 | climbing past the line
    { x: 70, y: 2, z: 330, width: 13 },    // 27 wide arc north of it
    { x: 25, y: 2, z: 385, width: 14 },    // 28 monotonic fall onto Main Street
  ],
  boostPads: [
    { cp: 1.0, d: -4 },   // Main Street chain
    { cp: 1.5, d: -4 },
    { cp: 2.0, d: -4 },
    { cp: 5.3, d: 0 },    // cross street
    { cp: 8.4, d: 0 },    // skyway climb
    { cp: 10.3, d: -8 },  // SPLIT fast lane round the block
    { cp: 10.9, d: -8 },
    { cp: 11.5, d: -8 },
    { cp: 16.4, d: 0 },   // plaza landing
    { cp: 20.2, d: 0 },   // tunnel run
    { cp: 23.4, d: 0 },   // back street
    { cp: 26.3, d: 3 },   // avenue home
  ],
  weaponPads: [
    { cp: 3.2, d: -3 },
    { cp: 7.6, d: 3 },
    { cp: 13.2, d: -3 },
    { cp: 18.5, d: 3 },
    { cp: 25.5, d: -3 },
  ],
  splits: [
    { from: 9.4, to: 11.6, gap: 4.5, fast: -1 },  // the tower block on the skyway
  ],
  features: [
    { type: 'jump', cp: 14.6, gap: 20, lift: 10 },
    { type: 'corkscrew', from: 19.3, to: 20.5, turns: 1, dir: 1 },
  ],
};
