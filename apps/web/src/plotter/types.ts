// Translated from LaserGRBL Plotter (GNU GPLv3), commit d893552.

export interface PlotPoint {
  x: number
  y: number
}

export function pt(x: number, y: number): PlotPoint {
  return { x: x, y: y }
}

export interface PlotPath {
  points: PlotPoint[]
  closed: boolean
}

export function pathOf(points: PlotPoint[], closed: boolean): PlotPath {
  return { points: points, closed: closed }
}

/** One motion of the knife holder. cut=false is a pen-up travel. Arc I/J are offsets from the start of the arc to its center. */
export interface PlotMove {
  x: number
  y: number
  cut: boolean
  arc: boolean
  clockwise: boolean
  i: number
  j: number
}

export function moveTo(x: number, y: number, cut: boolean): PlotMove {
  return { x: x, y: y, cut: cut, arc: false, clockwise: false, i: 0, j: 0 }
}

export const PenMode = {
  ServoPwm: 'ServoPwm',
  Digital: 'Digital',
  ZAxis: 'ZAxis',
  Manual: 'Manual',
} as const

export type PenMode = (typeof PenMode)[keyof typeof PenMode]

export const BladePreset = {
  Custom: 'Custom',
  Pen: 'Pen',
  VinylFine: 'VinylFine',
  Craft: 'Craft',
  Deep: 'Deep',
  Rubber: 'Rubber',
} as const

export type BladePreset = (typeof BladePreset)[keyof typeof BladePreset]

/** Potrace curve in pixel space. Y is already flipped by the caller. */
export const CurveKind = {
  Line: 'Line',
  Bezier: 'Bezier',
} as const

export type CurveKind = (typeof CurveKind)[keyof typeof CurveKind]

export interface CurvePoint {
  x: number
  y: number
}

export interface Curve {
  kind: CurveKind
  a: CurvePoint | null
  b: CurvePoint | null
  controlA: CurvePoint | null
  controlB: CurvePoint | null
}
