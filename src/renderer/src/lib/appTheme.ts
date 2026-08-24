export type AppTheme = 'dark' | 'light'

export function applyAppTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}
