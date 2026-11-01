// Translated from LaserGRBL Plotter/PotracePaths.cs (GNU GPLv3), commit d893552.

import { appendCubic } from './PlotGeom'
import { CurveKind, pt, type Curve, type PlotPath } from './types'

export function toPaths(figures: Curve[][] | null, offsetX: number, offsetY: number, pixelsPerMm: number): PlotPath[] {
  const result: PlotPath[] = []
  if (figures == null) return result

  const scale = pixelsPerMm <= 0 ? 1 : pixelsPerMm
  for (let f = 0; f < figures.length; f++) {
    const fig = figures[f]
    if (fig == null || fig.length === 0) continue

    const path: PlotPath = { points: [], closed: false }
    for (let i = 0; i < fig.length; i++) {
      const curve = fig[i]
      if (curve.a == null || curve.b == null) continue
      const a = toMm(curve.a.x, curve.a.y, offsetX, offsetY, scale)
      const b = toMm(curve.b.x, curve.b.y, offsetX, offsetY, scale)
      if (path.points.length === 0) path.points.push(a)

      const controlA = curve.controlA
      const controlB = curve.controlB
      const bezier = curve.kind === CurveKind.Bezier && controlA != null && controlB != null
      if (!bezier) path.points.push(b)
      else {
        const c1 = toMm(controlA.x, controlA.y, offsetX, offsetY, scale)
        const c2 = toMm(controlB.x, controlB.y, offsetX, offsetY, scale)
        appendCubic(path.points, a, c1, c2, b, 0.05)
      }
    }
    if (path.points.length >= 2) result.push(path)
  }
  return result
}

function toMm(x: number, y: number, offsetX: number, offsetY: number, scale: number) {
  return pt(x / scale + offsetX, y / scale + offsetY)
}
