import assert from 'node:assert/strict'
import test from 'node:test'
import { centerline, vectorize, type Raster } from './BitmapTrace'
import { build } from './DragKnife'
import { read as readSvg } from './SvgReader'
import { read as readDxf } from './DxfReader'
import { read } from './GCodePathReader'
import { appendCubic, dist, segmentThroughInterior } from './PlotGeom'
import { createDefault, type PlotterConfig } from './PlotterConfig'
import { convert, convertPaths } from './PlotterPipeline'
import { prepare } from './PathOptimizer'
import { route } from './SafeRoute'
import { PenMode, pt, type PlotMove, type PlotPath, type PlotPoint } from './types'

test('Pen_follows_square_corners', () => {
  const cfg = knife()
  cfg.bladeOffsetMm = 0
  cfg.leadInMm = 0
  cfg.overcutMm = 0
  const moves = build([square()], cfg)

  assert.ok(moves.some((m) => m.cut && nearMove(m, 10, 0)))
  assert.ok(moves.some((m) => m.cut && nearMove(m, 10, 10)))
  assert.ok(moves.some((m) => m.cut && nearMove(m, 0, 10)))
  assert.ok(moves.some((m) => m.cut && nearMove(m, 0, 0)))
  assert.equal(moves.some((m) => m.arc), false)
})

test('Drag_knife_offsets_square_and_swings_around_corners', () => {
  const cfg = knife()
  cfg.bladeOffsetMm = 1
  cfg.leadInMm = 1
  cfg.overcutMm = 1
  cfg.cornerThresholdDeg = 0
  const moves = build([square()], cfg)

  assert.equal(moves[0].cut, false)
  assert.equal(nearMove(moves[0], 0, 0), true)
  assert.ok(moves.some((m) => m.cut && !m.arc && nearMove(m, 11, 0)))

  const arc = moves.find((m) => m.arc)
  assert.ok(arc)
  assert.equal(arc.clockwise, false)
  assert.ok(Math.abs(hypot(arc.i, arc.j) - 1) < 0.0005)

  const last = moves[moves.length - 1]
  assert.equal(last.cut, true)
  assert.equal(nearMove(last, 2, 0), true)
})

test('Sharp_turn_lifts_the_knife', () => {
  const cfg = knife()
  cfg.bladeOffsetMm = 1
  cfg.leadInMm = 1
  cfg.overcutMm = 0
  cfg.liftAngleDeg = 45
  const moves = build([square()], cfg)

  assert.ok(moves.slice(1).some((m) => !m.cut))
  assert.equal(moves.some((m) => m.arc), false)
})

test('Reader_keeps_one_closed_square_and_modal_lines', () => {
  const gcode = `
G90
G0 X0 Y0
M3 S0
S255
G1 X10 Y0 F1000
X10 Y10
X0 Y10
X0 Y0
S0
M5`
  const paths = read(gcode.split('\n'))
  assert.equal(paths.length, 1)
  assert.equal(paths[0].closed, true)
  assert.equal(paths[0].points.length, 4)
  assert.equal(near(paths[0].points[1], 10, 0), true)
  assert.equal(near(paths[0].points[2], 10, 10), true)
})

test('Reader_linearizes_quarter_arc', () => {
  const gcode = 'G0 X10 Y0\nM3 S100\nG3 X0 Y10 I-10 J0\nS0\n'
  const paths = read(gcode.split('\n'))
  assert.equal(paths.length, 1)
  assert.ok(paths[0].points.length > 4)
  assert.equal(near(paths[0].points[paths[0].points.length - 1], 0, 10), true)
})

