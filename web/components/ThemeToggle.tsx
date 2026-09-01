'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { applyTheme, readTheme, resolvedTheme, type ResolvedTheme } from '@/lib/theme';
import styles from './ThemeToggle.module.css';

/**
 * One button, two states: the moon offers dark, the sun offers light.
 *
 * "System" is still the default and is still the absence of a stored value, so
 * a member who never touches this follows their phone when it switches at
 * dusk. What went is the third button for choosing it back, which cost a third
 * of the control's width to say something most people never need to say. The
 * first tap commits to a colour; clearing that is a matter of clearing site
 * data, which is where every other stored preference lives too.
 *
 * The server cannot know what is in the reader's storage, so the first render
 * assumes light and an effect corrects it. The colours themselves are already
 * right by then: the bootstrap script stamped the root element before anything
 * painted, and only this icon has to catch up.
 */
export function ThemeToggle({ onDark = false }: { onDark?: boolean }) {
    const [theme, setTheme] = useState<ResolvedTheme>('light');

    useEffect(() => {
        setTheme(resolvedTheme());

        // While the choice is still "system", the device can change it under us.
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const follow = () => {
            if (readTheme() === 'system') setTheme(resolvedTheme());
        };
        media.addEventListener('change', follow);
        return () => media.removeEventListener('change', follow);
    }, []);

    const next: ResolvedTheme = theme === 'dark' ? 'light' : 'dark';
    const label = next === 'dark' ? 'Switch to dark colours' : 'Switch to light colours';
    const Icon = next === 'dark' ? Moon : Sun;

    return (
        <button
            type="button"
            className={`${styles.toggle} ${onDark ? styles.onDark : ''}`}
            onClick={() => { setTheme(next); applyTheme(next); }}
            aria-label={label}
            title={label}
        >
            <Icon size={16} aria-hidden="true" />
        </button>
    );
}
