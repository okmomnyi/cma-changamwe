'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { applyTheme, readTheme, type Theme } from '@/lib/theme';
import styles from './ThemeToggle.module.css';

const OPTIONS: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'system', label: 'Match device', icon: Monitor },
    { value: 'dark', label: 'Dark', icon: Moon },
];

/**
 * The server cannot know what is in the reader's storage, so the first render
 * always shows "Match device" and an effect corrects it after hydration. The
 * colours themselves are already right by then: the bootstrap script stamped
 * the root element before anything painted.
 */
export function ThemeToggle({ onDark = false }: { onDark?: boolean }) {
    const [theme, setTheme] = useState<Theme>('system');

    useEffect(() => { setTheme(readTheme()); }, []);

    function choose(next: Theme) {
        setTheme(next);
        applyTheme(next);
    }

    return (
        <div
            className={`${styles.group} ${onDark ? styles.onDark : ''}`}
            role="radiogroup"
            aria-label="Colour theme"
        >
            {OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={theme === value}
                    className={`${styles.option} ${theme === value ? styles.selected : ''}`}
                    onClick={() => choose(value)}
                    title={label}
                >
                    <Icon size={15} aria-hidden="true" />
                    <span className="srOnly">{label}</span>
                </button>
            ))}
        </div>
    );
}
