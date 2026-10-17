import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { dxfToShape } from './dxf'
import type { ErrorCode, MachineState, Phase, RunStatus } from '../station/protocol'

/** Everything the twin shows, derived from station status (read-only). */
export interface TwinState {
  online: boolean
  state?: MachineState
  phase?: Phase
  vib: boolean
  cup: boolean
  hopperOk: boolean
  hopperPct?: number
  powerOk: boolean
  tareOk: boolean
  scaleFault: boolean
  augerFitted: boolean
  weight: number
  target: number
  result?: RunStatus
  error?: ErrorCode
}

/*
 * World frame, millimetres, Y up. Positions come from the CAD files:
 *   X  across the box (side panels span X −110…110, base extension to X 200)
 *   Z  between the side walls: motor wall at Z 0…5, right wall at Z −195…−190
 *   auger axis at X 0, Y 147 (panel hole 103 mm below the top edge of a 250 mm wall)
 *   tube inlet (z = 160 in the part) lines up with the top-plate hole at Z −50
 *   discharge spout (z = 60 in the part) is at Z −150, the cup sits under it
 */
const AXIS_Y = 147
const SPOUT = new THREE.Vector3(0, 100, -150)
const CUP_FLOOR_Y = 48 // cup plate dish floor, on top of the load cell
const T = 5 // MDF thickness

const HOPPER_NECK_Y = 198 + 25 // where the cone starts
const HOPPER_RIM_Y = 198 + 171
const coneR = (y: number) => 20 + (y - HOPPER_NECK_Y) * 0.577

const PHASE_SPEED: Partial<Record<Phase, number>> = { FAST: 9, SLOW: 3.5, FINE: 1.4, TRIM: 0.8 }
const STREAM: Partial<Record<Phase, number>> = { FAST: 1, SLOW: 0.45, FINE: 0.15, TRIM: 0.1 }

type Hint = 'cup' | 'hopper' | 'power' | 'scale' | 'flow'

export class TwinScene {
  private renderer: THREE.WebGLRenderer
  private labels: CSS2DRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(30, 1, 10, 6000)
  private controls: OrbitControls
  private clock = new THREE.Clock()
  private ro: ResizeObserver
  private io: IntersectionObserver
  private visible = true
  private disposed = false
  private state: TwinState | null = null

  // parts that react to state
  private auger = new THREE.Group()
  private hopper = new THREE.Group()
  private hopperMat = new THREE.MeshStandardMaterial({ color: '#cfe3ff', transparent: true, opacity: 0.18, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide })
  private hopperEdges = new THREE.LineBasicMaterial({ color: '#9fb6d6', transparent: true, opacity: 0.55 })
  private powder: THREE.Mesh
  private cup = new THREE.Group()
  private cupMat = new THREE.MeshStandardMaterial({ color: '#f2f2f2', transparent: true, opacity: 0.55, roughness: 0.2, depthWrite: false, side: THREE.DoubleSide })
  private cupFill: THREE.Mesh
  private ghostCup = new THREE.Group()
  private ghostMat = new THREE.MeshBasicMaterial({ color: '#ff4d4d', transparent: true, opacity: 0.3, depthWrite: false })
  private ghostEdge = new THREE.LineBasicMaterial({ color: '#ff4d4d', transparent: true })
  private plateRing: THREE.Mesh
  private motorMat = new THREE.MeshStandardMaterial({ color: '#2b2d31', metalness: 0.6, roughness: 0.4 })
  private cellMat = new THREE.MeshStandardMaterial({ color: '#b9bec6', metalness: 0.7, roughness: 0.35 })
  // see-through so the auger can be seen turning
  private tubeMat = new THREE.MeshStandardMaterial({ color: '#e6e6e6', roughness: 0.3, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })
  private stream: THREE.Points
  private streamSeeds: Float32Array
  private hintLabels = new Map<Hint | 'weight', CSS2DObject>()
  private tmp = new THREE.Color()
  private lastPct = -1
  private lcdCanvas = document.createElement('canvas')
  private lcdTex = new THREE.CanvasTexture(this.lcdCanvas)
  private lcdText = ''

  private host: HTMLElement

