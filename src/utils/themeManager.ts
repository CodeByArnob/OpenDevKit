export type ThemeMode = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'offlinekit_theme';
export const REDUCED_MOTION_STORAGE_KEY = 'offlinekit_reduced_motion';
export const APP_VERSION = '1.0.0';

export const DEVELOPER_PROFILE = {
  name: 'ArnobRazz',
  githubProfileUrl: 'https://github.com/arnob123/',
  repositoryUrl: 'https://github.com/arnob123/OpenDevKit',
  license: 'MIT License · Copyright (c) 2026 Gameofbtc (ArnobRazz)',
} as const;

export function resolveInitialTheme(
  storage?: Pick<Storage, 'getItem'> | null,
  prefersLightQuery?: boolean
): ThemeMode {
  try {
    const saved = storage?.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // ignore storage read restrictions
  }
  if (prefersLightQuery === true) {
    return 'light';
  }
  return 'dark';
}

export function persistThemeSelection(
  theme: ThemeMode,
  storage?: Pick<Storage, 'setItem'> | null
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore storage write restrictions
  }
}
