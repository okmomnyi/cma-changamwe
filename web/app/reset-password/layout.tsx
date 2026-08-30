import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Set a new password',
    description: 'Choose a new password for your CMA Changamwe account.',
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
    return children;
}
