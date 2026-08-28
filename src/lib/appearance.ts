export type ThemeMode =
  | 'light'
  | 'dark'

export type WorkspaceAppearance =
  | 'clean'
  | 'ambient'
  | 'deep'

export type GlowStrength =
  | 'off'
  | 'subtle'
  | 'medium'

export type AppearancePreferences = {
  theme: ThemeMode
  workspace: WorkspaceAppearance
  glow: GlowStrength
}

export const APPEARANCE_STORAGE_KEY =
  'ridearrivo-workspace-appearance'

export const defaultAppearance: AppearancePreferences = {
  theme: 'light',
  workspace: 'ambient',
  glow: 'subtle'
}

const themes: ThemeMode[] = [
  'light',
  'dark'
]

const workspaces: WorkspaceAppearance[] = [
  'clean',
  'ambient',
  'deep'
]

const glows: GlowStrength[] = [
  'off',
  'subtle',
  'medium'
]

export function readAppearance(): AppearancePreferences {
  if (typeof window === 'undefined') {
    return defaultAppearance
  }

  try {
    const raw =
      window.localStorage.getItem(
        APPEARANCE_STORAGE_KEY
      )

    if (!raw) {
      return defaultAppearance
    }

    const parsed =
      JSON.parse(raw) as Partial<AppearancePreferences>

    return {
      theme:
        parsed.theme &&
        themes.includes(parsed.theme)
          ? parsed.theme
          : defaultAppearance.theme,

      workspace:
        parsed.workspace &&
        workspaces.includes(parsed.workspace)
          ? parsed.workspace
          : defaultAppearance.workspace,

      glow:
        parsed.glow &&
        glows.includes(parsed.glow)
          ? parsed.glow
          : defaultAppearance.glow
    }
  } catch {
    return defaultAppearance
  }
}

export function applyAppearance(
  preferences: AppearancePreferences
) {
  if (typeof document === 'undefined') {
    return
  }

  const root = document.documentElement

  root.dataset.raTheme =
    preferences.theme

  root.dataset.raWorkspace =
    preferences.workspace

  root.dataset.raGlow =
    preferences.glow

  root.style.colorScheme =
    preferences.theme
}

export function saveAppearance(
  preferences: AppearancePreferences
) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify(preferences)
    )
  }

  applyAppearance(preferences)

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(
        'ridearrivo:appearance',
        {
          detail: preferences
        }
      )
    )
  }
}

export function applyStoredAppearance() {
  const preferences = readAppearance()

  applyAppearance(preferences)

  return preferences
}
