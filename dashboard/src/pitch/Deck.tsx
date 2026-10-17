import { useCallback, useEffect, useState } from 'react'
import Stage3D from './Stage3D'
import DashZoom from './DashZoom'
import { Arch, SLIDES, regionFor } from './slides'
import { useTwinScript } from './twinScript'

const fromHash = () => {
  const n = Number(location.hash.slice(1))
  return Number.isInteger(n) && n >= 1 && n <= SLIDES.length ? n - 1 : 0
}

/**
 * Pitch deck. → / PageDown / Space: next · ← / PageUp: back · F: fullscreen · N: notes.
 * The 3D twin and the live dashboard stay mounted; slides only re-aim them.
 */
export default function Deck() {
  // position = slide + click step inside it (slides with `steps` reveal content one click at a time)
  const [pos, setPos] = useState(() => ({ i: fromHash(), step: 0 }))
  const [notes, setNotes] = useState(false)
  const { i, step } = pos
  const slide = SLIDES[i]
  const twin = useTwinScript(slide.mode)
  const setI = (n: number) => setPos({ i: n, step: 0 })

  const go = useCallback((d: number) => setPos(({ i, step }) => {
    const steps = SLIDES[i].steps ?? 0
    if (d > 0 && step < steps) return { i, step: step + 1 }
    if (d < 0 && step > 0) return { i, step: step - 1 }
    const n = Math.max(0, Math.min(SLIDES.length - 1, i + d))
    if (n === i) return { i, step }
    return { i: n, step: d < 0 ? SLIDES[n].steps ?? 0 : 0 } // going back lands on the fully revealed slide
  }), [])

  useEffect(() => {
    history.replaceState(null, '', `#${i + 1}`)
  }, [i])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(1) }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(-1) }
      else if (e.key === 'Home') setI(0)
      else if (e.key === 'End') setI(SLIDES.length - 1)
      else if (e.key.toLowerCase() === 'f') {
        if (document.fullscreenElement) document.exitFullscreen()
        else document.documentElement.requestFullscreen().catch(() => {})
      } else if (e.key.toLowerCase() === 'n') setNotes((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  // the dashboard iframe swallows keys while it has focus: hand them back to the deck
  useEffect(() => {
    const t = setInterval(() => {
      if (slide.dash?.interactive) return
      if (document.activeElement instanceof HTMLIFrameElement) (document.activeElement as HTMLElement).blur()
    }, 400)
    return () => clearInterval(t)
  }, [slide])

  const chapter = slide.kicker ?? ''
  return (
    <div className={`deck layer-${slide.layer} ${slide.dim ? 'is-dim' : ''} ${slide.twinOff ? 'twin-off' : ''}`}>
      <div className="bg-twin">
        <Stage3D shot={slide.twin} state={twin} />
      </div>
      <DashZoom shot={slide.dash ?? { tab: 'Run' }} region={regionFor(slide)} active={slide.layer === 'dash'} />
      <div className="bg-arch">
        <Arch step={slide.id === 'signed' ? 1 : 0} />
      </div>

      <section key={slide.id} className={`copy copy-${slide.layout}`}>
        {chapter && <p className="kicker">{chapter}</p>}
        {slide.body({ twin, step })}
      </section>

      <footer className="chrome">
        <div className="progress"><span style={{ width: `${((i + 1) / SLIDES.length) * 100}%` }} /></div>
        <span className="count">{i + 1} / {SLIDES.length}</span>
        <button aria-label="Previous" onClick={() => go(-1)}>‹</button>
        <button aria-label="Next" onClick={() => go(1)}>›</button>
      </footer>
      {notes && <aside className="notes">{slide.notes}</aside>}
    </div>
  )
}