  constructor(host: HTMLElement) {
    this.host = host
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    host.appendChild(this.renderer.domElement)

    this.labels = new CSS2DRenderer()
    this.labels.domElement.className = 'twin-labels'
    host.appendChild(this.labels.domElement)

    this.camera.position.set(620, 470, 330)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(45, 175, -95)
    this.controls.enableDamping = true
    this.controls.minDistance = 300
    this.controls.maxDistance = 1600
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.enablePan = false
    this.controls.update()

    this.lights()
    this.ground()

    // powder in the hopper: a cone frustum rebuilt when the level changes
    this.powder = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48), new THREE.MeshStandardMaterial({ color: '#e9dcc0', roughness: 0.95 }))
    this.scene.add(this.powder)

    // powder already in the cup
    this.cupFill = new THREE.Mesh(new THREE.CylinderGeometry(24.5, 24.5, 1, 40), new THREE.MeshStandardMaterial({ color: '#e9dcc0', roughness: 0.95 }))
    this.cupFill.position.set(SPOUT.x, CUP_FLOOR_Y + 6, SPOUT.z)
    this.scene.add(this.cupFill)

    // falling powder stream
    const N = 160
    this.streamSeeds = new Float32Array(N * 3).map(() => Math.random())
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3))
    this.stream = new THREE.Points(g, new THREE.PointsMaterial({ color: '#e9dcc0', size: 3, sizeAttenuation: true }))
    this.stream.frustumCulled = false
    this.scene.add(this.stream)

    // red ring on the cup plate, shown when no cup is detected
    this.plateRing = new THREE.Mesh(new THREE.RingGeometry(31, 38, 48), new THREE.MeshBasicMaterial({ color: '#ff4d4d', transparent: true, side: THREE.DoubleSide, depthWrite: false }))
    this.plateRing.rotation.x = -Math.PI / 2
    this.plateRing.position.set(SPOUT.x, CUP_FLOOR_Y + 9.5, SPOUT.z)
    this.scene.add(this.plateRing)

    this.makeLabels()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.io = new IntersectionObserver(([e]) => (this.visible = e.isIntersecting))
    this.io.observe(host)
    this.resize()
    this.renderer.setAnimationLoop(() => this.frame())
  }

  async load(base = '/models/') {
    const stl = new STLLoader()
    const geo = async (n: string) => {
      const g = await stl.loadAsync(base + n)
      g.computeVertexNormals()
      return g
    }
    const dxf = async (n: string) => dxfToShape(await (await fetch(base + n)).text())
    const [tube, screw, hopper, cup, plate, cover, lcd, fixer, left, right, lower, upper, btnUp, btnSide, irSup] = await Promise.all([
      geo('tube.stl'), geo('auger.stl'), geo('hopper.stl'), geo('cup.stl'), geo('cup-plate.stl'), geo('tube-cover.stl'),
      geo('lcd-holder.stl'), geo('loadcell-fixer.stl'),
      dxf('left-side-motor.dxf'), dxf('right-side.dxf'), dxf('lower-side.dxf'), dxf('upper-side.dxf'),
      dxf('buttons-platform-upper.dxf'), dxf('buttons-platform-side.dxf'), dxf('irsensor-support.dxf'),
    ])
    if (this.disposed) return

    const mdf = new THREE.MeshStandardMaterial({ color: '#b08d62', roughness: 0.85 })
    const pla = new THREE.MeshStandardMaterial({ color: '#e6e6e6', roughness: 0.55 })
    const plaDark = new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.6 })
    const add = (o: THREE.Object3D) => {
      o.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          c.castShadow = true
          c.receiveShadow = true
        }
      })
      this.scene.add(o)
      return o
    }
    const panel = (shape: THREE.Shape, mat = mdf) => new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 24 }), mat)

    // ---- MDF frame (DXF outlines, panel x −220…0 → X −110…110)
    const lw = add(panel(left))
    lw.position.set(110, 250, 0)
    const rw = add(panel(right))
    rw.position.set(110, 250, -195)
    const flat = (m: THREE.Mesh, y: number) => {
      m.rotation.x = Math.PI / 2 // DXF y → world Z, extrusion → downwards
      m.position.set(110, y, 0)
      return add(m)
    }
    const basePanel = flat(panel(lower), 20)
    const topPanel = flat(panel(upper), 250)

    // electronics deck on the base extension (approximate placement)
    const deck = add(panel(btnUp))
    deck.rotation.set(Math.PI / 2, Math.PI / 2, 0, 'YXZ') // DXF x → Z, DXF y → X
    deck.position.set(200, 80, -185)
    const deckSides: THREE.Object3D[] = []
    for (const z of [-185, -125]) {
      const side = add(panel(btnSide))
      deckSides.push(side)
      side.position.set(195, 75, z)
    }
    const ir = add(panel(irSup, plaDark))
    ir.rotation.x = Math.PI / 2
    ir.position.set(70, 35, -128)

    // ---- printed parts (STL frames measured from the files)
    const tubeMesh = add(new THREE.Mesh(tube, this.tubeMat))
    tubeMesh.position.set(-35, AXIS_Y - 47, -210)
    tubeMesh.castShadow = false
    tubeMesh.renderOrder = 1
    const coverMesh = add(new THREE.Mesh(cover, pla))
    coverMesh.position.set(-27, AXIS_Y - 27, -221)

    // auger screw spins around its own axis inside the tube
    const screwMesh = new THREE.Mesh(screw, new THREE.MeshStandardMaterial({ color: '#f0a43a', roughness: 0.5 }))
    screwMesh.position.set(-17.1, -17.1, 0)
    this.auger.add(screwMesh)
    this.auger.position.set(0, AXIS_Y, -195)
    add(this.auger)

    // NEMA 17 on the outside of the motor wall
    const motor = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(42.3, 42.3, 40), this.motorMat)
    const cap = new THREE.Mesh(new THREE.BoxGeometry(42.3, 42.3, 6), new THREE.MeshStandardMaterial({ color: '#8b9097', metalness: 0.8, roughness: 0.3 }))
    cap.position.z = 23
    motor.add(body, cap)
    motor.position.set(0, AXIS_Y, T + 20)
    add(motor)

    // transparent hopper: flange (70 × 45) bolted onto the tube inlet
    const hopperMesh = new THREE.Mesh(hopper, this.hopperMat)
    hopperMesh.renderOrder = 2
    const hopperLines = new THREE.LineSegments(new THREE.EdgesGeometry(hopper, 25), this.hopperEdges)
    for (const o of [hopperMesh, hopperLines]) {
      o.rotation.x = -Math.PI / 2
      o.position.set(-112, 198, 57.8)
      this.hopper.add(o)
    }
    this.scene.add(this.hopper)

    // weighing unit: fixer + bar load cell + cup plate + cup
    const fixerMesh = add(new THREE.Mesh(fixer, plaDark))
    fixerMesh.rotation.set(-Math.PI / 2, 0, Math.PI / 2)
    fixerMesh.position.set(8.5, 20, -109)
    const cell = add(new THREE.Mesh(new THREE.BoxGeometry(12.7, 12.7, 80), this.cellMat))
    cell.position.set(0, 25 + 6.35, -115)
    const plateMesh = add(new THREE.Mesh(plate, pla))
    plateMesh.position.set(SPOUT.x - 33, CUP_FLOOR_Y - 10, SPOUT.z - 33)

    const cupMesh = new THREE.Mesh(cup, this.cupMat)
    cupMesh.renderOrder = 3
    cupMesh.position.set(-29, 0, -29)
    this.cup.add(cupMesh)
    this.cup.position.set(SPOUT.x, CUP_FLOOR_Y, SPOUT.z)
    this.scene.add(this.cup)

    // ghost cup where the cup should be (blinks when missing)
    const ghost = new THREE.Mesh(cup, this.ghostMat)
    const ghostLines = new THREE.LineSegments(new THREE.EdgesGeometry(cup, 30), this.ghostEdge)
    for (const o of [ghost, ghostLines]) {
      o.position.set(-29, 0, -29)
      this.ghostCup.add(o)
    }
    this.ghostCup.position.copy(this.cup.position)
    this.scene.add(this.ghostCup)

    // LCD holder on the electronics side, screen facing outwards (away from the dosing tower)
    const lcdMesh = add(new THREE.Mesh(lcd, plaDark))
    lcdMesh.rotation.y = -Math.PI / 2
    lcdMesh.position.set(199, 20, -115)
    // 16×2 character screen in the slanted window: holder frame x 0…110, top face 0.77·y − 0.64·z ≈ 10.3
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(74, 27), new THREE.MeshBasicMaterial({ map: this.lcdTex, toneMapped: false }))
    const along = new THREE.Vector3(0, 0.64, 0.77)
    const normal = new THREE.Vector3(0, 0.77, -0.64)
    screen.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), along, normal))
    screen.position.set(55, 40, 32.5).addScaledVector(normal, 0.8)
    lcdMesh.add(screen)

    // named part groups for the presentation (exploded views, cutaways, callouts)
    const rig = (name: string, ...objs: THREE.Object3D[]) => {
      const g = new THREE.Group()
      g.name = name
      this.scene.add(g)
      g.add(...objs)
      this.rigs.set(name, g)
    }
    rig('wallMotor', lw)
    rig('wallRight', rw)
    rig('base', basePanel)
    rig('top', topPanel)
    rig('electronics', deck, ...deckSides, ir, lcdMesh)
    rig('tube', tubeMesh, coverMesh)
    rig('auger', this.auger)
    rig('motor', motor)
    rig('hopper', this.hopper, this.powder)
    rig('loadcell', fixerMesh, cell)
    rig('plate', plateMesh, this.plateRing)
    rig('cup', this.cup, this.cupFill, this.ghostCup)
    rig('stream', this.stream)

    if (this.state) this.update(this.state)
  }

  /** Mirror of the station's 16×2 LCD: key info of the current sample. */
  private drawLcd() {
    const s = this.state
    const pad = (t: string) => t.slice(0, 16).padEnd(16)
    const w = (x: number) => `${x.toFixed(2)} g`
    let l1 = ''
    let l2 = ''
    if (s?.online) {
      if (!s.cup) [l1, l2] = ['NO CUP', 'place a cup']
      else if (s.error === 'NO_FLOW') [l1, l2] = ['NO FLOW', 'check hopper']
      else if (s.state === 'DONE') [l1, l2] = [s.result ?? 'DONE', `${w(s.weight)} / ${s.target.toFixed(1)}`]
      else if (s.state === 'DOSING' || s.state === 'SETTLE') [l1, l2] = [`${s.phase ?? s.state}`, `${w(s.weight)} / ${s.target.toFixed(1)}`]
      else [l1, l2] = ['READY', `${w(s.weight)}  tare ok`]
    }
    const text = pad(l1) + '|' + pad(l2)
    if (text === this.lcdText) return
    this.lcdText = text
    const c = this.lcdCanvas
    c.width = 512
    c.height = 160
    const g = c.getContext('2d')!
    g.fillStyle = s?.online ? '#2346c8' : '#141a33'
    g.fillRect(0, 0, c.width, c.height)
    if (s?.online) {
      const cw = 29
      g.font = '600 40px ui-monospace, Consolas, monospace'
      g.textBaseline = 'middle'
      g.fillStyle = '#eef3ff'
      ;[pad(l1), pad(l2)].forEach((row, r) => {
        for (let i = 0; i < 16; i++) {
          g.fillStyle = 'rgba(255,255,255,.07)' // unlit character cells
          g.fillRect(24 + i * cw, 22 + r * 62, cw - 4, 54)
          g.fillStyle = '#eef3ff'
          g.fillText(row[i], 26 + i * cw, 50 + r * 62)
        }
      })
    }
    this.lcdTex.colorSpace = THREE.SRGBColorSpace
    this.lcdTex.needsUpdate = true
  }

  // ---- presentation API (used by the pitch deck; the dashboard never calls it)

  readonly rigs = new Map<string, THREE.Group>()
  private flight: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t0: number; ms: number } | null = null
  private rigAnim = new Map<string, { from: THREE.Vector3; to: THREE.Vector3; hide: boolean; t0: number; ms: number }>()
  private callouts: CSS2DObject[] = []

  /** Fly the camera to a position looking at a target (world mm). */
  flyTo(pos: [number, number, number], target: [number, number, number], ms = 1400) {
    this.flight = {
      from: [this.camera.position.clone(), this.controls.target.clone()],
      to: [new THREE.Vector3(...pos), new THREE.Vector3(...target)],
      t0: performance.now(),
      ms,
    }
  }

  /** Move part groups by an offset (mm) from their assembled place; listed parts in hide fly off and vanish. */
  pose(offsets: Record<string, [number, number, number]>, hide: string[] = [], ms = 1200) {
    const now = performance.now()
    for (const [name, g] of this.rigs) {
      const off = offsets[name] ?? [0, 0, 0]
      const isHidden = hide.includes(name)
      if (!isHidden) g.visible = true
      this.rigAnim.set(name, { from: g.position.clone(), to: new THREE.Vector3(...off), hide: isHidden, t0: now, ms })
    }
  }

  /** Floating labels pinned to a part (they move with it when exploded). */
  setCallouts(list: { text: string; at: [number, number, number]; rig?: string; tone?: 'accent' | 'plain' }[]) {
    for (const c of this.callouts) c.removeFromParent()
    this.callouts = list.map((c, i) => {
      const el = document.createElement('div')
      el.className = `twin-callout twin-callout-${c.tone ?? 'plain'}`
      el.style.animationDelay = `${0.25 + i * 0.12}s`
      el.textContent = c.text
      const o = new CSS2DObject(el)
      o.position.set(...c.at)
      ;(c.rig ? this.rigs.get(c.rig) ?? this.scene : this.scene).add(o)
      return o
    })
  }

  private fleet: THREE.Group[] = []
  private fleetAnim: { t0: number; show: boolean; spots: THREE.Vector3[] } | null = null

  /** Copies of the whole station at the given offsets (mm), each with a label; [] hides them. */
  setFleet(spots: { at: [number, number, number]; label: string }[]) {
    if (spots.length && !this.fleet.length) {
      for (let k = 0; k < 4; k++) {
        const g = new THREE.Group()
        for (const [name, r] of this.rigs) {
          if (name === 'stream') continue
          const c = r.clone(true)
          const labels: THREE.Object3D[] = []
          c.traverse((o) => o instanceof CSS2DObject && labels.push(o))
          labels.forEach((o) => o.removeFromParent())
          c.position.set(0, 0, 0)
          c.visible = true
          g.add(c)
        }
        g.visible = false
        this.scene.add(g)
        this.fleet.push(g)
      }
    }
    this.fleet.forEach((g, k) => {
      g.children.filter((o) => o instanceof CSS2DObject).forEach((o) => o.removeFromParent())
      const spot = spots[k]
      if (!spot) return
      const el = document.createElement('div')
      el.className = 'twin-callout twin-callout-accent'
      el.textContent = spot.label
      const lbl = new CSS2DObject(el)
      lbl.position.set(0, 400, -95)
      g.add(lbl)
    })
    this.fleetAnim = { t0: performance.now(), show: spots.length > 0, spots: spots.map((p) => new THREE.Vector3(...p.at)) }
  }

  setAutoRotate(on: boolean, speed = 0.6) {
    this.controls.autoRotate = on
    this.controls.autoRotateSpeed = speed
  }

  /** Let the presenter orbit freely (zoom range opened up for close-ups). */
  presenterMode() {
    this.controls.minDistance = 60
    this.controls.maxDistance = 2400
    this.controls.enablePan = true
  }

  private animatePresentation() {
    const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
    const now = performance.now()
    if (this.flight) {
      const k = Math.min(1, (now - this.flight.t0) / this.flight.ms)
      const e = ease(k)
      this.camera.position.lerpVectors(this.flight.from[0], this.flight.to[0], e)
      this.controls.target.lerpVectors(this.flight.from[1], this.flight.to[1], e)
      if (k >= 1) this.flight = null
    }
    if (this.fleetAnim) {
      const k = Math.min(1, (now - this.fleetAnim.t0) / 1400)
      this.fleet.forEach((g, i) => {
        const to = this.fleetAnim!.spots[i]
        if (!to || !this.fleetAnim!.show) {
          g.visible = false
          return
        }
        g.visible = true
        const e = ease(Math.min(1, Math.max(0, k * 1.4 - i * 0.2)))
        g.position.set(to.x, to.y - 600 * (1 - e), to.z) // rise into place one after another
      })
      if (k >= 1) this.fleetAnim = null
    }
    for (const [name, a] of this.rigAnim) {
      const g = this.rigs.get(name)!
      const k = Math.min(1, (now - a.t0) / a.ms)
      g.position.lerpVectors(a.from, a.to, ease(k))
      if (k >= 1) {
        if (a.hide) g.visible = false
        this.rigAnim.delete(name)
      }
    }
  }

  update(s: TwinState) {
    this.state = s
  }

  dispose() {
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    this.ro.disconnect()
    this.io.disconnect()
    this.controls.dispose()
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.labels.domElement.remove()
  }

  /** Render one frame now (used when the browser throttles animation frames). */
  renderOnce() {
    this.frame(true)
  }

  // ---------------------------------------------------------------------------

  private lights() {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#3a3530', 1.6))
    const key = new THREE.DirectionalLight('#ffffff', 2.4)
    key.position.set(400, 700, 350)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    const c = key.shadow.camera
    c.left = -350
    c.right = 350
    c.top = 350
    c.bottom = -350
    c.far = 2000
    key.target.position.set(40, 100, -100)
    this.scene.add(key, key.target)
    const rim = new THREE.DirectionalLight('#9ec5ff', 0.8)
    rim.position.set(-500, 300, -600)
    this.scene.add(rim)
  }

  private ground() {
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.ShadowMaterial({ opacity: 0.28 }))
    shadow.rotation.x = -Math.PI / 2
    shadow.receiveShadow = true
    this.scene.add(shadow)
    const grid = new THREE.GridHelper(1000, 40, '#555', '#555')
    grid.position.set(40, 0.1, -95)
    const gm = grid.material as THREE.LineBasicMaterial
    gm.transparent = true
    gm.opacity = 0.18
    this.scene.add(grid)
  }

  private makeLabels() {
    const mk = (key: Hint | 'weight', text: string, pos: THREE.Vector3, tone: 'bad' | 'warn' | 'info') => {
      const el = document.createElement('div')
      el.className = `twin-hint twin-${tone}`
      const dot = document.createElement('span')
      dot.className = 'dot'
      el.append(dot, document.createTextNode(text))
      const o = new CSS2DObject(el)
      o.position.copy(pos)
      o.visible = false
      this.scene.add(o)
      this.hintLabels.set(key, o)
    }
    mk('cup', 'Place a cup', new THREE.Vector3(SPOUT.x + 40, CUP_FLOOR_Y + 30, SPOUT.z), 'bad')
    mk('hopper', 'Refill hopper', new THREE.Vector3(0, HOPPER_RIM_Y + 18, -50), 'bad')
    mk('power', '12 V is off', new THREE.Vector3(0, AXIS_Y + 45, 30), 'bad')
    mk('scale', 'Tare the scale', new THREE.Vector3(30, 30, -100), 'warn')
    mk('flow', 'No flow · check hopper', new THREE.Vector3(0, AXIS_Y + 40, -110), 'bad')
    mk('weight', '', new THREE.Vector3(SPOUT.x - 45, CUP_FLOOR_Y + 30, SPOUT.z), 'info')
  }

  private resize() {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.labels.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    // keep the whole station in frame whatever the card shape
    const R = 270
    const vf = THREE.MathUtils.degToRad(this.camera.fov) / 2
    const hf = Math.atan(Math.tan(vf) * this.camera.aspect)
    const dist = R / Math.sin(Math.min(vf, hf))
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist)
    this.controls.maxDistance = dist * 2
  }

  private frame(force = false) {
    if (!force && !this.visible) return
    const dt = Math.min(0.05, this.clock.getDelta())
    const t = this.clock.elapsedTime
    const s = this.state
    const pulse = 0.5 + 0.5 * Math.sin(t * 6)

    if (s) {
      const dosing = s.state === 'DOSING' && !!s.phase && s.phase in PHASE_SPEED
      const hints: Record<Hint, boolean> = {
        cup: !s.cup,
        hopper: !s.hopperOk || s.error === 'HOPPER_EMPTY',
        power: !s.powerOk,
        scale: s.scaleFault || (!s.tareOk && s.cup && !dosing),
        flow: s.error === 'NO_FLOW',
      }

      // auger turns with the phase speed; ghosted when not fitted
      if (dosing && s.augerFitted) this.auger.rotation.z -= (PHASE_SPEED[s.phase!] ?? 0) * dt
      this.auger.visible = s.augerFitted

      // vibration motor against bridging
      this.hopper.position.set(s.vib ? Math.sin(t * 90) * 0.8 : 0, 0, s.vib ? Math.cos(t * 77) * 0.8 : 0)

      // hopper: level from the ultrasonic sensor, red blink when empty
      const pct = Math.max(0, Math.min(100, s.hopperPct ?? (s.hopperOk ? 60 : 0)))
      const top = HOPPER_NECK_Y + ((HOPPER_RIM_Y - 30 - HOPPER_NECK_Y) * pct) / 100
      this.powder.visible = pct > 1
      if (this.powder.visible && Math.round(pct) !== this.lastPct) {
        this.lastPct = Math.round(pct)
        const h = top - HOPPER_NECK_Y + 25
        this.powder.geometry.dispose()
        this.powder.geometry = new THREE.CylinderGeometry(coneR(top) - 2, 15, h, 48)
        this.powder.position.y = 198 + h / 2
      }
      this.powder.position.x = this.hopper.position.x
      this.powder.position.z = -50 + this.hopper.position.z
      this.hopperMat.color.set(hints.hopper ? '#ff4d4d' : '#cfe3ff')
      this.hopperMat.opacity = hints.hopper ? 0.12 + 0.3 * pulse : 0.18
      this.hopperEdges.color.set(hints.hopper ? '#ff4d4d' : '#9fb6d6')
      this.hopperEdges.opacity = hints.hopper ? 0.4 + 0.6 * pulse : 0.55

      // cup or its blinking ghost
      this.cup.visible = s.cup
      this.ghostCup.visible = !s.cup
      this.plateRing.visible = !s.cup
      this.ghostMat.opacity = 0.08 + 0.3 * pulse
      this.ghostEdge.opacity = 0.3 + 0.7 * pulse
      ;(this.plateRing.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.6 * pulse
      const glow = s.state === 'DONE' && s.result ? (s.result === 'ACCEPTED' ? '#33d17a' : '#ff4d4d') : null
      this.cupMat.color.set(glow ?? '#f2f2f2')
      this.cupMat.opacity = glow ? 0.45 + 0.25 * pulse : 0.55

      // powder in the cup follows the measured weight
      const fill = s.cup ? Math.max(0, Math.min(1, s.weight / Math.max(1, s.target * 2.6))) : 0
      this.cupFill.visible = fill > 0.005
      const fh = Math.max(0.5, fill * 36)
      this.cupFill.scale.y = fh
      this.cupFill.position.y = CUP_FLOOR_Y + 6 + fh / 2

      // falling stream from the spout
      const rate = dosing && s.augerFitted && s.cup ? (STREAM[s.phase!] ?? 0) : 0
      const pos = this.stream.geometry.getAttribute('position') as THREE.BufferAttribute
      const floor = CUP_FLOOR_Y + 6 + fh
      const drop = SPOUT.y - floor
      for (let i = 0; i < pos.count; i++) {
        const on = this.streamSeeds[i * 3 + 2] < rate
        const k = (this.streamSeeds[i * 3] + t * 1.6) % 1
        const spread = 3 + 6 * rate
        pos.setXYZ(
          i,
          on ? SPOUT.x + (this.streamSeeds[i * 3 + 1] - 0.5) * spread * k : 0,
          on ? SPOUT.y - k * k * drop : -999,
          on ? SPOUT.z + (this.streamSeeds[(i * 3 + 4) % pos.array.length] - 0.5) * spread * k : 0,
        )
      }
      pos.needsUpdate = true

      // motor and load cell hints
      this.tmp.set(hints.power ? '#ff4d4d' : '#000000')
      this.motorMat.emissive.copy(this.tmp)
      this.motorMat.emissiveIntensity = hints.power ? 0.4 + 0.8 * pulse : 0
      this.cellMat.emissive.set(s.scaleFault ? '#ff4d4d' : '#fab219')
      this.cellMat.emissiveIntensity = hints.scale ? 0.3 + 0.7 * pulse : 0
      this.tubeMat.emissive.set('#ff4d4d')
      this.tubeMat.emissiveIntensity = hints.flow ? 0.2 + 0.5 * pulse : 0

      for (const [k, on] of Object.entries(hints) as [Hint, boolean][]) {
        const o = this.hintLabels.get(k)!
        o.visible = on && s.online
        if (k === 'scale') o.element.lastChild!.textContent = s.scaleFault ? 'Load cell fault' : 'Tare the scale'
      }
      const wl = this.hintLabels.get('weight')!
      wl.visible = s.online && s.cup && (dosing || s.state === 'SETTLE' || s.state === 'MANUAL' || s.state === 'DONE')
      wl.element.lastChild!.textContent = `${s.weight.toFixed(2)} g`
      wl.element.className = `twin-hint twin-${s.state === 'DONE' ? (s.result === 'ACCEPTED' ? 'ok' : 'bad') : 'info'}`
    }

    this.drawLcd()
    this.animatePresentation()
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
    this.labels.render(this.scene, this.camera)
  }
}
