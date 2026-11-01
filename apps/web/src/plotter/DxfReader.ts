// Translated from LaserGRBL Plotter/DxfReader.cs (GNU GPLv3), commit d893552.
// ASCII DXF: LINE, LWPOLYLINE, POLYLINE, ARC, CIRCLE, ELLIPSE, SPLINE, INSERT.
// Positive bulge follows the DXF rule: bulge +1 from (0,0) to (2,0) passes through (1,-1).

import { dist, num } from './PlotGeom'
import { pt, type PlotPath, type PlotPoint } from './types'

interface Pair {
  code: number
  value: string
}

interface Xform {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

function identity(): Xform {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
}

function applyX(m: Xform, p: PlotPoint): PlotPoint {
  return pt(m.a * p.x + m.b * p.y + m.e, m.c * p.x + m.d * p.y + m.f)
}

function then(current: Xform, next: Xform): Xform {
  return {
    a: next.a * current.a + next.b * current.c,
    b: next.a * current.b + next.b * current.d,
    e: next.a * current.e + next.b * current.f + next.e,
    c: next.c * current.a + next.d * current.c,
    d: next.c * current.b + next.d * current.d,
    f: next.c * current.e + next.d * current.f + next.f,
  }
}

interface InsertOp {
  name: string
  x: number
  y: number
  rot: number
  sx: number
  sy: number
}

interface BlockDef {
  name: string
  baseX: number
  baseY: number
  paths: PlotPath[]
  inserts: InsertOp[]
}

function newBlock(name: string): BlockDef {
  return { name: name, baseX: 0, baseY: 0, paths: [], inserts: [] }
}

export function read(content: string | null): PlotPath[] {
  if (content == null) content = ''
  if (content.indexOf('AutoCAD Binary DXF') === 0 || content.indexOf('\0') >= 0) {
    throw new Error('Binary DXF is not supported. Save the drawing as ASCII DXF.')
  }

  const pairs = parsePairs(content)
  const scale = unitScale(pairs)
  const blocks = new Map<string, BlockDef>()
  const model = newBlock('*MODEL')

  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code !== 0 || pairs[i].value !== 'SECTION') continue
    let name = ''
    if (i + 1 < pairs.length && pairs[i + 1].code === 2) name = pairs[i + 1].value
    const start = i + 1
    let end = start
    while (end < pairs.length && !(pairs[end].code === 0 && pairs[end].value === 'ENDSEC')) end++
    if (name === 'BLOCKS') readBlocks(pairs, start, end, scale, blocks)
    else if (name === 'ENTITIES') readEntities(pairs, start, end, scale, model)
    i = end
  }

  const world: PlotPath[] = []
  paint(model, identity(), blocks, 0, world)
  return joinOpen(world)
}

export function toContourGCode(paths: PlotPath[] | null, feed: number): string {
  if (feed < 1) feed = 1000
  let sb = 'G90\r\n'
  if (paths == null) return sb
  const f = String(Math.trunc(feed))
  for (let p = 0; p < paths.length; p++) {
    const path = paths[p]
    if (path == null || path.points == null || path.points.length < 2) continue
    sb += 'G0 X' + num(path.points[0].x) + ' Y' + num(path.points[0].y) + '\r\n'
    sb += 'M3 S255\r\n'
    for (let i = 1; i < path.points.length; i++) {
      sb += 'G1 X' + num(path.points[i].x)
      sb += ' Y' + num(path.points[i].y)
      sb += ' F' + f + '\r\n'
    }
    if (path.closed) {
      sb += 'G1 X' + num(path.points[0].x)
      sb += ' Y' + num(path.points[0].y)
      sb += ' F' + f + '\r\n'
    }
    sb += 'M5 S0\r\n'
  }
  return sb
}

function readBlocks(pairs: Pair[], start: number, end: number, scale: number, blocks: Map<string, BlockDef>): void {
  for (let i = start; i < end; i++) {
    if (pairs[i].code !== 0 || pairs[i].value !== 'BLOCK') continue
    const block = newBlock('')
    let j = i + 1
    while (j < end && pairs[j].code !== 0) {
      if (pairs[j].code === 2 || pairs[j].code === 3) block.name = pairs[j].value
      else if (pairs[j].code === 10) block.baseX = numOf(pairs[j].value) * scale
      else if (pairs[j].code === 20) block.baseY = numOf(pairs[j].value) * scale
      j++
    }
    let ent = j
    while (ent < end && !(pairs[ent].code === 0 && pairs[ent].value === 'ENDBLK')) ent++
    if (block.name != null && block.name !== '') {
      readEntities(pairs, j, ent, scale, block)
      blocks.set(block.name.toLowerCase(), block)
    }
    i = ent
  }
}