test('Inner_contour_is_cut_before_the_outline', () => {
  const outer = rect(0, 0, 100, 100)
  const inner = rect(40, 40, 60, 60)
  const cfg = knife()
  cfg.optimizeOrder = true
  cfg.insideFirst = true
  const ordered = prepare([outer, inner], cfg)

  assert.equal(ordered.length, 2)
  assert.ok(ordered[0].points[0].x >= 40 && ordered[0].points[0].x <= 60)
  assert.ok(ordered[0].points[0].y >= 40 && ordered[0].points[0].y <= 60)
  const minX = Math.min(...ordered[1].points.map((p) => p.x))
  assert.ok(Math.abs(minX - 0) < 0.0005)
})

test('Pipeline_emits_servo_and_corner_arc', () => {
  const cfg = knife()
  cfg.bladeOffsetMm = 1
  cfg.leadInMm = 1
  cfg.overcutMm = 1
  cfg.cutSpeed = 800
  cfg.penMode = PenMode.ServoPwm
  cfg.servoUp = 0
  cfg.servoDown = 255
  const source = 'G0 X0 Y0\nM3 S0\nS255\nG1 X10 Y0\nG1 X10 Y10\nG1 X0 Y10\nG1 X0 Y0\nS0\n'
  const result = convert(source, cfg)

  assert.ok(result.includes('G90'))
  assert.ok(result.includes('G3'))
  assert.ok(result.includes('M3 S255'))
  assert.ok(result.includes('F800'))
  assert.ok(result.includes('X11'))

  const again = read(result.split('\n'))
  assert.equal(again.length, 1)
})

test('Straight_bezier_is_not_subdivided', () => {
  const pts: PlotPoint[] = []
  appendCubic(pts, pt(0, 0), pt(3, 0), pt(7, 0), pt(10, 0), 0.05)
  assert.equal(pts.length, 2)
  assert.equal(near(pts[0], 0, 0), true)
  assert.equal(near(pts[1], 10, 0), true)
})

test('Empty_program_still_lifts_the_knife', () => {
  const result = convert('', knife())
  assert.ok(result.includes('M3 S0'))
  assert.ok(result.includes('paths 0'))
})

test('Manual_approach_enters_at_the_near_corner', () => {
  const cfg = createDefault()
  cfg.simplifyMm = 0
  cfg.minSegmentMm = 0
  cfg.bladeOffsetMm = 3.6
  cfg.leadInMm = 3.6
  cfg.overcutMm = 3.6
  cfg.cutSpeed = 600
  cfg.travelSpeed = 0
  cfg.optimizeOrder = true
  cfg.insideFirst = true
  cfg.startMarginMm = 0
  cfg.laserOffsetX = 0
  cfg.laserOffsetY = 0

  const squarePath: PlotPath = {
    closed: true,
    points: [pt(30, 30), pt(10, 30), pt(10, 10), pt(30, 10)],
  }

  const gcode = convertPaths([squarePath], cfg)
  assert.equal(gcode.includes('G0'), false)

  const first = firstMove(gcode)
  assert.ok(dist(first, pt(10, 10)) < 0.05, first.x + ',' + first.y)
  assert.equal(segmentThroughInterior(pt(0, 0), first, squarePath.points), false)
})

test('Manual_approach_does_not_cross_the_outline_to_reach_a_hole', () => {
  const cfg = createDefault()
  cfg.simplifyMm = 0
  cfg.minSegmentMm = 0
  cfg.bladeOffsetMm = 0
  cfg.leadInMm = 0
  cfg.overcutMm = 0
  cfg.cornerThresholdDeg = 180
  cfg.optimizeOrder = true
  cfg.insideFirst = true
  cfg.startMarginMm = 0
  cfg.laserOffsetX = 0
  cfg.laserOffsetY = 0

  const outer = rect(20, 20, 80, 80)
  const inner = rect(40, 40, 60, 60)
  const gcode = convertPaths([outer, inner], cfg)
  const first = firstMove(gcode)
  assert.equal(segmentThroughInterior(pt(0, 0), first, outer.points), false)
  assert.ok(dist(first, pt(20, 20)) < 0.05, first.x + ',' + first.y)
})

