import { useCallback, useEffect, useRef, useState } from 'react'

export interface DashShot {
  tab: 'Run' | 'History' | 'Stats' | 'Log'
  focus?: string // card title (h2) to zoom onto
  interactive?: boolean
}

const W = 1440
const H = 1100

interface Aim { win: { left: number; top: number; width: number; height: number }; tf: string }

/**
 * The real dashboard (same origin, same saved connection) in a fixed 1440×1100 frame.
 * Each slide picks a tab and a card: a window glides to hug that card while the frame
 * scales behind it, like a camera move. Without a card the whole dashboard is shown.
 */
export default function DashZoom({ shot, region, active }: { shot: DashShot; region: { x: number; y: number; w: number; h: number }; active: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [aim, setAim] = useState<Aim | null>(null)

  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument
    const win = frame.current?.contentWindow
    if (!doc || !win) return
    const rx = region.x * window.innerWidth
    const ry = region.y * window.innerHeight
    const rw = region.w * window.innerWidth
    const rh = region.h * window.innerHeight
    const card = shot.focus
      ? [...doc.querySelectorAll('h2')].find((h) => h.textContent?.trim().startsWith(shot.focus!))?.closest('.card')
      : null
    if (!card) {
      win.scrollTo(0, 0)
      const s = Math.min(rw / W, rh / H)
      const w = W * s
      const h = H * s
      setAim({ win: { left: rx + (rw - w) / 2, top: ry + (rh - h) / 2, width: w, height: h }, tf: `scale(${s})` })
      return
    }
    // scroll inside the frame only (scrollIntoView would also scroll the deck)
    const b0 = card.getBoundingClientRect()
    win.scrollTo(0, Math.max(0, b0.top + win.scrollY - (H - b0.height) / 2))
    const r = card.getBoundingClientRect()
    const pad = 18
    const s = Math.min((rw - 2 * pad) / r.width, (rh - 2 * pad) / r.height, 2.4)
    const w = r.width * s + 2 * pad
    const h = r.height * s + 2 * pad
    setAim({
      win: { left: rx + (rw - w) / 2, top: ry + (rh - h) / 2, width: w, height: h },
      tf: `translate(${pad - r.left * s}px, ${pad - r.top * s}px) scale(${s})`,
    })
  }, [shot.focus, region.x, region.y, region.w, region.h])

  // switch tab, let it lay out, then aim
  useEffect(() => {
    if (!loaded || !active) return
    const doc = frame.current!.contentDocument!
    const btn = [...doc.querySelectorAll<HTMLButtonElement>('nav.tabs button.tab')].find((b) => b.textContent?.trim() === shot.tab)
    if (btn && btn.getAttribute('aria-selected') !== 'true') btn.click()
    const t1 = setTimeout(measure, 120)
    const t2 = setTimeout(measure, 700) // charts and late cards settle
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [loaded, active, shot.tab, measure])

  useEffect(() => {
    if (!active) return
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [active, measure])

  return (
    <div className={`dash-layer ${shot.interactive ? 'is-live' : ''}`}>
      <div className="dash-window" style={aim?.win}>
        <iframe
          ref={frame}
          src="/index.html"
          title="Live dashboard"
          width={W}
          height={H}
          style={{ transform: aim?.tf }}
          onLoad={() => setLoaded(true)}
        />
      </div>
    </div>
  )
}
