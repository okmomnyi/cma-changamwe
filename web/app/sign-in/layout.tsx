import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Sign in',
    description: 'Sign in to the CMA Changamwe member portal.',
};

export default function SignInLayout({ children }: { children: React.ReactNode }) {
    return children;
}