test('Blade_parks_outside_the_corner_marked_by_the_laser', () => {
  const cfg = createDefault()
  cfg.simplifyMm = 0
  cfg.minSegmentMm = 0
  cfg.bladeOffsetMm = 0
  cfg.leadInMm = 0
  cfg.overcutMm = 0
  cfg.cornerThresholdDeg = 180
  cfg.startMarginMm = 20
  cfg.laserOffsetX = 10
  cfg.laserOffsetY = 0

  const squarePath = rect(5, 8, 40, 50)
  const gcode = convertPaths([squarePath], cfg)
  const motion = motionPoints(gcode)

  assert.ok(motion.length >= 2)
  assert.ok(Math.abs(motion[0].x - -10) < 0.05, motion[0].x + ',' + motion[0].y)
  assert.ok(Math.abs(motion[0].y - -20) < 0.05, motion[0].x + ',' + motion[0].y)
  assert.ok(Math.abs(motion[1].x - 10) < 0.05, motion[1].x + ',' + motion[1].y)
  assert.ok(Math.abs(motion[1].y) < 0.05, motion[1].x + ',' + motion[1].y)
  assert.equal(gcode.includes('G0'), false)

  const onSheet = [pt(10, 0), pt(45, 0), pt(45, 42), pt(10, 42)]
  assert.equal(segmentThroughInterior(motion[0], motion[1], onSheet), false)
})

test('Route_walks_around_a_blocking_square', () => {
  const wall = rect(10, 10, 20, 20)
  const way = route(pt(0, 0), pt(30, 30), [wall], 1)
  assert.ok(dist(way[way.length - 1], pt(30, 30)) < 0.001)
  let prev = pt(0, 0)
  for (let i = 0; i < way.length; i++) {
    assert.equal(segmentThroughInterior(prev, way[i], wall.points), false)
    prev = way[i]
  }
})

test('Dxf_reads_line_polyline_circle_bulge_and_inches', () => {
  const dxf = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n'
    + '0\nLINE\n10\n0\n20\n0\n11\n10\n21\n0\n'
    + '0\nLWPOLYLINE\n90\n4\n70\n1\n10\n0\n20\n0\n10\n5\n20\n0\n10\n5\n20\n5\n10\n0\n20\n5\n'
    + '0\nLWPOLYLINE\n90\n2\n70\n0\n10\n0\n20\n0\n42\n1\n10\n2\n20\n0\n'
    + '0\nCIRCLE\n10\n10\n20\n10\n40\n2\n'
    + '0\nENDSEC\n0\nEOF\n'
  const paths = readDxf(dxf)
  assert.ok(paths.some((p) => p.closed && p.points.length === 4 && p.points.some((point) => Math.abs(point.x - 5) < 0.01 && Math.abs(point.y - 5) < 0.01)))
  assert.ok(paths.some((p) => p.closed && p.points.length > 8))
  assert.ok(paths.some((p) => !p.closed && p.points.some((point) => Math.abs(point.y) > 0.5)))

  const arc = '0\nSECTION\n2\nENTITIES\n0\nARC\n10\n0\n20\n0\n40\n10\n50\n0\n51\n90\n0\nENDSEC\n0\nEOF\n'
  const arcPaths = readDxf(arc)
  assert.equal(arcPaths.length, 1)
  assert.ok(Math.abs(arcPaths[0].points[0].x - 10) < 0.05)
  assert.ok(Math.abs(arcPaths[0].points[0].y) < 0.05)
  assert.ok(Math.abs(arcPaths[0].points[arcPaths[0].points.length - 1].x) < 0.05)
  assert.ok(Math.abs(arcPaths[0].points[arcPaths[0].points.length - 1].y - 10) < 0.05)

  const inches = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n1\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n'
    + '0\nLINE\n10\n0\n20\n0\n11\n1\n21\n0\n0\nENDSEC\n0\nEOF\n'
  const inchPaths = readDxf(inches)
  assert.equal(inchPaths.length, 1)
  assert.ok(Math.abs(inchPaths[0].points[1].x - 25.4) < 0.01)

  const block = '0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nSLOT\n10\n0\n20\n0\n'
    + '0\nLINE\n10\n0\n20\n0\n11\n4\n21\n0\n0\nENDBLK\n0\nENDSEC\n'
    + '0\nSECTION\n2\nENTITIES\n0\nINSERT\n2\nSLOT\n10\n5\n20\n6\n50\n0\n0\nENDSEC\n0\nEOF\n'
  const inserted = readDxf(block)
  assert.equal(inserted.length, 1)
  assert.ok(Math.abs(inserted[0].points[0].x - 5) < 0.01)
  assert.ok(Math.abs(inserted[0].points[0].y - 6) < 0.01)
  assert.ok(Math.abs(inserted[0].points[1].x - 9) < 0.01)
})

