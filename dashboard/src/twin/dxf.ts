import * as THREE from 'three'

type P = [number, number]

/**
 * Minimal DXF reader for SolidWorks laser-cut exports: LINE, ARC and CIRCLE
 * entities chained into closed loops. The largest loop is the outline,
 * everything else becomes a hole.
 */
export function dxfToShape(text: string): THREE.Shape {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const start = lines.indexOf('ENTITIES')
  const segs: P[][] = []
  const circles: { c: P; r: number }[] = []

  let i = start
  while (i < lines.length - 1) {
    if (lines[i] !== '0') {
      i++
      continue
    }
    const type = lines[i + 1]
    if (type === 'ENDSEC') break
    // collect this entity's group codes
    const g: Record<string, number> = {}
    let j = i + 2
    while (j < lines.length - 1 && lines[j] !== '0') {
      const v = Number(lines[j + 1])
      if (!(lines[j] in g)) g[lines[j]] = v
      j += 2
    }
    if (type === 'LINE') segs.push([[g['10'], g['20']], [g['11'], g['21']]])
    else if (type === 'CIRCLE') circles.push({ c: [g['10'], g['20']], r: g['40'] })
    else if (type === 'ARC') {
      const [cx, cy, r] = [g['10'], g['20'], g['40']]
      const a0 = (g['50'] * Math.PI) / 180
      let a1 = (g['51'] * Math.PI) / 180
      if (a1 < a0) a1 += Math.PI * 2
      const n = Math.max(4, Math.ceil(((a1 - a0) * r) / 2))
      const pts: P[] = []
      for (let k = 0; k <= n; k++) {
        const a = a0 + ((a1 - a0) * k) / n
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
      }
      segs.push(pts)
    }
    i = j
  }

  const loops = chain(segs)
  const area = (l: P[]) => Math.abs(l.reduce((s, p, k) => { const q = l[(k + 1) % l.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0)) / 2
  loops.sort((a, b) => area(b) - area(a))
  const [outer, ...inner] = loops
  const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)))
  for (const l of inner) shape.holes.push(new THREE.Path(l.map(([x, y]) => new THREE.Vector2(x, y))))
  for (const c of circles) {
    const h = new THREE.Path()
    h.absarc(c.c[0], c.c[1], c.r, 0, Math.PI * 2, true)
    shape.holes.push(h)
  }
  return shape
}

const EPS = 0.05
const same = (a: P, b: P) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS

function chain(segs: P[][]): P[][] {
  const left = segs.slice()
  const loops: P[][] = []
  while (left.length) {
    const loop = left.pop()!.slice()
    let grew = true
    while (grew && !same(loop[0], loop[loop.length - 1])) {
      grew = false
      const end = loop[loop.length - 1]
      for (let k = 0; k < left.length; k++) {
        const s = left[k]
        if (same(s[0], end)) loop.push(...s.slice(1))
        else if (same(s[s.length - 1], end)) loop.push(...s.slice(0, -1).reverse())
        else continue
        left.splice(k, 1)
        grew = true
        break
      }
    }
    if (loop.length > 2) loops.push(same(loop[0], loop[loop.length - 1]) ? loop.slice(0, -1) : loop)
  }
  return loops
}