function readEntities(pairs: Pair[], start: number, end: number, scale: number, into: BlockDef): void {
  let inPoly = false
  let polyClosed = false
  let poly: PlotPoint[] | null = null
  let polyBulge: number[] | null = null

  for (let i = start; i < end; i++) {
    if (pairs[i].code !== 0) continue
    const type = pairs[i].value
    let j = i + 1
    while (j < end && pairs[j].code !== 0) j++

    if (inPoly && type !== 'VERTEX' && type !== 'SEQEND') {
      finishPoly(into, poly, polyBulge, polyClosed)
      inPoly = false
    }

    if (type === 'POLYLINE') {
      inPoly = true
      polyClosed = flag(pairs, i + 1, j, 70, 1)
      poly = []
      polyBulge = []
    } else if (type === 'VERTEX' && inPoly) {
      const xy = tryXY(pairs, i + 1, j, 10, 20, scale)
      if (xy.ok && poly != null && polyBulge != null) {
        const bulge = first(pairs, i + 1, j, 42)
        poly.push(pt(xy.x, xy.y))
        polyBulge.push(bulge)
      }
    } else if (type === 'SEQEND' && inPoly) {
      finishPoly(into, poly, polyBulge, polyClosed)
      inPoly = false
    } else if (type === 'LINE') addLine(into, pairs, i + 1, j, scale)
    else if (type === 'LWPOLYLINE') addLwPolyline(into, pairs, i + 1, j, scale)
    else if (type === 'CIRCLE') addCircle(into, pairs, i + 1, j, scale)
    else if (type === 'ARC') addArc(into, pairs, i + 1, j, scale)
    else if (type === 'ELLIPSE') addEllipse(into, pairs, i + 1, j, scale)
    else if (type === 'SPLINE') addSpline(into, pairs, i + 1, j, scale)
    else if (type === 'INSERT') addInsert(into, pairs, i + 1, j, scale)

    i = j - 1
  }
  if (inPoly) finishPoly(into, poly, polyBulge, polyClosed)
}

function hidden(pairs: Pair[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    if (pairs[i].code === 60 && Math.round(numOf(pairs[i].value)) === 1) return true
    if (pairs[i].code === 67 && Math.round(numOf(pairs[i].value)) === 1) return true
  }
  return false
}

function addLine(into: BlockDef, pairs: Pair[], start: number, end: number, scale: number): void {
  if (hidden(pairs, start, end)) return
  const a = tryXY(pairs, start, end, 10, 20, scale)
  if (!a.ok) return
  const b = tryXY(pairs, start, end, 11, 21, scale)
  if (!b.ok) return
  if (dist(pt(a.x, a.y), pt(b.x, b.y)) < 1e-6) return
  into.paths.push({ points: [pt(a.x, a.y), pt(b.x, b.y)], closed: false })
}

function addLwPolyline(into: BlockDef, pairs: Pair[], start: number, end: number, scale: number): void {
  if (hidden(pairs, start, end)) return
  const closed = flag(pairs, start, end, 70, 1)
  const verts: PlotPoint[] = []
  const bulges: number[] = []
  let have = false
  let x = 0
  let y = 0
  let bulge = 0
  for (let i = start; i < end; i++) {
    if (pairs[i].code === 10) {
      if (have) {
        verts.push(pt(x, y))
        bulges.push(bulge)
        bulge = 0
      }
      x = numOf(pairs[i].value) * scale
      have = true
    } else if (pairs[i].code === 20) y = numOf(pairs[i].value) * scale
    else if (pairs[i].code === 42) bulge = numOf(pairs[i].value)
  }
  if (have) {
    verts.push(pt(x, y))
    bulges.push(bulge)
  }
  finishPoly(into, verts, bulges, closed)
}

