import { useEffect, useRef, useState } from 'react'
import { TwinScene, type TwinState } from '../twin/TwinScene'

export type Vec = [number, number, number]
export interface TwinShot {
  cam: [Vec, Vec] // camera position, look-at target
  pose?: Record<string, Vec>
  hide?: string[]
  callouts?: { text: string; at: Vec; rig?: string; tone?: 'accent' | 'plain' }[]
  rotate?: boolean
  fleet?: { at: Vec; label: string }[]
}

/** One persistent twin for the whole deck: each slide only re-aims it. */
export default function Stage3D({ shot, state }: { shot: TwinShot; state: TwinState }) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<TwinScene | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = host.current!
    let tw: TwinScene
    try {
      tw = new TwinScene(el)
    } catch {
      setFailed(true)
      return
    }
    scene.current = tw
    tw.presenterMode()
    tw.load().then(() => setReady(true), () => setFailed(true))
    ;(window as unknown as { __twin?: TwinScene }).__twin = tw
    return () => {
      tw.dispose()
      scene.current = null
      setReady(false)
    }
  }, [])

  useEffect(() => {
    const tw = scene.current
    if (!tw || !ready) return
    tw.flyTo(shot.cam[0], shot.cam[1])
    tw.pose(shot.pose ?? {}, shot.hide ?? [])
    tw.setCallouts(shot.callouts ?? [])
    tw.setAutoRotate(!!shot.rotate, 0.5)
    tw.setFleet(shot.fleet ?? [])
  }, [shot, ready])

  useEffect(() => {
    scene.current?.update(state)
  }, [state])

  return (
    <div className="stage3d" ref={host}>
      {!ready && !failed && <div className="stage-msg">Loading CAD model…</div>}
      {failed && <div className="stage-msg">3D unavailable on this machine</div>}
    </div>
  )
}
