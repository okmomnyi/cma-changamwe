import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Forgotten password',
    description: 'Ask for a link to set a new password on your CMA Changamwe account.',
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
    return children;
}
