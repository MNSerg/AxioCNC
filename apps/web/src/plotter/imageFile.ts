import { rasterFromRgba, type Raster } from './BitmapTrace'

export async function imageFileToRaster(file: File): Promise<{ raster: Raster; pixelWidth: number; pixelHeight: number }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const maxDim = 800
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height, 1))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h)
    return {
      raster: rasterFromRgba(w, h, data.data, 128),
      pixelWidth: img.width,
      pixelHeight: img.height,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read the image'))
    img.src = url
  })
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function plotterJobName(name: string): string {
  return jobBase(name) + '.plotter.nc'
}

export function contourJobName(name: string): string {
  return jobBase(name) + '.nc'
}

function jobBase(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

const GCODE = ['nc', 'gcode', 'cnc', 'tap']
const VECTOR = ['dxf', 'svg']
const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']

export function isGcodeExtension(ext: string): boolean {
  return GCODE.indexOf(ext) >= 0
}

export function isVectorExtension(ext: string): boolean {
  return VECTOR.indexOf(ext) >= 0
}

export function isImageExtension(ext: string): boolean {
  return IMAGE.indexOf(ext) >= 0
}
