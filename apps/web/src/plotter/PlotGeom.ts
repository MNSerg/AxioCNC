// Translated from LaserGRBL Plotter/PlotGeom.cs (GNU GPLv3), commit d893552.

import { pt, type PlotPoint } from './types'

export const Eps = 1e-9

export function num(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Math.abs(value) < 0.0005) return '0'
  const negative = value < 0
  const rounded = Math.round(Math.abs(value) * 1000) / 1000
  let text = rounded.toFixed(3)
  text = text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  if (text === '' || text === '0') return '0'
  return negative ? '-' + text : text
}

export function dist(a: PlotPoint, b: PlotPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function sub(a: PlotPoint, b: PlotPoint): PlotPoint {
  return pt(a.x - b.x, a.y - b.y)
}

export function add(a: PlotPoint, b: PlotPoint): PlotPoint {
  return pt(a.x + b.x, a.y + b.y)
}

export function mul(a: PlotPoint, s: number): PlotPoint {
  return pt(a.x * s, a.y * s)
}

export function normalize(v: PlotPoint): PlotPoint {
  const len = Math.sqrt(v.x * v.x + v.y * v.y)
  if (len < Eps) return pt(0, 0)
  return pt(v.x / len, v.y / len)
}

export function heading(unit: PlotPoint): number {
  return Math.atan2(unit.y, unit.x)
}

/** Signed shortest turn from angle a to angle b, radians in (-pi, pi]. */
export function deltaAngle(a: number, b: number): number {
  let d = b - a
  while (d <= -Math.PI) d += 2 * Math.PI
  while (d > Math.PI) d -= 2 * Math.PI
  return d
}

export function distPointSegment(p: PlotPoint, a: PlotPoint, b: PlotPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < Eps) return dist(p, a)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  return dist(p, pt(a.x + t * dx, a.y + t * dy))
}

export function pointInPoly(p: PlotPoint, poly: PlotPoint[] | null): boolean {
  if (poly == null || poly.length < 3) return false
  let inside = false
  let j = poly.length - 1
  for (let i = 0; i < poly.length; i++) {
    const yi = poly[i].y
    const yj = poly[j].y
    const xi = poly[i].x
    const xj = poly[j].x
    const crosses = (yi > p.y) !== (yj > p.y)
    if (crosses) {
      const xint = ((xj - xi) * (p.y - yi)) / (yj - yi) + xi
      if (p.x < xint) inside = !inside
    }
    j = i
  }
  return inside
}

export function simplify(pts: PlotPoint[], tolerance: number): PlotPoint[] {
  const copy = pts.slice()
  if (copy.length < 3 || tolerance <= 0) return copy

  const keep = new Array<boolean>(copy.length)
  for (let i = 0; i < keep.length; i++) keep[i] = false
  keep[0] = true
  keep[copy.length - 1] = true
  const stack: number[] = []
  stack.push(0)
  stack.push(copy.length - 1)
  while (stack.length > 0) {
    const last = stack.pop() as number
    const first = stack.pop() as number
    let max = 0
    let idx = first
    for (let i = first + 1; i < last; i++) {
      const d = distPointSegment(copy[i], copy[first], copy[last])
      if (d > max) {
        max = d
        idx = i
      }
    }
    if (max > tolerance && idx !== first && idx !== last) {
      keep[idx] = true
      stack.push(first)
      stack.push(idx)
      stack.push(idx)
      stack.push(last)
    }
  }

  const result: PlotPoint[] = []
  for (let i = 0; i < copy.length; i++) {
    if (keep[i]) result.push(copy[i])
  }
  return result
}

export function appendCubic(pts: PlotPoint[], p0: PlotPoint, c1: PlotPoint, c2: PlotPoint, p1: PlotPoint, tolerance: number): void {
  if (pts.length === 0) pts.push(p0)
  flattenCubic(pts, p0, c1, c2, p1, tolerance, 0)
}

function flattenCubic(pts: PlotPoint[], p0: PlotPoint, c1: PlotPoint, c2: PlotPoint, p1: PlotPoint, tolerance: number, depth: number): void {
  const flat = depth >= 12 || (distPointSegment(c1, p0, p1) <= tolerance && distPointSegment(c2, p0, p1) <= tolerance)
  if (flat) {
    pts.push(p1)
    return
  }

  const p01 = mid(p0, c1)
  const p12 = mid(c1, c2)
  const p23 = mid(c2, p1)
  const p012 = mid(p01, p12)
  const p123 = mid(p12, p23)
  const p0123 = mid(p012, p123)
  flattenCubic(pts, p0, p01, p012, p0123, tolerance, depth + 1)
  flattenCubic(pts, p0123, p123, p23, p1, tolerance, depth + 1)
}

function mid(a: PlotPoint, b: PlotPoint): PlotPoint {
  return pt((a.x + b.x) * 0.5, (a.y + b.y) * 0.5)
}

/** Closest point on the segment AB. t is 0 at A and 1 at B. */
export function closestOnSegment(p: PlotPoint, a: PlotPoint, b: PlotPoint): { point: PlotPoint; t: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < Eps) return { point: a, t: 0 }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  return { point: pt(a.x + dx * t, a.y + dy * t), t: t }
}

/**
 * True when the open segment passes through the polygon interior.
 * Ending on the boundary, or travelling along an edge, does not count.
 */
export function segmentThroughInterior(a: PlotPoint, b: PlotPoint, poly: PlotPoint[] | null): boolean {
  if (poly == null || poly.length < 3) return false
  if (dist(a, b) < 1e-6) return false

  const n = poly.length
  for (let i = 0; i < n; i++) {
    if (properEdgeCross(a, b, poly[i], poly[(i + 1) % n])) return true
  }

  const midPoint = pt((a.x + b.x) * 0.5, (a.y + b.y) * 0.5)
  return pointInPoly(midPoint, poly)
}

function properEdgeCross(a: PlotPoint, b: PlotPoint, c: PlotPoint, d: PlotPoint): boolean {
  const rx = b.x - a.x
  const ry = b.y - a.y
  const sx = d.x - c.x
  const sy = d.y - c.y
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-12) return false
  const qpx = c.x - a.x
  const qpy = c.y - a.y
  const t = (qpx * sy - qpy * sx) / den
  const u = (qpx * ry - qpy * rx) / den
  const eps = 1e-6
  return t > eps && t < 1.0 - eps && u > eps && u < 1.0 - eps
}

export function sampleArc(pts: PlotPoint[], start: PlotPoint, end: PlotPoint, i: number, j: number, clockwise: boolean, stepDeg: number): void {
  const cx = start.x + i
  const cy = start.y + j
  const radius = Math.sqrt(i * i + j * j)
  if (radius < Eps) {
    pts.push(end)
    return
  }

  const a0 = Math.atan2(start.y - cy, start.x - cx)
  const a1 = Math.atan2(end.y - cy, end.x - cx)
  let sweep = a1 - a0
  if (dist(start, end) < 0.0001) sweep = clockwise ? -2 * Math.PI : 2 * Math.PI
  else {
    if (clockwise && sweep > 0) sweep -= 2 * Math.PI
    if (!clockwise && sweep < 0) sweep += 2 * Math.PI
  }

  let step = stepDeg
  if (step < 1) step = 1
  step = step * Math.PI / 180.0
  let n = Math.ceil(Math.abs(sweep) / step)
  if (n < 1) n = 1
  if (n > 720) n = 720
  for (let k = 1; k <= n; k++) {
    const ang = a0 + (sweep * k) / n
    pts.push(pt(cx + radius * Math.cos(ang), cy + radius * Math.sin(ang)))
  }
}
