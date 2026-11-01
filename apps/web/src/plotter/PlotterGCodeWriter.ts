// Translated from LaserGRBL Plotter/PlotterGCodeWriter.cs (GNU GPLv3), commit d893552.

import { dist, num, sampleArc } from './PlotGeom'
import type { PlotterConfig } from './PlotterConfig'
import { PenMode } from './types'
import { pt, type PlotMove, type PlotPoint } from './types'

export function write(moves: PlotMove[] | null, cfg: PlotterConfig, pathCount: number): string {
  let sb = ''
  sb += '(LaserGRBL plotter drag-knife)\r\n'
  sb += '(preview is the swivel axis; the blade tip follows the design)\r\n'
  sb += '(blade ' + safe(cfg.bladeName)
  sb += ' offset ' + num(cfg.bladeOffsetMm)
  sb += ' mm overcut ' + num(cfg.overcutMm)
  sb += ' lead-in ' + num(cfg.leadInMm) + ')\r\n'
  sb += '(cut F' + intText(cfg.cutSpeed)
  sb += ' travel '
  if (cfg.penMode === PenMode.Manual && cfg.travelSpeed <= 0) sb += 'cut feed'
  else if (cfg.travelSpeed <= 0) sb += 'rapid'
  else sb += 'F' + intText(cfg.travelSpeed)
  sb += ' paths ' + intText(pathCount)
  sb += ' pen ' + cfg.penMode + ')\r\n'
  if (cfg.penMode === PenMode.Manual) {
    sb += '(manual knife height, blade stays down)\r\n'
    sb += '(every XY move is a cut; the approach does not cross a contour)\r\n'
  }
  if (cfg.startMarginMm > 0 || Math.abs(cfg.laserOffsetX) > 0.0001 || Math.abs(cfg.laserOffsetY) > 0.0001) {
    sb += '(zero XY with the positioning laser on the sheet bottom-left)\r\n'
    sb += '(blade parks X' + num(cfg.laserOffsetX - cfg.startMarginMm)
    sb += ' Y' + num(cfg.laserOffsetY - cfg.startMarginMm)
    sb += ' then cuts into the drawing)\r\n'
  }
  sb += 'G90\r\n'

  const manual = cfg.penMode === PenMode.Manual
  let down = false
  if (!manual) sb += penUp(cfg)
  let x = Number.NaN
  let y = Number.NaN
  let cutLength = 0

  if (moves != null) {
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i]
      if (!move.cut) {
        if (down && !manual) {
          sb += penUp(cfg)
          down = false
        }
        if (Number.isNaN(x) || Math.abs(x - move.x) > 0.0001 || Math.abs(y - move.y) > 0.0001) {
          sb += rapid(cfg, move.x, move.y)
          x = move.x
          y = move.y
        }
        continue
      }

      if (!down && !manual) {
        sb += penDown(cfg)
        down = true
      }

      if (move.arc && !cfg.linearizeArcs) {
        sb += move.clockwise ? 'G2' : 'G3'
        sb += ' X' + num(move.x)
        sb += ' Y' + num(move.y)
        sb += ' I' + num(move.i)
        sb += ' J' + num(move.j)
        sb += ' F' + intText(cfg.cutSpeed)
        sb += '\r\n'
        if (!Number.isNaN(x)) cutLength += dist(pt(x, y), pt(move.x, move.y))
        x = move.x
        y = move.y
      } else if (move.arc) {
        const samples: PlotPoint[] = []
        const start = pt(x, y)
        sampleArc(samples, start, pt(move.x, move.y), move.i, move.j, move.clockwise, cfg.arcStepDeg)
        for (let s = 0; s < samples.length; s++) {
          cutLength += dist(pt(x, y), samples[s])
          sb += cutLine(cfg, samples[s].x, samples[s].y)
          x = samples[s].x
          y = samples[s].y
        }
      } else {
        if (!Number.isNaN(x)) cutLength += dist(pt(x, y), pt(move.x, move.y))
        sb += cutLine(cfg, move.x, move.y)
        x = move.x
        y = move.y
      }
    }
  }

  if (down && !manual) sb += penUp(cfg)

  sb += '(cut length mm ' + num(cutLength) + ')\r\n'
  return sb
}

function rapid(cfg: PlotterConfig, x: number, y: number): string {
  if (cfg.penMode === PenMode.Manual) {
    let stayDown = cfg.travelSpeed > 0 ? cfg.travelSpeed : cfg.cutSpeed
    if (stayDown <= 0) stayDown = 1
    return 'G1 X' + num(x) + ' Y' + num(y) + ' F' + intText(stayDown) + '\r\n'
  }

  const feed = cfg.travelSpeed
  if (feed <= 0) return 'G0 X' + num(x) + ' Y' + num(y) + '\r\n'
  return 'G1 X' + num(x) + ' Y' + num(y) + ' F' + intText(feed) + '\r\n'
}

function cutLine(cfg: PlotterConfig, x: number, y: number): string {
  return 'G1 X' + num(x) + ' Y' + num(y) + ' F' + intText(cfg.cutSpeed) + '\r\n'
}

function penUp(cfg: PlotterConfig): string {
  if (cfg.penMode === PenMode.Manual) return ''
  let line = ''
  if (cfg.penMode === PenMode.ZAxis) line = 'G0 Z' + num(cfg.penUpZ) + '\r\n'
  else if (cfg.penMode === PenMode.Digital) line = 'M5 S0\r\n'
  else line = 'M3 S' + intText(cfg.servoUp) + '\r\n'
  return line + dwell(cfg.dwellUpMs)
}

function penDown(cfg: PlotterConfig): string {
  if (cfg.penMode === PenMode.Manual) return ''
  let line = ''
  if (cfg.penMode === PenMode.ZAxis) {
    line = 'G1 Z' + num(cfg.penDownZ) + ' F' + intText(cfg.plungeSpeed) + '\r\n'
  } else if (cfg.penMode === PenMode.Digital) {
    const s = cfg.servoDown > 0 ? cfg.servoDown : 255
    line = 'M3 S' + intText(s) + '\r\n'
  } else {
    line = 'M3 S' + intText(cfg.servoDown) + '\r\n'
  }
  return line + dwell(cfg.dwellDownMs)
}

function dwell(milliseconds: number): string {
  if (milliseconds <= 0) return ''
  const seconds = milliseconds / 1000.0
  return 'G4 P' + num(seconds) + '\r\n'
}

function safe(name: string | null): string {
  if (name == null || name === '') return 'blade'
  return name.replace(/\(/g, ' ').replace(/\)/g, ' ')
}

function intText(value: number): string {
  return String(Math.trunc(value))
}
