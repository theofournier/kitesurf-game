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
  /** Altitude shadow on the water, under the rider. */
  shadow: 'rgba(8, 18, 26, 0.45)',
  // The three landing verdicts (spec §3.7). Green, amber and red, because the
  // one thing this feedback cannot afford is to need explaining.
  clean: '#5fe0b0',
  sketchy: '#f2b23c',
  wipeout: '#ff5f57',
  sprayClean: '#dff6ff',
  spraySketchy: '#b9ccd6',
  sprayWipeout: '#eef7fb',
}
