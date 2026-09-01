/**
 * Light, dark, or whatever the device says.
 *
 * Three states rather than two. "System" is the default and is not a stored
 * value: it is the absence of one, so a member who never touches the control
 * follows their phone when it switches at dusk.
 */
export type Theme = 'light' | 'dark' | 'system';

export const THEME_KEY = 'cma-theme';

/**
 * Inlined at the top of the document and run before anything paints. Doing this
 * in React would be one frame too late: the page would paint light, then flip.
 * Wrapped in try/catch because a browser set to block site data throws on read.
 */
export const THEME_BOOTSTRAP =
    `(function(){try{var t=localStorage.getItem('${THEME_KEY}');`
    + `if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}})()`;

export type ResolvedTheme = 'light' | 'dark';

/**
 * The theme actually on screen, which is what a two-state control has to know.
 *
 * "System" is a stored preference, not a colour: to decide whether the toggle
 * should offer the moon or the sun it has to be resolved against what the
 * device is currently saying.
 */
export function resolvedTheme(): ResolvedTheme {
    const stored = readTheme();
    if (stored !== 'system') return stored;
    try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    catch {
        return 'light';
    }
}

export function readTheme(): Theme {
    try {
        const stored = localStorage.getItem(THEME_KEY);
        if (stored === 'light' || stored === 'dark') return stored;
    }
    catch { /* storage blocked; fall through to system */ }
    return 'system';
}

export function applyTheme(theme: Theme): void {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;

    try {
        if (theme === 'system') localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, theme);
    }
    catch { /* the choice still applies for this page */ }
}
