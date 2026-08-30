'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useResource } from '@/lib/useResource';
import styles from './Forms.module.css';
import { summariseError } from '@/lib/formErrors';

interface OfficeTypesResponse {
    office_types: Array<{
        office_key: string;
        label: string;
        parish_scope: boolean;
        house_scope: boolean;
        active: boolean;
    }>;
}

interface MembersResponse {
    members: Array<{
        id: string;
        full_name: string;
        prayer_house: string;
    }>;
}
interface HousesResponse {
    prayer_houses: Array<{ id: string; name: string }>;
}

export function OfficeHandoff({ onDone }: {
    onDone: () => void;
}) {
    const [scope, setScope] = useState<'parish' | 'prayer_house'>('parish');
    const [prayerHouseId, setPrayerHouseId] = useState('');
    const [officeKey, setOfficeKey] = useState('coordinator');
    const [memberId, setMemberId] = useState('');
    const [effective, setEffective] = useState('');
    const [override, setOverride] = useState('');
    const [needsOverride, setNeedsOverride] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const members = useResource<MembersResponse>('/api/admin/members?limit=200');
    const houses = useResource<HousesResponse>('/api/admin/prayer-houses');
    const offices = useResource<OfficeTypesResponse>('/api/admin/office-types');

    // Only the offices that legitimately sit at the chosen level, so the form
    // cannot offer a prayer house an office the by-laws place at the parish.
    const available = (offices.data?.office_types ?? []).filter((o) => o.active
        && (scope === 'parish' ? o.parish_scope : o.house_scope));

    const houseMissing = scope === 'prayer_house' && !prayerHouseId;
    const officeMissing = available.length > 0 && !available.some((o) => o.office_key === officeKey);

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
                    scope,
                    prayer_house_id: scope === 'prayer_house' ? prayerHouseId : null,
                    incoming_member_id: memberId,
                    effective_date: effective || undefined,
                    override_reason: override.trim() || undefined,
                }),
            });
            setNotice(result.closed > 0
                ? 'Term handed over. The outgoing holder lost any administrative access on their next request.'
                : 'Term opened. The office was vacant, so nothing needed closing.');
            setMemberId('');
            setOverride('');
            setNeedsOverride(false);
            onDone();
        }
        catch (err) {
            const message = summariseError(err);
            // The API asks for a reason when a member has already served the two
            // terms the by-laws allow. Show the field rather than a dead end.
            if (message.includes('override_reason'))
                setNeedsOverride(true);
            setError(message);
        }
        finally {
            setBusy(false);
        }
    }

    return (<form className={styles.form} onSubmit={submit} noValidate>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

      <p className="muted small">
        Parish terms in the offices the committee has named carry administrative access, and
        handing one over moves that access immediately. A prayer-house term leads that house and
        never carries parish access.
      </p>

      <div className={styles.grid}>
        <div className="field">
          <label className="fieldLabel" htmlFor="scope">Level</label>
          <select id="scope" className="input" value={scope}
            onChange={(e) => {
                setScope(e.target.value as 'parish' | 'prayer_house');
                setPrayerHouseId('');
            }}>
            <option value="parish">Parish</option>
            <option value="prayer_house">Prayer house</option>
          </select>
        </div>

        {scope === 'prayer_house' ? (
          <div className="field">
            <label className="fieldLabel" htmlFor="house">Prayer house</label>
            <select id="house" className="input" value={prayerHouseId} required
              onChange={(e) => setPrayerHouseId(e.target.value)}>
              <option value="">Choose a prayer house</option>
              {houses.data?.prayer_houses.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="field">
          <label className="fieldLabel" htmlFor="office">Office</label>
          <select id="office" className="input" value={officeKey} required
            onChange={(e) => setOfficeKey(e.target.value)} aria-describedby="office-hint">
            {available.length === 0 ? <option value="">Loading offices...</option> : null}
            {available.map((o) => (<option key={o.office_key} value={o.office_key}>{o.label}</option>))}
          </select>
          {officeMissing ? (
            <p id="office-hint" className="subtle small" role="alert">
              That office does not sit at this level. Choose one from the list.
            </p>
          ) : (
            <p id="office-hint" className="subtle small">
              {offices.error ? 'The office list could not be loaded. Reload the page and try again.' : `${available.length} offices sit at this level.`}
            </p>
          )}
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
          <p id="effective-hint" className="subtle small">Defaults to today. Terms run three years.</p>
        </div>
      </div>

      {needsOverride ? (
        <div className="field">
          <label className="fieldLabel" htmlFor="override">Committee exception</label>
          <input id="override" className="input" value={override} required
            placeholder="e.g. AGM of 18 January 2026 agreed a third term"
            onChange={(e) => setOverride(e.target.value)} aria-describedby="override-hint"/>
          <p id="override-hint" className="subtle small">
            The by-laws allow two terms in an office. Record what the committee decided; it is
            kept in the audit log against this handover.
          </p>
        </div>
      ) : null}

      <button type="submit" className="btn btnPrimary"
        disabled={busy || !memberId || houseMissing || officeMissing || available.length === 0
          || (needsOverride && override.trim().length < 4)}>
        {busy ? 'Handing over...' : 'Hand over the office'}
      </button>
    </form>);
}
