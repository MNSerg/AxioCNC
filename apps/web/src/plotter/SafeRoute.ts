// Translated from LaserGRBL Plotter/SafeRoute.cs (GNU GPLv3), commit d893552.
// Routes a knife that cannot lift. A straight move is kept when it stays
// out of every closed contour. Otherwise the knife walks around the
// bounding box. If the target sits in a hole, the straight line is kept.

import { dist, segmentThroughInterior } from './PlotGeom'
import { pt, type PlotPath, type PlotPoint } from './types'

export function hits(a: PlotPoint, b: PlotPoint, obstacles: PlotPath[] | null): boolean {
  if (obstacles == null) return false
  for (let i = 0; i < obstacles.length; i++) {
    const path = obstacles[i]
    if (path == null || !path.closed || path.points == null || path.points.length < 3) continue
    if (!nearBox(a, b, path.points)) continue
    if (segmentThroughInterior(a, b, path.points)) return true
  }
  return false
}

export function route(from: PlotPoint, to: PlotPoint, obstacles: PlotPath[] | null, margin: number): PlotPoint[] {
  const direct: PlotPoint[] = [to]
  if (!hits(from, to, obstacles)) return direct
  let gap = margin
  if (gap < 0.1) gap = 0.1

  const nodes: PlotPoint[] = []
  nodes.push(from)
  nodes.push(to)
  addGates(nodes, obstacles, gap)

  const n = nodes.length
  const best = new Array<number>(n)
  const prev = new Array<number>(n)
  const used = new Array<boolean>(n)
  for (let i = 0; i < n; i++) {
    best[i] = Number.MAX_VALUE
    prev[i] = -1
    used[i] = false
  }
  best[0] = 0

  for (let iter = 0; iter < n; iter++) {
    let u = -1
    let bd = Number.MAX_VALUE
    for (let i = 0; i < n; i++) {
      if (!used[i] && best[i] < bd) {
        bd = best[i]
        u = i
      }
    }
    if (u < 0 || u === 1) break
    used[u] = true
    for (let v = 0; v < n; v++) {
      if (used[v] || v === u) continue
      if (hits(nodes[u], nodes[v], obstacles)) continue
      const nd = best[u] + dist(nodes[u], nodes[v])
      if (nd < best[v]) {
        best[v] = nd
        prev[v] = u
      }
    }
  }

  if (best[1] >= Number.MAX_VALUE / 2 || prev[1] < 0) return direct

  const reversed: PlotPoint[] = []
  let cur = 1
  let guard = 0
  while (cur > 0 && guard < n + 2) {
    reversed.push(nodes[cur])
    cur = prev[cur]
    guard++
  }
  reversed.reverse()
  return reversed
}

function addGates(nodes: PlotPoint[], obstacles: PlotPath[] | null, margin: number): void {
  if (obstacles == null) return

  let minX = Number.MAX_VALUE
  let minY = Number.MAX_VALUE
  let maxX = -Number.MAX_VALUE
  let maxY = -Number.MAX_VALUE
  let any = false
  let closed = 0
  for (let i = 0; i < obstacles.length; i++) {
    const path = obstacles[i]
    if (path == null || !path.closed || path.points == null || path.points.length < 3) continue
    closed++
  }

  const perShape = closed > 0 && closed <= 24
  for (let i = 0; i < obstacles.length; i++) {
    const path = obstacles[i]
    if (path == null || !path.closed || path.points == null || path.points.length < 3) continue
    const box = bounds(path.points)
    if (box.x0 < minX) minX = box.x0
    if (box.y0 < minY) minY = box.y0
    if (box.x1 > maxX) maxX = box.x1
    if (box.y1 > maxY) maxY = box.y1
    any = true
    if (perShape) addBox(nodes, box.x0 - margin, box.y0 - margin, box.x1 + margin, box.y1 + margin)
  }
  if (any) addBox(nodes, minX - margin, minY - margin, maxX + margin, maxY + margin)
}

function addBox(nodes: PlotPoint[], x0: number, y0: number, x1: number, y1: number): void {
  addNode(nodes, pt(x0, y0))
  addNode(nodes, pt(x1, y0))
  addNode(nodes, pt(x1, y1))
  addNode(nodes, pt(x0, y1))
  addNode(nodes, pt((x0 + x1) * 0.5, y0))
  addNode(nodes, pt(x1, (y0 + y1) * 0.5))
  addNode(nodes, pt((x0 + x1) * 0.5, y1))
  addNode(nodes, pt(x0, (y0 + y1) * 0.5))
}

function addNode(nodes: PlotPoint[], p: PlotPoint): void {
  for (let i = 0; i < nodes.length; i++) {
    if (dist(nodes[i], p) < 0.05) return
  }
  if (nodes.length >= 160) return
  nodes.push(p)
}

function bounds(pts: PlotPoint[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = pts[0].x
  let y0 = pts[0].y
  let x1 = pts[0].x
  let y1 = pts[0].y
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x < x0) x0 = pts[i].x
    if (pts[i].y < y0) y0 = pts[i].y
    if (pts[i].x > x1) x1 = pts[i].x
    if (pts[i].y > y1) y1 = pts[i].y
  }
  return { x0: x0, y0: y0, x1: x1, y1: y1 }
}

function nearBox(a: PlotPoint, b: PlotPoint, poly: PlotPoint[]): boolean {
  const box = bounds(poly)
  const sx0 = Math.min(a.x, b.x)
  const sy0 = Math.min(a.y, b.y)
  const sx1 = Math.max(a.x, b.x)
  const sy1 = Math.max(a.y, b.y)
  if (sx1 < box.x0 || sx0 > box.x1 || sy1 < box.y0 || sy0 > box.y1) return false
  return true
}
