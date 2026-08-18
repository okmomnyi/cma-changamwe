import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/auth';
import './globals.css';
export const metadata: Metadata = {
    title: {
        default: 'CMA Changamwe',
        template: '%s - CMA Changamwe',
    },
    description: 'Member records, attendance, matoleo and performance tracking for the Catholic Men Association, Changamwe Parish.',
    applicationName: 'CMA Changamwe',
    robots: { index: false, follow: false },
};
export const viewport: Viewport = {
    themeColor: '#17324f',
    width: 'device-width',
    initialScale: 1,
};
export default function RootLayout({ children }: {
    children: React.ReactNode;
}) {
    return (<html lang="en">
      <body>
        <a className="skipLink" href="#main">Skip to main content</a>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>);
}
