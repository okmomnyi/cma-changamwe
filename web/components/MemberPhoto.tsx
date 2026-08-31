'use client';

import { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import styles from './MemberPhoto.module.css';

export type PhotoSize = 'small' | 'medium' | 'avatar' | 'avatarLg';

/**
 * The photograph a member submits with their biodata, shown wherever they are
 * identified: the passport frame on the biodata form, and the round crop that
 * stands in for them in the portal.
 *
 * The link from R2 is signed and short-lived, so a portal left open past its
 * expiry gets a broken image. One silent re-request covers that; a second
 * failure means there is genuinely no photograph and the initials frame stands.
 */
export function MemberPhoto({ url, alt, size = 'medium' }: {
    url: string;
    alt: string;
    size?: PhotoSize;
}) {
    const [src, setSrc] = useState<string | null>(null);
    const [state, setState] = useState<'loading' | 'ready' | 'none'>('loading');
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const signed = await api<{ url: string }>(url);
                if (cancelled) return;
                setSrc(signed.url);
                setState('ready');
            }
            catch {
                if (!cancelled) setState('none');
            }
        })();
        return () => { cancelled = true; };
    }, [url, attempt]);

    function handleError() {
        if (attempt === 0) {
            setState('loading');
            setAttempt(1);
            return;
        }
        setState('none');
    }

    const iconSize = size === 'avatar' ? 16 : size === 'small' || size === 'avatarLg' ? 20 : 30;

    return (
        <div className={`${styles.frame} ${styles[size]}`}>
            {state === 'ready' && src ? (
                <img src={src} alt={alt} className={styles.image} onError={handleError}/>
            ) : (
                <span className={styles.placeholder}>
                    <UserRound size={iconSize} aria-hidden="true"/>
                    <span className="srOnly">
                        {state === 'loading' ? 'Loading photograph' : 'No photograph on file'}
                    </span>
                </span>
            )}
        </div>
    );
}
