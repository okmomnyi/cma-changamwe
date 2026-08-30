import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Verify a document',
    description: 'Confirm that a document was issued by CMA Changamwe and has not been altered.',
    robots: { index: false, follow: false },
};

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
    return children;
}
