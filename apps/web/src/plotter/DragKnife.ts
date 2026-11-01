// Translated from LaserGRBL Plotter/DragKnife.cs (GNU GPLv3), commit d893552.
// Drag-knife compensation. The machine XY is the swivel axis.
// The blade tip trails that axis by bladeOffsetMm.
// On a corner the holder swings around the tip on an arc of that radius.

import { deltaAngle, dist, heading, normalize, sub } from './PlotGeom'
import { PenMode } from './types'
import type { PlotMove, PlotPath, PlotPoint } from './types'
import type { PlotterConfig } from './PlotterConfig'
import { pt, moveTo } from './types'
import { route } from './SafeRoute'

export function build(paths: PlotPath[] | null, cfg: PlotterConfig): PlotMove[] {
  return buildPark(paths, cfg, pt(0, 0), false)
}

export function buildPark(paths: PlotPath[] | null, cfg: PlotterConfig | null, park: PlotPoint, parkFirst: boolean): PlotMove[] {
  const moves: PlotMove[] = []
  if (paths == null || cfg == null) return moves

  const passes = cfg.passes
  const cursor = { p: pt(0, 0) }
  if (parkFirst) approach(moves, cfg, paths, cursor, park)
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]
    if (path == null || path.points == null || path.points.length < 2) continue
    for (let pass = 0; pass < passes; pass++) emit(path, cfg, moves, paths, cursor)
  }
  return moves
}

function approach(moves: PlotMove[], cfg: PlotterConfig, obstacles: PlotPath[], cursor: { p: PlotPoint }, park: PlotPoint): void {
  if (dist(cursor.p, park) <= 0.0001) {
    cursor.p = park
    return
  }
  if (cfg.penMode === PenMode.Manual) {
    let margin = cfg.leadInMm
    if (cfg.bladeOffsetMm > margin) margin = cfg.bladeOffsetMm
    if (cfg.startMarginMm > margin) margin = cfg.startMarginMm
    if (margin < 1) margin = 1
    const way = route(cursor.p, park, obstacles, margin)
    for (let r = 0; r < way.length; r++) {
      if (dist(cursor.p, way[r]) <= 0.0001) continue
      travel(moves, way[r])
      cursor.p = way[r]
    }
  } else {
    travel(moves, park)
  }
  cursor.p = park
}

function emit(path: PlotPath, cfg: PlotterConfig, moves: PlotMove[], obstacles: PlotPath[], cursor: { p: PlotPoint }): void {
  const pts = compact(path.points)
  if (pts.length < 2) return

  const closed = path.closed && pts.length >= 3
  const segCount = closed ? pts.length : pts.length - 1
  const dir: PlotPoint[] = new Array(segCount)
  for (let s = 0; s < segCount; s++) {
    const a = pts[s]
    const b = pts[(s + 1) % pts.length]
    dir[s] = normalize(sub(b, a))
    if (dir[s].x === 0 && dir[s].y === 0) return
  }

  const offset = cfg.bladeOffsetMm
  const lead = cfg.leadInMm
  const over = cfg.overcutMm
  const u0 = dir[0]
  const holderStart = shift(pts[0], u0, offset - lead)

  if (cfg.penMode === PenMode.Manual) {
    let margin = lead
    if (offset > margin) margin = offset
    if (margin < 1) margin = 1
    const way = route(cursor.p, holderStart, obstacles, margin)
    let at = cursor.p
    for (let r = 0; r < way.length; r++) {
      if (dist(at, way[r]) <= 0.0001) continue
      travel(moves, way[r])
      at = way[r]
    }
  } else {
    travel(moves, holderStart)
  }
  if (lead > 0.0001) line(moves, shift(pts[0], u0, offset))
  line(moves, shift(next(pts, 0, closed), u0, offset))

  for (let s = 1; s < segCount; s++) {
    const corner = pts[s]
    cornerMove(moves, cfg, corner, dir[s - 1], dir[s], offset, lead)
    line(moves, shift(next(pts, s, closed), dir[s], offset))
  }

  if (closed) {
    cornerMove(moves, cfg, pts[0], dir[segCount - 1], dir[0], offset, lead)
    if (over > 0.0001) line(moves, shift(pts[0], dir[0], offset + over))
  } else if (over > 0.0001) {
    line(moves, shift(pts[pts.length - 1], dir[segCount - 1], offset + over))
  }

  if (moves.length > 0) {
    const last = moves[moves.length - 1]
    cursor.p = pt(last.x, last.y)
  }
}

function next(pts: PlotPoint[], index: number, closed: boolean): PlotPoint {
  if (closed) return pts[(index + 1) % pts.length]
  return pts[index + 1]
}

function cornerMove(moves: PlotMove[], cfg: PlotterConfig, corner: PlotPoint, uIn: PlotPoint, uOut: PlotPoint, offset: number, lead: number): void {
  const delta = deltaAngle(heading(uIn), heading(uOut))
  const deg = Math.abs((delta * 180.0) / Math.PI)
  const from = shift(corner, uIn, offset)
  const to = shift(corner, uOut, offset)

  const liftAngle = cfg.penMode === PenMode.Manual ? 0 : cfg.liftAngleDeg
  if (liftAngle > 0 && deg >= liftAngle) {
    const align = lead > 0 ? lead : offset
    travel(moves, shift(corner, uOut, offset - align))
    if (align > 0.0001) line(moves, to)
    return
  }

  if (offset <= 0.0001 || deg < cfg.cornerThresholdDeg) {
    if (dist(from, to) > 0.0001) line(moves, to)
    return
  }

  if (dist(from, to) <= 0.0001) return

  const arc: PlotMove = {
    cut: true,
    arc: true,
    clockwise: delta < 0,
    x: to.x,
    y: to.y,
    i: corner.x - from.x,
    j: corner.y - from.y,
  }
  moves.push(arc)
}

function shift(point: PlotPoint, unit: PlotPoint, distance: number): PlotPoint {
  return pt(point.x + unit.x * distance, point.y + unit.y * distance)
}

function travel(moves: PlotMove[], p: PlotPoint): void {
  moves.push(moveTo(p.x, p.y, false))
}

function line(moves: PlotMove[], p: PlotPoint): void {
  if (moves.length > 0) {
    const prev = moves[moves.length - 1]
    if (Math.abs(prev.x - p.x) < 0.0001 && Math.abs(prev.y - p.y) < 0.0001) return
  }
  moves.push(moveTo(p.x, p.y, true))
}

function compact(source: PlotPoint[]): PlotPoint[] {
  const pts: PlotPoint[] = []
  for (let i = 0; i < source.length; i++) {
    if (pts.length === 0 || dist(pts[pts.length - 1], source[i]) > 0.0001) pts.push(source[i])
  }
  return pts
}
