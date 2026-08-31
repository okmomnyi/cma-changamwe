import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/auth';
import { THEME_BOOTSTRAP } from '@/lib/theme';
import './globals.css';
export const metadata: Metadata = {
    title: {
        default: 'CMA Changamwe',
        template: '%s - CMA Changamwe',
    },
    description: 'Member records, attendance, matoleo and performance tracking for the Catholic Men Association, Changamwe Parish.',
    applicationName: 'CMA Changamwe',
    // Everything holds personal data and stays out of the index. The landing
    // page, which holds none, opts itself back in.
    robots: { index: false, follow: false },
};
export const viewport: Viewport = {
    // The browser chrome follows the page, not the brand.
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#17324f' },
        { media: '(prefers-color-scheme: dark)', color: '#12161b' },
    ],
    width: 'device-width',
    initialScale: 1,
};
export default function RootLayout({ children }: {
    children: React.ReactNode;
}) {
    return (<html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}/>
        <a className="skipLink" href="#main">Skip to main content</a>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>);
}
