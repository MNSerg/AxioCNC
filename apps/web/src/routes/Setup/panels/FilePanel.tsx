import React, { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload, FileCode, Circle, Loader2, X, ClipboardList, PenLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import 'overlayscrollbars/overlayscrollbars.css'
import { useGetWorkfilesQuery, useUploadWorkfileMutation, useLazyGetWorkfileContentQuery, useGetControllersQuery, useGetGcodeQuery, useGetSettingsQuery, useSetSettingsMutation } from '@/services/api'
import { socketService } from '@/services/socket'
import { runGcodeBatch } from '@/utils/runGcodeBatch'
import { calculateOutline } from '@/lib/gcodeOutline'
import { useNotifications } from '@/hooks/useNotifications'
import { ConfirmationDialog } from '@/components/ConfirmationDialog'
import type { PanelProps } from '../types'
import { MachineActionButton } from '@/components/MachineActionButton'
import { ActionRequirements } from '@/utils/machineState'
import { centerline, vectorize, type Raster } from '@/plotter/BitmapTrace'
import { configFromStored, isPlotterGCode, toStored } from '@/plotter/PlotterConfig'
import { pathsToJob, vectorTextToJob } from '@/plotter'
import { convert, withBorderSpeed } from '@/plotter/PlotterPipeline'
import { num } from '@/plotter/PlotGeom'
import { plotterText } from '@/plotter/plotterText'
import { contourJobName, fileExtension, imageFileToRaster, isImageExtension, isVectorExtension, plotterJobName } from '@/plotter/imageFile'
import { PlotterImportDialog, type PlotterImageMode } from './PlotterImportDialog'

type PendingImport =
  | { kind: 'dxf' | 'svg'; name: string; text: string }
  | { kind: 'image'; name: string; raster: Raster }

export interface FilePanelProps extends PanelProps {
  onSetUpJob?: () => void
}

export function FilePanel({ isConnected, connectedPort: connectedPortProp, onFlashStatus, machinePosition, machineStatus, onSetUpJob }: FilePanelProps) {
  const { t, i18n } = useTranslation()
  const tr = (english: string, russian: string) => plotterText(i18n.language, english, russian)
  // Get connected port from controllers (may be null if not connected)
  const { data: controllers } = useGetControllersQuery()
  const connectedPort = connectedPortProp || controllers?.[0]?.port || null
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null)
  const [isOutlining, setIsOutlining] = useState(false)
  const [outlineError, setOutlineError] = useState<string | null>(null)
  const [showOutlineConfirm, setShowOutlineConfirm] = useState(false)
  const outliningStartedRef = useRef(false)
  const [getWorkfileContent] = useLazyGetWorkfileContentQuery()
  const { showErrorNotification, showInfoNotification } = useNotifications()
  const { data: settings } = useGetSettingsQuery()
  const [setSettings] = useSetSettingsMutation()
  const [importOpen, setImportOpen] = useState(false)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [importSpeed, setImportSpeed] = useState(600)
  const [importWidth, setImportWidth] = useState(100)
  const [importMode, setImportMode] = useState<PlotterImageMode>('vectorize')
  const [showApplyPlotter, setShowApplyPlotter] = useState(false)
  const [isApplyingPlotter, setIsApplyingPlotter] = useState(false)

  const { data: workfilesData, isLoading: isLoadingFiles } = useGetWorkfilesQuery()
  const [uploadWorkfile] = useUploadWorkfileMutation()
  const plotterCfg = configFromStored(settings?.plotter).cfg

  const files = workfilesData?.files || []

  // Query currently loaded G-code on mount (to restore when navigating/reloading)
  const { data: gcodeData } = useGetGcodeQuery(connectedPort || '', {
    skip: !connectedPort,
  })

  // Restore loaded file name from API on mount
  // This ensures the FilePanel shows the correct loaded file state
  React.useEffect(() => {
    if (gcodeData) {
      // Backend is source of truth - update local state to match
      if (gcodeData.name) {
        setLoadedFileName(gcodeData.name)
      } else {
        // No file loaded on backend
        setLoadedFileName(null)
      }
    }
    // If query is skipped (no connectedPort), preserve existing state
  }, [gcodeData])

  const openImport = useCallback((pending: PendingImport) => {
    setImportSpeed(plotterCfg.enabled ? plotterCfg.cutSpeed : 1000)
    setPendingImport(pending)
    setImportOpen(true)
  }, [plotterCfg.cutSpeed, plotterCfg.enabled])

  const sendLoadedGcode = useCallback(async (name: string, gcode: string) => {
    if (!isConnected || !connectedPort) return
    const token = localStorage.getItem('axiocnc-token')
    const response = await fetch('/api/gcode', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({
        port: connectedPort,
        name,
        gcode,
        context: {},
      }),
    })
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.msg || t('Failed to load file'))
    }
    setLoadedFileName(name)
  }, [isConnected, connectedPort, t])

  // Handle file upload (from file picker or drag-drop).
  // G-code files stay on the existing upload path. DXF, SVG and images are imported.
  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.name) return
    const ext = fileExtension(file.name)

    if (isImageExtension(ext)) {
      setIsUploading(true)
      try {
        const image = await imageFileToRaster(file)
        const width = Math.max(10, Math.round(Math.max(image.pixelWidth, image.pixelHeight) / 10))
        setImportWidth(width)
        setImportMode('vectorize')
        openImport({ kind: 'image', name: file.name, raster: image.raster })
      } catch (error) {
        console.error('Failed to read image:', error)
        showErrorNotification(tr('Plotter', 'Плоттер'), tr('Could not read the image', 'Не удалось прочитать изображение'))
      } finally {
        setIsUploading(false)
      }
      return
    }

    setIsUploading(true)
    
    try {
      const reader = new FileReader()
      
      reader.onloadend = async (event) => {
        try {
          const result = event.target?.result as string
          if (!result) {
            throw new Error(t('Failed to read file'))
          }

          if (isVectorExtension(ext)) {
            openImport({ kind: ext === 'dxf' ? 'dxf' : 'svg', name: file.name, text: result })
            return
          }

          await uploadWorkfile({ name: file.name, gcode: result }).unwrap()
        } catch (error) {
          console.error('Failed to upload file:', error)
          showErrorNotification(t('Failed to load file'), error instanceof Error ? error.message : t('Failed to read file'))
        } finally {
          setIsUploading(false)
        }
      }

      reader.onerror = () => {
        console.error('FileReader error')
        setIsUploading(false)
      }

      reader.readAsText(file)
    } catch (error) {
      console.error('Failed to process file:', error)
      setIsUploading(false)
    }
  }, [openImport, showErrorNotification, t, tr, uploadWorkfile])

  const handleImportConfirm = useCallback(async () => {
    if (!pendingImport) return
    const pending = pendingImport
    setImportOpen(false)
    setIsUploading(true)
    try {
      const cfg = configFromStored(settings?.plotter).cfg
      let gcode: string
      if (pending.kind === 'image') {
        const paths = importMode === 'centerline'
          ? centerline(pending.raster, importWidth)
          : vectorize(pending.raster, importWidth)
        gcode = pathsToJob(paths, cfg, importSpeed)
      } else {
        gcode = vectorTextToJob(pending.text, pending.kind, cfg, importSpeed)
      }
      if ((cfg.enabled && gcode.indexOf('paths 0') >= 0) || gcode.indexOf('X') < 0) {
        showErrorNotification(
          tr('Plotter', 'Плоттер'),
          tr('No contours found in this file.', 'В файле нет контуров.'),
        )
        return
      }
      if (cfg.enabled && importSpeed > 0) {
        try {
          await setSettings({ plotter: toStored(withBorderSpeed(cfg, importSpeed)) }).unwrap()
        } catch (error) {
          console.error('Failed to save plotter cut speed:', error)
        }
      }
      const name = cfg.enabled ? plotterJobName(pending.name) : contourJobName(pending.name)
      await uploadWorkfile({ name, gcode }).unwrap()
      showInfoNotification(
        tr('Plotter', 'Плоттер'),
        tr('Saved {{name}}', 'Сохранён {{name}}').replace('{{name}}', name),
      )
    } catch (error) {
      console.error('Failed to import plotter file:', error)
      showErrorNotification(
        tr('Plotter', 'Плоттер'),
        error instanceof Error ? error.message : tr('Could not build the toolpath', 'Не удалось построить траекторию'),
      )
    } finally {
      setIsUploading(false)
      setPendingImport(null)
    }
  }, [importMode, importSpeed, importWidth, pendingImport, setSettings, settings?.plotter, showErrorNotification, showInfoNotification, tr, uploadWorkfile])

  const performApplyPlotter = useCallback(async () => {
    if (!loadedFileName || isApplyingPlotter) return
    setIsApplyingPlotter(true)
    try {
      let source = gcodeData?.data || gcodeData?.gcode || ''
      if (!source) {
        const result = await getWorkfileContent(loadedFileName).unwrap()
        source = result.gcode || ''
      }
      if (!source) {
        throw new Error(t('G-code content is empty'))
      }
      if (isPlotterGCode(source)) {
        showErrorNotification(
          tr('Plotter', 'Плоттер'),
          tr(
            'This file is already a drag-knife path. The holder path cannot be used as a new drawing.',
            'Этот файл уже содержит путь ножа. Путь оси нельзя принимать за новый рисунок.',
          ),
        )
        return
      }
      const cfg = configFromStored(settings?.plotter).cfg
      const gcode = convert(source, cfg)
      if (gcode.indexOf('paths 0') >= 0) {
        showErrorNotification(
          tr('Plotter', 'Плоттер'),
          tr(
            'No cutting moves found. Open a DXF or SVG, or a G-code file with spindle-on G1 moves.',
            'Нет режущих ходов. Откройте DXF или SVG, либо G-code с ходами G1 при включённом шпинделе.',
          ),
        )
        return
      }
      const name = plotterJobName(loadedFileName)
      await uploadWorkfile({ name, gcode }).unwrap()
      await sendLoadedGcode(name, gcode)
      showInfoNotification(
        tr('Plotter', 'Плоттер'),
        tr('Saved {{name}}', 'Сохранён {{name}}').replace('{{name}}', name),
      )
    } catch (error) {
      console.error('Failed to apply plotter:', error)
      showErrorNotification(
        tr('Plotter', 'Плоттер'),
        error instanceof Error ? error.message : tr('Could not build the toolpath', 'Не удалось построить траекторию'),
      )
    } finally {
      setIsApplyingPlotter(false)
    }
  }, [gcodeData, getWorkfileContent, isApplyingPlotter, loadedFileName, sendLoadedGcode, settings?.plotter, showErrorNotification, showInfoNotification, t, tr, uploadWorkfile])

  // Handle file picker click
  const handleFilePickerClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // Handle file input change
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileUpload(file)
    }
    // Reset input so same file can be selected again
    e.target.value = ''
  }, [handleFileUpload])

  // Handle drag and drop
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleFileUpload(file)
    }
  }, [handleFileUpload])

  // Load file into controller
  const handleLoadFile = useCallback(async (filename: string) => {
    console.log('[FilePanel] handleLoadFile called:', filename, { isConnected, connectedPort })
    try {
      // Check if we have a connection
      if (!isConnected || !connectedPort) {
        // No connection - flash status to indicate connection required
        console.log('[FilePanel] Not connected, flashing status')
        onFlashStatus()
        return
      }

      console.log('[FilePanel] Fetching file content...')
      const result = await getWorkfileContent(filename).unwrap()
      console.log('[FilePanel] File content fetched, sending to backend:', { filename: result.filename, gcodeLength: result.gcode.length })
      
      // Send to controller via existing /api/gcode endpoint
      const token = localStorage.getItem('axiocnc-token')
      const response = await fetch('/api/gcode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({
          port: connectedPort,
          name: result.filename,
          gcode: result.gcode,
          context: {},
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.msg || t('Failed to load file'))
      }

      console.log('[FilePanel] File sent to backend successfully, waiting for gcode:load event')
      setLoadedFileName(result.filename)
      
      // The gcode:load socket event will be emitted by the backend
      // which will trigger updates in other panels (like ToolsPanel)
    } catch (error) {
      console.error('[FilePanel] Failed to load file:', error)
      // TODO: Show error toast
    }
  }, [isConnected, connectedPort, getWorkfileContent, onFlashStatus, t])

  // Unload file from controller
  const handleUnload = useCallback(() => {
    console.log('[FilePanel] handleUnload called', { connectedPort, loadedFileName })
    setLoadedFileName(null)
    
    // If connected, send unload command to controller
    if (connectedPort) {
      console.log('[FilePanel] Sending gcode:unload command via socket')
      socketService.command(connectedPort, 'gcode:unload')
      console.log('[FilePanel] gcode:unload command emitted, waiting for gcode:unload event')
    } else {
      console.warn('[FilePanel] No connected port, cannot send unload command')
    }
  }, [connectedPort, loadedFileName])

  // Perform the actual outline (called after confirmation)
  const performOutline = useCallback(async () => {
    if (!isConnected || !connectedPort || !loadedFileName || !machinePosition) {
      if (!isConnected || !connectedPort) {
        onFlashStatus()
      } else {
        showErrorNotification(t('Outline Error'), t('Machine position not available'))
      }
      return
    }

    if (isOutlining) {
      return // Already running
    }

    setIsOutlining(true)
    setOutlineError(null)

    try {
      // Fetch G-code content
      const result = await getWorkfileContent(loadedFileName).unwrap()
      
      if (!result.gcode) {
        throw new Error(t('G-code content is empty'))
      }

      // Calculate outline
      const outlineResult = calculateOutline(
        result.gcode,
        {
          x: machinePosition.x,
          y: machinePosition.y,
          z: machinePosition.z,
        },
        {
          concavity: 5, // Less detailed, smoother outline
          margin: 2, // 2mm margin
          closePath: true,
          returnToStart: true,
          minPointDistance: 5, // 5mm minimum distance between points
        }
      )

      if (!outlineResult) {
        throw new Error(t('Failed to calculate outline. Need at least 3 XY points in toolpath.'))
      }

      if (outlineResult.commands.length === 0) {
        throw new Error(t('No outline commands generated'))
      }

      console.log('[FilePanel] Outline calculated:', {
        hullPoints: outlineResult.hullPoints.length,
        commands: outlineResult.commands.length,
        bounds: outlineResult.bounds,
      })

      outliningStartedRef.current = true
      const outlineGcode = outlineResult.commands.join('\n')

      showInfoNotification(t('Outline Started'), t('Tracing outline with {{count}} points', { count: outlineResult.hullPoints.length }))

      runGcodeBatch({ gcode: outlineGcode, port: connectedPort, waitForIdle: true })
        .then(() => {
          setIsOutlining(false)
          outliningStartedRef.current = false
          showInfoNotification(t('Outline Complete'), t('Outline tracing finished'))
        })
        .catch((err) => {
          setIsOutlining(false)
          outliningStartedRef.current = false
          const errorMessage = err?.message ?? t('Outline tracing failed')
          setOutlineError(errorMessage)
          showErrorNotification(t('Outline Error'), errorMessage)
        })
    } catch (error) {
      console.error('[FilePanel] Outline error:', error)
      const errorMessage = error instanceof Error ? error.message : t('Failed to generate outline')
      setOutlineError(errorMessage)
      showErrorNotification(t('Outline Error'), errorMessage)
      setIsOutlining(false)
      outliningStartedRef.current = false
    }
  }, [isConnected, connectedPort, loadedFileName, machinePosition, isOutlining, getWorkfileContent, onFlashStatus, showErrorNotification, showInfoNotification, t])

  // Handle outline button click - show confirmation dialog
  const handleOutline = useCallback(() => {
    if (!isConnected || !connectedPort || !loadedFileName || !machinePosition) {
      if (!isConnected || !connectedPort) {
        onFlashStatus()
      } else {
        showErrorNotification(t('Outline Error'), t('Machine position not available'))
      }
      return
    }

    if (isOutlining) {
      return // Already running
    }

    setShowOutlineConfirm(true)
  }, [isConnected, connectedPort, loadedFileName, machinePosition, isOutlining, onFlashStatus, showErrorNotification, t])

  // Listen for gcode:load and gcode:unload events to track loaded file
  React.useEffect(() => {
    // gcode:load emits (name, gcode, context) as separate arguments
    const handleGcodeLoad = (name: string) => {
      console.log('[FilePanel] gcode:load event received:', name)
      if (name) {
        setLoadedFileName(name)
      }
    }

    const handleGcodeUnload = () => {
      setLoadedFileName(null)
    }

    socketService.on('gcode:load', handleGcodeLoad)
    socketService.on('gcode:unload', handleGcodeUnload)

    return () => {
      socketService.off('gcode:load', handleGcodeLoad)
      socketService.off('gcode:unload', handleGcodeUnload)
    }
  }, [])

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatDate = (mtime: number) => {
    return new Date(mtime).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="p-3 space-y-3 h-full flex flex-col">
      {/* Upload zone */}
      <div
        className={`
          border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer
          ${isDragging 
            ? 'border-primary bg-primary/10' 
            : 'border-border hover:border-primary'
          }
          ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        onClick={handleFilePickerClick}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".nc,.gcode,.cnc,.tap,.dxf,.svg,.png,.jpg,.jpeg,.gif,.bmp,.webp"
          className="hidden"
          onChange={handleFileInputChange}
          disabled={isUploading}
        />
        {isUploading ? (
          <>
            <Loader2 className="w-8 h-8 mx-auto text-primary mb-2 animate-spin" />
            <div className="text-sm text-muted-foreground">{t('Uploading...')}</div>
          </>
        ) : (
          <>
            <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <div className="text-sm text-muted-foreground">
              {t('Drop G-code file or click to browse')}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {tr('DXF, SVG, PNG, JPG and BMP open as contours', 'DXF, SVG, PNG, JPG и BMP открываются как контуры')}
            </div>
          </>
        )}
      </div>

      {/* Loaded file card */}
      <div className="bg-muted/30 rounded border border-border p-3 space-y-2">
        <div className="text-xs font-medium text-muted-foreground mb-1">
          {t('Loaded File')}
        </div>
        {loadedFileName ? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <FileCode className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="text-sm font-medium truncate">{loadedFileName}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation()
                  handleUnload()
                }}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
            {/* Actions - only show when connected */}
            {connectedPort && (
              <div className="flex flex-col gap-2">
                {onSetUpJob && (
                  <MachineActionButton
                    isConnected={isConnected}
                    connectedPort={connectedPort}
                    machineStatus={machineStatus ?? 'not_connected'}
                    onFlashStatus={onFlashStatus}
                    onAction={onSetUpJob}
                    requirements={ActionRequirements.standard}
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    <ClipboardList className="w-4 h-4 mr-2" />
                    {t('Set up job')}
                  </MachineActionButton>
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  size="sm"
                  disabled={isApplyingPlotter || !loadedFileName}
                  onClick={() => {
                    const source = gcodeData?.data || gcodeData?.gcode || ''
                    if (source && isPlotterGCode(source)) {
                      showErrorNotification(
                        tr('Plotter', 'Плоттер'),
                        tr(
                          'This file is already a drag-knife path. The holder path cannot be used as a new drawing.',
                          'Этот файл уже содержит путь ножа. Путь оси нельзя принимать за новый рисунок.',
                        ),
                      )
                      return
                    }
                    setShowApplyPlotter(true)
                  }}
                >
                  {isApplyingPlotter ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" /> {tr('Plotter', 'Плоттер')}
                    </>
                  ) : (
                    <>
                      <PenLine className="w-4 h-4 mr-1" /> {tr('Apply plotter to loaded file', 'Применить плоттер к загруженному файлу')}
                    </>
                  )}
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full" 
                  size="sm" 
                  disabled={isOutlining || !loadedFileName || !machinePosition}
                  onClick={handleOutline}
                >
                  {isOutlining ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" /> {t('Tracing...')}
                    </>
                  ) : (
                    <>
                      <Circle className="w-4 h-4 mr-1" /> {t('Outline')}
                    </>
                  )}
                </Button>
              </div>
            )}
            {/* Error message */}
            {outlineError && (
              <div className="text-xs text-destructive mt-1">
                {outlineError}
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-1">
            {t('No file loaded')}
          </div>
        )}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        <div className="text-xs font-medium text-muted-foreground mb-2 px-1">
          {t('Files ({{count}})', { count: files.length })}
        </div>
        <OverlayScrollbarsComponent 
          className="max-h-[400px]"
          options={{ 
            scrollbars: { autoHide: 'scroll', autoHideDelay: 400 },
            overflow: { x: 'hidden', y: 'scroll' }
          }}
        >
          <div className="space-y-1 pr-2">
            {isLoadingFiles ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin" />
                {t('Loading files...')}
              </div>
            ) : files.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                {t('No files uploaded yet')}
              </div>
            ) : (
              files.map((file) => {
                const isLoaded = loadedFileName === file.filename
                return (
                  <div
                    key={file.filename}
                    className={`
                      rounded border p-2 text-sm cursor-pointer transition-colors
                      ${isLoaded 
                        ? 'border-primary bg-primary/10' 
                        : 'border-border hover:border-border-foreground/20'
                      }
                    `}
                    onClick={() => handleLoadFile(file.filename)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <FileCode className="w-4 h-4 text-primary flex-shrink-0" />
                          <span className="font-medium truncate">{file.filename}</span>
                          {isLoaded && (
                            <span className="text-xs text-primary font-medium">{t('Loaded')}</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <div>
                            {t('{{count}} lines', { count: file.lines })}
                            {file.tools.length > 0 && (
                              <> • {t('Tools:')} T{file.tools.join(', T')}</>
                            )}
                          </div>
                          <div className="flex items-center justify-between">
                            <span>{formatFileSize(file.size)}</span>
                            <span>{formatDate(file.mtime)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </OverlayScrollbarsComponent>
      </div>

      <PlotterImportDialog
        open={importOpen}
        kind={pendingImport?.kind ?? 'dxf'}
        plotterEnabled={plotterCfg.enabled}
        speed={importSpeed}
        widthMm={importWidth}
        mode={importMode}
        onSpeed={setImportSpeed}
        onWidth={setImportWidth}
        onMode={setImportMode}
        onOpenChange={(open) => {
          setImportOpen(open)
          if (!open) setPendingImport(null)
        }}
        onConfirm={handleImportConfirm}
      />

      <ConfirmationDialog
        open={showApplyPlotter}
        onOpenChange={setShowApplyPlotter}
        title={tr('Plotter', 'Плоттер')}
        description={tr(
          'Rebuild the loaded toolpath for the drag knife? Blade offset ' + num(plotterCfg.bladeOffsetMm) + ' mm. Do not run this twice on the same file.',
          'Перестроить загруженную траекторию под нож? Смещение лезвия ' + num(plotterCfg.bladeOffsetMm) + ' мм. Не запускайте это дважды для одного и того же файла.',
        )}
        confirmLabel={tr('Apply', 'Применить')}
        cancelLabel={tr('Cancel', 'Отмена')}
        onConfirm={performApplyPlotter}
      />

      {/* Outline confirmation dialog */}
      <ConfirmationDialog
        open={showOutlineConfirm}
        onOpenChange={setShowOutlineConfirm}
        title={t('Confirm Outline Tracing')}
        description={
          <>
            <p className="mb-2">
              {t('The tool will trace the outline of the loaded G-code at Z=-5 (machine coordinates).')}
            </p>
            <p className="font-medium">
              {t('Please ensure nothing is in the way of the tool path. The spindle will remain off during the outline.')}
            </p>
          </>
        }
        confirmLabel={t('Start Outline')}
        cancelLabel={t('Cancel')}
        onConfirm={performOutline}
      />
    </div>
  )
}
