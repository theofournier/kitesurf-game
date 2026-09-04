// The grey-box palette (build plan session 3: no art until session 11).
//
// Colours and alphas are not gameplay values — nothing here changes what the
// sim does or how the game feels to play — so they live beside the drawing
// code rather than in TUNING, same reasoning as MAX_FRAME_TIME in loop.ts.
export const PALETTE = {
  sky: '#233642',
  skyHaze: '#2d4452',
  sea: '#16242e',
  seaFar: '#1d2f3b',
  horizon: '#3c5666',
  waterline: '#4d6b7d',
  streakFar: 'rgba(120, 160, 180, 0.18)',
  streakMid: 'rgba(140, 180, 200, 0.28)',
  streakNear: 'rgba(180, 215, 235, 0.42)',
  rider: '#c8ced2',
  riderDark: '#8d979d',
  board: '#e0e6ea',
  kite: '#d5dbdf',
  kiteEdge: '#71797e',
  line: 'rgba(226, 234, 238, 0.85)',
  arc: 'rgba(200, 220, 235, 0.16)',
  ghost: 'rgba(220, 235, 245, 0.35)',
  // Waves (spec §4). The face is a lit slab of water, the lip is the one thing
  // on it that has to be unmistakable from a second out, and a boat wake says
  // so in its own colour because it is the one worth changing line for.
  waveFace: '#2b4657',
  waveFaceWake: '#365a6e',
  waveFoam: 'rgba(226, 244, 250, 0.92)',
  waveFoamWake: 'rgba(159, 242, 255, 0.96)',
  waveGuide: 'rgba(196, 230, 246, 0.20)',
  // Obstacles (spec §9.1). Warm and solid against water that is cold and flat,
  // because the one thing the player has to read at a glance is which shapes on
  // the horizon are water and which are the end of the run. The top edge is the
  // brightest part of each: it is the line the jump has to beat.
  hull: '#4a3a3f',
  hullTop: '#e9d7c6',
  hullMark: '#ff8b6a',
  // The pointer's aiming reticle (spec §5.2). It is on screen for the whole
  // run, over sky and over water, so it carries its own dark halo — a light
  // reticle alone disappears against the haze and a dark one against the sea.
  cursor: '#e6eef2',
  cursorHalo: '#08121a',
  /** Altitude shadow on the water, under the rider. */
  shadow: 'rgba(8, 18, 26, 0.45)',
  // The tier wash (spec §7.1). Each tier is meant to look like worse water than
  // the last — "flat water, pale sky" up to "barely controllable" — and the
  // cheapest honest version of that at grey-box stage is to drain the light out
  // of the sky and the sea as the wind climbs. Laid over the flats at an alpha
  // that follows the wind rather than the tier, so the change is continuous the
  // way the wind is; the banner is what steps at a boundary.
  tierSky: '#0a141c',
  tierSea: '#03080d',
  /** The HUD (spec §7.1's feedback half): tier, wind, score, combo. */
  hud: '#dce8ee',
  hudDim: 'rgba(220, 232, 238, 0.55)',
  hudShadow: 'rgba(6, 14, 20, 0.75)',
  /** The tier-change banner, and the word a fatal crash ends the run with. */
  tierFlash: '#9fe8ff',
  over: '#ff5f57',
  // The three landing verdicts (spec §3.7). Green, amber and red, because the
  // one thing this feedback cannot afford is to need explaining.
  clean: '#5fe0b0',
  sketchy: '#f2b23c',
  wipeout: '#ff5f57',
  sprayClean: '#dff6ff',
  spraySketchy: '#b9ccd6',
  sprayWipeout: '#eef7fb',
}
