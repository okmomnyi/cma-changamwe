'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import styles from './Forms.module.css';
import { summariseError } from '@/lib/formErrors';
export interface EditableMember {
    full_name: string;
    year_of_birth: number | string | null;
    id_or_passport_no: string | null;
    mobile_no: string | null;
    home_parish_diocese: string | null;
    jumuiya: string | null;
    prayer_house_id?: string;
    marital_status: string | null;
    spouse_name: string | null;
    membership_status: string | null;
    next_of_kin_name: string | null;
    next_of_kin_id_no: string | null;
    next_of_kin_mobile: string | null;
}
export function MemberEditForm({ memberId, member, prayerHouses, onSaved }: {
    memberId: string;
    member: EditableMember;
    prayerHouses: Array<{
        id: string;
        name: string;
    }>;
    onSaved: () => void;
}) {
    const [form, setForm] = useState<EditableMember>(member);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const set = (patch: Partial<EditableMember>) => setForm((current) => ({ ...current, ...patch }));
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const changes: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(form)) {
                const before = (member as unknown as Record<string, unknown>)[key];
                const normalised = value === '' ? null : value;
                if (String(normalised ?? '') !== String(before ?? ''))
                    changes[key] = normalised;
            }
            if (Object.keys(changes).length === 0) {
                setNotice('Nothing has changed.');
                return;
            }
            if (reason.trim())
                changes.reason = reason.trim();
            const result = await api<{
                fields_changed: string[];
            }>(`/api/admin/members/${memberId}`, {
                method: 'PATCH', body: JSON.stringify(changes),
            });
            setNotice(`Saved. ${result.fields_changed.length} field${result.fields_changed.length === 1 ? '' : 's'} ` +
                `changed and recorded in the audit log: ${result.fields_changed.join(', ')}.`);
            setReason('');
            onSaved();
        }
        catch (err) {
            setError(summariseError(err));
        }
        finally {
            setBusy(false);
        }
    }
    const text = (key: keyof EditableMember, label: string, type = 'text') => (<div className="field">
      <label className="fieldLabel" htmlFor={`edit-${key}`}>{label}</label>
      <input id={`edit-${key}`} className="input" type={type} value={(form[key] ?? '') as string} onChange={(e) => set({ [key]: e.target.value } as Partial<EditableMember>)}/>
    </div>);
    return (<form className={styles.form} onSubmit={submit} noValidate>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

      <div className={styles.grid}>
        {text('full_name', 'Full name')}
        {text('year_of_birth', 'Year of birth', 'number')}
        {text('id_or_passport_no', 'ID / passport number')}
        {text('mobile_no', 'Mobile number', 'tel')}
        {text('jumuiya', 'Jumuiya')}
        {text('home_parish_diocese', 'Home parish / diocese')}

        <div className="field">
          <label className="fieldLabel" htmlFor="edit-prayer-house">Prayer house</label>
          <select id="edit-prayer-house" className="input" value={form.prayer_house_id ?? ''} onChange={(e) => set({ prayer_house_id: e.target.value })}>
            {prayerHouses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>

        <div className="field">
          <label className="fieldLabel" htmlFor="edit-marital">Marital status</label>
          <select id="edit-marital" className="input" value={form.marital_status ?? ''} onChange={(e) => set({ marital_status: e.target.value })}>
            <option value="married">Married</option>
            <option value="widowed">Widowed</option>
            <option value="single">Single</option>
          </select>
        </div>

        {text('spouse_name', 'Spouse name')}

        <div className="field">
          <label className="fieldLabel" htmlFor="edit-membership">Membership status</label>
          <select id="edit-membership" className="input" value={form.membership_status ?? ''} onChange={(e) => set({ membership_status: e.target.value })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="transferred">Transferred</option>
            <option value="deceased">Deceased</option>
          </select>
        </div>

        {text('next_of_kin_name', 'Next of kin name')}
        {text('next_of_kin_id_no', 'Next of kin ID')}
        {text('next_of_kin_mobile', 'Next of kin mobile', 'tel')}
      </div>

      <div className="field">
        <label className="fieldLabel" htmlFor="edit-reason">Reason for the change</label>
        <input id="edit-reason" className="input" value={reason} placeholder="e.g. corrected at the AGM from the member ID card" onChange={(e) => setReason(e.target.value)} aria-describedby="reason-hint"/>
        <p id="reason-hint" className="subtle small">
          Optional, but it is stored with the audit entry and is what makes the log readable later.
        </p>
      </div>

      <div className={styles.actions}>
        <button type="submit" className="btn btnPrimary" disabled={busy}>
          {busy ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </form>);
}
