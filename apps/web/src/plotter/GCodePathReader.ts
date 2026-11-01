// Translated from LaserGRBL Plotter/GCodePathReader.cs (GNU GPLv3), commit d893552.
// A cutting move is G1/G2/G3 while the spindle is on and S is positive,
// or while M3/M4 is active and no S word has been seen yet.

import { dist, sampleArc } from './PlotGeom'
import { pt, type PlotPath, type PlotPoint } from './types'

const CloseTol = 0.2

export function read(lines: Iterable<string> | null): PlotPath[] {
  const paths: PlotPath[] = []
  if (lines == null) return paths

  let x = 0
  let y = 0
  let absolute = true
  let motion = 0
  let spindle = 5
  let sValue = 0
  let seenS = false
  let inCut = false
  let pts: PlotPoint[] | null = null

  for (const raw of lines) {
    const words = parse(raw)
    if (wordCount(words) === 0) continue

    if (words.G != null) {
      const g = Math.round(words.G)
      if (g === 90) absolute = true
      else if (g === 91) absolute = false
      else if (g === 0 || g === 1 || g === 2 || g === 3) motion = g
    }
    if (words.M != null) {
      const m = Math.round(words.M)
      if (m === 3 || m === 4 || m === 5) spindle = m
    }
    if (words.S != null) {
      sValue = words.S
      seenS = true
    }

    const hasMove = words.X != null || words.Y != null || words.I != null || words.J != null
    if (!hasMove) {
      if (!isCutting(spindle, sValue, seenS)) {
        const finished = finish(paths, pts, inCut)
        pts = finished.pts
        inCut = finished.inCut
      }
      continue
    }

    let nx = x
    let ny = y
    if (words.X != null) nx = absolute ? words.X : x + words.X
    if (words.Y != null) ny = absolute ? words.Y : y + words.Y

    const cutting = (motion === 1 || motion === 2 || motion === 3) && isCutting(spindle, sValue, seenS)
    if (!cutting) {
      const finished = finish(paths, pts, inCut)
      pts = finished.pts
      inCut = finished.inCut
      x = nx
      y = ny
      continue
    }

    if (!inCut) {
      inCut = true
      pts = []
      pts.push(pt(x, y))
    }

    if (motion === 2 || motion === 3) {
      const i = words.I != null ? words.I : 0
      const j = words.J != null ? words.J : 0
      sampleArc(pts as PlotPoint[], pt(x, y), pt(nx, ny), i, j, motion === 2, 5)
    } else if (dist(pt(x, y), pt(nx, ny)) > 0.0001) {
      ;(pts as PlotPoint[]).push(pt(nx, ny))
    }

    x = nx
    y = ny
  }

  finish(paths, pts, inCut)
  return paths
}

function isCutting(spindle: number, sValue: number, seenS: boolean): boolean {
  const on = spindle === 3 || spindle === 4
  if (!on) return false
  if (!seenS) return true
  return sValue > 0
}

function finish(paths: PlotPath[], pts: PlotPoint[] | null, inCut: boolean): { pts: PlotPoint[] | null; inCut: boolean } {
  inCut = false
  if (pts == null || pts.length < 2) return { pts: null, inCut: inCut }

  const path: PlotPath = { points: pts, closed: false }
  if (pts.length >= 3 && dist(pts[0], pts[pts.length - 1]) <= CloseTol) {
    pts.pop()
    path.closed = pts.length >= 3
  }
  if (path.points.length >= 2) paths.push(path)
  return { pts: null, inCut: inCut }
}

interface Words {
  G?: number
  M?: number
  S?: number
  X?: number
  Y?: number
  I?: number
  J?: number
  [key: string]: number | undefined
}

function wordCount(words: Words): number {
  let n = 0
  for (const key in words) {
    if (Object.prototype.hasOwnProperty.call(words, key) && words[key] != null) n++
  }
  return n
}

function parse(raw: string): Words {
  const words: Words = {}
  if (raw == null || raw === '') return words

  const line = stripComments(raw)
  let i = 0
  while (i < line.length) {
    const c = line.charAt(i)
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
      const key = c.toUpperCase()
      i++
      const start = i
      if (i < line.length && (line.charAt(i) === '+' || line.charAt(i) === '-')) i++
      let any = false
      while (i < line.length && (isDigit(line.charAt(i)) || line.charAt(i) === '.')) {
        any = true
        i++
      }
      if (!any) continue
      const value = Number.parseFloat(line.substring(start, i))
      if (!Number.isNaN(value)) words[key] = value
    } else {
      i++
    }
  }
  return words
}

function stripComments(raw: string): string {
  let sb = ''
  let comment = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charAt(i)
    if (c === ';') break
    if (c === '(') {
      comment = true
      continue
    }
    if (c === ')') {
      comment = false
      continue
    }
    if (!comment) sb += c
  }
  return sb
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9'
}
