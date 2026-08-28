import { useState } from 'react'

import {
  defaultAppearance,
  readAppearance,
  saveAppearance
} from '../lib/appearance'

import type {
  AppearancePreferences,
  GlowStrength,
  ThemeMode,
  WorkspaceAppearance,
  WorkstationSize
} from '../lib/appearance'

export function AppearanceSettings() {
  const [preferences, setPreferences] =
    useState<AppearancePreferences>(
      () => readAppearance()
    )

  const apply = (
    next: AppearancePreferences
  ) => {
    setPreferences(next)
    saveAppearance(next)
  }

  const setTheme = (
    theme: ThemeMode
  ) => {
    apply({
      ...preferences,
      theme
    })
  }

  const setWorkspace = (
    workspace: WorkspaceAppearance
  ) => {
    apply({
      ...preferences,
      workspace
    })
  }

  const setGlow = (
    glow: GlowStrength
  ) => {
    apply({
      ...preferences,
      glow
    })
  }

  const setSize = (
    size: WorkstationSize
  ) => {
    apply({
      ...preferences,
      size
    })
  }

  const reset = () => {
    apply({
      ...defaultAppearance
    })
  }

  return (
    <section className="appearanceSettings">
      <div className="appearanceHeading">
        <div>
          <span className="eyebrow">
            PERSONAL WORKSPACE
          </span>

          <h2>
            Appearance
          </h2>

          <p>
            Personalise the RideArrivo workspace,
            application theme and surrounding
            workstation environment.
          </p>
        </div>

        <button
          type="button"
          className="glassButton"
          onClick={reset}
        >
          Reset appearance
        </button>
      </div>

      <div className="appearancePreview">
        <div className="appearancePreviewGlow">
          <div className="appearancePreviewShell">
            <div className="appearancePreviewSidebar">
              <span />
              <span />
              <span />
            </div>

            <div className="appearancePreviewContent">
              <div className="appearancePreviewTopbar" />

              <div className="appearancePreviewCard">
                <strong>
                  RideArrivo Workspace
                </strong>

                <small>
                  Live appearance preview
                </small>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="appearanceSettingsGrid">
        <article className="appearanceSettingCard">
          <div className="appearanceSettingCopy">
            <span className="appearanceSettingNumber">
              01
            </span>

            <div>
              <h3>
                Theme
              </h3>

              <p>
                Choose the visual theme used across
                the application.
              </p>
            </div>
          </div>

          <div className="appearanceChoices">
            <button
              type="button"
              className={
                preferences.theme === 'light'
                  ? 'appearanceChoice active'
                  : 'appearanceChoice'
              }
              aria-pressed={
                preferences.theme === 'light'
              }
              onClick={() => setTheme('light')}
            >
              <span className="themeSwatch lightSwatch" />
              <strong>Light</strong>
              <small>Bright workspace</small>
            </button>

            <button
              type="button"
              className={
                preferences.theme === 'dark'
                  ? 'appearanceChoice active'
                  : 'appearanceChoice'
              }
              aria-pressed={
                preferences.theme === 'dark'
              }
              onClick={() => setTheme('dark')}
            >
              <span className="themeSwatch darkSwatch" />
              <strong>Dark</strong>
              <small>Low-light workspace</small>
            </button>
          </div>
        </article>

        <article className="appearanceSettingCard">
          <div className="appearanceSettingCopy">
            <span className="appearanceSettingNumber">
              02
            </span>

            <div>
              <h3>
                Workspace environment
              </h3>

              <p>
                Control the environment surrounding
                the application frame.
              </p>
            </div>
          </div>

          <div className="appearanceChoices three">
            {(
              [
                ['clean', 'Clean', 'Minimal background'],
                ['ambient', 'Ambient', 'Soft branded lighting'],
                ['deep', 'Deep', 'Rich workstation depth']
              ] as const
            ).map(
              ([value, label, note]) => (
                <button
                  key={value}
                  type="button"
                  className={
                    preferences.workspace === value
                      ? 'appearanceChoice active'
                      : 'appearanceChoice'
                  }
                  aria-pressed={
                    preferences.workspace === value
                  }
                  onClick={() =>
                    setWorkspace(value)
                  }
                >
                  <span
                    className={
                      `workspaceSwatch ${value}`
                    }
                  />
                  <strong>
                    {label}
                  </strong>
                  <small>
                    {note}
                  </small>
                </button>
              )
            )}
          </div>
        </article>

                <article className="appearanceSettingCard">
          <div className="appearanceSettingCopy">
            <span className="appearanceSettingNumber">
              03
            </span>
            <div>
              <h3>
                Workstation size
              </h3>
              <p>
                Choose how much of the display the
                workstation should occupy.
              </p>
            </div>
          </div>

          <div className="appearanceChoices four">
            {(
              [
                [
                  'compact',
                  'Compact',
                  'More surrounding workspace'
                ],
                [
                  'balanced',
                  'Balanced',
                  'Recommended everyday size'
                ],
                [
                  'expanded',
                  'Expanded',
                  'Large working area'
                ],
                [
                  'maximized',
                  'Maximized',
                  'Use almost the entire display'
                ]
              ] as const
            ).map(
              ([value, label, note]) => (
                <button
                  key={value}
                  type="button"
                  className={
                    preferences.size === value
                      ? 'appearanceChoice active'
                      : 'appearanceChoice'
                  }
                  aria-pressed={
                    preferences.size === value
                  }
                  onClick={() =>
                    setSize(value)
                  }
                >
                  <span
                    className={
                      `sizeSwatch ${value}`
                    }
                  />
                  <strong>
                    {label}
                  </strong>
                  <small>
                    {note}
                  </small>
                </button>
              )
            )}
          </div>
        </article>

<article className="appearanceSettingCard">
          <div className="appearanceSettingCopy">
            <span className="appearanceSettingNumber">
              04
            </span>

            <div>
              <h3>
                Outer ring-light
              </h3>

              <p>
                Adjust the subtle amber and blue
                glow surrounding the workstation.
              </p>
            </div>
          </div>

          <div className="appearanceChoices four">
            {(
              [
                ['off', 'Off', 'No outer glow'],
                ['subtle', 'Subtle', 'Premium soft edge'],
                ['medium', 'Medium', 'More visible aura'],
                ['high', 'High', 'Strong workstation halo']
              ] as const
            ).map(
              ([value, label, note]) => (
                <button
                  key={value}
                  type="button"
                  className={
                    preferences.glow === value
                      ? 'appearanceChoice active'
                      : 'appearanceChoice'
                  }
                  aria-pressed={
                    preferences.glow === value
                  }
                  onClick={() =>
                    setGlow(value)
                  }
                >
                  <span
                    className={
                      `glowSwatch ${value}`
                    }
                  />
                  <strong>
                    {label}
                  </strong>
                  <small>
                    {note}
                  </small>
                </button>
              )
            )}
          </div>
        </article>
      </div>
    </section>
  )
}
