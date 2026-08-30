'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useResource } from '@/lib/useResource';
import { summariseError } from '@/lib/formErrors';
import { formatKes } from '@/lib/format';
import { WELFARE_SUPPORT_TYPES } from '@shared/vocabulary';
import styles from './Forms.module.css';

const SUPPORT_TYPES = WELFARE_SUPPORT_TYPES;

const WEDDING = ['pre_wedding', 'wedding_gift'];
const BEREAVEMENT = ['benevolent_member_spouse', 'benevolent_child', 'benevolent_parent'];

interface TypesResponse {
    support_types: Array<{ key: string; default_amount: number }>;
    child_max_age: number;
    sickness_min_days: number;
}
interface MembersResponse {
    members: Array<{ id: string; full_name: string; prayer_house: string }>;
}
interface EventsResponse {
    events: Array<{ id: string; title: string; date: string; type: string }>;
}
interface MemberDetail {
    children: Array<{ id: string; name: string; date_of_birth: string | null }>;
}

export function NewClaimForm({ onCreated }: { onCreated: () => void }) {
    const [supportType, setSupportType] = useState('benevolent_member_spouse');
    const [memberId, setMemberId] = useState('');
    const [amount, setAmount] = useState('');
    const [subjectName, setSubjectName] = useState('');
    const [eventId, setEventId] = useState('');
    const [childId, setChildId] = useState('');
    const [admitted, setAdmitted] = useState('');
    const [discharged, setDischarged] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const types = useResource<TypesResponse>('/api/admin/welfare/support-types');
    const members = useResource<MembersResponse>('/api/admin/members?limit=500');
    const events = useResource<EventsResponse>('/api/admin/events?limit=200');
    const member = useResource<MemberDetail>(
        supportType === 'benevolent_child' && memberId ? `/api/admin/members/${memberId}` : null,
    );

    const defaults = types.data?.support_types ?? [];
    const suggested = defaults.find((t) => t.key === supportType)?.default_amount ?? 0;
    const minDays = types.data?.sickness_min_days ?? 7;
    const maxAge = types.data?.child_max_age ?? 18;

    // The by-law amount fills in whenever the kind of support changes, and the
    // officer can still overwrite it where the committee agreed otherwise.
    useEffect(() => {
        setAmount(suggested ? String(suggested) : '');
    }, [suggested]);

    const weddings = (events.data?.events ?? []).filter((e) => e.type === 'wedding');
    const needsEvent = WEDDING.includes(supportType);
    const needsSubject = BEREAVEMENT.includes(supportType);
    const needsChild = supportType === 'benevolent_child';
    const needsDates = supportType === 'sickness_advance';

    const days = admitted && discharged
        ? Math.round((Date.parse(discharged) - Date.parse(admitted)) / 86400000)
        : null;
    const daysTooFew = days !== null && days <= minDays;

    const ready = memberId
        && (!needsEvent || eventId)
        && (!needsSubject || subjectName.trim())
        && (!needsChild || childId)
        && (!needsDates || (admitted && discharged && !daysTooFew))
        && !busy;

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await api('/api/admin/welfare/claims', {
                method: 'POST',
                body: JSON.stringify({
                    member_id: memberId,
                    support_type: supportType,
                    amount: amount ? Number(amount) : undefined,
                    subject_name: needsSubject ? subjectName.trim() : null,
                    event_id: needsEvent ? eventId : null,
                    child_id: needsChild ? childId : null,
                    admitted_on: needsDates ? admitted : null,
                    discharged_on: needsDates ? discharged : null,
                    note: note.trim() || null,
                }),
            });
            setMemberId('');
            setSubjectName('');
            setEventId('');
            setChildId('');
            setAdmitted('');
            setDischarged('');
            setNote('');
            onCreated();
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

      <p className="muted small">
        Opening a claim records the request. It is not a payment, and it is not an approval. An
        officer decides it against the member standing for a completed month, and records the
        payment separately once it has been made.
      </p>

      <div className={styles.grid}>
        <div className="field">
          <label className="fieldLabel" htmlFor="support-type">Kind of support</label>
          <select id="support-type" className="input" value={supportType}
            onChange={(e) => setSupportType(e.target.value)}>
            {SUPPORT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        <div className="field">
          <label className="fieldLabel" htmlFor="claim-member">Member</label>
          <select id="claim-member" className="input" value={memberId} required
            onChange={(e) => { setMemberId(e.target.value); setChildId(''); }}>
            <option value="">Choose a member</option>
            {members.data?.members.map((m) => (
              <option key={m.id} value={m.id}>{m.full_name} ({m.prayer_house})</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="fieldLabel" htmlFor="claim-amount">Amount</label>
          <input id="claim-amount" className="input" type="number" min={0} step={50}
            value={amount} onChange={(e) => setAmount(e.target.value)}
            aria-describedby="amount-hint"/>
          <p id="amount-hint" className="subtle small">
            {suggested ? `The by-laws set ${formatKes(suggested)}.` : 'No standing amount for this kind of support.'}
          </p>
        </div>

        {needsEvent ? (
          <div className="field">
            <label className="fieldLabel" htmlFor="claim-event">Wedding</label>
            <select id="claim-event" className="input" value={eventId} required
              onChange={(e) => setEventId(e.target.value)} aria-describedby="event-hint">
              <option value="">Choose the wedding</option>
              {weddings.map((e) => <option key={e.id} value={e.id}>{e.title} ({e.date})</option>)}
            </select>
            <p id="event-hint" className="subtle small">
              {weddings.length === 0
                ? 'No weddings are on the programme yet. Add the event first.'
                : 'A pre-wedding payment and a wedding gift are each recorded once per wedding.'}
            </p>
          </div>
        ) : null}

        {needsSubject ? (
          <div className="field">
            <label className="fieldLabel" htmlFor="claim-subject">Who has died</label>
            <input id="claim-subject" className="input" value={subjectName} required
              onChange={(e) => setSubjectName(e.target.value)}
              placeholder={supportType === 'benevolent_parent' ? 'Name of the parent' : 'Full name'}/>
          </div>
        ) : null}

        {needsChild ? (
          <div className="field">
            <label className="fieldLabel" htmlFor="claim-child">Child</label>
            <select id="claim-child" className="input" value={childId} required
              onChange={(e) => setChildId(e.target.value)} aria-describedby="child-hint">
              <option value="">Choose the child</option>
              {member.data?.children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.date_of_birth ? ` (born ${c.date_of_birth})` : ' (no date of birth)'}
                </option>
              ))}
            </select>
            <p id="child-hint" className="subtle small">
              {!memberId
                ? 'Choose the member first.'
                : (member.data?.children.length ?? 0) === 0
                  ? 'This member has no children on file. Record them on the member page first.'
                  : `The by-laws apply this payment below ${maxAge}, so a date of birth must be on file.`}
            </p>
          </div>
        ) : null}

        {needsDates ? (<>
          <div className="field">
            <label className="fieldLabel" htmlFor="claim-admitted">Admitted on</label>
            <input id="claim-admitted" className="input" type="date" value={admitted} required
              onChange={(e) => setAdmitted(e.target.value)}/>
          </div>
          <div className="field">
            <label className="fieldLabel" htmlFor="claim-discharged">Discharged on</label>
            <input id="claim-discharged" className="input" type="date" value={discharged} required
              onChange={(e) => setDischarged(e.target.value)}
              aria-invalid={daysTooFew ? true : undefined}
              aria-describedby="days-hint"/>
            <p id="days-hint" className={daysTooFew ? 'small' : 'subtle small'}
              role={daysTooFew ? 'alert' : undefined}
              style={daysTooFew ? { color: 'var(--absent-fg)' } : undefined}>
              {days === null
                ? `The by-laws apply this advance to an admission of more than ${minDays} days.`
                : daysTooFew
                  ? `That is ${days} days. The by-laws require more than ${minDays}.`
                  : `${days} days, which qualifies.`}
            </p>
          </div>
        </>) : null}
      </div>

      <div className="field">
        <label className="fieldLabel" htmlFor="claim-note">Note</label>
        <input id="claim-note" className="input" value={note} maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything the committee should see when deciding"/>
      </div>

      <button type="submit" className="btn btnPrimary" disabled={!ready}>
        {busy ? 'Opening...' : 'Open the claim'}
      </button>
    </form>);
}