test('Manual_height_emits_xy_only_at_cut_speed', () => {
  const cfg = createDefault()
  assert.equal(cfg.penMode, PenMode.Manual)
  assert.ok(Math.abs(cfg.bladeOffsetMm - 3.6) < 0.000005)
  assert.equal(cfg.passes, 1)
  cfg.simplifyMm = 0
  cfg.minSegmentMm = 0
  cfg.optimizeOrder = false
  cfg.insideFirst = false
  cfg.cutSpeed = 600
  cfg.travelSpeed = 0
  cfg.liftAngleDeg = 150

  const source = 'G0 X0 Y0\nM3 S0\nS255\nG1 X10 Y0\nG1 X10 Y10\nG1 X0 Y10\nG1 X0 Y0\nS0\n'
  const result = convert(source, cfg)

  assert.ok(result.includes('F600'))
  assert.equal(result.includes('M3'), false)
  assert.equal(result.includes('M5'), false)
  assert.equal(result.includes('G0 '), false)
  assert.equal(result.includes(' Z'), false)
  assert.ok(result.includes('G3'))
})

test('Right_angle_swings_an_arc_and_a_gentle_turn_does_not', () => {
  const sharp = createDefault()
  sharp.simplifyMm = 0
  sharp.minSegmentMm = 0
  sharp.leadInMm = 0
  sharp.overcutMm = 0
  sharp.bladeOffsetMm = 3.6
  sharp.cornerThresholdDeg = 8
  sharp.penMode = PenMode.Manual
  sharp.startMarginMm = 0
  sharp.laserOffsetX = 0
  sharp.laserOffsetY = 0
  const sharpMoves = build([square()], sharp)
  const arc = sharpMoves.find((m) => m.arc)
  assert.ok(arc)
  assert.ok(Math.abs(hypot(arc.i, arc.j) - 3.6) < 0.001)

  const gentle = createDefault()
  gentle.simplifyMm = 0
  gentle.minSegmentMm = 0
  gentle.leadInMm = 0
  gentle.overcutMm = 0
  gentle.bladeOffsetMm = 3.6
  gentle.cornerThresholdDeg = 8
  const rad = 5 * Math.PI / 180
  const open: PlotPath = {
    closed: false,
    points: [pt(0, 0), pt(10, 0), pt(10 + 10 * Math.cos(rad), 10 * Math.sin(rad))],
  }
  const gentleMoves = build([open], gentle)
  assert.equal(gentleMoves.some((m) => m.arc), false)
})

test('Svg_square_circle_and_hidden_shape', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10">'
    + '<path d="M0 0 L10 0 L10 10 L0 10 Z"/>'
    + '<circle cx="5" cy="5" r="2"/>'
    + '<path display="none" d="M0 0 L1 0"/>'
    + '</svg>'
  const paths = readSvg(svg)
  assert.equal(paths.length, 2)
  const squarePath = paths.find((p) => p.closed && p.points.length === 4)
  assert.ok(squarePath)
  assert.ok(squarePath.points.some((p) => Math.abs(p.x) < 0.01 && Math.abs(p.y - 10) < 0.01))
  assert.ok(squarePath.points.some((p) => Math.abs(p.x - 10) < 0.01 && Math.abs(p.y) < 0.01))
  assert.ok(paths.some((p) => p.closed && p.points.length > 8))
})

