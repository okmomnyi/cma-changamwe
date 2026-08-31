'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BookOpenCheck, CalendarDays, ClipboardList, Coins, Gauge, HandCoins, LogOut, Menu, ScrollText, ShieldCheck, Table2, User, Users, X, } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { officeLabel } from '@/lib/format';
import { LoadingState } from './ui';
import { MemberPhoto } from './MemberPhoto';
import { ThemeToggle } from './ThemeToggle';
import styles from './AppShell.module.css';
const MEMBER_NAV = [
    { href: '/portal', label: 'Overview', icon: Gauge },
    { href: '/portal/profile', label: 'My profile', icon: User },
    { href: '/portal/attendance', label: 'Attendance', icon: ClipboardList },
    { href: '/portal/matoleo', label: 'Matoleo', icon: Coins },
    { href: '/portal/matrix', label: 'Matrix score', icon: BookOpenCheck },
    { href: '/portal/welfare', label: 'Welfare', icon: HandCoins },
];
const ADMIN_NAV = [
    { href: '/admin', label: 'Overview', icon: Gauge },
    { href: '/admin/members', label: 'Members', icon: Users },
    { href: '/admin/events', label: 'Programme', icon: CalendarDays },
    { href: '/admin/contributions', label: 'Matoleo', icon: Coins },
    { href: '/admin/matrix', label: 'Matrix', icon: Table2 },
    { href: '/admin/welfare', label: 'Welfare', icon: HandCoins },
    { href: '/admin/offices', label: 'Offices', icon: ShieldCheck },
    { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
];
export function AppShell({ children }: {
    children: React.ReactNode;
}) {
    const { user, loading, signOut } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const [navOpen, setNavOpen] = useState(false);
    useEffect(() => {
        if (!loading && !user)
            router.replace('/sign-in');
    }, [user, loading, router]);
    useEffect(() => {
        setNavOpen(false);
    }, [pathname]);
    if (loading) {
        return <main id="main"><LoadingState label="Loading your portal"/></main>;
    }
    if (!user) {
        return <main id="main"><LoadingState label="Redirecting to sign in"/></main>;
    }
    const isAdminArea = pathname.startsWith('/admin');
    const nav = isAdminArea ? ADMIN_NAV : MEMBER_NAV;
    async function handleSignOut() {
        await signOut();
        router.replace('/sign-in');
    }
    return (<div className={styles.shell}>
      <button type="button" className={`btn btnGhost ${styles.navToggle}`} onClick={() => setNavOpen((open) => !open)} aria-expanded={navOpen} aria-controls="primary-navigation">
        {navOpen ? <X size={18} aria-hidden="true"/> : <Menu size={18} aria-hidden="true"/>}
        Menu
      </button>

      <aside id="primary-navigation" className={`${styles.sidebar} ${navOpen ? styles.sidebarOpen : ''}`}>
        <Link href={isAdminArea ? '/admin' : '/portal'} className={styles.brand}>
          <span className={styles.mark} aria-hidden="true"/>
          <span>
            <span className={styles.brandName}>CMA Changamwe</span>
            <span className={styles.brandSub}>{isAdminArea ? 'Administration' : 'Member portal'}</span>
          </span>
        </Link>

        <nav aria-label={isAdminArea ? 'Administration' : 'Member portal'}>
          <ul className={styles.navList}>
            {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/portal' && href !== '/admin' && pathname.startsWith(href));
            return (<li key={href}>
                  <Link href={href} className={`${styles.navLink} ${active ? styles.navLinkActive : ''}`} aria-current={active ? 'page' : undefined}>
                    <Icon size={16} aria-hidden="true"/>
                    {label}
                  </Link>
                </li>);
        })}
          </ul>
        </nav>

        
        {user.is_admin ? (<div className={styles.switcher}>
            <p className="label">Signed in as office holder</p>
            <Link className="btn btnSecondary" href={isAdminArea ? '/portal' : '/admin'}>
              {isAdminArea ? 'Go to my member portal' : 'Go to administration'}
            </Link>
          </div>) : null}

        <div className={styles.account}>
          <div className={styles.accountTop}>
            <MemberPhoto url="/api/me/photo/url" alt={`Photograph of ${user.username}`} size="avatar"/>
            <div className={styles.accountText}>
              <p className={styles.accountName}>{user.username}</p>
              <p className="subtle small">
                {user.offices.length ? user.offices.map(officeLabel).join(', ') : 'Member'}
              </p>
            </div>
          </div>
          <div className={styles.accountActions}>
            <button type="button" className={`btn btnGhost ${styles.signOut}`} onClick={handleSignOut}>
              <LogOut size={15} aria-hidden="true"/>
              Sign out
            </button>
            <ThemeToggle onDark/>
          </div>
        </div>
      </aside>

      <main id="main" className={styles.content}>
        {children}
      </main>
    </div>);
}
