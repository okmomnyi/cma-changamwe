'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useResource } from '@/lib/useResource';
import styles from './Forms.module.css';
import { summariseError } from '@/lib/formErrors';
const OFFICES = [
    'coordinator', 'asst_coordinator', 'secretary', 'asst_secretary', 'treasurer',
    'organizing_sec', 'asst_organizing_sec', 'liturgist', 'marriage_counselor', 'shg_rep',
];
interface MembersResponse {
    members: Array<{
        id: string;
        full_name: string;
        prayer_house: string;
    }>;
}
export function OfficeHandoff({ onDone }: {
    onDone: () => void;
}) {
    const [officeKey, setOfficeKey] = useState('coordinator');
    const [memberId, setMemberId] = useState('');
    const [effective, setEffective] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const members = useResource<MembersResponse>('/api/admin/members?limit=200');
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const result = await api<{
                closed: number;
            }>('/api/admin/offices/handoff', {
                method: 'POST',
                body: JSON.stringify({
                    office_key: officeKey,
                    incoming_member_id: memberId,
                    effective_date: effective || undefined,
                }),
            });
            setNotice(result.closed > 0
                ? 'Term handed over. The outgoing holder lost any admin access on their next request.'
                : 'Term opened. The office was vacant, so nothing needed closing.');
            setMemberId('');
            onDone();
        }
        catch (err) {
            setError(summariseError(err));
        }
        finally {
            setBusy(false);
        }
    }
    return (<form className={styles.form} onSubmit={submit} noValidate>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

      <p className="muted small">
        Coordinator and Treasurer carry administrative access. Handing either over moves that
        access immediately.
      </p>

      <div className={styles.grid}>
        <div className="field">
          <label className="fieldLabel" htmlFor="office">Office</label>
          <select id="office" className="input" value={officeKey} onChange={(e) => setOfficeKey(e.target.value)}>
            {OFFICES.map((key) => (<option key={key} value={key}>
                {key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}
              </option>))}
          </select>
        </div>

        <div className="field">
          <label className="fieldLabel" htmlFor="incoming">Incoming holder</label>
          <select id="incoming" className="input" value={memberId} required onChange={(e) => setMemberId(e.target.value)}>
            <option value="">Choose a member</option>
            {members.data?.members.map((m) => (<option key={m.id} value={m.id}>{m.full_name} ({m.prayer_house})</option>))}
          </select>
        </div>

        <div className="field">
          <label className="fieldLabel" htmlFor="effective">Effective date</label>
          <input id="effective" className="input" type="date" value={effective} onChange={(e) => setEffective(e.target.value)} aria-describedby="effective-hint"/>
          <p id="effective-hint" className="subtle small">Defaults to today.</p>
        </div>
      </div>

      <button type="submit" className="btn btnPrimary" disabled={busy || !memberId}>
        {busy ? 'Handing over...' : 'Hand over the office'}
      </button>
    </form>);
}
