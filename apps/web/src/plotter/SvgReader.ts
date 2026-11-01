// SVG geometry to polylines for the plotter pipeline.
// Coordinates are millimetres, Y grows away from the operator.

import { appendCubic } from './PlotGeom'
import { pt, type PlotPath, type PlotPoint } from './types'

interface El {
  name: string
  attrs: Record<string, string>
  children: El[]
}

interface Xform {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

interface DocScale {
  vbX: number
  vbY: number
  vbW: number
  vbH: number
  sx: number
  sy: number
}

const PX_TO_MM = 25.4 / 96

export function read(content: string | null): PlotPath[] {
  if (content == null || content.trim() === '') return []
  const root = parseXml(content)
  const svg = findSvg(root)
  const doc = documentScale(svg)
  const paths: PlotPath[] = []
  const ids = new Map<string, El>()
  indexIds(svg, ids)
  walk(svg, identity(), doc, ids, 0, false, paths)
  return paths
}

function findSvg(root: El): El {
  if (root.name === 'svg') return root
  for (let i = 0; i < root.children.length; i++) {
    if (root.children[i].name === 'svg') return root.children[i]
  }
  return root
}

function documentScale(svg: El): DocScale {
  const box = (svg.attrs.viewbox || '').trim().split(/[\s,]+/).map(Number)
  const width = parseLength(svg.attrs.width)
  const height = parseLength(svg.attrs.height)
  let vbX = 0
  let vbY = 0
  let vbW = 0
  let vbH = 0
  const hasBox = box.length === 4 && box.every((n) => Number.isFinite(n)) && box[2] !== 0 && box[3] !== 0
  if (hasBox) {
    vbX = box[0]
    vbY = box[1]
    vbW = box[2]
    vbH = box[3]
  }
  let sx = 1
  let sy = 1
  if (hasBox && width != null && height != null && width.mm !== 0 && height.mm !== 0) {
    sx = width.mm / vbW
    sy = height.mm / vbH
  } else if (hasBox) {
    sx = 1
    sy = 1
  } else if (width != null && width.user !== 0) {
    sx = width.mm / width.user
    sy = height != null && height.user !== 0 ? height.mm / height.user : sx
    vbW = width.user
    vbH = height != null ? height.user : width.user
  }
  if (!hasBox && vbW === 0) {
    vbW = 0
    vbH = 0
  }
  return { vbX, vbY, vbW, vbH, sx, sy }
}

function walk(el: El, xform: Xform, doc: DocScale, ids: Map<string, El>, depth: number, inDefs: boolean, into: PlotPath[]): void {
  if (el == null || depth > 12) return
  const name = el.name
  const hidden = isHidden(el)
  const nextDefs = inDefs || name === 'defs' || name === 'symbol' || name === 'clippath' || name === 'mask'
  const local = then(parseTransform(el.attrs.transform), xform)
  if (name === 'use') {
    const href = el.attrs.href || el.attrs['xlink:href'] || ''
    const id = href.startsWith('#') ? href.slice(1) : ''
    const target = id !== '' ? ids.get(id) : undefined
    if (target != null && !hidden) {
      const dx = num(el.attrs.x)
      const dy = num(el.attrs.y)
      walk(target, then(translate(dx, dy), local), doc, ids, depth + 1, false, into)
    }
    return
  }
  if (!hidden && !nextDefs) emitShape(el, local, doc, into)
  for (let i = 0; i < el.children.length; i++) {
    walk(el.children[i], local, doc, ids, depth + 1, nextDefs, into)
  }
}

function emitShape(el: El, xform: Xform, doc: DocScale, into: PlotPath[]): void {
  const name = el.name
  if (name === 'path') {
    const subs = parsePath(el.attrs.d || '')
    for (let i = 0; i < subs.length; i++) pushMapped(into, subs[i].points, subs[i].closed, xform, doc)
  } else if (name === 'line') {
    pushMapped(into, [pt(num(el.attrs.x1), num(el.attrs.y1)), pt(num(el.attrs.x2), num(el.attrs.y2))], false, xform, doc)
  } else if (name === 'polyline' || name === 'polygon') {
    const points = parsePoints(el.attrs.points || '')
    pushMapped(into, points, name === 'polygon', xform, doc)
  } else if (name === 'rect') {
    const x = num(el.attrs.x)
    const y = num(el.attrs.y)
    const w = num(el.attrs.width)
    const h = num(el.attrs.height)
    if (w === 0 || h === 0) return
    pushMapped(into, [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)], true, xform, doc)
  } else if (name === 'circle' || name === 'ellipse') {
    const cx = num(el.attrs.cx)
    const cy = num(el.attrs.cy)
    const rx = name === 'circle' ? num(el.attrs.r) : num(el.attrs.rx)
    const ry = name === 'circle' ? num(el.attrs.r) : num(el.attrs.ry)
    if (rx === 0 || ry === 0) return
    pushMapped(into, sampleEllipse(cx, cy, rx, ry), true, xform, doc)
  }
}