test('Vectorize_keeps_a_hole_and_centerline_is_a_stroke', () => {
  const frame = blank(8, 8)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const hole = x >= 2 && x <= 5 && y >= 2 && y <= 5
      if (!hole) frame.ink[y * 8 + x] = 1
    }
  }
  const outlines = vectorize(frame, 8)
  assert.ok(outlines.length >= 2)
  assert.ok(outlines.every((p) => p.closed))

  const bar = blank(12, 7)
  for (let y = 2; y <= 4; y++) {
    for (let x = 1; x <= 10; x++) bar.ink[y * 12 + x] = 1
  }
  const strokes = centerline(bar, 12)
  assert.ok(strokes.length >= 1)
  const stroke = strokes[0]
  const xs = stroke.points.map((p) => p.x)
  const ys = stroke.points.map((p) => p.y)
  const spanX = Math.max(...xs) - Math.min(...xs)
  const spanY = Math.max(...ys) - Math.min(...ys)
  assert.ok(spanX > spanY)
  assert.equal(stroke.closed, false)
})

test('Positive_bulge_semicircle_passes_under_the_chord', () => {
  const dxf = '0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n90\n2\n70\n0\n10\n0\n20\n0\n42\n1\n10\n2\n20\n0\n0\nENDSEC\n0\nEOF\n'
  const paths = readDxf(dxf)
  assert.equal(paths.length, 1)
  assert.equal(paths[0].closed, false)
  assert.ok(paths[0].points.some((p) => Math.abs(p.x - 1) < 0.05 && Math.abs(p.y - -1) < 0.05))
})

function blank(width: number, height: number): Raster {
  return { width, height, ink: new Uint8Array(width * height) }
}

function firstMove(gcode: string): PlotPoint {
  return motionPoints(gcode)[0]
}

function motionPoints(gcode: string): PlotPoint[] {
  const points: PlotPoint[] = []
  const lines = gcode.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('G0') || line.startsWith('G1') || line.startsWith('G2') || line.startsWith('G3')) {
      points.push(pt(word(line, 'X'), word(line, 'Y')))
    }
  }
  if (points.length === 0) throw new Error('no motion')
  return points
}

function word(line: string, axis: string): number {
  const at = line.indexOf(axis)
  if (at < 0) return 0
  let end = at + 1
  while (end < line.length && (isDigit(line.charAt(end)) || line.charAt(end) === '.' || line.charAt(end) === '-' || line.charAt(end) === '+')) end++
  return Number.parseFloat(line.substring(at + 1, end))
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9'
}

function knife(): PlotterConfig {
  const cfg = createDefault()
  cfg.penMode = PenMode.ServoPwm
  cfg.servoUp = 0
  cfg.servoDown = 255
  cfg.simplifyMm = 0
  cfg.minSegmentMm = 0
  cfg.optimizeOrder = false
  cfg.insideFirst = false
  cfg.passes = 1
  cfg.startMarginMm = 0
  cfg.laserOffsetX = 0
  cfg.laserOffsetY = 0
  cfg.leadInMm = 0
  cfg.overcutMm = 0
  cfg.liftAngleDeg = 0
  return cfg
}

function square(): PlotPath {
  return rect(0, 0, 10, 10)
}

function rect(x0: number, y0: number, x1: number, y1: number): PlotPath {
  return {
    closed: true,
    points: [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)],
  }
}

function nearMove(move: PlotMove, x: number, y: number): boolean {
  return near(pt(move.x, move.y), x, y)
}

function near(point: PlotPoint, x: number, y: number): boolean {
  return Math.abs(point.x - x) < 0.02 && Math.abs(point.y - y) < 0.02
}

function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y)
}
