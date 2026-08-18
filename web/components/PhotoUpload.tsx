'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Trash2, UserRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { summariseError } from '@/lib/formErrors';
import { compressProfilePhoto, ImageError, ACCEPTED_TYPES } from '@/lib/compressImage';
import styles from './PhotoUpload.module.css';
interface Endpoints {
    uploadUrl: string;
    confirm: string;
    view: string;
    remove: string;
}
export function PhotoUpload({ endpoints, headers, label = 'Photograph', hint, onChange, }: {
    endpoints: Endpoints;
    headers?: Record<string, string>;
    label?: string;
    hint?: string;
    onChange?: (hasPhoto: boolean) => void;
}) {
    const [preview, setPreview] = useState<string | null>(null);
    const [hasPhoto, setHasPhoto] = useState(false);
    const [stage, setStage] = useState<'idle' | 'compressing' | 'uploading' | 'saving'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const localUrl = useRef<string | null>(null);
    const busy = stage !== 'idle';
    const showLocal = (blob: Blob | null) => {
        if (localUrl.current)
            URL.revokeObjectURL(localUrl.current);
        localUrl.current = blob ? URL.createObjectURL(blob) : null;
        setPreview(localUrl.current);
    };
    const loadExisting = useCallback(async () => {
        try {
            const { url } = await api<{
                url: string;
            }>(endpoints.view, { headers });
            setPreview(url);
            setHasPhoto(true);
            onChange?.(true);
        }
        catch {
        }
    }, [endpoints.view]);
    useEffect(() => {
        void loadExisting();
        return () => {
            if (localUrl.current)
                URL.revokeObjectURL(localUrl.current);
        };
    }, [loadExisting]);
    async function handleFile(file: File) {
        setError(null);
        setNote(null);
        try {
            setStage('compressing');
            const compressed = await compressProfilePhoto(file);
            showLocal(compressed.blob);
            setStage('uploading');
            const signed = await api<{
                url: string;
                object_key: string;
                content_type: string;
            }>(endpoints.uploadUrl, { method: 'POST', headers });
            const put = await fetch(signed.url, {
                method: 'PUT',
                headers: { 'content-type': signed.content_type },
                body: compressed.blob,
            });
            if (!put.ok) {
                throw new ApiError(put.status, 'upload_failed', 'The upload to storage was refused. If this persists, check the bucket CORS rules.');
            }
            setStage('saving');
            await api(endpoints.confirm, {
                method: 'POST',
                headers,
                body: JSON.stringify({ object_key: signed.object_key }),
            });
            setHasPhoto(true);
            onChange?.(true);
            const savedKb = Math.round(compressed.bytes / 1024);
            const fromKb = Math.round(compressed.originalBytes / 1024);
            setNote(`Saved. Compressed from ${fromKb} KB to ${savedKb} KB before upload.`);
        }
        catch (err) {
            if (err instanceof ImageError)
                setError(err.message);
            else
                setError(summariseError(err, 'Could not upload that photo.'));
        }
        finally {
            setStage('idle');
            if (inputRef.current)
                inputRef.current.value = '';
        }
    }
    async function remove() {
        setStage('saving');
        setError(null);
        setNote(null);
        try {
            await api(endpoints.remove, { method: 'DELETE', headers });
            showLocal(null);
            setHasPhoto(false);
            onChange?.(false);
        }
        catch (err) {
            setError(summariseError(err, 'Could not remove that photo.'));
        }
        finally {
            setStage('idle');
        }
    }
    const stageLabel = stage === 'compressing' ? 'Compressing...'
        : stage === 'uploading' ? 'Uploading...'
            : stage === 'saving' ? 'Saving...'
                : hasPhoto ? 'Replace photo' : 'Choose a photo';
    return (<div className="field">
      <span className="fieldLabel">{label}</span>

      <div className={styles.row}>
        <div className={styles.frame} aria-live="polite">
          {preview ? (<img src={preview} alt="Profile photograph" className={styles.image}/>) : (<span className={styles.placeholder}>
              <UserRound size={28} aria-hidden="true"/>
              <span className="srOnly">No photograph uploaded yet</span>
            </span>)}
        </div>

        <div className={styles.controls}>
          <input ref={inputRef} id="photo-input" className="srOnly" type="file" accept={ACCEPTED_TYPES.join(',')} disabled={busy} onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
                void handleFile(file);
        }} aria-describedby="photo-hint"/>
          <label htmlFor="photo-input" className="btn btnSecondary" aria-disabled={busy}>
            <Camera size={15} aria-hidden="true"/>
            {stageLabel}
          </label>

          {hasPhoto && !busy ? (<button type="button" className="btn btnGhost" onClick={remove}>
              <Trash2 size={15} aria-hidden="true"/>
              Remove
            </button>) : null}

          <p id="photo-hint" className="subtle small">
            {hint ?? 'A clear head-and-shoulders photo. It is resized and compressed on this device before it is sent, and location data is removed.'}
          </p>
        </div>
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {note ? <p className={styles.note} role="status">{note}</p> : null}
    </div>);
}
