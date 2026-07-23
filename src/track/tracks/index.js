// The track roster, in menu order: 3 worlds x 2 tracks.
import { SUNSET_CIRCUIT } from './sunsetCircuit.js';
import { MESA_RUN } from './mesaRun.js';
import { LAGOON_PASS } from './lagoonPass.js';
import { CORAL_KEYS } from './coralKeys.js';
import { ORBITAL_RING } from './orbitalRing.js';
import { SKYLINE_RUSH } from './skylineRush.js';
// CONTENT BLOCK (unreleased): FROSTFALL RIDGE (aurora-pass, avalanche-run)
// plus dune-drift / breaker-bay / grid-lock are built but NOT in the roster —
// they all go live together with the two-cup restructure, so the championship
// never changes length under a live player's saved cup. To preview locally:
// import the track and append it here.
export const TRACKS = [
  SUNSET_CIRCUIT,
  MESA_RUN,
  LAGOON_PASS,
  CORAL_KEYS,
  ORBITAL_RING,
  SKYLINE_RUSH,
];
