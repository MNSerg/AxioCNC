// Translated from LaserGRBL Plotter/PlotterConfig.cs (GNU GPLv3), commit d893552.

import { BladePreset, PenMode } from './types'

export interface PlotterConfig {
  enabled: boolean
  preset: BladePreset
  bladeName: string
  bladeOffsetMm: number
  overcutMm: number
  leadInMm: number
  cornerThresholdDeg: number
  liftAngleDeg: number
  simplifyMm: number
  minSegmentMm: number
  cutSpeed: number
  travelSpeed: number
  plungeSpeed: number
  dwellDownMs: number
  dwellUpMs: number
  penMode: PenMode
  servoUp: number
  servoDown: number
  penUpZ: number
  penDownZ: number
  optimizeOrder: boolean
  insideFirst: boolean
  passes: number
  linearizeArcs: boolean
  arcStepDeg: number
  /** How far outside the drawing's bottom-left corner the blade waits before the first contour. */
  startMarginMm: number
  /** Positioning laser minus blade axis. Positive X means the laser is to the right of the blade. */
  laserOffsetX: number
  laserOffsetY: number
}

export function createDefault(): PlotterConfig {
  return {
    enabled: false,
    preset: BladePreset.Rubber,
    bladeName: 'Rubber 3.60',
    bladeOffsetMm: 3.6,
    overcutMm: 3.6,
    leadInMm: 3.6,
    cornerThresholdDeg: 8,
    liftAngleDeg: 0,
    simplifyMm: 0.05,
    minSegmentMm: 0.02,
    cutSpeed: 600,
    travelSpeed: 0,
    plungeSpeed: 300,
    dwellDownMs: 0,
    dwellUpMs: 0,
    penMode: PenMode.Manual,
    servoUp: 0,
    servoDown: 255,
    penUpZ: 5,
    penDownZ: 0,
    optimizeOrder: true,
    insideFirst: true,
    passes: 1,
    linearizeArcs: false,
    arcStepDeg: 10,
    startMarginMm: 20,
    laserOffsetX: 10,
    laserOffsetY: 0,
  }
}

export function cloneConfig(cfg: PlotterConfig): PlotterConfig {
  return {
    enabled: cfg.enabled,
    preset: cfg.preset,
    bladeName: cfg.bladeName,
    bladeOffsetMm: cfg.bladeOffsetMm,
    overcutMm: cfg.overcutMm,
    leadInMm: cfg.leadInMm,
    cornerThresholdDeg: cfg.cornerThresholdDeg,
    liftAngleDeg: cfg.liftAngleDeg,
    simplifyMm: cfg.simplifyMm,
    minSegmentMm: cfg.minSegmentMm,
    cutSpeed: cfg.cutSpeed,
    travelSpeed: cfg.travelSpeed,
    plungeSpeed: cfg.plungeSpeed,
    dwellDownMs: cfg.dwellDownMs,
    dwellUpMs: cfg.dwellUpMs,
    penMode: cfg.penMode,
    servoUp: cfg.servoUp,
    servoDown: cfg.servoDown,
    penUpZ: cfg.penUpZ,
    penDownZ: cfg.penDownZ,
    optimizeOrder: cfg.optimizeOrder,
    insideFirst: cfg.insideFirst,
    passes: cfg.passes,
    linearizeArcs: cfg.linearizeArcs,
    arcStepDeg: cfg.arcStepDeg,
    startMarginMm: cfg.startMarginMm,
    laserOffsetX: cfg.laserOffsetX,
    laserOffsetY: cfg.laserOffsetY,
  }
}

export function applyPreset(cfg: PlotterConfig, preset: BladePreset): void {
  cfg.preset = preset
  if (preset === BladePreset.Pen) {
    cfg.bladeName = 'Pen'
    cfg.bladeOffsetMm = 0
    cfg.overcutMm = 0
    cfg.leadInMm = 0
  } else if (preset === BladePreset.VinylFine) {
    cfg.bladeName = 'Vinyl 0.25'
    cfg.bladeOffsetMm = 0.25
    cfg.overcutMm = 0.5
    cfg.leadInMm = 0.25
  } else if (preset === BladePreset.Craft) {
    cfg.bladeName = 'Craft 0.50'
    cfg.bladeOffsetMm = 0.5
    cfg.overcutMm = 1.0
    cfg.leadInMm = 0.5
  } else if (preset === BladePreset.Deep) {
    cfg.bladeName = 'Deep 0.75'
    cfg.bladeOffsetMm = 0.75
    cfg.overcutMm = 1.2
    cfg.leadInMm = 0.75
  } else if (preset === BladePreset.Rubber) {
    cfg.bladeName = 'Rubber 3.60'
    cfg.bladeOffsetMm = 3.6
    cfg.overcutMm = 3.6
    cfg.leadInMm = 3.6
  }
}

export interface StoredPlotter extends Partial<PlotterConfig> {
  schema?: number
}

