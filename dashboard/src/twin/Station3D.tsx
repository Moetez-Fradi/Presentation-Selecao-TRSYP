import { useEffect, useRef, useState } from 'react'
import { TwinScene, type TwinState } from './TwinScene'

/** Live 3D twin of the station built from the team's CAD parts (desktop only). */
export default function Station3D({ state }: { state: TwinState }) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<TwinScene | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let tw: TwinScene
    try {
      tw = new TwinScene(el)
    } catch {
      setFailed(true) // no WebGL
      return
    }
    scene.current = tw
    tw.load().then(() => setLoading(false), () => setFailed(true))
    ;(window as unknown as { __twin?: TwinScene }).__twin = tw
    return () => {
      tw.dispose()
      scene.current = null
    }
  }, [])

  useEffect(() => {
    scene.current?.update(state)
  }, [state])

  return (
    <div className="twin3d" ref={host}>
      {loading && !failed && <div className="twin3d-msg">Loading CAD model…</div>}
      {failed && <div className="twin3d-msg">3D view unavailable on this device</div>}
    </div>
  )
}