function finishPoly(into: BlockDef, verts: PlotPoint[] | null, bulges: number[] | null, closed: boolean): void {
  if (verts == null || verts.length < 2) return
  const pts: PlotPoint[] = []
  const seg = closed ? verts.length : verts.length - 1
  for (let i = 0; i < seg; i++) {
    let bulge = 0
    if (bulges != null && i < bulges.length) bulge = bulges[i]
    appendBulge(pts, verts[i], verts[(i + 1) % verts.length], bulge)
  }
  if (pts.length < 2) return
  if (closed && dist(pts[0], pts[pts.length - 1]) < 0.0001) pts.pop()
  if (pts.length < 2) return
  into.paths.push({ points: pts, closed: closed && pts.length >= 3 })
}

function addCircle(into: BlockDef, pairs: Pair[], start: number, end: number, scale: number): void {
  if (hidden(pairs, start, end)) return
  const c = tryXY(pairs, start, end, 10, 20, scale)
  if (!c.ok) return
  const radius = Math.abs(first(pairs, start, end, 40) * scale)
  if (radius < 1e-6) return
  into.paths.push({ closed: true, points: sampleArc(c.x, c.y, radius, radius, 0, Math.PI * 2, true) })
}

function addArc(into: BlockDef, pairs: Pair[], start: number, end: number, scale: number): void {
  if (hidden(pairs, start, end)) return
  const c = tryXY(pairs, start, end, 10, 20, scale)
  if (!c.ok) return
  const radius = Math.abs(first(pairs, start, end, 40) * scale)
  if (radius < 1e-6) return
  const a0 = first(pairs, start, end, 50) * Math.PI / 180.0
  const a1 = first(pairs, start, end, 51) * Math.PI / 180.0
  let sweep = a1 - a0
  if (sweep <= 1e-8) sweep += Math.PI * 2
  into.paths.push({ points: sampleArc(c.x, c.y, radius, radius, a0, sweep, false), closed: false })
}

function addEllipse(into: BlockDef, pairs: Pair[], start: number, end: number, scale: number): void {
  if (hidden(pairs, start, end)) return
  const c = tryXY(pairs, start, end, 10, 20, scale)
  if (!c.ok) return
  const major = tryXY(pairs, start, end, 11, 21, scale)
  if (!major.ok) return
  let ratio = first(pairs, start, end, 40)
  if (ratio <= 0) ratio = 1
  let a0 = first(pairs, start, end, 41)
  let a1 = first(pairs, start, end, 42)
  if (Math.abs(a0) < 1e-12 && Math.abs(a1) < 1e-12) a1 = Math.PI * 2
  let sweep = a1 - a0
  if (sweep <= 1e-8) sweep += Math.PI * 2
  const majorLen = Math.sqrt(major.x * major.x + major.y * major.y)
  const minor = majorLen * ratio
  const full = Math.abs(sweep - Math.PI * 2) < 1e-3
  const points = sampleEllipse(c.x, c.y, major.x, major.y, minor, a0, sweep, full)
  if (points.length >= 2) into.paths.push({ points: points, closed: full })
}

function addSpline(into: BlockDef, pairs: Pair[], start: number, end: number, scale: number): void {
  if (hidden(pairs, start, end)) return
  let degree = Math.round(first(pairs, start, end, 71))
  if (degree < 1) degree = 3
  const fit: PlotPoint[] = []
  const controls: PlotPoint[] = []
  const knots: number[] = []
  let haveFit = false
  let haveCtl = false
  let fx = 0
  let fy = 0
  let cx = 0
  let cy = 0
  for (let i = start; i < end; i++) {
    if (pairs[i].code === 11) {
      if (haveFit) fit.push(pt(fx, fy))
      fx = numOf(pairs[i].value) * scale
      haveFit = true
    } else if (pairs[i].code === 21 && haveFit) fy = numOf(pairs[i].value) * scale
    else if (pairs[i].code === 10) {
      if (haveCtl) controls.push(pt(cx, cy))
      cx = numOf(pairs[i].value) * scale
      haveCtl = true
    } else if (pairs[i].code === 20 && haveCtl) cy = numOf(pairs[i].value) * scale
    else if (pairs[i].code === 40) knots.push(numOf(pairs[i].value))
  }
  if (haveFit) fit.push(pt(fx, fy))
  if (haveCtl) controls.push(pt(cx, cy))

  let pts: PlotPoint[] | null = null
  if (fit.length >= 2) pts = fit
  else if (controls.length >= 2) pts = sampleSpline(controls, knots, degree)
  if (pts == null || pts.length < 2) return
  const flagValue = Math.round(first(pairs, start, end, 70))
  into.paths.push({ points: pts, closed: (flagValue & 1) !== 0 && pts.length >= 3 })
}

