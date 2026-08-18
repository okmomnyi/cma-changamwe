'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { LoadingState } from '@/components/ui';
export default function Home() {
    const { user, loading } = useAuth();
    const router = useRouter();
    useEffect(() => {
        if (loading)
            return;
        router.replace(user ? '/portal' : '/sign-in');
    }, [user, loading, router]);
    return (<main id="main">
      <LoadingState label="Checking your session"/>
    </main>);
}
