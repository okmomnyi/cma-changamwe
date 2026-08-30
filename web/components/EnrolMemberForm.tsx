'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useResource } from '@/lib/useResource';
import { summariseError } from '@/lib/formErrors';
import styles from './Forms.module.css';

interface HousesResponse {
    prayer_houses: Array<{ id: string; name: string }>;
}

const CURRENT_YEAR = new Date().getFullYear();

/**
 * For the members who did not register themselves.
 *
 * Public registration reaches only those with an email address. The association
 * was commissioned in 2012 and has 435 members, so the Secretary has to be able
 * to enter the rest by hand. No account and no password are created here.
 */
export function EnrolMemberForm({ onCreated }: { onCreated: () => void }) {
    const houses = useResource<HousesResponse>('/api/admin/prayer-houses');

    const [fullName, setFullName] = useState('');
    const [yearOfBirth, setYearOfBirth] = useState('');
    const [idNo, setIdNo] = useState('');
    const [mobile, setMobile] = useState('');
    const [houseId, setHouseId] = useState('');
    const [marital, setMarital] = useState<'married' | 'widowed' | 'single'>('married');
    const [spouseName, setSpouseName] = useState('');
    const [kinName, setKinName] = useState('');
    const [kinMobile, setKinMobile] = useState('');
    const [jumuiya, setJumuiya] = useState('');
    const [joinedOn, setJoinedOn] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const spouseMissing = marital === 'married' && !spouseName.trim();
    const ready = fullName.trim().length >= 3
        && Number(yearOfBirth) >= 1900 && Number(yearOfBirth) <= CURRENT_YEAR - 16
        && idNo.trim().length >= 4
        && mobile.trim().length >= 7
        && houseId
        && kinName.trim().length >= 3
        && kinMobile.trim().length >= 7
        && !spouseMissing
        && !busy;

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const result = await api<{
                joined_on: string;
            }>('/api/admin/members', {
                method: 'POST',
                body: JSON.stringify({
                    full_name: fullName.trim(),
                    year_of_birth: Number(yearOfBirth),
                    id_or_passport_no: idNo.trim(),
                    mobile_no: mobile.trim(),
                    prayer_house_id: houseId,
                    marital_status: marital,
                    spouse_name: marital === 'married' ? spouseName.trim() : null,
                    next_of_kin_name: kinName.trim(),
                    next_of_kin_mobile: kinMobile.trim(),
                    jumuiya: jumuiya.trim() || null,
                    joined_on: joinedOn || undefined,
                    reason: reason.trim() || undefined,
                }),
            });
            setNotice(`${fullName.trim()} is enrolled, counted as joining on ${result.joined_on}. They have no sign-in account, so their monthly report has nowhere to go until one is made.`);
            setFullName('');
            setYearOfBirth('');
            setIdNo('');
            setMobile('');
            setSpouseName('');
            setKinName('');
            setKinMobile('');
            setJumuiya('');
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
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

      <p className="muted small">
        For a member who cannot register online. Their bio-data counts as complete, which is one
        of the two conditions the Matrix checks. The other is the yearly affiliation, recorded
        under Matoleo.
      </p>

      <div className={styles.grid}>
        <div className="field">
          <label className="fieldLabel" htmlFor="enrol-name">Full name</label>
          <input id="enrol-name" className="input" value={fullName} required
            onChange={(e) => setFullName(e.target.value)}/>
        </div>

        <div className="field">
          <label className="fieldLabel" htmlFor="enrol-year">Year of birth</label>
          <input id="enrol-year" className="input" type="number" inputMode="numeric"
            min={1900} max={CURRENT_YEAR - 16} value={yearOfBirth} required
            onChange={(e) => setYearOfBirth(e.target.value)} aria-describedby="year-hint"/>
          <p id="year-hint" className="subtle small">Members are 16 or over.</p>
        </div>

        <div className="field">
          <label className="fieldLabel" htmlFor="enrol-id">ID or passport number</label>
          <input id="enrol-id" className="input" value={idNo} required
            onChange={(e) => setIdNo(e.target.value)}/>
        </div>

        <div className="field">
          <label className="fieldLabel" htmlFor="enrol-mobile">Mobile number</label>
          <input id="enrol-mobile" className="input" type="tel" value={mobile} required
            onChange={(e) => setMobile(e.target.value)}/>
        </div>

        <div className="field">
          <label className="fieldLabel" htmlFor="enrol-house">Prayer house</label>
          <select id="enrol-house" className="input" value={houseId} required
            onChange={(e) => setHouseId(e.target.value)}>
            <option value="">Choose a prayer house</option>
            {houses.data?.prayer_houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>

        <div className="field">
          <label className="fieldLabel" htmlFor="enrol-jumuiya">Jumuiya</label>
          <input id="enrol-jumuiya" className="input" value={jumuiya}
            onChange={(e) => setJumuiya(e.target.value)}/>
        </div>

        <div className="field">
          <label className="fieldLabel" htmlFor="enrol-marital">Marital status</label>
          <select id="enrol-marital" className="input" value={marital}
            onChange={(e) => setMarital(e.target.value as 'married' | 'widowed' | 'single')}>
            <option value="married">Married</option>
            <option value="widowed">Widowed</option>
            <option value="single">Single</option>
          </select>
        </div>

        {marital === 'married' ? (
          <div className="field">
            <label className="fieldLabel" htmlFor="enrol-spouse">Spouse name</label>
            <input id="enrol-spouse" className="input" value={spouseName} required
              onChange={(e) => setSpouseName(e.target.value)}/>
          </div>
        ) : null}

        <div className="field">
          <label className="fieldLabel" htmlFor="enrol-kin">Next of kin</label>
          <input id="enrol-kin" className="input" value={kinName} required
            onChange={(e) => setKinName(e.target.value)}/>
        </div>

        <div className="field">
          <label className="fieldLabel" htmlFor="enrol-kin-mobile">Next of kin mobile</label>
          <input id="enrol-kin-mobile" className="input" type="tel" value={kinMobile} required
            onChange={(e) => setKinMobile(e.target.value)}/>
        </div>

        <div className="field">
          <label className="fieldLabel" htmlFor="enrol-joined">Commissioned on</label>
          <input id="enrol-joined" className="input" type="date" value={joinedOn}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setJoinedOn(e.target.value)} aria-describedby="joined-hint"/>
          <p id="joined-hint" className="subtle small">
            Every Matrix denominator starts here, so a member commissioned in 2012 is not measured
            against events held before they joined. Leave it blank for today.
          </p>
        </div>
      </div>

      <div className="field">
        <label className="fieldLabel" htmlFor="enrol-reason">Reason for entering by hand</label>
        <input id="enrol-reason" className="input" value={reason} maxLength={300}
          placeholder="e.g. no email address, enrolled at the AGM"
          onChange={(e) => setReason(e.target.value)} aria-describedby="reason-hint"/>
        <p id="reason-hint" className="subtle small">Kept in the audit log against this record.</p>
      </div>

      <button type="submit" className="btn btnPrimary" disabled={!ready}>
        {busy ? 'Enrolling...' : 'Enrol the member'}
      </button>
    </form>);
}