function addInsert(into: BlockDef, pairs: Pair[], start: number, end: number, scale: number): void {
  if (hidden(pairs, start, end)) return
  let name: string | null = null
  for (let i = start; i < end; i++) {
    if (pairs[i].code === 2) name = pairs[i].value
  }
  if (name == null || name === '') return
  const xy = tryXY(pairs, start, end, 10, 20, scale)
  let sx = first(pairs, start, end, 41)
  let sy = first(pairs, start, end, 42)
  if (Math.abs(sx) < 1e-12) sx = 1
  if (Math.abs(sy) < 1e-12) sy = 1
  into.inserts.push({
    name: name,
    x: xy.x,
    y: xy.y,
    sx: sx,
    sy: sy,
    rot: first(pairs, start, end, 50),
  })
}

function paint(block: BlockDef | null, xform: Xform, blocks: Map<string, BlockDef>, depth: number, into: PlotPath[]): void {
  if (block == null || depth > 8) return
  for (let i = 0; i < block.paths.length; i++) {
    const src = block.paths[i]
    const points: PlotPoint[] = []
    for (let p = 0; p < src.points.length; p++) points.push(applyX(xform, src.points[p]))
    into.push({ closed: src.closed, points: points })
  }
  for (let i = 0; i < block.inserts.length; i++) {
    const op = block.inserts[i]
    const child = blocks.get(op.name.toLowerCase())
    if (child == null) continue
    let local = identity()
    local = then(translate(-child.baseX, -child.baseY), scaleOf(op.sx, op.sy))
    local = then(local, rotate(op.rot))
    local = then(local, translate(op.x, op.y))
    paint(child, then(local, xform), blocks, depth + 1, into)
  }
}

function translate(x: number, y: number): Xform {
  const m = identity()
  m.e = x
  m.f = y
  return m
}

function scaleOf(sx: number, sy: number): Xform {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }
}

function rotate(degrees: number): Xform {
  const r = degrees * Math.PI / 180.0
  const co = Math.cos(r)
  const si = Math.sin(r)
  return { a: co, b: -si, c: si, d: co, e: 0, f: 0 }
}

function joinOpen(source: PlotPath[]): PlotPath[] {
  const closed: PlotPath[] = []
  const open: PlotPath[] = []
  for (let i = 0; i < source.length; i++) {
    const path = source[i]
    if (path == null || path.points == null || path.points.length < 2) continue
    if (path.closed && path.points.length >= 3) closed.push(path)
    else {
      path.closed = false
      open.push(path)
    }
  }

  const tol = 0.02
  let merged = true
  while (merged) {
    merged = false
    for (let i = 0; i < open.length && !merged; i++) {
      for (let j = i + 1; j < open.length && !merged; j++) {
        const joined = tryJoin(open[i], open[j], tol)
        if (joined == null) continue
        open[i] = joined
        open.splice(j, 1)
        merged = true
      }
    }
  }

  for (let i = 0; i < open.length; i++) {
    const path = open[i]
    if (path.points.length >= 3 && dist(path.points[0], path.points[path.points.length - 1]) <= tol) {
      path.points.pop()
      path.closed = path.points.length >= 3
    }
    closed.push(path)
  }
  return closed
}

function tryJoin(a: PlotPath, b: PlotPath, tol: number): PlotPath | null {
  const a0 = a.points[0]
  const a1 = a.points[a.points.length - 1]
  const b0 = b.points[0]
  const b1 = b.points[b.points.length - 1]
  if (dist(a1, b0) <= tol) return concat(a.points, b.points, false, false)
  if (dist(a1, b1) <= tol) return concat(a.points, b.points, false, true)
  if (dist(a0, b0) <= tol) return concat(a.points, b.points, true, false)
  if (dist(a0, b1) <= tol) return concat(a.points, b.points, true, true)
  return null
}

function concat(a: PlotPoint[], b: PlotPoint[], reverseA: boolean, reverseB: boolean): PlotPath {
  const left = a.slice()
  const right = b.slice()
  if (reverseA) left.reverse()
  if (reverseB) right.reverse()
  const points = left
  let begin = 0
  if (right.length > 0 && dist(left[left.length - 1], right[0]) <= 0.02) begin = 1
  for (let i = begin; i < right.length; i++) points.push(right[i])
  return { points: points, closed: false }
}

