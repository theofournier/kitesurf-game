// Entry point. Wiring only — no game logic yet.
const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const ctx = canvas.getContext('2d')!

const dpr = Math.min(window.devicePixelRatio || 1, 2) // spec §5.4: cap DPR at 2

function resize(): void {
  canvas.width = Math.round(canvas.clientWidth * dpr)
  canvas.height = Math.round(canvas.clientHeight * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

window.addEventListener('resize', resize)
resize()
