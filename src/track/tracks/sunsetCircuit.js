// World 1, track 1: the original flowing lap — long straight, banked sweeper,
// chicane, blind crest with airtime, hairpin, elevated esses crossing the
// final approach on a flyover.
export const SUNSET_CIRCUIT = {
  id: 'sunset-circuit',
  name: 'Sunset Circuit',
  world: 'desert',
  laps: 3,
  points: [
    { x: 0, y: 2, z: 280, width: 18 },    //  0 start/finish
    { x: 0, y: 2, z: 140, width: 18 },    //  1 |
    { x: 0, y: 2, z: 0, width: 18 },      //  2 | long start straight
    { x: 0, y: 2, z: -140, width: 18 },   //  3 |
    { x: 10, y: 3, z: -260, width: 16 },  //  4 straight end
    { x: 70, y: 5, z: -350, width: 16 },  //  5 sweeping right begins
    { x: 180, y: 8, z: -395, width: 16 }, //  6 sweeper apex
    { x: 290, y: 11, z: -360, width: 16 },//  7
    { x: 350, y: 13, z: -270, width: 14 },//  8 sweeper exit, pinch
    { x: 330, y: 15, z: -180, width: 13 },//  9 chicane left
    { x: 395, y: 17, z: -110, width: 13 },// 10 chicane right
    { x: 420, y: 26, z: -20, width: 14 }, // 11 climbing
    { x: 425, y: 34, z: 60, width: 15 },  // 12 blind crest
    { x: 410, y: 16, z: 150, width: 15 }, // 13 steep drop (airtime)
    { x: 380, y: 10, z: 230, width: 14 }, // 14 approach hairpin
    { x: 330, y: 8, z: 300, width: 12 },  // 15 hairpin entry (pinched)
    { x: 250, y: 7, z: 330, width: 12 },  // 16 hairpin apex
    { x: 185, y: 8, z: 290, width: 13 },  // 17 hairpin exit
    { x: 120, y: 9, z: 290, width: 14 },  // 18 elevated esses (flyover)
    { x: 55, y: 9.5, z: 350, width: 14 }, // 19
    { x: -40, y: 11, z: 295, width: 14 }, // 20 crosses OVER the final approach
    { x: -115, y: 6, z: 370, width: 15 },// 21 diving back down, clear of the straight
    { x: -220, y: 4, z: 320, width: 16 }, // 22 esses exit, heading west
    { x: -280, y: 3, z: 400, width: 17 }, // 23 valley sweeper south
    { x: -235, y: 2, z: 480, width: 17 }, // 24
    { x: -120, y: 2, z: 510, width: 18 }, // 25 along the south edge
    { x: -45, y: 2, z: 470, width: 18 },  // 26 sweeping back north
    { x: -4, y: 2, z: 385, width: 16 },   // 27 final approach, east of the flyover leg
  ],
  boostPads: [
    { cp: 1.2, d: -4 },  // risk line: a chain of three near the left wall
    { cp: 1.6, d: -4 },
    { cp: 2.0, d: -4 },
    { cp: 8.3, d: 0 },   // sweeper exit
    { cp: 10.5, d: 0 },  // chicane exit
    { cp: 12.0, d: 0 },  // top of the blind crest
    { cp: 17.4, d: 0 },  // hairpin exit
    { cp: 22.3, d: 0 },  // esses exit
    { cp: 25.2, d: 3 },  // south edge, near the right wall
  ],
  features: [
    // A full loop on the long start straight, fed by the boost chain...
    { type: 'loop', cp: 2, dir: 1 },
    // ...then a jump where the straight ends, just before the sweeper.
    { type: 'jump', cp: 3.0, gap: 22, lift: 11 },
    // A barrel roll along the flat valley sweeper on the way home.
    { type: 'corkscrew', from: 24.0, to: 25.4, turns: 1, dir: -1 },
  ],
};
