// World 2, track 1: a coastal pass over the lagoon — start on the crest,
// dive to the water, climb a chicaned S back up, blind drop, and a flyunder
// beneath the climbing section on the way home.
export const LAGOON_PASS = {
  id: 'lagoon-pass',
  name: 'Lagoon Pass',
  world: 'tropic',
  laps: 3,
  points: [
    { x: 0, y: 20, z: 0, width: 16 },     //  0 start/finish on the crest
    { x: 0, y: 16, z: -130, width: 16 },  //  1 descending
    { x: -30, y: 12, z: -250, width: 15 },//  2
    { x: -120, y: 8, z: -330, width: 14 },//  3 shoreline left sweep
    { x: -240, y: 6, z: -330, width: 14 },//  4 water level
    { x: -330, y: 8, z: -240, width: 14 },//  5 wide left
    { x: -340, y: 12, z: -120, width: 15 },// 6 climb begins
    { x: -280, y: 18, z: -10, width: 15 },//  7
    { x: -300, y: 24, z: 110, width: 13 },//  8 climbing chicane (pinch)
    { x: -210, y: 28, z: 180, width: 13 },//  9
    { x: -110, y: 30, z: 150, width: 14 },// 10 high plateau
    { x: -40, y: 26, z: 230, width: 14 }, // 11 blind drop entry
    { x: -60, y: 18, z: 350, width: 15 }, // 12 diving left
    { x: -170, y: 12, z: 420, width: 15 },// 13
    { x: -290, y: 10, z: 400, width: 14 },// 14 wide left low
    { x: -380, y: 10, z: 290, width: 14 },// 15
    { x: -350, y: 8, z: 170, width: 14 }, // 16 the flyunder: passes BELOW cp8-9
    { x: -260, y: 6, z: 90, width: 16 },  // 17
    { x: -140, y: 4, z: 40, width: 16 },  // 18 lagoon run home
    { x: -50, y: 10, z: 90, width: 16 },  // 19 final climb to the crest
  ],
  boostPads: [
    { cp: 1.3, d: 0 },   // the dive
    { cp: 4.5, d: 0 },   // shoreline exit
    { cp: 7.3, d: 0 },   // climb
    { cp: 9.5, d: 0 },   // chicane exit
    { cp: 11.0, d: 0 },  // plateau edge, before the blind drop
    { cp: 13.5, d: -3 }, // low lagoon risk line
    { cp: 18.4, d: 0 },  // final climb chain
    { cp: 18.8, d: 0 },
  ],
  features: [
    // Barrel roll along the flat shoreline, then a full loop on the run home.
    { type: 'corkscrew', from: 3.1, to: 4.3, turns: 1, dir: 1 },
    { type: 'loop', cp: 18, dir: 1 },
  ],
};