function appendBulge(pts: PlotPoint[], a: PlotPoint, b: PlotPoint, bulge: number): void {
  if (pts.length === 0) pts.push(a)
  if (Math.abs(bulge) < 1e-8 || dist(a, b) < 1e-9) {
    pts.push(b)
    return
  }
  const chord = dist(a, b)
  const radius = chord * (bulge * bulge + 1.0) / (4.0 * Math.abs(bulge))
  const half = chord * 0.5
  let dist2 = radius * radius - half * half
  if (dist2 < 0) dist2 = 0
  const distCenter = Math.sqrt(dist2)
  const sign = bulge >= 0 ? 1 : -1
  const mx = (a.x + b.x) * 0.5
  const my = (a.y + b.y) * 0.5
  const nx = -(b.y - a.y) / chord
  const ny = (b.x - a.x) / chord
  const cx = mx + sign * nx * distCenter
  const cy = my + sign * ny * distCenter
  const a0 = Math.atan2(a.y - cy, a.x - cx)
  const a1 = Math.atan2(b.y - cy, b.x - cx)
  let sweep = a1 - a0
  if (bulge > 0 && sweep < 0) sweep += Math.PI * 2
  if (bulge < 0 && sweep > 0) sweep -= Math.PI * 2
  const arc = sampleArc(cx, cy, radius, radius, a0, sweep, false)
  for (let i = 1; i < arc.length; i++) pts.push(arc[i])
}

function sampleArc(cx: number, cy: number, rx: number, ry: number, start: number, sweep: number, full: boolean): PlotPoint[] {
  const radius = Math.max(Math.abs(rx), Math.abs(ry))
  let step = 0.2
  if (radius > 0.05) {
    let cosArg = 1.0 - 0.05 / radius
    if (cosArg < -1) cosArg = -1
    if (cosArg > 1) cosArg = 1
    step = 2 * Math.acos(cosArg)
  }
  if (step < 0.05) step = 0.05
  if (step > Math.PI / 6) step = Math.PI / 6
  let n = Math.ceil(Math.abs(sweep) / step)
  if (n < 8) n = 8
  if (n > 720) n = 720
  const last = full ? n - 1 : n
  const pts: PlotPoint[] = []
  for (let i = 0; i <= last; i++) {
    const t = start + (sweep * i) / n
    pts.push(pt(cx + rx * Math.cos(t), cy + ry * Math.sin(t)))
  }
  return pts
}

function sampleEllipse(cx: number, cy: number, mx: number, my: number, minor: number, start: number, sweep: number, full: boolean): PlotPoint[] {
  const major = Math.sqrt(mx * mx + my * my)
  if (major < 1e-9) return []
  const nx = (-my / major) * minor
  const ny = (mx / major) * minor
  const step = Math.PI / 24
  let n = Math.ceil(Math.abs(sweep) / step)
  if (n < 12) n = 12
  if (n > 720) n = 720
  const last = full ? n - 1 : n
  const pts: PlotPoint[] = []
  for (let i = 0; i <= last; i++) {
    const t = start + (sweep * i) / n
    const c = Math.cos(t)
    const s = Math.sin(t)
    pts.push(pt(cx + mx * c + nx * s, cy + my * c + ny * s))
  }
  return pts
}

function sampleSpline(controls: PlotPoint[], knotsIn: number[], degreeIn: number): PlotPoint[] {
  const n = controls.length
  let degree = degreeIn
  if (degree >= n) degree = n - 1
  if (degree < 1) return controls.slice()
  let knots = knotsIn
  if (knots == null || knots.length < n + degree + 1) {
    const made: number[] = []
    for (let i = 0; i < n + degree + 1; i++) {
      if (i <= degree) made.push(0)
      else if (i >= n) made.push(n - degree)
      else made.push(i - degree)
    }
    knots = made
  }
  let t0 = knots[degree]
  let t1 = knots[knots.length - degree - 1]
  if (t1 < t0) {
    const swap = t0
    t0 = t1
    t1 = swap
  }
  let samples = n * 8
  if (samples < 8) samples = 8
  if (samples > 400) samples = 400
  const pts: PlotPoint[] = []
  for (let s = 0; s <= samples; s++) {
    let t = t0
    if (samples > 0) t = t0 + ((t1 - t0) * s) / samples
    if (s === samples) t = t1 - 1e-9
    pts.push(deBoor(controls, knots, degree, t))
  }
  return pts
}

