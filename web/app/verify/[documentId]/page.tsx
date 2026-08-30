'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, FileWarning, KeyRound, ShieldAlert, ShieldCheck, Upload } from 'lucide-react';
import styles from './verify.module.css';

interface Document {
    document_id: string;
    title: string;
    kind: string;
    concerning: string | null;
    period: string | null;
    issued_at: string;
    issued_by: string | null;
    pages: number | null;
    size_bytes: number | null;
    revoked: boolean;
    revoked_at: string | null;
    revoked_reason: string | null;
    seal_intact: boolean;
    key_id: string;
    signature: string;
    sha256: string;
}

type Check =
    | { state: 'idle' }
    | { state: 'hashing' }
    | { state: 'done'; matches: boolean; verdict: string; digest: string }
    | { state: 'error'; message: string };

function formatWhen(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi',
    }).format(d);
}

export default function VerifyPage({ params }: { params: Promise<{ documentId: string }> }) {
    const { documentId } = use(params);
    const id = decodeURIComponent(documentId).toUpperCase();

    const [doc, setDoc] = useState<Document | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [check, setCheck] = useState<Check>({ state: 'idle' });

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/verify/${encodeURIComponent(id)}`)
            .then(async (res) => {
                const body = await res.json().catch(() => null);
                if (!res.ok) throw new Error(body?.error?.message ?? 'That document could not be looked up.');
                return body as Document;
            })
            .then((d) => { if (!cancelled) setDoc(d); })
            .catch((e: Error) => { if (!cancelled) setError(e.message); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [id]);

    /**
     * The file is hashed here, in the browser. Nothing is uploaded, so a
     * member's bio-data never leaves the machine of whoever is checking it.
     */
    async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;
        setCheck({ state: 'hashing' });
        try {
            const buffer = await file.arrayBuffer();
            const digestBytes = await crypto.subtle.digest('SHA-256', buffer);
            const digest = Array.from(new Uint8Array(digestBytes))
                .map((b) => b.toString(16).padStart(2, '0')).join('');

            const res = await fetch(`/api/verify/${encodeURIComponent(id)}/check`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ sha256: digest }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body?.error?.message ?? 'That check could not be completed.');
            setCheck({ state: 'done', matches: body.matches, verdict: body.verdict, digest });
        }
        catch (e) {
            setCheck({ state: 'error', message: e instanceof Error ? e.message : 'That file could not be read.' });
        }
    }

    return (<main id="main" className={styles.page}>
      <div className={styles.sheet}>
        <header className={styles.head}>
          <span className={styles.mark} aria-hidden="true"/>
          <div>
            <p className={styles.org}>CMA Changamwe</p>
            <p className={styles.sub}>Catholic Men Association, Changamwe Parish</p>
          </div>
        </header>

        <h1 className={styles.title}>Document verification</h1>

        {loading ? <p className="muted">Looking up {id}...</p> : null}

        {error ? (
          <div className={styles.bad} role="alert">
            <FileWarning size={20} aria-hidden="true"/>
            <div>
              <p className={styles.verdict}>No such document</p>
              <p className={styles.small}>{error}</p>
              <p className={styles.small}>
                Check the number printed on the page. It reads like CMA-2026-BIO-A7F3K9.
              </p>
            </div>
          </div>
        ) : null}

        {doc ? (<>
          <div className={doc.revoked ? styles.warn : doc.seal_intact ? styles.good : styles.bad} role="status">
            {doc.revoked
              ? <ShieldAlert size={20} aria-hidden="true"/>
              : doc.seal_intact
                ? <ShieldCheck size={20} aria-hidden="true"/>
                : <FileWarning size={20} aria-hidden="true"/>}
            <div>
              <p className={styles.verdict}>
                {doc.revoked
                  ? 'Issued, but since withdrawn'
                  : doc.seal_intact
                    ? 'Issued by the association'
                    : 'The seal on this record does not check out'}
              </p>
              <p className={styles.small}>
                {doc.revoked
                  ? `Withdrawn on ${formatWhen(doc.revoked_at!)}. ${doc.revoked_reason ?? ''}`
                  : doc.seal_intact
                    ? 'This document number was issued by CMA Changamwe and its record carries a valid signature.'
                    : 'Contact the parish office before relying on this document.'}
              </p>
            </div>
          </div>

          <dl className={styles.facts}>
            <div><dt>Document</dt><dd className={styles.mono}>{doc.document_id}</dd></div>
            <div><dt>Title</dt><dd>{doc.title}</dd></div>
            {doc.concerning ? <div><dt>Concerning</dt><dd>{doc.concerning}</dd></div> : null}
            {doc.period ? <div><dt>Period</dt><dd>{doc.period}</dd></div> : null}
            <div><dt>Issued</dt><dd>{formatWhen(doc.issued_at)}</dd></div>
            {doc.issued_by ? <div><dt>Issued by</dt><dd>{doc.issued_by}</dd></div> : null}
            {doc.pages ? <div><dt>Pages</dt><dd>{doc.pages}</dd></div> : null}
          </dl>

          <section className={styles.block} aria-labelledby="check">
            <h2 id="check" className={styles.blockTitle}>
              <Upload size={16} aria-hidden="true"/>
              Check the file you are holding
            </h2>
            <p className={styles.small}>
              Choose the PDF. It is read in this browser and never uploaded, so nothing on it
              leaves your device. Only a fingerprint of the file is compared.
            </p>

            <label className={styles.file}>
              <input type="file" accept="application/pdf,.pdf" onChange={onFile}/>
              <span>Choose the PDF</span>
            </label>

            {check.state === 'hashing' ? <p className={styles.small}>Reading the file...</p> : null}

            {check.state === 'error' ? (
              <p className={styles.bad} role="alert">
                <FileWarning size={18} aria-hidden="true"/>
                <span>{check.message}</span>
              </p>
            ) : null}

            {check.state === 'done' ? (
              <div className={check.matches ? styles.good : styles.bad} role="status">
                {check.matches ? <BadgeCheck size={20} aria-hidden="true"/> : <FileWarning size={20} aria-hidden="true"/>}
                <div>
                  <p className={styles.verdict}>{check.matches ? 'The file is genuine' : 'The file does not match'}</p>
                  <p className={styles.small}>{check.verdict}</p>
                  <p className={`${styles.small} ${styles.mono}`}>{check.digest}</p>
                </div>
              </div>
            ) : null}
          </section>

          <section className={styles.block} aria-labelledby="independent">
            <h2 id="independent" className={styles.blockTitle}>
              <KeyRound size={16} aria-hidden="true"/>
              Check it without trusting this page
            </h2>
            <p className={styles.small}>
              The signature below covers the SHA-256 of the issued file. Download the public key
              and verify it yourself, so you need not take this page at its word.
            </p>
            <dl className={styles.facts}>
              <div><dt>Fingerprint</dt><dd className={styles.mono}>{doc.sha256}</dd></div>
              <div><dt>Signature</dt><dd className={styles.mono}>{doc.signature}</dd></div>
              <div><dt>Key</dt><dd className={styles.mono}>Ed25519, id {doc.key_id}</dd></div>
            </dl>
            <p>
              <a className="btn btnSecondary" href="/api/verify/public-key" download>
                Download the public key
              </a>
            </p>
          </section>

          <p className={styles.foot}>
            Questions about a document should go to the parish office.{' '}
            <Link href="/sign-in">Members and officers sign in here</Link>.
          </p>
        </>) : null}
      </div>
    </main>);
}
