import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Register',
    description: 'Register as a member of the Catholic Men Association, Changamwe. Your progress is saved as you go.',
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
    return children;
}