function pushMapped(into: PlotPath[], points: PlotPoint[], closed: boolean, xform: Xform, doc: DocScale): void {
  if (points.length < 2) return
  const mapped: PlotPoint[] = []
  for (let i = 0; i < points.length; i++) {
    const p = applyX(xform, points[i])
    mapped.push(userToMm(p, doc))
  }
  if (closed && mapped.length >= 2 && Math.abs(mapped[0].x - mapped[mapped.length - 1].x) < 1e-6 && Math.abs(mapped[0].y - mapped[mapped.length - 1].y) < 1e-6) {
    mapped.pop()
  }
  if (mapped.length < 2) return
  into.push({ points: mapped, closed: closed && mapped.length >= 3 })
}

function userToMm(p: PlotPoint, doc: DocScale): PlotPoint {
  const x = (p.x - doc.vbX) * doc.sx
  const y = doc.vbH !== 0 ? (doc.vbY + doc.vbH - p.y) * doc.sy : -p.y * doc.sy
  return pt(x, y)
}

interface SubPath {
  points: PlotPoint[]
  closed: boolean
}

function parsePath(d: string): SubPath[] {
  const tokens = tokenizePath(d)
  const subs: SubPath[] = []
  let pts: PlotPoint[] = []
  let closed = false
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let prevCmd = ''
  let lastCx = 0
  let lastCy = 0
  let i = 0
  const flush = () => {
    if (pts.length >= 2) subs.push({ points: pts, closed: closed })
    pts = []
    closed = false
  }
  while (i < tokens.length) {
    let cmd = tokens[i]
    if (!/^[A-Za-z]$/.test(cmd)) {
      if (prevCmd === 'M') cmd = 'L'
      else if (prevCmd === 'm') cmd = 'l'
      else cmd = prevCmd
    } else {
      i++
    }
    if (cmd === '') break
    const rel = cmd === cmd.toLowerCase()
    const op = cmd.toUpperCase()
    const need = argCount(op)
    if (op === 'Z') {
      if (pts.length > 0) pts.push(pt(sx, sy))
      closed = true
      cx = sx
      cy = sy
      prevCmd = cmd
      flush()
      continue
    }
    if (i + need > tokens.length) break
    const args: number[] = []
    for (let a = 0; a < need; a++) args.push(Number(tokens[i + a]))
    i += need
    if (args.some((n) => !Number.isFinite(n))) {
      prevCmd = cmd
      continue
    }
    if (op === 'M') {
      flush()
      const x = rel ? cx + args[0] : args[0]
      const y = rel ? cy + args[1] : args[1]
      cx = x
      cy = y
      sx = x
      sy = y
      pts = [pt(x, y)]
      prevCmd = rel ? 'm' : 'M'
      continue
    }
    if (op === 'L') {
      const x = rel ? cx + args[0] : args[0]
      const y = rel ? cy + args[1] : args[1]
      pts.push(pt(x, y))
      cx = x
      cy = y
    } else if (op === 'H') {
      const x = rel ? cx + args[0] : args[0]
      pts.push(pt(x, cy))
      cx = x
    } else if (op === 'V') {
      const y = rel ? cy + args[0] : args[0]
      pts.push(pt(cx, y))
      cy = y
    } else if (op === 'C') {
      const x1 = rel ? cx + args[0] : args[0]
      const y1 = rel ? cy + args[1] : args[1]
      const x2 = rel ? cx + args[2] : args[2]
      const y2 = rel ? cy + args[3] : args[3]
      const x = rel ? cx + args[4] : args[4]
      const y = rel ? cy + args[5] : args[5]
      appendCubic(pts, pt(cx, cy), pt(x1, y1), pt(x2, y2), pt(x, y), 0.05)
      lastCx = x2
      lastCy = y2
      cx = x
      cy = y
    } else if (op === 'S') {
      let x1 = cx
      let y1 = cy
      if (prevCmd === 'C' || prevCmd === 'c' || prevCmd === 'S' || prevCmd === 's') {
        x1 = cx * 2 - lastCx
        y1 = cy * 2 - lastCy
      }
      const x2 = rel ? cx + args[0] : args[0]
      const y2 = rel ? cy + args[1] : args[1]
      const x = rel ? cx + args[2] : args[2]
      const y = rel ? cy + args[3] : args[3]
      appendCubic(pts, pt(cx, cy), pt(x1, y1), pt(x2, y2), pt(x, y), 0.05)
      lastCx = x2
      lastCy = y2
      cx = x
      cy = y
    } else if (op === 'Q') {
      const x1 = rel ? cx + args[0] : args[0]
      const y1 = rel ? cy + args[1] : args[1]
      const x = rel ? cx + args[2] : args[2]
      const y = rel ? cy + args[3] : args[3]
      const c1 = pt(cx + (2 / 3) * (x1 - cx), cy + (2 / 3) * (y1 - cy))
      const c2 = pt(x + (2 / 3) * (x1 - x), y + (2 / 3) * (y1 - y))
      appendCubic(pts, pt(cx, cy), c1, c2, pt(x, y), 0.05)
      lastCx = x1
      lastCy = y1
      cx = x
      cy = y
    } else if (op === 'T') {
      let x1 = cx
      let y1 = cy
      if (prevCmd === 'Q' || prevCmd === 'q' || prevCmd === 'T' || prevCmd === 't') {
        x1 = cx * 2 - lastCx
        y1 = cy * 2 - lastCy
      }
      const x = rel ? cx + args[0] : args[0]
      const y = rel ? cy + args[1] : args[1]
      const c1 = pt(cx + (2 / 3) * (x1 - cx), cy + (2 / 3) * (y1 - cy))
      const c2 = pt(x + (2 / 3) * (x1 - x), y + (2 / 3) * (y1 - y))
      appendCubic(pts, pt(cx, cy), c1, c2, pt(x, y), 0.05)
      lastCx = x1
      lastCy = y1
      cx = x
      cy = y
    } else if (op === 'A') {
      const rx = Math.abs(args[0])
      const ry = Math.abs(args[1])
      const phi = args[2] * Math.PI / 180
      const large = args[3] !== 0
      const sweep = args[4] !== 0
      const x = rel ? cx + args[5] : args[5]
      const y = rel ? cy + args[6] : args[6]
      sampleSvgArc(pts, cx, cy, x, y, rx, ry, phi, large, sweep)
      cx = x
      cy = y
    }
    prevCmd = cmd
  }
  flush()
  return subs
}

