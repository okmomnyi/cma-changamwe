'use client';

import { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import styles from './MemberPhoto.module.css';
export function MemberPhoto({ url, alt, size = 'medium' }: {
    url: string;
    alt: string;
    size?: 'small' | 'medium';
}) {
    const [src, setSrc] = useState<string | null>(null);
    const [state, setState] = useState<'loading' | 'ready' | 'none'>('loading');
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const signed = await api<{
                    url: string;
                }>(url);
                if (cancelled)
                    return;
                setSrc(signed.url);
                setState('ready');
            }
            catch {
                if (!cancelled)
                    setState('none');
            }
        })();
        return () => { cancelled = true; };
    }, [url]);
    return (<div className={`${styles.frame} ${styles[size]}`}>
      {state === 'ready' && src ? (<img src={src} alt={alt} className={styles.image} onError={() => setState('none')}/>) : (<span className={styles.placeholder}>
          <UserRound size={size === 'small' ? 20 : 30} aria-hidden="true"/>
          <span className="srOnly">
            {state === 'loading' ? 'Loading photograph' : 'No photograph on file'}
          </span>
        </span>)}
    </div>);
}
