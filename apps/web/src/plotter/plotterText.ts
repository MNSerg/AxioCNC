/** Labels from LaserGRBL PlotterSettingsForm. Russian when the UI language is ru. */
export function plotterText(language: string | undefined, english: string, russian: string): string {
  const lang = (language || 'en').toLowerCase()
  if (lang === 'ru' || lang.startsWith('ru-')) return russian
  return english
}
