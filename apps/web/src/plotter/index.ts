export { read as readDxf, toContourGCode } from './DxfReader'
export { read as readSvg } from './SvgReader'
export { centerline, rasterFromRgba, vectorize, type Raster } from './BitmapTrace'
export { convert, convertPaths, withBorderSpeed } from './PlotterPipeline'
export { applyPreset, cloneConfig, createDefault, isPlotterGCode, normalize, PLOTTER_MARKER, type PlotterConfig } from './PlotterConfig'
export { BladePreset, PenMode, type PlotPath, type PlotPoint } from './types'
export { plotterText } from './plotterText'

import { read as readDxf, toContourGCode } from './DxfReader'
import { read as readSvg } from './SvgReader'
import { convertPaths, withBorderSpeed } from './PlotterPipeline'
import type { PlotterConfig } from './PlotterConfig'
import type { PlotPath } from './types'

export function pathsToJob(paths: PlotPath[], cfg: PlotterConfig, borderSpeed: number): string {
  if (cfg.enabled) return convertPaths(paths, withBorderSpeed(cfg, borderSpeed))
  const feed = borderSpeed > 0 ? borderSpeed : 1000
  return toContourGCode(paths, feed)
}

export function vectorTextToJob(text: string, extension: string, cfg: PlotterConfig, borderSpeed: number): string {
  const ext = extension.toLowerCase()
  const paths = ext === 'dxf' ? readDxf(text) : readSvg(text)
  return pathsToJob(paths, cfg, borderSpeed)
}
