// Landscape lock, with the rotate prompt as the fallback (spec §5.4).
//
// The lock is the thing you want and the thing you rarely get: every browser
// that implements Screen Orientation gates `lock()` behind fullscreen, and iOS
// Safari does not implement it at all. So the prompt is not a nicety for when
// the lock fails — it is the load-bearing half, and it lives in CSS in
// index.html where it works before a line of JavaScript has run. This module is
// only the opportunistic other half.

/**
 * The `lock` half of ScreenOrientation, which not every browser ships and not
 * every lib.dom types the same way. Declared locally so a missing method is a
 * runtime check rather than a compile error.
 */
interface LockableOrientation {
  lock?: (orientation: string) => Promise<void>
}

/**
 * Ask for landscape. Never throws and never reports: a refusal is the expected
 * outcome outside fullscreen, and the CSS prompt has the case covered either
 * way — there is nothing for a caller to do about it.
 */
export function lockLandscape(): void {
  const orientation = globalThis.screen?.orientation as LockableOrientation | undefined
  // The rejection has to be caught on the promise *and* guarded synchronously:
  // some engines throw from lock() itself rather than returning a rejection.
  try {
    void orientation?.lock?.('landscape').catch(() => {})
  } catch {
    // Refused. The prompt handles it.
  }
}
