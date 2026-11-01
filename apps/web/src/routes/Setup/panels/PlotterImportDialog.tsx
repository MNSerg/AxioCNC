import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { plotterText } from '@/plotter/plotterText'

export type PlotterImportKind = 'dxf' | 'svg' | 'image'
export type PlotterImageMode = 'vectorize' | 'centerline'

interface PlotterImportDialogProps {
  open: boolean
  kind: PlotterImportKind
  plotterEnabled: boolean
  speed: number
  widthMm: number
  mode: PlotterImageMode
  onSpeed: (value: number) => void
  onWidth: (value: number) => void
  onMode: (value: PlotterImageMode) => void
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function PlotterImportDialog({
  open,
  kind,
  plotterEnabled,
  speed,
  widthMm,
  mode,
  onSpeed,
  onWidth,
  onMode,
  onOpenChange,
  onConfirm,
}: PlotterImportDialogProps) {
  const { i18n } = useTranslation()
  const tr = (english: string, russian: string) => plotterText(i18n.language, english, russian)
  const title = kind === 'svg' && plotterEnabled
    ? tr('SVG to plotter', 'SVG в программу плоттера')
    : kind === 'image' && plotterEnabled
      ? tr('Plotter size and speed', 'Плоттер: размер и скорость')
      : tr('Cut speed', 'Скорость реза')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {kind === 'image' && (
            <div className="space-y-2">
              <RadioGroup value={mode} onValueChange={(value) => onMode(value as PlotterImageMode)}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="vectorize" id="plotter-vectorize" />
                  <Label htmlFor="plotter-vectorize">{tr('Vectorize — contours and holes', 'Векторизация — контуры и отверстия')}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="centerline" id="plotter-centerline" />
                  <Label htmlFor="plotter-centerline">{tr('Centerline — strokes', 'Центральная линия — штрихи')}</Label>
                </div>
              </RadioGroup>
              {plotterEnabled && (
                <p className="text-sm text-muted-foreground">
                  {tr('Plotter mode cuts vectors. Hatch and raster fill are not built.', 'Режим плоттера режет векторы. Штриховка и растровая заливка не строятся.')}
                </p>
              )}
              <Label htmlFor="plotter-width">{tr('Width, mm', 'Ширина, мм')}</Label>
              <Input
                id="plotter-width"
                type="number"
                min={1}
                max={5000}
                step={1}
                value={widthMm}
                onChange={(e) => {
                  const n = Number.parseFloat(e.target.value)
                  if (Number.isFinite(n)) onWidth(n)
                }}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="plotter-speed">{tr('Cut speed', 'Скорость реза')}</Label>
            <Input
              id="plotter-speed"
              type="number"
              min={1}
              max={50000}
              step={50}
              value={speed}
              onChange={(e) => {
                const n = Number.parseFloat(e.target.value)
                if (Number.isFinite(n)) onSpeed(n)
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tr('Cancel', 'Отмена')}</Button>
          <Button onClick={onConfirm}>{tr('Create', 'Создать')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