function deBoor(controls: PlotPoint[], knots: number[], degree: number, t: number): PlotPoint {
  const n = controls.length
  let span = degree
  if (t <= knots[degree]) span = degree
  else if (t >= knots[n]) span = n - 1
  else {
    for (let i = degree; i < n; i++) {
      if (t >= knots[i] && t < knots[i + 1]) {
        span = i
        break
      }
    }
  }

  const d: PlotPoint[] = []
  for (let j = 0; j <= degree; j++) {
    let idx = span - degree + j
    if (idx < 0) idx = 0
    if (idx >= n) idx = n - 1
    d.push(controls[idx])
  }
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const left = j + span - degree
      const right = j + 1 + span - r
      let denom = 0
      if (left >= 0 && right < knots.length) denom = knots[right] - knots[left]
      let alpha = 0
      if (Math.abs(denom) > 1e-12 && left >= 0) alpha = (t - knots[left]) / denom
      if (alpha < 0) alpha = 0
      if (alpha > 1) alpha = 1
      d[j] = pt((1 - alpha) * d[j - 1].x + alpha * d[j].x, (1 - alpha) * d[j - 1].y + alpha * d[j].y)
    }
  }
  return d[degree]
}

function unitScale(pairs: Pair[]): number {
  let units = -2147483648
  let measurement = 1
  let header = false
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code === 0 && pairs[i].value === 'SECTION') {
      header = i + 1 < pairs.length && pairs[i + 1].code === 2 && pairs[i + 1].value === 'HEADER'
    }
    if (pairs[i].code === 0 && pairs[i].value === 'ENDSEC') header = false
    if (!header || pairs[i].code !== 9) continue
    const key = pairs[i].value
    if (i + 1 >= pairs.length) break
    if (key === '$INSUNITS' && pairs[i + 1].code === 70) units = Math.round(numOf(pairs[i + 1].value))
    if (key === '$MEASUREMENT' && pairs[i + 1].code === 70) measurement = Math.round(numOf(pairs[i + 1].value))
  }
  if (units === -2147483648) return measurement === 0 ? 25.4 : 1
  switch (units) {
    case 1: return 25.4
    case 2: return 304.8
    case 4: return 1
    case 5: return 10
    case 6: return 1000
    case 9: return 0.0254
    case 10: return 914.4
    case 13: return 0.001
    case 14: return 100
    case 15: return 10000
    case 0: return measurement === 0 ? 25.4 : 1
    default: return 1
  }
}

function parsePairs(content: string): Pair[] {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const pairs: Pair[] = []
  let i = 0
  while (i + 1 < lines.length) {
    const codeText = lines[i].trim()
    const value = lines[i + 1].trim()
    i += 2
    if (codeText.length === 0) continue
    const code = Number.parseInt(codeText, 10)
    if (!Number.isFinite(code) || String(code) !== codeText && !/^[+-]?\d+$/.test(codeText)) continue
    pairs.push({ code: code, value: value })
  }
  return pairs
}

function tryXY(pairs: Pair[], start: number, end: number, xc: number, yc: number, scale: number): { ok: boolean; x: number; y: number } {
  let x = 0
  let y = 0
  let hx = false
  let hy = false
  for (let i = start; i < end; i++) {
    if (pairs[i].code === xc) {
      x = numOf(pairs[i].value) * scale
      hx = true
    } else if (pairs[i].code === yc) {
      y = numOf(pairs[i].value) * scale
      hy = true
    }
  }
  return { ok: hx && hy, x: x, y: y }
}

function first(pairs: Pair[], start: number, end: number, code: number): number {
  for (let i = start; i < end; i++) {
    if (pairs[i].code === code) return numOf(pairs[i].value)
  }
  return 0
}

function flag(pairs: Pair[], start: number, end: number, code: number, bit: number): boolean {
  const value = Math.round(first(pairs, start, end, code))
  return (value & bit) !== 0
}

function numOf(text: string): number {
  if (text == null) return 0
  const value = Number.parseFloat(text)
  if (Number.isFinite(value)) return value
  return 0
}
