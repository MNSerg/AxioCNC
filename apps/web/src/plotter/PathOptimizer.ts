// Translated from LaserGRBL Plotter/PathOptimizer.cs (GNU GPLv3), commit d893552.

import { closestOnSegment, deltaAngle, dist, heading, normalize, pointInPoly, simplify, sub } from './PlotGeom'
import type { PlotterConfig } from './PlotterConfig'
import { PenMode } from './types'
import { pt, type PlotPath, type PlotPoint } from './types'
import { hits } from './SafeRoute'

const DuplicateTol = 0.0001

export function prepare(source: PlotPath[] | null, cfg: PlotterConfig): PlotPath[] {
  return prepareFrom(source, cfg, pt(0, 0))
}

export function prepareFrom(source: PlotPath[] | null, cfg: PlotterConfig, start: PlotPoint): PlotPath[] {
  const clean: PlotPath[] = []
  if (source == null) return clean

  for (let i = 0; i < source.length; i++) {
    const path = sanitize(source[i], cfg)
    if (path != null) clean.push(path)
  }

  if (cfg.penMode === PenMode.Manual) return orderKnifeDown(clean, cfg, start)

  if (clean.length <= 1 || (!cfg.optimizeOrder && !cfg.insideFirst)) return clean

  let depth = new Array<number>(clean.length)
  for (let i = 0; i < depth.length; i++) depth[i] = 0
  if (cfg.insideFirst) depth = computeDepth(clean)

  let maxDepth = 0
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] > maxDepth) maxDepth = depth[i]
  }

  const ordered: PlotPath[] = []
  const cursor = { p: start }
  const head = { value: 0, have: false }
  for (let d = maxDepth; d >= 0; d--) {
    const bucket: number[] = []
    for (let i = 0; i < clean.length; i++) {
      if (depth[i] === d) bucket.push(i)
    }
    if (cfg.optimizeOrder) takeNearest(clean, bucket, ordered, cursor, head)
    else {
      for (let i = 0; i < bucket.length; i++) {
        const path = clean[bucket[i]]
        ordered.push(path)
        cursor.p = path.points[path.points.length - 1]
      }
    }
  }
  return ordered
}

function orderKnifeDown(clean: PlotPath[], cfg: PlotterConfig, start: PlotPoint): PlotPath[] {
  const ordered: PlotPath[] = []
  if (clean.length === 0) return ordered

  let depth = new Array<number>(clean.length)
  for (let i = 0; i < depth.length; i++) depth[i] = 0
  if (cfg.insideFirst) depth = computeDepth(clean)

  const left: number[] = []
  for (let i = 0; i < clean.length; i++) left.push(i)

  const cursor = { p: start }
  let headingNow = 0
  let haveHeading = false
  const reorder = cfg.optimizeOrder && clean.length > 1

  while (left.length > 0) {
    let pick = 0
    if (reorder || cfg.insideFirst) {
      let bestScore = Number.MAX_VALUE
      for (let s = 0; s < left.length; s++) {
        if (!reorder && s > 0 && !cfg.insideFirst) break
        const trial = bestKnifeOrientation(clean[left[s]], cursor.p, headingNow, haveHeading, clean, cfg)
        let score = trial.cost
        if (cfg.insideFirst && trial.cost < 1e8) score -= depth[left[s]] * 100000.0
        if (!reorder && cfg.insideFirst) {
          score = (trial.cost < 1e8 ? -depth[left[s]] * 100000.0 : 1e9) + s
        }
        if (score < bestScore) {
          bestScore = score
          pick = s
        }
      }
    }

    const chosen = bestKnifeOrientation(clean[left[pick]], cursor.p, headingNow, haveHeading, clean, cfg)
    ordered.push(chosen.path)
    cursor.p = chosen.end
    headingNow = chosen.exitHeading
    haveHeading = true
    left.splice(pick, 1)
  }
  return ordered
}

interface Oriented {
  path: PlotPath
  cost: number
  end: PlotPoint
  exitHeading: number
}

