import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsSection } from '../SettingsSection'
import { SettingsField } from '../SettingsField'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useGetSettingsQuery, useSetSettingsMutation } from '@/services/api'
import {
  applyPreset,
  cloneConfig,
  configFromStored,
  toStored,
  type PlotterConfig,
} from '@/plotter/PlotterConfig'
import { BladePreset, PenMode } from '@/plotter/types'
import { plotterText } from '@/plotter/plotterText'

export function PlotterSection() {
  const { i18n } = useTranslation()
  const tr = (english: string, russian: string) => plotterText(i18n.language, english, russian)
  const { data: settings } = useGetSettingsQuery()
  const [setSettings] = useSetSettingsMutation()
  const [cfg, setCfg] = useState<PlotterConfig | null>(null)
  const dirty = useRef(false)
  const seen = useRef('')

  useEffect(() => {
    if (!settings?.plotter || dirty.current) return
    const loaded = configFromStored(settings.plotter)
    const serial = JSON.stringify(toStored(loaded.cfg))
    if (serial === seen.current) return
    seen.current = serial
    setCfg(loaded.cfg)
    if (loaded.migrated) {
      dirty.current = true
      setSettings({ plotter: toStored(loaded.cfg) })
        .unwrap()
        .catch(() => undefined)
        .finally(() => {
          dirty.current = false
        })
    }
  }, [settings, setSettings])

  const commit = (next: PlotterConfig) => {
    const stored = toStored(next)
    seen.current = JSON.stringify(stored)
    dirty.current = true
    setCfg(stored)
    setSettings({ plotter: stored })
      .unwrap()
      .catch(() => undefined)
      .finally(() => {
        dirty.current = false
      })
  }

  if (!cfg) return null

  const manual = cfg.penMode === PenMode.Manual

  const setNumber = (key: keyof PlotterConfig, raw: string, markCustom: boolean) => {
    const value = Number.parseFloat(raw)
    if (!Number.isFinite(value)) return
    const next = cloneConfig(cfg)
    ;(next as unknown as Record<string, number>)[key] = value
    if (markCustom) next.preset = BladePreset.Custom
    commit(next)
  }

  return (
    <SettingsSection
      id="plotter"
      title={tr('Plotter / drag knife', 'Плоттер / нож с пассивным поворотом')}
      description={tr(
        'Aim the positioning laser at the bottom-left corner of the sheet and zero XY. The laser sits to the right of the blade (default 10 mm, Y unchanged). The job moves the blade 20 mm outside that corner, to the left and toward you, then travels into the first contour. Every XY move is G1. A gentle turn follows the curve; a sharp corner swings the holder around the tip.',
        'Наведите позиционный лазер на левый нижний угол листа и обнулите XY. Лазер правее лезвия (по умолчанию 10 мм, по Y без смещения). Программа сначала уводит лезвие на 20 мм за этот угол — влево и на себя — и только потом едет к первому контуру и врезается в лист. Любое движение X Y — это G1. Плавный поворот идёт по кривой, острый — дугой держателя вокруг острия.',
      )}
    >
      <SettingsField label={tr('Plotter mode when importing images, SVG and DXF', 'Режим плоттера при импорте изображений, SVG и DXF')} horizontal>
        <Switch checked={cfg.enabled} onCheckedChange={(checked) => commit({ ...cfg, enabled: checked })} />
      </SettingsField>

      <SettingsField label={tr('Blade preset', 'Пресет лезвия')}>
        <Select
          value={cfg.preset}
          onValueChange={(value) => {
            const preset = value as BladePreset
            if (preset === BladePreset.Custom) {
              commit({ ...cfg, preset })
              return
            }
            const next = cloneConfig(cfg)
            applyPreset(next, preset)
            commit(next)
          }}
        >
          <SelectTrigger className="w-full max-w-md">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={BladePreset.Rubber}>{tr('Rubber blade 3.60 mm', 'Резина, лезвие 3,60 мм')}</SelectItem>
            <SelectItem value={BladePreset.Pen}>{tr('Pen (no offset)', 'Перо (без смещения)')}</SelectItem>
            <SelectItem value={BladePreset.VinylFine}>{tr('Vinyl blade 0.25 mm', 'Винил 0.25 мм')}</SelectItem>
            <SelectItem value={BladePreset.Craft}>{tr('Craft blade 0.50 mm', 'Канцелярское 0.50 мм')}</SelectItem>
            <SelectItem value={BladePreset.Deep}>{tr('Deep blade 0.75 mm', 'Глубокое 0.75 мм')}</SelectItem>
            <SelectItem value={BladePreset.Custom}>{tr('Custom', 'Своё')}</SelectItem>
          </SelectContent>
        </Select>
      </SettingsField>

      <SettingsField label={tr('Blade name', 'Имя лезвия')}>
        <Input
          value={cfg.bladeName}
          className="max-w-md"
          onChange={(e) => {
            dirty.current = true
            setCfg({ ...cfg, bladeName: e.target.value })
          }}
          onBlur={(e) => commit({ ...cfg, bladeName: e.target.value })}
        />
      </SettingsField>

      <Num label={tr('Blade offset, mm', 'Смещение лезвия, мм')} value={cfg.bladeOffsetMm} min={0} max={20} step={0.05} onChange={(v) => setNumber('bladeOffsetMm', v, true)} />
      <Num label={tr('Overcut, mm', 'Перерез (overcut), мм')} value={cfg.overcutMm} min={0} max={50} step={0.1} onChange={(v) => setNumber('overcutMm', v, true)} />
      <Num label={tr('Lead-in, mm', 'Заход для разворота, мм')} value={cfg.leadInMm} min={0} max={50} step={0.1} onChange={(v) => setNumber('leadInMm', v, true)} />
      <Num label={tr('Sharp corner from, deg', 'Острый угол от, град')} value={cfg.cornerThresholdDeg} min={0} max={180} step={1} onChange={(v) => setNumber('cornerThresholdDeg', v, false)} />
      <Num label={tr('Lift knife above, deg (0 = never)', 'Поднимать нож свыше, град (0 = никогда)')} value={cfg.liftAngleDeg} min={0} max={180} step={1} disabled={manual} onChange={(v) => setNumber('liftAngleDeg', v, false)} />
      <Num label={tr('Simplify tolerance, mm', 'Упрощение пути, мм')} value={cfg.simplifyMm} min={0} max={5} step={0.01} onChange={(v) => setNumber('simplifyMm', v, false)} />
      <Num label={tr('Minimum segment, mm', 'Мин. отрезок, мм')} value={cfg.minSegmentMm} min={0} max={5} step={0.01} onChange={(v) => setNumber('minSegmentMm', v, false)} />
      <Num label={tr('Passes', 'Проходы')} value={cfg.passes} min={1} max={30} step={1} onChange={(v) => setNumber('passes', v, false)} />
      <Num label={tr('Start margin outside the drawing, mm', 'Отступ снаружи габарита, мм')} value={cfg.startMarginMm} min={0} max={500} step={1} onChange={(v) => setNumber('startMarginMm', v, false)} />
      <Num label={tr('Positioning laser offset X, mm', 'Смещение позиционного лазера X, мм')} value={cfg.laserOffsetX} min={-500} max={500} step={1} onChange={(v) => setNumber('laserOffsetX', v, false)} />
      <Num label={tr('Positioning laser offset Y, mm', 'Смещение позиционного лазера Y, мм')} value={cfg.laserOffsetY} min={-500} max={500} step={1} onChange={(v) => setNumber('laserOffsetY', v, false)} />
      <Num label={tr('Cut speed, mm/min', 'Скорость реза, мм/мин')} value={cfg.cutSpeed} min={1} max={50000} step={50} onChange={(v) => setNumber('cutSpeed', v, false)} />
      <Num label={tr('Travel speed, mm/min (0 = cut speed, no G0 while the knife stays down)', 'Переезд, мм/мин (0 = скорость реза; нож не поднимается)')} value={cfg.travelSpeed} min={0} max={50000} step={50} onChange={(v) => setNumber('travelSpeed', v, false)} />
      <Num label={tr('Plunge speed, mm/min', 'Скорость опускания, мм/мин')} value={cfg.plungeSpeed} min={1} max={50000} step={50} disabled={manual} onChange={(v) => setNumber('plungeSpeed', v, false)} />
      <Num label={tr('Dwell after down, ms', 'Пауза после опускания, мс')} value={cfg.dwellDownMs} min={0} max={5000} step={10} disabled={manual} onChange={(v) => setNumber('dwellDownMs', v, false)} />
      <Num label={tr('Dwell after up, ms', 'Пауза после подъёма, мс')} value={cfg.dwellUpMs} min={0} max={5000} step={10} disabled={manual} onChange={(v) => setNumber('dwellUpMs', v, false)} />

      <SettingsField label={tr('Knife up / down', 'Подъём / опускание ножа')}>
        <Select value={cfg.penMode} onValueChange={(value) => commit({ ...cfg, penMode: value as PenMode })}>
          <SelectTrigger className="w-full max-w-md">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PenMode.Manual}>{tr('Manual height, XY only', 'Высота вручную, только X и Y')}</SelectItem>
            <SelectItem value={PenMode.ServoPwm}>{tr('Servo on laser PWM (M3 S)', 'Серво на ШИМ лазера (M3 S)')}</SelectItem>
            <SelectItem value={PenMode.Digital}>{tr('Solenoid M3 down / M5 up', 'Соленоид M3 вниз / M5 вверх')}</SelectItem>
            <SelectItem value={PenMode.ZAxis}>{tr('Z axis', 'Ось Z')}</SelectItem>
          </SelectContent>
        </Select>
      </SettingsField>

      <Num label={tr('S value, knife up', 'Значение S, нож вверх')} value={cfg.servoUp} min={0} max={100000} step={1} disabled={manual} onChange={(v) => setNumber('servoUp', v, false)} />
      <Num label={tr('S value, knife down', 'Значение S, нож вниз')} value={cfg.servoDown} min={0} max={100000} step={1} disabled={manual} onChange={(v) => setNumber('servoDown', v, false)} />
      <Num label={tr('Z up, mm', 'Z вверх, мм')} value={cfg.penUpZ} min={-50} max={200} step={0.1} disabled={manual} onChange={(v) => setNumber('penUpZ', v, false)} />
      <Num label={tr('Z down, mm', 'Z вниз, мм')} value={cfg.penDownZ} min={-50} max={200} step={0.1} disabled={manual} onChange={(v) => setNumber('penDownZ', v, false)} />

      <SettingsField label={tr('Sort contours (short travels, small swivels)', 'Сортировать контуры (короче переезды, меньше разворотов)')} horizontal>
        <Switch checked={cfg.optimizeOrder} onCheckedChange={(checked) => commit({ ...cfg, optimizeOrder: checked })} />
      </SettingsField>
      <SettingsField label={tr('Cut holes first when the knife can reach them', 'Сначала отверстия, если к ним можно подойти')} horizontal>
        <Switch checked={cfg.insideFirst} onCheckedChange={(checked) => commit({ ...cfg, insideFirst: checked })} />
      </SettingsField>
      <SettingsField label={tr('Replace corner arcs with short lines', 'Заменять дуги поворота короткими отрезками')} horizontal>
        <Switch checked={cfg.linearizeArcs} onCheckedChange={(checked) => commit({ ...cfg, linearizeArcs: checked })} />
      </SettingsField>
    </SettingsSection>
  )
}

function Num({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled?: boolean
  onChange: (raw: string) => void
}) {
  return (
    <SettingsField label={label}>
      <Input
        type="number"
        className="max-w-[160px]"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </SettingsField>
  )
}