function argCount(op: string): number {
  if (op === 'M' || op === 'L' || op === 'T') return 2
  if (op === 'H' || op === 'V') return 1
  if (op === 'S' || op === 'Q') return 4
  if (op === 'C') return 6
  if (op === 'A') return 7
  return 0
}

function tokenizePath(d: string): string[] {
  const out: string[] = []
  const re = /[A-Za-z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(d)) != null) out.push(m[0])
  return out
}

function sampleSvgArc(pts: PlotPoint[], x1: number, y1: number, x2: number, y2: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean): void {
  if (rx < 1e-9 || ry < 1e-9 || (Math.abs(x1 - x2) < 1e-9 && Math.abs(y1 - y2) < 1e-9)) {
    pts.push(pt(x2, y2))
    return
  }
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cos * dx + sin * dy
  const y1p = -sin * dx + cos * dy
  let rx2 = rx * rx
  let ry2 = ry * ry
  const x1p2 = x1p * x1p
  const y1p2 = y1p * y1p
  const lam = x1p2 / rx2 + y1p2 / ry2
  if (lam > 1) {
    const s = Math.sqrt(lam)
    rx *= s
    ry *= s
    rx2 = rx * rx
    ry2 = ry * ry
  }
  const sign = large === sweep ? -1 : 1
  const numr = rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2
  const den = rx2 * y1p2 + ry2 * x1p2
  const coef = sign * Math.sqrt(Math.max(0, numr / den))
  const cxp = coef * ((rx * y1p) / ry)
  const cyp = coef * ((-ry * x1p) / rx)
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const start = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx)
  const end = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx)
  let sweepAng = end - start
  if (!sweep && sweepAng > 0) sweepAng -= 2 * Math.PI
  if (sweep && sweepAng < 0) sweepAng += 2 * Math.PI
  let n = Math.ceil(Math.abs(sweepAng) / (Math.PI / 18))
  if (n < 4) n = 4
  if (n > 180) n = 180
  for (let i = 1; i <= n; i++) {
    const t = start + (sweepAng * i) / n
    const ex = rx * Math.cos(t)
    const ey = ry * Math.sin(t)
    pts.push(pt(cx + cos * ex - sin * ey, cy + sin * ex + cos * ey))
  }
}

function sampleEllipse(cx: number, cy: number, rx: number, ry: number): PlotPoint[] {
  const pts: PlotPoint[] = []
  const n = 24
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    pts.push(pt(cx + rx * Math.cos(t), cy + ry * Math.sin(t)))
  }
  return pts
}

function parsePoints(text: string): PlotPoint[] {
  const nums = text.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)
  const pts: PlotPoint[] = []
  if (nums == null) return pts
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push(pt(Number(nums[i]), Number(nums[i + 1])))
  return pts
}

