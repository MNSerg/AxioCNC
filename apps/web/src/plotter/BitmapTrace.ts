// Bitmap outlines and centerlines for plotter import.
// Vectorize returns closed contours and holes. Centerline returns open strokes.
// Y grows away from the operator. No hatch and no raster fill.

import { pt, type PlotPath, type PlotPoint } from './types'

export interface Raster {
  width: number
  height: number
  ink: Uint8Array
}

export function rasterFromRgba(width: number, height: number, rgba: Uint8ClampedArray, threshold: number): Raster {
  const ink = new Uint8Array(width * height)
  const limit = threshold > 0 ? threshold : 128
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    const alpha = rgba[o + 3]
    if (alpha < 128) continue
    const lum = 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2]
    if (lum < limit) ink[i] = 1
  }
  return { width, height, ink }
}

export function vectorize(raster: Raster, widthMm: number): PlotPath[] {
  const loops = boundaryLoops(raster.ink, raster.width, raster.height)
  return toMm(loops, raster.width, raster.height, widthMm, true)
}

export function centerline(raster: Raster, widthMm: number): PlotPath[] {
  const thin = zhangSuen(raster.ink, raster.width, raster.height)
  const strokes = skeletonStrokes(thin, raster.width, raster.height)
  return toMm(strokes.map((s) => s.points), raster.width, raster.height, widthMm, false).map((path, i) => {
    path.closed = strokes[i].closed
    return path
  })
}

function toMm(loops: PlotPoint[][], width: number, height: number, widthMm: number, closed: boolean): PlotPath[] {
  const span = widthMm > 0 ? widthMm : width
  const scale = width > 0 ? span / width : 1
  const paths: PlotPath[] = []
  for (let i = 0; i < loops.length; i++) {
    const src = loops[i]
    if (src.length < 2) continue
    const points: PlotPoint[] = []
    for (let p = 0; p < src.length; p++) points.push(pt(src[p].x * scale, (height - src[p].y) * scale))
    paths.push({ points, closed: closed && points.length >= 3 })
  }
  return paths
}

function boundaryLoops(ink: Uint8Array, w: number, h: number): PlotPoint[][] {
  const outgoing = new Map<string, PlotPoint[]>()
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const key = x0 + ',' + y0
    const list = outgoing.get(key)
    const next = pt(x1, y1)
    if (list == null) outgoing.set(key, [next])
    else list.push(next)
  }
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && ink[y * w + x] === 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue
      if (!on(x, y - 1)) add(x, y, x + 1, y)
      if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1)
      if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1)
      if (!on(x - 1, y)) add(x, y + 1, x, y)
    }
  }

  const used = new Set<string>()
  const loops: PlotPoint[][] = []
  outgoing.forEach((list, key) => {
    for (let n = 0; n < list.length; n++) {
      const start = key.split(',')
      const x0 = Number(start[0])
      const y0 = Number(start[1])
      const edgeKey = key + '>' + list[n].x + ',' + list[n].y
      if (used.has(edgeKey)) continue
      const points: PlotPoint[] = []
      let x = x0
      let y = y0
      let guard = 0
      const limit = (w + 1) * (h + 1) * 4
      while (guard < limit) {
        const from = x + ',' + y
        const options = outgoing.get(from)
        if (options == null) break
        let next: PlotPoint | null = null
        for (let i = 0; i < options.length; i++) {
          const mark = from + '>' + options[i].x + ',' + options[i].y
          if (!used.has(mark)) {
            next = options[i]
            used.add(mark)
            break
          }
        }
        if (next == null) break
        points.push(pt(x, y))
        x = next.x
        y = next.y
        guard++
        if (x === x0 && y === y0) break
      }
      if (points.length >= 3) loops.push(points)
    }
  })
  return loops
}

function zhangSuen(source: Uint8Array, w: number, h: number): Uint8Array {
  const a = new Uint8Array(source)
  let changed = true
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : a[y * w + x] ? 1 : 0)
  while (changed) {
    changed = false
    for (let step = 0; step < 2; step++) {
      const del: number[] = []
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (a[y * w + x] === 0) continue
          const p2 = at(x, y - 1)
          const p3 = at(x + 1, y - 1)
          const p4 = at(x + 1, y)
          const p5 = at(x + 1, y + 1)
          const p6 = at(x, y + 1)
          const p7 = at(x - 1, y + 1)
          const p8 = at(x - 1, y)
          const p9 = at(x - 1, y - 1)
          const bp = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (bp < 2 || bp > 6) continue
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
          let ap = 0
          for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) ap++
          if (ap !== 1) continue
          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue
            if (p4 * p6 * p8 !== 0) continue
          } else {
            if (p2 * p4 * p8 !== 0) continue
            if (p2 * p6 * p8 !== 0) continue
          }
          del.push(y * w + x)
        }
      }
      if (del.length > 0) {
        changed = true
        for (let i = 0; i < del.length; i++) a[del[i]] = 0
      }
    }
  }
  return a
}

interface Stroke {
  points: PlotPoint[]
  closed: boolean
}

function skeletonStrokes(ink: Uint8Array, w: number, h: number): Stroke[] {
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && ink[y * w + x] === 1
  const neighbors = (x: number, y: number): PlotPoint[] => {
    const found: PlotPoint[] = []
    for (let i = 0; i < 8; i++) {
      const nx = x + dirs[i][0]
      const ny = y + dirs[i][1]
      if (on(nx, ny)) found.push(pt(nx, ny))
    }
    return found
  }
  const seen = new Set<string>()
  const key = (x: number, y: number) => x + ',' + y
  const strokes: Stroke[] = []
  const starts: PlotPoint[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue
      const n = neighbors(x, y).length
      if (n !== 2) starts.push(pt(x, y))
    }
  }
  const walk = (x: number, y: number, closed: boolean) => {
    const points: PlotPoint[] = []
    let cx = x
    let cy = y
    let guard = 0
    while (guard < w * h) {
      const here = key(cx, cy)
      if (seen.has(here) && points.length > 0) break
      seen.add(here)
      points.push(pt(cx + 0.5, cy + 0.5))
      const next = neighbors(cx, cy).filter((p) => !seen.has(key(p.x, p.y)))
      if (next.length === 0) break
      cx = next[0].x
      cy = next[0].y
      guard++
    }
    if (points.length >= 2) strokes.push({ points, closed })
  }
  for (let i = 0; i < starts.length; i++) {
    if (seen.has(key(starts[i].x, starts[i].y))) continue
    walk(starts[i].x, starts[i].y, false)
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y) || seen.has(key(x, y))) continue
      walk(x, y, true)
    }
  }
  return strokes
}
