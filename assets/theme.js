// ABOUTME: Theme selection for the CADScope UI: dark default with a light override.
// ABOUTME: Resolves and persists the choice, applies data-theme on <html>, emits themechange.

// Maps a stored preference to a theme name; anything unrecognized is dark.
export function resolveTheme(value) {
  return value === 'light' ? 'light' : 'dark';
}

export function nextTheme(theme) {
  return theme === 'dark' ? 'light' : 'dark';
}
