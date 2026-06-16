// World 3, track 1: the elevated ring road around downtown — vast banked
// sweepers with an inner cut between the towers. Top-speed test.
export const ORBITAL_RING = {
  id: 'orbital-ring',
  name: 'Orbital Ring',
  world: 'city',
  laps: 3,
  points: [
    { x: 0, y: 8, z: 360, width: 16 },    //  0 start/finish, heading east
    { x: 235, y: 10, z: 280, width: 15 }, //  1 outer ring
    { x: 360, y: 14, z: 65, width: 15 },  //  2
    { x: 325, y: 18, z: -185, width: 14 },//  3
    { x: 125, y: 22, z: -340, width: 14 },//  4 back of the ring, high
    { x: -120, y: 24, z: -340, width: 14 },// 5
    { x: -310, y: 20, z: -175, width: 15 },// 6
    { x: -375, y: 16, z: 40, width: 15 }, //  7
    { x: -275, y: 12, z: 200, width: 14 },//  8 leaving the ring inward
    { x: -170, y: 10, z: 260, width: 14 },//  9 inner cut, between the towers
    { x: -90, y: 9, z: 310, width: 14 },  // 10 sweeping left
    { x: -30, y: 8, z: 345, width: 15 },  // 11 onto the line from the west
  ],
  boostPads: [
    { cp: 0.4, d: 0 },   // ring chain — carry speed all the way around
    { cp: 1.5, d: 0 },
    { cp: 3.5, d: 4 },   // high-side risk line at the back
    { cp: 4.5, d: 4 },
    { cp: 6.5, d: 0 },
    { cp: 8.5, d: 0 },   // inner cut entry
    { cp: 10.5, d: 0 },  // cut exit
  ],
  features: [
    // A jump between the towers on the inner cut, then a loop onto the line.
    { type: 'jump', cp: 9.1, gap: 20, lift: 11 },
    { type: 'loop', cp: 10, dir: 1 },
  ],
};
