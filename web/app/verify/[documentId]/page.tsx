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
    revoked: boolean;
    revoked_at: string | null;
    revoked_reason: string | null;
    seal_intact: boolean;
    key_id: string;
    details: Record<string, unknown>;
}

const KIND_NAMES: Record<string, string> = {
    member_biodata: 'Member bio-data',
    matrix_report: 'Matrix report',
    member_roster: 'Member register',
    contributions_statement: 'Statement of matoleo',
    matrix_summary: 'Matrix standing',
    welfare_statement: 'Welfare support',
};

const DETAIL_LABELS: Record<string, string> = {
    member: 'Member',
    prayer_house: 'Prayer house',
    prayer_houses: 'Prayer houses',
    children_listed: 'Children listed',
    membership: 'Membership',
    standing: 'Standing',
    score: 'Score',
    covering: 'Covering',
    members: 'Members listed',
    month: 'Month',
    in_good_standing: 'In good standing',
    entries: 'Entries',
    total: 'Total',
    from: 'From',
    to: 'To',
    claims: 'Claims',
    paid: 'Paid',
    paid_total: 'Total paid',
};

const MONEY_KEYS = new Set(['total', 'paid_total']);

function label(key: string): string {
    return DETAIL_LABELS[key] ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function detailValue(key: string, value: unknown): string {
    if (value === null || value === undefined || value === '') return '--';
    if (typeof value === 'number' && MONEY_KEYS.has(key)) {
        return `KES ${value.toLocaleString('en-KE')}`;
    }
    if (typeof value === 'number') return value.toLocaleString('en-KE');
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    return String(value).replace(/_/g, ' ');
}

type Check =
    | { state: 'idle' }
    | { state: 'reading' }
    | { state: 'done'; matches: boolean; verdict: string }
    | { state: 'error'; message: string };

function formatWhen(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi',
    }).format(d);
}

function formatMonth(period: string): string {
    const d = new Date(`${period}-01T12:00:00+03:00`);
    return Number.isNaN(d.getTime()) ? period : new Intl.DateTimeFormat('en-GB', {
        month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi',
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

    const details = doc ? Object.entries(doc.details).filter(([, v]) => v !== null && v !== '') : [];

    /**
     * The file is hashed here, in the browser. Nothing is uploaded, so a
     * member's bio-data never leaves the machine of whoever is checking it.
     */
    async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;
        setCheck({ state: 'reading' });
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
            setCheck({ state: 'done', matches: body.matches, verdict: body.verdict });
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

        <h1 className={styles.title}>Document check</h1>

        {loading ? <p className={styles.small}>Looking up {id}...</p> : null}

        {error ? (
          <div className={styles.bad} role="alert">
            <FileWarning size={20} aria-hidden="true"/>
            <div>
              <p className={styles.verdict}>No such document</p>
              <p className={styles.small}>{error}</p>
              <p className={styles.small}>
                Check the number printed at the foot of the page. It reads like
                {' '}<span className={styles.mono}>CMA-2026-BIO-A7F3K9</span>.
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
                    ? 'Genuine'
                    : 'This record does not check out'}
              </p>
              <p className={styles.small}>
                {doc.revoked
                  ? `This document was issued by the association and later withdrawn on ${formatWhen(doc.revoked_at!)}. ${doc.revoked_reason ?? ''} It should not be relied on.`
                  : doc.seal_intact
                    ? 'This document number was issued by CMA Changamwe, and its record carries a valid seal.'
                    : 'Contact the parish office before relying on this document.'}
              </p>
            </div>
          </div>

          <dl className={styles.facts}>
            <div><dt>Document</dt><dd className={styles.mono}>{doc.document_id}</dd></div>
            <div><dt>Type</dt><dd>{KIND_NAMES[doc.kind] ?? doc.title}</dd></div>
            {doc.concerning ? <div><dt>Concerning</dt><dd>{doc.concerning}</dd></div> : null}
            {doc.period ? <div><dt>Period</dt><dd>{formatMonth(doc.period)}</dd></div> : null}
            <div><dt>Date of issue</dt><dd>{formatWhen(doc.issued_at)}</dd></div>
            {doc.issued_by ? <div><dt>Issued by</dt><dd>{doc.issued_by}</dd></div> : null}
            {doc.pages ? <div><dt>Length</dt><dd>{doc.pages} {doc.pages === 1 ? 'page' : 'pages'}</dd></div> : null}
          </dl>

          {details.length > 0 ? (
            <section className={styles.block} aria-labelledby="says">
              <h2 id="says" className={styles.blockTitle}>What the association issued</h2>
              <p className={styles.small}>
                Read these against the document in front of you. If anything differs, the copy you
                are holding is not what was issued under this number.
              </p>
              <dl className={styles.facts} style={{ marginTop: 'var(--space-4)', marginBottom: 0 }}>
                {details.map(([key, value]) => (
                  <div key={key}>
                    <dt>{label(key)}</dt>
                    <dd>{detailValue(key, value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <section className={styles.block} aria-labelledby="check">
            <h2 id="check" className={styles.blockTitle}>
              <Upload size={16} aria-hidden="true"/>
              Settle it outright
            </h2>
            <p className={styles.small}>
              Comparing the details above catches most alterations. To be certain, choose the PDF
              file: it is read in this browser and never uploaded, so nothing on it leaves your
              device. Only a fingerprint is compared.
            </p>

            <label className={styles.file}>
              <input type="file" accept="application/pdf,.pdf" onChange={onFile}/>
              <span>Choose the PDF</span>
            </label>

            {check.state === 'reading' ? <p className={styles.small}>Reading the file...</p> : null}

            {check.state === 'error' ? (
              <div className={styles.bad} role="alert">
                <FileWarning size={20} aria-hidden="true"/>
                <span className={styles.small}>{check.message}</span>
              </div>
            ) : null}

            {check.state === 'done' ? (
              <div className={check.matches ? styles.good : styles.bad} role="status">
                {check.matches ? <BadgeCheck size={20} aria-hidden="true"/> : <FileWarning size={20} aria-hidden="true"/>}
                <div>
                  <p className={styles.verdict}>
                    {check.matches ? 'The file is the one that was issued' : 'The file does not match'}
                  </p>
                  <p className={styles.small}>{check.verdict}</p>
                </div>
              </div>
            ) : null}

            <p className={`${styles.small} ${styles.aside}`}>
              <KeyRound size={13} aria-hidden="true"/>
              Checking for an institution?{' '}
              <a href="/api/verify/public-key" download>Download the public key</a>
              {' '}to verify the seal yourself, without relying on this page.
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
