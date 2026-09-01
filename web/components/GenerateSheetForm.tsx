'use client';

import { useState } from 'react';
import { Printer } from 'lucide-react';
import { ApiError, getAccessToken, refreshSession } from '@/lib/api';
import { useResource } from '@/lib/useResource';
import { summariseError } from '@/lib/formErrors';
import { EVENT_TYPES } from '@shared/vocabulary';
import styles from './Forms.module.css';

/**
 * The sheet is generated from the register, so the names on the paper are the
 * names the system holds. Choosing the meeting type here is what decides
 * whether the ticks feed the Matrix, before a single box is drawn.
 */

const MATRIX_KEYS = [
    { value: '', label: 'Does not feed the Matrix' },
    { value: 'fridays', label: 'Fridays' },
    { value: 'dominica', label: 'Dominica' },
    { value: 'seminars', label: 'Seminars' },
    { value: 'novena', label: 'Novena' },
];

interface PrayerHouse {
    id: string;
    name: string;
    member_count: number;
}

interface EventOption {
    id: string;
    title: string;
    date: string;
    matrix_item_key: string | null;
}

interface MemberOption {
    id: string;
    full_name: string;
}

function today(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
}

export function GenerateSheetForm({ onGenerated }: { onGenerated: () => void }) {
    const [mode, setMode] = useState<'new' | 'existing'>('new');
    const [type, setType] = useState('mass');
    const [matrixKey, setMatrixKey] = useState('fridays');
    const [title, setTitle] = useState('Friday mass');
    const [date, setDate] = useState(today());
    const [eventId, setEventId] = useState('');
    const [houseId, setHouseId] = useState('');
    const [narrowing, setNarrowing] = useState(false);
    const [excluded, setExcluded] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const houses = useResource<{ prayer_houses: PrayerHouse[] }>('/api/admin/prayer-houses');
    const events = useResource<{ events: EventOption[] }>('/api/admin/events?limit=50');
    // Narrowing the roll is offered for one house at a time. A parish-wide
    // sheet runs to hundreds of names, and picking through them on a screen is
    // not how anyone would do it.
    const members = useResource<{ members: MemberOption[] }>(
        narrowing && houseId ? `/api/admin/members?prayer_house_id=${houseId}&limit=200` : null);

    function toggle(id: string) {
        setExcluded((current) => {
            const next = new Set(current);
            if (next.has(id))
                next.delete(id);
            else
                next.add(id);
            return next;
        });
    }

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const keep = members.data && narrowing
                ? members.data.members.filter((m) => !excluded.has(m.id)).map((m) => m.id)
                : null;

            const body = JSON.stringify(mode === 'existing'
                ? { event_id: eventId, prayer_house_id: houseId || null, member_ids: keep }
                : {
                    meeting: {
                        type, title, date,
                        matrix_item_key: matrixKey || null,
                    },
                    prayer_house_id: houseId || null,
                    member_ids: keep,
                });

            const request = async () => fetch('/api/admin/attendance-sheets', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...(getAccessToken() ? { authorization: `Bearer ${getAccessToken()}` } : {}),
                },
                body,
            });
            let res = await request();
            if (res.status === 401 && await refreshSession())
                res = await request();
            if (!res.ok) {
                let message = `The sheet could not be generated (${res.status}).`;
                try {
                    message = (await res.json())?.error?.message ?? message;
                }
                catch { }
                throw new ApiError(res.status, 'generate_failed', message);
            }

            const pages = res.headers.get('x-pages') ?? '?';
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = `attendance-sheet-${date}.pdf`;
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 0);

            setNotice(`${pages} page${pages === '1' ? '' : 's'} generated and downloading. `
                + 'Print it fresh for the meeting. Do not photocopy it.');
            onGenerated();
        }
        catch (err) {
            setError(summariseError(err));
        }
        finally {
            setBusy(false);
        }
    }

    return (
        <form className={styles.form} onSubmit={submit}>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

            <fieldset className={styles.segmented}>
                <legend className="label">Meeting</legend>
                {([['new', 'A new meeting'], ['existing', 'One already on the programme']] as const)
                    .map(([value, label]) => (
                        <label key={value} className={styles.segment}>
                            <input
                                type="radio" name="sheet-mode" value={value}
                                checked={mode === value}
                                onChange={() => setMode(value)}
                            />
                            <span>{label}</span>
                        </label>
                    ))}
            </fieldset>

            {mode === 'new' ? (
                <div className={styles.grid}>
                    <label>
                        <span className="label">Meeting type</span>
                        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
                            {EVENT_TYPES.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>
                    <label>
                        <span className="label">Feeds which Matrix item</span>
                        <select className="input" value={matrixKey} onChange={(e) => setMatrixKey(e.target.value)}>
                            {MATRIX_KEYS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>
                    <label>
                        <span className="label">Title, as it prints on the sheet</span>
                        <input
                            className="input" value={title} maxLength={90} required
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </label>
                    <label>
                        <span className="label">Meeting date</span>
                        <input
                            className="input" type="date" value={date} required
                            onChange={(e) => setDate(e.target.value)}
                        />
                    </label>
                </div>
            ) : (
                <label>
                    <span className="label">Event</span>
                    <select
                        className="input" value={eventId} required
                        onChange={(e) => setEventId(e.target.value)}
                    >
                        <option value="">Choose an event</option>
                        {(events.data?.events ?? []).map((option) => (
                            <option key={option.id} value={option.id}>
                                {option.date} - {option.title}
                            </option>
                        ))}
                    </select>
                </label>
            )}

            <label>
                <span className="label">Whose names print</span>
                <select
                    className="input" value={houseId}
                    onChange={(e) => { setHouseId(e.target.value); setNarrowing(false); setExcluded(new Set()); }}
                >
                    <option value="">All prayer houses, parish-wide</option>
                    {(houses.data?.prayer_houses ?? []).map((house) => (
                        <option key={house.id} value={house.id}>
                            {house.name} ({house.member_count} on the register)
                        </option>
                    ))}
                </select>
            </label>

            {houseId ? (
                <div>
                    <label className={styles.segment} style={{ display: 'inline-flex' }}>
                        <input
                            type="checkbox" checked={narrowing}
                            onChange={(e) => { setNarrowing(e.target.checked); setExcluded(new Set()); }}
                        />
                        <span>Leave some members off this sheet</span>
                    </label>

                    {narrowing && members.data ? (
                        <div className="tableScroll" style={{ maxHeight: '18rem', marginTop: 'var(--space-3)' }}>
                            <table className="table">
                                <caption className="srOnly">Members to print on the sheet</caption>
                                <thead>
                                    <tr>
                                        <th scope="col">Print</th>
                                        <th scope="col">Member</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {members.data.members.map((member) => (
                                        <tr key={member.id}>
                                            <td data-label="Print">
                                                <input
                                                    type="checkbox"
                                                    checked={!excluded.has(member.id)}
                                                    onChange={() => toggle(member.id)}
                                                    aria-label={`Print ${member.full_name} on the sheet`}
                                                />
                                            </td>
                                            <td data-label="Member">{member.full_name}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : null}
                </div>
            ) : (
                <p className="subtle small">
                    A parish-wide sheet prints every active member, several pages of them. Choose a
                    prayer house first if you want to leave anyone off.
                </p>
            )}

            <div className={styles.actions}>
                <button type="submit" className="btn btnPrimary" disabled={busy}>
                    <Printer size={15} aria-hidden="true" />
                    {busy ? 'Generating...' : 'Generate and download'}
                </button>
            </div>
        </form>
    );
}
