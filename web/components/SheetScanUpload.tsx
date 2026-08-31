'use client';

import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { summariseError } from '@/lib/formErrors';
import { compressSheetPhoto, ImageError, ACCEPTED_TYPES } from '@/lib/compressImage';

/**
 * Photographing one printed page.
 *
 * The bytes go straight to private storage and never through the API, as the
 * member photographs do. What comes back is a scan to review, not attendance:
 * nothing is recorded until a person has been through the rows.
 */
export function SheetScanUpload({ sheetId, sheetCode, onUploaded }: {
    sheetId: string;
    sheetCode: string;
    onUploaded: (scanId: string, status: string, duplicateOf: string | null) => void;
}) {
    const [stage, setStage] = useState<'idle' | 'compressing' | 'uploading' | 'reading'>('idle');
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const busy = stage !== 'idle';

    async function handle(file: File) {
        setError(null);
        try {
            setStage('compressing');
            const compressed = await compressSheetPhoto(file);

            setStage('uploading');
            const signed = await api<{ url: string; object_key: string; content_type: string }>(
                `/api/admin/attendance-sheets/${sheetId}/scan/upload-url`, { method: 'POST' });
            const put = await fetch(signed.url, {
                method: 'PUT',
                headers: { 'content-type': signed.content_type },
                body: compressed.blob,
            });
            if (!put.ok) {
                throw new ApiError(put.status, 'upload_failed',
                    'That photograph could not be saved. Try again, and if it keeps happening '
                    + 'enter this register by hand instead.');
            }

            setStage('reading');
            const result = await api<{
                scan_id: string; status: string; duplicate_of: string | null;
            }>(`/api/admin/attendance-sheets/${sheetId}/scan/confirm`, {
                method: 'POST',
                body: JSON.stringify({ object_key: signed.object_key }),
            });
            onUploaded(result.scan_id, result.status, result.duplicate_of);
        }
        catch (err) {
            setError(err instanceof ImageError ? err.message : summariseError(err));
        }
        finally {
            setStage('idle');
            if (inputRef.current)
                inputRef.current.value = '';
        }
    }

    const label = stage === 'compressing' ? 'Preparing...'
        : stage === 'uploading' ? 'Uploading...'
            : stage === 'reading' ? 'Reading the sheet...'
                : 'Photograph this page';

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_TYPES.join(',')}
                capture="environment"
                className="srOnly"
                id={`scan-${sheetId}`}
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file)
                        void handle(file);
                }}
            />
            <button
                type="button"
                className="btn btnSecondary"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
            >
                <Camera size={15} aria-hidden="true" />
                {label}
            </button>
            <span className="srOnly">Page {sheetCode}</span>
            {error ? (
                <p role="alert" className="small" style={{ color: 'var(--absent-fg)', marginTop: '0.35rem' }}>
                    {error}
                </p>
            ) : null}
        </>
    );
}