function bestKnifeOrientation(path: PlotPath, cursor: PlotPoint, head: number, haveHeading: boolean, obstacles: PlotPath[], cfg: PlotterConfig): Oriented {
  const closed = path.closed && path.points.length >= 3
  const state: Oriented = {
    path: path,
    cost: Number.MAX_VALUE,
    end: path.points[path.points.length - 1],
    exitHeading: head,
  }

  for (let rev = 0; rev < 2; rev++) {
    const ring = rev === 0 ? path.points : reversed(path.points)
    if (!closed) {
      considerEntry(ring, 0, 0, false, cursor, head, haveHeading, obstacles, cfg, state)
      continue
    }
    const edge = closestEdge(ring, cursor)
    considerEntry(ring, edge.edge, edge.t, true, cursor, head, haveHeading, obstacles, cfg, state)
  }

  if (closed && state.cost >= 1e8) {
    for (let rev = 0; rev < 2; rev++) {
      const ring = rev === 0 ? path.points : reversed(path.points)
      const n = ring.length
      let step = n > 48 ? Math.floor(n / 48) : 1
      if (step < 1) step = 1
      for (let e = 0; e < n; e += step) considerEntry(ring, e, 0, true, cursor, head, haveHeading, obstacles, cfg, state)
    }
  }
  return state
}

function closestEdge(ring: PlotPoint[], cursor: PlotPoint): { edge: number; t: number } {
  let edge = 0
  let t = 0
  let best = Number.MAX_VALUE
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const hit = closestOnSegment(cursor, ring[i], ring[(i + 1) % n])
    const d = dist(cursor, hit.point)
    if (d < best) {
      best = d
      edge = i
      t = hit.t
    }
  }
  return { edge: edge, t: t }
}

function considerEntry(
  ring: PlotPoint[],
  edge: number,
  t: number,
  closed: boolean,
  cursor: PlotPoint,
  head: number,
  haveHeading: boolean,
  obstacles: PlotPath[],
  cfg: PlotterConfig,
  state: Oriented,
): void {
  const pts = closed ? startAt(ring, edge, t) : ring.slice()
  if (pts.length < 2) return
  const dir = normalize(sub(pts[1], pts[0]))
  if (dir.x === 0 && dir.y === 0) return

  const along = cfg.bladeOffsetMm - cfg.leadInMm
  const target = pt(pts[0].x + dir.x * along, pts[0].y + dir.y * along)
  const clear = !hits(cursor, target, obstacles)
  const travel = dist(cursor, target)
  let turn = 0
  if (haveHeading) turn = Math.abs(deltaAngle(head, heading(dir))) * 180.0 / Math.PI
  let c = travel + 0.03 * turn
  if (!clear) c += 1e9
  if (c >= state.cost) return

  state.cost = c
  const oriented: PlotPath = { points: pts, closed: closed && pts.length >= 3 }
  state.path = oriented
  const shift = cfg.bladeOffsetMm + cfg.overcutMm
  if (oriented.closed) {
    state.end = pt(pts[0].x + dir.x * shift, pts[0].y + dir.y * shift)
    state.exitHeading = heading(dir)
  } else {
    const exitDir = normalize(sub(pts[pts.length - 1], pts[pts.length - 2]))
    state.end = pt(pts[pts.length - 1].x + exitDir.x * shift, pts[pts.length - 1].y + exitDir.y * shift)
    state.exitHeading = heading(exitDir)
  }
}

function startAt(ring: PlotPoint[], edge: number, t: number): PlotPoint[] {
  const n = ring.length
  const pts: PlotPoint[] = []
  if (t <= 0.0001) {
    for (let i = 0; i < n; i++) pts.push(ring[(edge + i) % n])
    return pts
  }
  if (t >= 0.9999) {
    const start = (edge + 1) % n
    for (let i = 0; i < n; i++) pts.push(ring[(start + i) % n])
    return pts
  }

  const a = ring[edge]
  const b = ring[(edge + 1) % n]
  pts.push(pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t))
  const v = (edge + 1) % n
  for (let i = 0; i < n; i++) pts.push(ring[(v + i) % n])
  return pts
}

function takeNearest(clean: PlotPath[], bucket: number[], ordered: PlotPath[], cursor: { p: PlotPoint }, head: { value: number; have: boolean }): void {
  while (bucket.length > 0) {
    let bestSlot = 0
    let bestPath: PlotPath | null = null
    let bestCost = Number.MAX_VALUE
    let bestHeading = head.value
    let bestEnd = cursor.p

    for (let s = 0; s < bucket.length; s++) {
      const candidate = clean[bucket[s]]
      const oriented = bestOrientation(candidate, cursor.p, head.value, head.have)
      if (oriented.cost < bestCost) {
        bestCost = oriented.cost
        bestSlot = s
        bestPath = oriented.path
        bestEnd = oriented.end
        bestHeading = oriented.exitHeading
      }
    }

    if (bestPath != null) ordered.push(bestPath)
    cursor.p = bestEnd
    head.value = bestHeading
    head.have = true
    bucket.splice(bestSlot, 1)
  }
}