function indexIds(el: El, ids: Map<string, El>): void {
  if (el.attrs.id) ids.set(el.attrs.id, el)
  for (let i = 0; i < el.children.length; i++) indexIds(el.children[i], ids)
}

function isHidden(el: El): boolean {
  const style = el.attrs.style || ''
  if (/\bdisplay\s*:\s*none\b/i.test(style)) return true
  if (/\bvisibility\s*:\s*hidden\b/i.test(style)) return true
  if ((el.attrs.display || '').toLowerCase() === 'none') return true
  if ((el.attrs.visibility || '').toLowerCase() === 'hidden') return true
  return false
}

function parseXml(text: string): El {
  const root: El = { name: '#root', attrs: {}, children: [] }
  const stack: El[] = [root]
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/\s*([A-Za-z0-9:_-]+)\s*>|<\s*([A-Za-z0-9:_-]+)([^>]*?)(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) != null) {
    if (m[1]) {
      const name = m[1].toLowerCase().replace(/^.*:/, '')
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) {
          stack.length = i
          break
        }
      }
      continue
    }
    if (!m[2]) continue
    const el: El = { name: m[2].toLowerCase().replace(/^.*:/, ''), attrs: parseAttrs(m[3] || ''), children: [] }
    stack[stack.length - 1].children.push(el)
    if (m[4] !== '/') stack.push(el)
  }
  return root
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) != null) {
    const key = m[1].toLowerCase()
    attrs[key] = decode(m[3] != null ? m[3] : m[4] || '')
  }
  return attrs
}

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

interface LengthValue {
  mm: number
  user: number
}

function parseLength(raw: string | undefined): LengthValue | null {
  if (raw == null) return null
  const m = raw.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(mm|cm|in|px|pt|pc)?$/)
  if (m == null) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const unit = m[2] || 'px'
  let mm = n
  if (unit === 'cm') mm = n * 10
  else if (unit === 'in') mm = n * 25.4
  else if (unit === 'px') mm = n * PX_TO_MM
  else if (unit === 'pt') mm = n * 25.4 / 72
  else if (unit === 'pc') mm = n * 25.4 / 6
  const user = unit === 'px' ? n : mm
  return { mm, user }
}

function num(raw: string | undefined): number {
  if (raw == null || raw === '') return 0
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : 0
}

function identity(): Xform {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
}

function applyX(m: Xform, p: PlotPoint): PlotPoint {
  return pt(m.a * p.x + m.b * p.y + m.e, m.c * p.x + m.d * p.y + m.f)
}

function then(local: Xform, parent: Xform): Xform {
  return {
    a: parent.a * local.a + parent.b * local.c,
    b: parent.a * local.b + parent.b * local.d,
    e: parent.a * local.e + parent.b * local.f + parent.e,
    c: parent.c * local.a + parent.d * local.c,
    d: parent.c * local.b + parent.d * local.d,
    f: parent.c * local.e + parent.d * local.f + parent.f,
  }
}

function translate(x: number, y: number): Xform {
  const m = identity()
  m.e = x
  m.f = y
  return m
}

function parseTransform(raw: string | undefined): Xform {
  if (raw == null || raw.trim() === '') return identity()
  let m = identity()
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(raw)) != null) {
    const kind = match[1].toLowerCase()
    const args = match[2].split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n))
    let step = identity()
    if (kind === 'matrix' && args.length >= 6) {
      step = { a: args[0], b: args[2], c: args[1], d: args[3], e: args[4], f: args[5] }
    } else if (kind === 'translate') {
      step = translate(args[0] || 0, args.length > 1 ? args[1] : 0)
    } else if (kind === 'scale') {
      const sx = args[0] || 1
      const sy = args.length > 1 ? args[1] : sx
      step = { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }
    } else if (kind === 'rotate') {
      const deg = args[0] || 0
      const cx = args.length > 1 ? args[1] : 0
      const cy = args.length > 2 ? args[2] : 0
      const r = deg * Math.PI / 180
      const co = Math.cos(r)
      const si = Math.sin(r)
      const rot: Xform = { a: co, b: -si, c: si, d: co, e: 0, f: 0 }
      step = then(then(translate(-cx, -cy), rot), translate(cx, cy))
    } else if (kind === 'skewx') {
      step = { a: 1, b: Math.tan((args[0] || 0) * Math.PI / 180), c: 0, d: 1, e: 0, f: 0 }
    } else if (kind === 'skewy') {
      step = { a: 1, b: 0, c: Math.tan((args[0] || 0) * Math.PI / 180), d: 1, e: 0, f: 0 }
    }
    m = then(step, m)
  }
  return m
}