export function configFromStored(raw: StoredPlotter | null | undefined): { cfg: PlotterConfig; migrated: boolean } {
  const cfg = createDefault()
  if (raw == null) return { cfg: cfg, migrated: false }
  const keys: (keyof PlotterConfig)[] = [
    'enabled', 'preset', 'bladeName', 'bladeOffsetMm', 'overcutMm', 'leadInMm', 'cornerThresholdDeg',
    'liftAngleDeg', 'simplifyMm', 'minSegmentMm', 'cutSpeed', 'travelSpeed', 'plungeSpeed',
    'dwellDownMs', 'dwellUpMs', 'penMode', 'servoUp', 'servoDown', 'penUpZ', 'penDownZ',
    'optimizeOrder', 'insideFirst', 'passes', 'linearizeArcs', 'arcStepDeg', 'startMarginMm',
    'laserOffsetX', 'laserOffsetY',
  ]
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const value = raw[key]
    if (value !== undefined && value !== null) {
      ;(cfg as unknown as Record<string, unknown>)[key] = value
    }
  }
  const schema = typeof raw.schema === 'number' ? raw.schema : 0
  let migrated = false
  if (schema < 3) {
    if (cfg.penMode === PenMode.ServoPwm && cfg.travelSpeed <= 0 && cfg.liftAngleDeg <= 0) {
      cfg.penMode = PenMode.Manual
    }
    migrated = true
  }
  normalize(cfg)
  return { cfg: cfg, migrated: migrated }
}

export function toStored(cfg: PlotterConfig): PlotterConfig & { schema: number } {
  const copy = cloneConfig(cfg)
  normalize(copy)
  return { schema: 3, ...copy }
}

export function normalize(cfg: PlotterConfig): void {
  if (cfg.bladeOffsetMm < 0) cfg.bladeOffsetMm = 0
  if (cfg.bladeOffsetMm > 20) cfg.bladeOffsetMm = 20
  if (cfg.overcutMm < 0) cfg.overcutMm = 0
  if (cfg.overcutMm > 50) cfg.overcutMm = 50
  if (cfg.leadInMm < 0) cfg.leadInMm = 0
  if (cfg.leadInMm > 50) cfg.leadInMm = 50
  if (cfg.cornerThresholdDeg < 0) cfg.cornerThresholdDeg = 0
  if (cfg.cornerThresholdDeg > 180) cfg.cornerThresholdDeg = 180
  if (cfg.liftAngleDeg < 0) cfg.liftAngleDeg = 0
  if (cfg.liftAngleDeg > 180) cfg.liftAngleDeg = 180
  if (cfg.simplifyMm < 0) cfg.simplifyMm = 0
  if (cfg.simplifyMm > 5) cfg.simplifyMm = 5
  if (cfg.minSegmentMm < 0) cfg.minSegmentMm = 0
  if (cfg.minSegmentMm > 5) cfg.minSegmentMm = 5
  if (cfg.cutSpeed < 1) cfg.cutSpeed = 1
  if (cfg.cutSpeed > 50000) cfg.cutSpeed = 50000
  if (cfg.travelSpeed < 0) cfg.travelSpeed = 0
  if (cfg.travelSpeed > 50000) cfg.travelSpeed = 50000
  if (cfg.plungeSpeed < 1) cfg.plungeSpeed = 1
  if (cfg.plungeSpeed > 50000) cfg.plungeSpeed = 50000
  if (cfg.dwellDownMs < 0) cfg.dwellDownMs = 0
  if (cfg.dwellDownMs > 5000) cfg.dwellDownMs = 5000
  if (cfg.dwellUpMs < 0) cfg.dwellUpMs = 0
  if (cfg.dwellUpMs > 5000) cfg.dwellUpMs = 5000
  if (cfg.servoUp < 0) cfg.servoUp = 0
  if (cfg.servoDown < 0) cfg.servoDown = 0
  if (cfg.servoUp > 100000) cfg.servoUp = 100000
  if (cfg.servoDown > 100000) cfg.servoDown = 100000
  if (cfg.passes < 1) cfg.passes = 1
  if (cfg.passes > 30) cfg.passes = 30
  if (cfg.arcStepDeg < 1) cfg.arcStepDeg = 1
  if (cfg.arcStepDeg > 45) cfg.arcStepDeg = 45
  if (cfg.startMarginMm < 0) cfg.startMarginMm = 0
  if (cfg.startMarginMm > 500) cfg.startMarginMm = 500
  if (cfg.laserOffsetX < -500) cfg.laserOffsetX = -500
  if (cfg.laserOffsetX > 500) cfg.laserOffsetX = 500
  if (cfg.laserOffsetY < -500) cfg.laserOffsetY = -500
  if (cfg.laserOffsetY > 500) cfg.laserOffsetY = 500
  if (cfg.bladeName == null || cfg.bladeName === '') cfg.bladeName = 'Blade'
  cfg.cutSpeed = Math.trunc(cfg.cutSpeed)
  cfg.travelSpeed = Math.trunc(cfg.travelSpeed)
  cfg.plungeSpeed = Math.trunc(cfg.plungeSpeed)
  cfg.dwellDownMs = Math.trunc(cfg.dwellDownMs)
  cfg.dwellUpMs = Math.trunc(cfg.dwellUpMs)
  cfg.servoUp = Math.trunc(cfg.servoUp)
  cfg.servoDown = Math.trunc(cfg.servoDown)
  cfg.passes = Math.trunc(cfg.passes)
}

export const PLOTTER_MARKER = '(LaserGRBL plotter drag-knife)'

export function isPlotterGCode(gcode: string | null | undefined): boolean {
  if (gcode == null) return false
  return gcode.indexOf(PLOTTER_MARKER) >= 0
}
