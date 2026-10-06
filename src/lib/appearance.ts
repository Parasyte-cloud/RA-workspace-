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
  | 'high'

export type WorkstationSize =
  | 'compact'
  | 'balanced'
  | 'expanded'
  | 'maximized'

export type AppearancePreferences = {
  theme: ThemeMode
  workspace: WorkspaceAppearance
  glow: GlowStrength
  size: WorkstationSize
}

export const APPEARANCE_STORAGE_KEY =
  'ridearrivo-workspace-appearance'

// Bump when the default lighting changes so existing users get the
// new always-on ambiance once. Their later choices are kept.
const APPEARANCE_VERSION = 2

export const defaultAppearance: AppearancePreferences = {
  theme: 'light',
  workspace: 'ambient',
  glow: 'medium',
  size: 'balanced'
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
  'medium',
  'high'
]

const workstationSizes: WorkstationSize[] = [
  'compact',
  'balanced',
  'expanded',
  'maximized'
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
      JSON.parse(raw) as Partial<AppearancePreferences> & {
        v?: number
      }

    if ((parsed.v ?? 1) < APPEARANCE_VERSION) {
      parsed.glow = defaultAppearance.glow
      parsed.workspace =
        parsed.workspace === 'clean'
          ? defaultAppearance.workspace
          : parsed.workspace
    }

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
          : defaultAppearance.glow,
      size:
        parsed.size &&
        workstationSizes.includes(parsed.size)
          ? parsed.size
          : defaultAppearance.size
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

  root.dataset.raSize =
    preferences.size

  root.style.colorScheme =
    preferences.theme
}

export function saveAppearance(
  preferences: AppearancePreferences
) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ ...preferences, v: APPEARANCE_VERSION })
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
