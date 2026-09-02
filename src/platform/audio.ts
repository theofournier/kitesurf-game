// The audio context, unlocked on the first touch (spec §5.4).
//
// Nothing plays a sound yet — that is session 13. What has to happen now is the
// unlock, because it can only ever happen inside a user gesture: a context
// created outside one starts `suspended` and stays there, and the first sound
// the game ever tries to play is silent. Doing it at the same moment the player
// first touches the screen costs nothing and means audio simply works whenever
// it does arrive.
//
// Not in /src/sim, obviously, and not in /src/render either: it is part of the
// web shell the game runs inside, same as the orientation lock.

/** The lazily created context. Null until the first gesture, or if unsupported. */
let context: AudioContext | null = null

/** Vendor-prefixed constructor, still the only one on older iOS Safari. */
interface AudioGlobals {
  AudioContext?: typeof AudioContext
  webkitAudioContext?: typeof AudioContext
}

/** The context, or null if no gesture has unlocked one yet. */
export function getAudioContext(): AudioContext | null {
  return context
}

/**
 * Create and resume the context. Safe to call more than once — after the first
 * success it only nudges a context the browser has re-suspended, which happens
 * when a phone locks or a tab goes to the background.
 */
export function unlockAudio(): void {
  const globals = globalThis as AudioGlobals
  const Ctor = globals.AudioContext ?? globals.webkitAudioContext
  if (!Ctor) return

  const ctx = (context ??= new Ctor())
  if (ctx.state === 'running') return

  void ctx.resume().catch(() => {})

  // iOS wants a buffer actually started inside the gesture, not just a resume.
  // A single silent sample, played and discarded; it is the cheapest thing the
  // API can be asked to do.
  const source = ctx.createBufferSource()
  source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
  source.connect(ctx.destination)
  source.start(0)
}

/** The gestures that count. "First touch" (spec §5.4), plus the desktop ones. */
const GESTURES = ['pointerdown', 'touchstart', 'keydown'] as const

/**
 * Unlock on the first gesture of any kind, then get out of the way.
 *
 * Pointer, touch and key are all listened for: the spec says "first touch", but
 * a desktop player who only ever presses space deserves audio too, and the
 * cheapest way to guarantee the gesture is real is to take the first of any of
 * them.
 *
 * Returns a disposer, for the listeners that never fired.
 */
export function unlockAudioOnFirstGesture(target: EventTarget): () => void {
  function remove(): void {
    for (const name of GESTURES) target.removeEventListener(name, onGesture)
  }

  function onGesture(): void {
    unlockAudio()
    remove()
  }

  for (const name of GESTURES) {
    target.addEventListener(name, onGesture, { once: true, passive: true })
  }

  return remove
}
