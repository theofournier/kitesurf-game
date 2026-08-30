// Tweakpane panel behind ?debug=1 (spec §11.4). Loaded through a dynamic
// import so Tweakpane never reaches the production bundle.
//
// This is the only file in /src/debug that touches the DOM.
import { Pane } from 'tweakpane'
import { TUNING } from '../config/tuning.ts'
import { resolveGroups } from './schema.ts'
import { serializeTuning } from './serialize.ts'

const CONTAINER_ID = 'debug-panel'
const CONTAINER_INSET_PX = 8
const CONTAINER_WIDTH_PX = 340
const COPY_LABEL = 'Copy values'
const COPY_OK_LABEL = 'Copied ✓'
const COPY_FAIL_LABEL = 'Copy failed — dumped to console'
const COPY_FEEDBACK_MS = 1400
/** Decimals shown for a non-integer readout value. */
const READOUT_DECIMALS = 2

/** Whatever the loop wants to watch. The panel monitors each key it finds. */
export type Readout = Record<string, number | string>

/**
 * A live knob that is not a TUNING constant — a debug-only override the loop
 * owns, bound straight into the state object that holds it. These deliberately
 * stay out of TUNING and so out of the copy-values dump: they are things to
 * fly the game at, not values to ship.
 */
export interface Control {
  /** The object holding the value. The named key must be a number. */
  target: object
  key: string
  label?: string
  min?: number
  max?: number
  step?: number
}

export interface DebugPanel {
  dispose(): void
}

function formatReadout(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(READOUT_DECIMALS)
}

/**
 * Clipboard fallback for insecure contexts, where navigator.clipboard is
 * undefined — plain http on a phone over LAN, which is exactly how this game
 * gets tested on device.
 */
function copyViaSelection(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()

  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }

  textarea.remove()
  return copied
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return copyViaSelection(text)
  }
}

/**
 * Builds the panel. Call once, after `readout` has every key the loop will
 * write — the monitors are created from the keys present at this moment.
 */
export function createDebugPanel(readout: Readout = {}, controls: Control[] = []): DebugPanel {
  const container = document.createElement('div')
  container.id = CONTAINER_ID
  container.style.position = 'fixed'
  container.style.top = `${CONTAINER_INSET_PX}px`
  container.style.right = `${CONTAINER_INSET_PX}px`
  container.style.width = `${CONTAINER_WIDTH_PX}px`
  container.style.maxHeight = `calc(100vh - ${CONTAINER_INSET_PX * 2}px)`
  container.style.overflowY = 'auto'
  container.style.zIndex = '10'
  document.body.appendChild(container)

  const pane = new Pane({ container, title: 'Kitesurf — debug' })

  const copyButton = pane.addButton({ title: COPY_LABEL })
  let feedbackTimer = 0

  copyButton.on('click', () => {
    const text = serializeTuning()
    void copyText(text).then((copied) => {
      if (!copied) console.log(text)
      copyButton.title = copied ? COPY_OK_LABEL : COPY_FAIL_LABEL
      window.clearTimeout(feedbackTimer)
      feedbackTimer = window.setTimeout(() => {
        copyButton.title = COPY_LABEL
      }, COPY_FEEDBACK_MS)
    })
  })

  // Readout first: it is what you watch while your other hand is on a slider.
  // Empty until the sim has state worth showing — later sessions only have to
  // add keys to the object handed in here.
  const readoutFolder = pane.addFolder({ title: 'readout', expanded: true })
  for (const key of Object.keys(readout)) {
    // Split rather than passing `format: undefined`, which a string monitor
    // has no use for.
    if (typeof readout[key] === 'number') {
      readoutFolder.addBinding(readout, key, { readonly: true, format: formatReadout })
    } else {
      readoutFolder.addBinding(readout, key, { readonly: true })
    }
  }

  // Overrides sit next to the readout rather than down among the constants:
  // they change what the sim is doing, not how it is tuned.
  if (controls.length > 0) {
    const folder = pane.addFolder({ title: 'overrides', expanded: true })
    for (const control of controls) {
      folder.addBinding(control.target as Record<string, number>, control.key, {
        label: control.label,
        min: control.min,
        max: control.max,
        step: control.step,
      })
    }
  }

  for (const group of resolveGroups()) {
    const folder = pane.addFolder({ title: group.title, expanded: true })

    for (const field of group.fields) {
      // Sliders write straight into TUNING, so a change is live on the next
      // sim step. Array-valued constants bind through their index.
      const target = field.isArray
        ? (TUNING[field.key] as unknown as Record<string, number>)
        : (TUNING as unknown as Record<string, number>)
      const property = field.isArray ? String(field.index) : field.key

      folder.addBinding(target, property, {
        label: field.label,
        min: field.min,
        max: field.max,
        step: field.step,
      })
    }
  }

  return {
    dispose(): void {
      window.clearTimeout(feedbackTimer)
      pane.dispose()
      container.remove()
    },
  }
}
