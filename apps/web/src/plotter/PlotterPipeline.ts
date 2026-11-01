// Translated from LaserGRBL Plotter/PlotterPipeline.cs (GNU GPLv3), commit d893552.

import { buildPark } from './DragKnife'
import { read } from './GCodePathReader'
import { prepareFrom } from './PathOptimizer'
import { write } from './PlotterGCodeWriter'
import { cloneConfig, createDefault, normalize, type PlotterConfig } from './PlotterConfig'
import { pt, type PlotPath, type PlotPoint } from './types'

export function convert(gcode: string | null, cfg: PlotterConfig): string {
  if (gcode == null) gcode = ''
  const lines = gcode.split(/\r\n|\r|\n/).filter(function (line) {
    return line.length > 0
  })
  return convertLines(lines, cfg)
}

export function convertLines(gcodeLines: string[] | null, cfg: PlotterConfig): string {
  return convertPaths(read(gcodeLines), cfg)
}

export function convertPaths(paths: PlotPath[] | null, cfg: PlotterConfig | null): string {
  if (cfg == null) cfg = createDefault()
  normalize(cfg)
  const copy = clonePaths(paths)
  const placed = placeOnSheet(copy, cfg)
  const orderFrom = placed.parkFirst ? placed.park : pt(0, 0)
  const prepared = prepareFrom(copy, cfg, orderFrom)
  let parkFirst = placed.parkFirst
  if (prepared.length === 0) parkFirst = false
  const moves = buildPark(prepared, cfg, placed.park, parkFirst)
  return write(moves, cfg, prepared.length)
}

/**
 * Puts the drawing's bottom-left corner on the point the positioning laser
 * marked, then returns the blade park startMarginMm outside that corner,
 * toward the operator and to the left.
 */
function placeOnSheet(paths: PlotPath[], cfg: PlotterConfig): { park: PlotPoint; parkFirst: boolean } {
  let park = pt(0, 0)
  if (cfg.startMarginMm <= 0 && Math.abs(cfg.laserOffsetX) < 1e-9 && Math.abs(cfg.laserOffsetY) < 1e-9) {
    return { park: park, parkFirst: false }
  }

  let any = false
  let minX = 0
  let minY = 0
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]
    if (path == null || path.points == null) continue
    for (let p = 0; p < path.points.length; p++) {
      const point = path.points[p]
      if (!any || point.x < minX) minX = point.x
      if (!any || point.y < minY) minY = point.y
      any = true
    }
  }
  if (!any) return { park: park, parkFirst: false }

  const shiftX = cfg.laserOffsetX - minX
  const shiftY = cfg.laserOffsetY - minY
  if (Math.abs(shiftX) > 1e-9 || Math.abs(shiftY) > 1e-9) {
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]
      if (path == null || path.points == null) continue
      for (let p = 0; p < path.points.length; p++) {
        const point = path.points[p]
        path.points[p] = pt(point.x + shiftX, point.y + shiftY)
      }
    }
  }

  park = pt(cfg.laserOffsetX - cfg.startMarginMm, cfg.laserOffsetY - cfg.startMarginMm)
  return { park: park, parkFirst: true }
}

function clonePaths(paths: PlotPath[] | null): PlotPath[] {
  const copy: PlotPath[] = []
  if (paths == null) return copy
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]
    if (path == null || path.points == null) continue
    const points: PlotPoint[] = []
    for (let p = 0; p < path.points.length; p++) points.push(pt(path.points[p].x, path.points[p].y))
    copy.push({ points: points, closed: path.closed })
  }
  return copy
}

export function withBorderSpeed(cfg: PlotterConfig, borderSpeed: number): PlotterConfig {
  const copy = cloneConfig(cfg)
  if (borderSpeed > 0) copy.cutSpeed = borderSpeed
  return copy
}