function bestOrientation(path: PlotPath, cursor: PlotPoint, head: number, haveHeading: boolean): Oriented {
  const closed = path.closed && path.points.length >= 3
  let steps = 1
  const rotations = closed ? path.points.length : 1
  if (rotations > 80) steps = Math.floor(rotations / 80)

  const state: Oriented = {
    path: path,
    cost: Number.MAX_VALUE,
    end: path.points[path.points.length - 1],
    exitHeading: head,
  }

  for (let rev = 0; rev < 2; rev++) {
    const basePts = rev === 0 ? path.points : reversed(path.points)
    const count = closed ? basePts.length : 1
    for (let start = 0; start < count; start += steps) {
      const pts = closed ? rotated(basePts, start) : basePts
      const dir = normalize(sub(pts[1], pts[0]))
      const entryHeading = heading(dir)
      const travel = dist(cursor, pts[0])
      let turn = 0
      if (haveHeading) turn = Math.abs(deltaAngle(head, entryHeading)) * 180.0 / Math.PI
      const c = travel + 0.03 * turn
      if (c < state.cost) {
        state.path = { points: pts, closed: path.closed }
        state.cost = c
        if (path.closed) {
          state.end = pts[0]
          state.exitHeading = entryHeading
        } else {
          state.end = pts[pts.length - 1]
          const exitDir = normalize(sub(pts[pts.length - 1], pts[pts.length - 2]))
          state.exitHeading = heading(exitDir)
        }
      }
    }
  }
  return state
}

function reversed(pts: PlotPoint[]): PlotPoint[] {
  const copy = pts.slice()
  copy.reverse()
  return copy
}

function rotated(pts: PlotPoint[], start: number): PlotPoint[] {
  const copy: PlotPoint[] = []
  for (let i = 0; i < pts.length; i++) copy.push(pts[(start + i) % pts.length])
  return copy
}

function computeDepth(paths: PlotPath[]): number[] {
  const depth = new Array<number>(paths.length)
  for (let i = 0; i < paths.length; i++) depth[i] = 0
  for (let i = 0; i < paths.length; i++) {
    if (paths[i].points.length < 2) continue
    for (let j = 0; j < paths.length; j++) {
      if (i === j || !paths[j].closed || paths[j].points.length < 3) continue
      if (isInside(paths[i], paths[j])) depth[i]++
    }
  }
  return depth
}

function isInside(inner: PlotPath, outer: PlotPath): boolean {
  if (inner.closed) return pointInPoly(inner.points[0], outer.points)

  const step = Math.max(1, Math.floor(inner.points.length / 8))
  for (let i = 0; i < inner.points.length; i += step) {
    if (pointInPoly(inner.points[i], outer.points)) return true
  }
  return false
}

function sanitize(source: PlotPath | null, cfg: PlotterConfig): PlotPath | null {
  if (source == null || source.points == null || source.points.length < 2) return null

  const pts: PlotPoint[] = []
  for (let i = 0; i < source.points.length; i++) {
    const p = source.points[i]
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (pts.length === 0 || dist(pts[pts.length - 1], p) > DuplicateTol) pts.push(p)
  }

  let closed = source.closed
  if (pts.length >= 3 && dist(pts[0], pts[pts.length - 1]) <= 0.2) {
    pts.pop()
    closed = true
  }
  if (!closed && source.closed) closed = pts.length >= 3

  let simplified = pts
  if (cfg.simplifyMm > 0 && simplified.length >= 3) simplified = simplify(simplified, cfg.simplifyMm)

  if (cfg.minSegmentMm > 0) simplified = dropShort(simplified, cfg.minSegmentMm, closed)

  if (simplified.length < 2) return null
  if (closed && simplified.length < 3) closed = false

  return { points: simplified, closed: closed }
}

function dropShort(pts: PlotPoint[], minLen: number, closed: boolean): PlotPoint[] {
  const kept: PlotPoint[] = []
  kept.push(pts[0])
  for (let i = 1; i < pts.length - 1; i++) {
    if (dist(kept[kept.length - 1], pts[i]) >= minLen) kept.push(pts[i])
  }
  const last = pts[pts.length - 1]
  if (dist(kept[kept.length - 1], last) >= minLen || kept.length === 1) kept.push(last)
  else kept[kept.length - 1] = last

  if (closed && kept.length >= 3 && dist(kept[0], kept[kept.length - 1]) < minLen) kept.pop()
  return kept
}
