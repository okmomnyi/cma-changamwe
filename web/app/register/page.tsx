'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Loader2, Mail, Plus, Trash2 } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { fieldErrorsFrom, fieldLabel, summariseError } from '@/lib/formErrors';
import { PhotoUpload } from '@/components/PhotoUpload';
import styles from './register.module.css';
const DRAFT_TOKEN_KEY = 'cma.signup.draft';
type Screen = 'email' | 'verify' | 'personal' | 'photo' | 'family' | 'children' | 'kin' | 'declaration';
const FORM_SCREENS: Screen[] = ['personal', 'photo', 'family', 'children', 'kin', 'declaration'];
const SCREEN_TITLES: Record<Screen, string> = {
    email: 'Your email address',
    verify: 'Verify your email',
    personal: 'Personal details',
    photo: 'Photograph',
    family: 'Family details',
    children: 'Children',
    kin: 'Next of kin',
    declaration: 'Declaration',
};
const SCREEN_OF_FIELD: Record<string, Screen> = {
    full_name: 'personal',
    year_of_birth: 'personal',
    id_or_passport_no: 'personal',
    mobile_no: 'personal',
    home_parish_diocese: 'personal',
    jumuiya: 'personal',
    prayer_house_id: 'personal',
    marital_status: 'family',
    spouse_name: 'family',
    spouse_status: 'family',
    father_status: 'family',
    mother_status: 'family',
    children: 'children',
    next_of_kin_name: 'kin',
    next_of_kin_id_no: 'kin',
    next_of_kin_mobile: 'kin',
};
interface Child {
    name: string;
    date_of_birth: string;
}
interface DraftData {
    full_name?: string;
    year_of_birth?: number | string;
    id_or_passport_no?: string;
    mobile_no?: string;
    home_parish_diocese?: string | null;
    jumuiya?: string | null;
    prayer_house_id?: string;
    marital_status?: 'married' | 'widowed' | 'single';
    spouse_name?: string | null;
    spouse_status?: 'alive' | 'deceased' | null;
    father_status?: 'alive' | 'deceased' | null;
    mother_status?: 'alive' | 'deceased' | null;
    children?: Child[];
    next_of_kin_name?: string;
    next_of_kin_id_no?: string | null;
    next_of_kin_mobile?: string;
}
async function draftFetch<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
    const res = await fetch(path, {
        ...init,
        headers: {
            ...(init.body ? { 'content-type': 'application/json' } : {}),
            ...(token ? { 'x-draft-token': token } : {}),
            ...init.headers,
        },
    });
    if (!res.ok) {
        let code = 'error';
        let message = `Request failed (${res.status})`;
        let fields;
        try {
            const body = await res.json();
            code = body?.error?.code ?? code;
            message = body?.error?.message ?? message;
            fields = body?.error?.fields;
        }
        catch { }
        throw new ApiError(res.status, code, message, fields);
    }
    return res.status === 204 ? (undefined as T) : res.json();
}
export default function RegisterPage() {
    const router = useRouter();
    const [screen, setScreen] = useState<Screen>('email');
    const [token, setToken] = useState<string | null>(null);
    const [email, setEmail] = useState('');
    const [data, setData] = useState<DraftData>({});
    const [houses, setHouses] = useState<Array<{
        id: string;
        name: string;
    }>>([]);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [restoring, setRestoring] = useState(true);
    const [missing, setMissing] = useState<string[]>([]);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        draftFetch<{
            prayer_houses: Array<{
                id: string;
                name: string;
            }>;
        }>('/api/signup/prayer-houses')
            .then((body) => setHouses(body.prayer_houses))
            .catch(() => setError('Could not load the prayer house list. Check your connection.'));
    }, []);
    useEffect(() => {
        const saved = typeof window !== 'undefined' ? window.localStorage.getItem(DRAFT_TOKEN_KEY) : null;
        if (!saved) {
            setRestoring(false);
            return;
        }
        draftFetch<{
            email: string;
            email_verified: boolean;
            current_step: number;
            data: DraftData;
            missing_mandatory: string[];
        }>('/api/signup/draft', {}, saved)
            .then((body) => {
            setToken(saved);
            setEmail(body.email);
            setData(body.data ?? {});
            setMissing(body.missing_mandatory ?? []);
            setScreen(body.email_verified
                ? (FORM_SCREENS[Math.min(body.current_step - 1, FORM_SCREENS.length - 1)] ?? 'personal')
                : 'verify');
            setNotice('We picked up where you left off.');
        })
            .catch(() => {
            window.localStorage.removeItem(DRAFT_TOKEN_KEY);
        })
            .finally(() => setRestoring(false));
    }, []);
    const update = useCallback((patch: Partial<DraftData>) => {
        setData((current) => ({ ...current, ...patch }));
        setFieldErrors((current) => {
            const next = { ...current };
            for (const key of Object.keys(patch))
                delete next[key];
            return next;
        });
    }, []);
    const save = useCallback(async (step: number, patch: Partial<DraftData>) => {
        if (!token)
            return;
        const body = await draftFetch<{
            data: DraftData;
            missing_mandatory: string[];
        }>('/api/signup/draft', { method: 'PATCH', body: JSON.stringify({ current_step: step, data: patch }) }, token);
        setData(body.data ?? {});
        setMissing(body.missing_mandatory ?? []);
    }, [token]);
    const stepIndex = FORM_SCREENS.indexOf(screen);
    async function guard(action: () => Promise<void>) {
        setBusy(true);
        setError(null);
        setNotice(null);
        setFieldErrors({});
        try {
            await action();
        }
        catch (err) {
            setFieldErrors(fieldErrorsFrom(err));
            setError(summariseError(err));
        }
        finally {
            setBusy(false);
        }
    }
    const startRegistration = (event: React.FormEvent) => {
        event.preventDefault();
        void guard(async () => {
            const body = await draftFetch<{
                draft_token?: string;
            }>('/api/signup/start', {
                method: 'POST',
                body: JSON.stringify({ email: email.trim() }),
            });
            if (body.draft_token) {
                window.localStorage.setItem(DRAFT_TOKEN_KEY, body.draft_token);
                setToken(body.draft_token);
            }
            setScreen('verify');
            setNotice(`We sent a 6-digit code to ${email.trim()}.`);
        });
    };
    const [code, setCode] = useState('');
    const verifyCode = (event: React.FormEvent) => {
        event.preventDefault();
        void guard(async () => {
            await draftFetch('/api/signup/verify-email', {
                method: 'POST', body: JSON.stringify({ code: code.trim() }),
            }, token ?? undefined);
            setScreen('personal');
            setNotice('Email verified. Now your bio-data.');
        });
    };
    const resend = () => guard(async () => {
        await draftFetch('/api/signup/resend-code', { method: 'POST' }, token ?? undefined);
        setNotice('A new code is on its way.');
    });
    const goNext = (patch: Partial<DraftData>) => {
        void guard(async () => {
            await save(stepIndex + 1, patch);
            const next = FORM_SCREENS[Math.min(stepIndex + 1, FORM_SCREENS.length - 1)];
            if (next)
                setScreen(next);
        });
    };
    const goBack = () => {
        const previous = FORM_SCREENS[Math.max(stepIndex - 1, 0)];
        if (previous)
            setScreen(previous);
    };
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [accepted, setAccepted] = useState(false);
    const [done, setDone] = useState(false);
    const passwordsMatch = password.length > 0 && password === confirmPassword;
    const passwordTooShort = password.length > 0 && password.length < 10;
    const outstanding = [...new Set([...missing, ...Object.keys(fieldErrors)])]
        .filter((path) => !['username', 'password', 'declaration_accepted'].includes(path));
    const finish = (event: React.FormEvent) => {
        event.preventDefault();
        if (!passwordsMatch) {
            setError('The two passwords do not match.');
            return;
        }
        if (password.length < 10) {
            setError('Your password must be at least 10 characters.');
            return;
        }
        void guard(async () => {
            await draftFetch('/api/signup/complete', {
                method: 'POST',
                body: JSON.stringify({ username: username.trim(), password, declaration_accepted: accepted }),
            }, token ?? undefined);
            window.localStorage.removeItem(DRAFT_TOKEN_KEY);
            setDone(true);
        });
    };
    const houseName = useMemo(() => houses.find((h) => h.id === data.prayer_house_id)?.name ?? '', [houses, data.prayer_house_id]);
    if (restoring) {
        return (<main id="main" className={styles.page}>
        <div className={styles.panel} role="status" aria-live="polite">
          <Loader2 size={20} className={styles.spinner} aria-hidden="true"/>
          <p className="muted">Checking for a saved registration...</p>
        </div>
      </main>);
    }
    if (done) {
        return (<main id="main" className={styles.page}>
        <div className={styles.panel}>
          <div className={styles.doneMark} aria-hidden="true"><Check size={22}/></div>
          <h1>Registration complete</h1>
          <p className="muted" style={{ marginTop: 'var(--space-3)' }}>
            Karibu. Your profile is now locked, which means it is the parish record. To correct any
            detail, speak to the Coordinator or Treasurer. Your email address is the only field you
            can change yourself.
          </p>
          <button type="button" className="btn btnPrimary" style={{ marginTop: 'var(--space-5)' }} onClick={() => router.replace('/sign-in')}>
            Go to sign in
          </button>
        </div>
      </main>);
    }
    return (<main id="main" className={styles.page}>
      <div className={styles.panel}>
        <p className={styles.brandName}>CMA Changamwe</p>
        <h1 className={styles.heading}>{SCREEN_TITLES[screen]}</h1>

        {stepIndex >= 0 ? (<ol className={styles.steps} aria-label="Registration progress">
            {FORM_SCREENS.map((s, i) => (<li key={s} className={`${styles.step} ${i === stepIndex ? styles.stepCurrent : ''} ${i < stepIndex ? styles.stepDone : ''}`} aria-current={i === stepIndex ? 'step' : undefined}>
                <span className={styles.stepNumber}>{i < stepIndex ? <Check size={12}/> : i + 1}</span>
                <span className={styles.stepLabel}>{SCREEN_TITLES[s]}</span>
              </li>))}
          </ol>) : null}

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

        {screen === 'email' ? (<form onSubmit={startRegistration} className={styles.form} noValidate>
            <p className="muted small">
              We use your email to verify your registration and to send your monthly report.
            </p>
            <div className="field">
              <label className="fieldLabel" htmlFor="email">Email address</label>
              <input id="email" className="input" type="email" value={email} required autoComplete="email" spellCheck={false} onChange={(e) => setEmail(e.target.value)}/>
            </div>
            <button type="submit" className="btn btnPrimary" disabled={busy || !email.trim()}>
              <Mail size={16} aria-hidden="true"/>
              {busy ? 'Sending...' : 'Send verification code'}
            </button>
          </form>) : null}

        {screen === 'verify' ? (<form onSubmit={verifyCode} className={styles.form} noValidate>
            <p className="muted small">Enter the 6-digit code we sent to {email}.</p>
            <div className="field">
              <label className="fieldLabel" htmlFor="code">Verification code</label>
              <input id="code" className={`input ${styles.codeInput}`} value={code} required inputMode="numeric" autoComplete="one-time-code" maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}/>
            </div>
            <button type="submit" className="btn btnPrimary" disabled={busy || code.length !== 6}>
              {busy ? 'Checking...' : 'Verify email'}
            </button>
            <button type="button" className="btn btnGhost" onClick={resend} disabled={busy}>
              Send a new code
            </button>
          </form>) : null}

        {screen === 'personal' ? (<form className={styles.form} noValidate onSubmit={(e) => {
                e.preventDefault();
                goNext({
                    full_name: data.full_name, year_of_birth: data.year_of_birth,
                    id_or_passport_no: data.id_or_passport_no, mobile_no: data.mobile_no,
                    home_parish_diocese: data.home_parish_diocese, jumuiya: data.jumuiya,
                    prayer_house_id: data.prayer_house_id,
                });
            }}>
            <Field id="full_name" label="Full name" required value={data.full_name ?? ''} onChange={(v) => update({ full_name: v })} error={fieldErrors.full_name}/>
            <Field id="year_of_birth" label="Year of birth" required type="number" value={String(data.year_of_birth ?? '')} onChange={(v) => update({ year_of_birth: v })} error={fieldErrors.year_of_birth}/>
            <Field id="id_or_passport_no" label="ID or passport number" required value={data.id_or_passport_no ?? ''} onChange={(v) => update({ id_or_passport_no: v })} error={fieldErrors.id_or_passport_no}/>
            <Field id="mobile_no" label="Mobile number" required type="tel" value={data.mobile_no ?? ''} onChange={(v) => update({ mobile_no: v })} error={fieldErrors.mobile_no}/>
            <Field id="home_parish_diocese" label="Home parish or diocese" hint="Optional" value={data.home_parish_diocese ?? ''} onChange={(v) => update({ home_parish_diocese: v })} error={fieldErrors.home_parish_diocese}/>
            <Field id="jumuiya" label="Jumuiya" hint="Your small Christian community. Optional." value={data.jumuiya ?? ''} onChange={(v) => update({ jumuiya: v })} error={fieldErrors.jumuiya}/>

            <div className="field">
              <label className="fieldLabel" htmlFor="prayer_house_id">Prayer house <span className={styles.req}>required</span></label>
              <select id="prayer_house_id" className="input" required value={data.prayer_house_id ?? ''} aria-invalid={fieldErrors.prayer_house_id ? true : undefined} aria-describedby={fieldErrors.prayer_house_id ? 'prayer_house_id-error' : undefined} onChange={(e) => update({ prayer_house_id: e.target.value })}>
                <option value="">Choose your prayer house</option>
                {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
              {fieldErrors.prayer_house_id ? (<p id="prayer_house_id-error" className={styles.fieldError}>{fieldErrors.prayer_house_id}</p>) : null}
            </div>

            <Nav busy={busy} onBack={null}/>
          </form>) : null}

        {screen === 'photo' ? (<form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); goNext({}); }}>
            <p className="muted small">
              Your photograph appears on your member record and on the printed bio-data form the
              parish files. It is optional - you can add it later through the Secretary.
            </p>

            <PhotoUpload label="Your photograph" headers={token ? { 'x-draft-token': token } : undefined} endpoints={{
                uploadUrl: '/api/signup/photo/upload-url',
                confirm: '/api/signup/photo/confirm',
                view: '/api/signup/photo/url',
                remove: '/api/signup/photo',
            }}/>

            <Nav busy={busy} onBack={goBack}/>
          </form>) : null}

        {screen === 'family' ? (<form className={styles.form} noValidate onSubmit={(e) => {
                e.preventDefault();
                goNext({
                    marital_status: data.marital_status, spouse_name: data.spouse_name,
                    spouse_status: data.spouse_status, father_status: data.father_status,
                    mother_status: data.mother_status,
                });
            }}>
            <div className="field">
              <label className="fieldLabel" htmlFor="marital_status">Marital status <span className={styles.req}>required</span></label>
              <select id="marital_status" className="input" required value={data.marital_status ?? ''} aria-invalid={fieldErrors.marital_status ? true : undefined} onChange={(e) => update({ marital_status: e.target.value as DraftData['marital_status'] })}>
                <option value="">Choose one</option>
                <option value="married">Married</option>
                <option value="widowed">Widowed</option>
                <option value="single">Single</option>
              </select>
            </div>

            {data.marital_status === 'married' || data.marital_status === 'widowed' ? (<>
                <Field id="spouse_name" label="Spouse name" required={data.marital_status === 'married'} value={data.spouse_name ?? ''} onChange={(v) => update({ spouse_name: v })} error={fieldErrors.spouse_name}/>
                <Choice id="spouse_status" label="Spouse status" value={data.spouse_status ?? ''} onChange={(v) => update({ spouse_status: v as DraftData['spouse_status'] })}/>
              </>) : null}

            <Choice id="father_status" label="Father" value={data.father_status ?? ''} onChange={(v) => update({ father_status: v as DraftData['father_status'] })}/>
            <Choice id="mother_status" label="Mother" value={data.mother_status ?? ''} onChange={(v) => update({ mother_status: v as DraftData['mother_status'] })}/>

            <Nav busy={busy} onBack={goBack}/>
          </form>) : null}

        {screen === 'children' ? (<form className={styles.form} noValidate onSubmit={(e) => {
                e.preventDefault();
                goNext({ children: (data.children ?? []).filter((c) => c.name.trim()) });
            }}>
            <p className="muted small">
              Add each child and their date of birth. Leave this empty if you have none.
            </p>

            {(data.children ?? []).map((child, index) => (<fieldset key={index} className={styles.childRow}>
                <legend className="srOnly">Child {index + 1}</legend>
                <div className="field" style={{ flex: '2 1 12rem' }}>
                  <label className="fieldLabel" htmlFor={`child-name-${index}`}>Name</label>
                  <input id={`child-name-${index}`} className="input" value={child.name} onChange={(e) => {
                    const next = [...(data.children ?? [])];
                    next[index] = { ...child, name: e.target.value };
                    update({ children: next });
                }}/>
                </div>
                <div className="field" style={{ flex: '1 1 9rem' }}>
                  <label className="fieldLabel" htmlFor={`child-dob-${index}`}>Date of birth</label>
                  <input id={`child-dob-${index}`} className="input" type="date" value={child.date_of_birth} onChange={(e) => {
                    const next = [...(data.children ?? [])];
                    next[index] = { ...child, date_of_birth: e.target.value };
                    update({ children: next });
                }}/>
                </div>
                <button type="button" className="btn btnGhost" onClick={() => {
                    update({ children: (data.children ?? []).filter((_, i) => i !== index) });
                }}>
                  <Trash2 size={15} aria-hidden="true"/>
                  <span className="srOnly">Remove child {index + 1}</span>
                </button>
              </fieldset>))}

            <button type="button" className="btn btnSecondary" onClick={() => {
                update({ children: [...(data.children ?? []), { name: '', date_of_birth: '' }] });
            }}>
              <Plus size={15} aria-hidden="true"/>
              Add a child
            </button>

            <Nav busy={busy} onBack={goBack}/>
          </form>) : null}

        {screen === 'kin' ? (<form className={styles.form} noValidate onSubmit={(e) => {
                e.preventDefault();
                goNext({
                    next_of_kin_name: data.next_of_kin_name,
                    next_of_kin_id_no: data.next_of_kin_id_no,
                    next_of_kin_mobile: data.next_of_kin_mobile,
                });
            }}>
            <p className="muted small">
              The person the association should contact about you in an emergency.
            </p>
            <Field id="next_of_kin_name" label="Next of kin name" required value={data.next_of_kin_name ?? ''} onChange={(v) => update({ next_of_kin_name: v })} error={fieldErrors.next_of_kin_name}/>
            <Field id="next_of_kin_id_no" label="Next of kin ID number" hint="Optional" value={data.next_of_kin_id_no ?? ''} onChange={(v) => update({ next_of_kin_id_no: v })} error={fieldErrors.next_of_kin_id_no}/>
            <Field id="next_of_kin_mobile" label="Next of kin mobile" required type="tel" value={data.next_of_kin_mobile ?? ''} onChange={(v) => update({ next_of_kin_mobile: v })} error={fieldErrors.next_of_kin_mobile}/>

            <Nav busy={busy} onBack={goBack}/>
          </form>) : null}

        {screen === 'declaration' ? (<form className={styles.form} noValidate onSubmit={finish}>
            {outstanding.length > 0 ? (<div className={styles.error} role="alert">
                <p><strong>These details are still needed before you can finish:</strong></p>
                <ul className={styles.errorList}>
                  {outstanding.map((path) => (<li key={path}>
                      {fieldLabel(path)}
                      {fieldErrors[path] ? ` - ${fieldErrors[path]}` : null}
                      {SCREEN_OF_FIELD[path] ? (<button type="button" className={styles.jumpLink} onClick={() => setScreen(SCREEN_OF_FIELD[path]!)}>
                          go to {SCREEN_TITLES[SCREEN_OF_FIELD[path]!].toLowerCase()}
                        </button>) : null}
                    </li>))}
                </ul>
              </div>) : null}

            <div className={styles.summary}>
              <h2 className={styles.summaryHeading}>Check your details</h2>
              <dl className={styles.summaryList}>
                <div><dt>Name</dt><dd>{data.full_name || '--'}</dd></div>
                <div><dt>Year of birth</dt><dd>{data.year_of_birth || '--'}</dd></div>
                <div><dt>ID / passport</dt><dd>{data.id_or_passport_no || '--'}</dd></div>
                <div><dt>Mobile</dt><dd>{data.mobile_no || '--'}</dd></div>
                <div><dt>Prayer house</dt><dd>{houseName || '--'}</dd></div>
                <div><dt>Marital status</dt><dd>{data.marital_status || '--'}</dd></div>
                <div><dt>Children</dt><dd>{(data.children ?? []).length}</dd></div>
                <div><dt>Next of kin</dt><dd>{data.next_of_kin_name || '--'}</dd></div>
                <div><dt>Email</dt><dd>{email}</dd></div>
              </dl>
            </div>

            <p className={styles.declaration}>
              I declare that the information I have given above is true and correct to the best of
              my knowledge. I understand that once I submit it, my profile is locked and only the
              Coordinator or Treasurer can change it, and that every change is recorded.
            </p>

            <div className="field">
              <label className="fieldLabel" htmlFor="username">Choose a username <span className={styles.req}>required</span></label>
              <input id="username" className="input" value={username} required autoComplete="username" spellCheck={false} onChange={(e) => setUsername(e.target.value)} aria-invalid={fieldErrors.username ? true : undefined} aria-describedby={fieldErrors.username ? 'username-error' : undefined}/>
              {fieldErrors.username ? (<p id="username-error" className={styles.fieldError}>{fieldErrors.username}</p>) : null}
            </div>
            <div className="field">
              <label className="fieldLabel" htmlFor="password">Choose a password <span className={styles.req}>required</span></label>
              <input id="password" className="input" type="password" value={password} required autoComplete="new-password" minLength={10} onChange={(e) => setPassword(e.target.value)} aria-invalid={passwordTooShort || fieldErrors.password ? true : undefined} aria-describedby="password-hint"/>
              <p id="password-hint" className={passwordTooShort ? styles.fieldError : 'subtle small'}>
                {passwordTooShort
                ? `At least 10 characters - ${10 - password.length} more to go.`
                : 'At least 10 characters.'}
              </p>
              {fieldErrors.password ? (<p className={styles.fieldError}>{fieldErrors.password}</p>) : null}
            </div>
            <div className="field">
              <label className="fieldLabel" htmlFor="confirm">Repeat your password <span className={styles.req}>required</span></label>
              <input id="confirm" className="input" type="password" value={confirmPassword} required autoComplete="new-password" aria-invalid={confirmPassword.length > 0 && !passwordsMatch} onChange={(e) => setConfirmPassword(e.target.value)}/>
              {confirmPassword.length > 0 && !passwordsMatch ? (<p className="small" style={{ color: 'var(--absent-fg)' }}>The passwords do not match.</p>) : null}
            </div>

            <label className={styles.checkbox}>
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} required/>
              <span>I accept the declaration above.</span>
            </label>

            <div className={styles.nav}>
              <button type="button" className="btn btnSecondary" onClick={goBack} disabled={busy}>
                <ArrowLeft size={15} aria-hidden="true"/> Back
              </button>
              <button type="submit" className="btn btnPrimary" disabled={busy || !accepted || !username.trim() || !passwordsMatch
                || passwordTooShort || outstanding.length > 0}>
                {busy ? 'Submitting...' : 'Complete registration'}
                <ArrowRight size={15} aria-hidden="true"/>
              </button>
            </div>
          </form>) : null}

        <p className={styles.footNote}>
          Already registered? <Link href="/sign-in">Sign in</Link>.
          {token ? ' Your progress is saved automatically as you go.' : null}
        </p>
      </div>
    </main>);
}
function Field({ id, label, value, onChange, required, hint, type = 'text', error }: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    required?: boolean;
    hint?: string;
    type?: string;
    error?: string;
}) {
    const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
        .filter(Boolean).join(' ') || undefined;
    return (<div className="field">
      <label className="fieldLabel" htmlFor={id}>
        {label}{required ? <span className={styles.req}>required</span> : null}
      </label>
      <input id={id} className="input" type={type} value={value} required={required} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={describedBy}/>
      {hint ? <p id={`${id}-hint`} className="subtle small">{hint}</p> : null}
      {error ? <p id={`${id}-error`} className={styles.fieldError}>{error}</p> : null}
    </div>);
}
function Choice({ id, label, value, onChange }: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (<div className="field">
      <label className="fieldLabel" htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Prefer not to say</option>
        <option value="alive">Alive</option>
        <option value="deceased">Deceased</option>
      </select>
    </div>);
}
function Nav({ busy, onBack }: {
    busy: boolean;
    onBack: (() => void) | null;
}) {
    return (<div className={styles.nav}>
      {onBack ? (<button type="button" className="btn btnSecondary" onClick={onBack} disabled={busy}>
          <ArrowLeft size={15} aria-hidden="true"/> Back
        </button>) : <span />}
      <button type="submit" className="btn btnPrimary" disabled={busy}>
        {busy ? 'Saving...' : 'Save and continue'}
        <ArrowRight size={15} aria-hidden="true"/>
      </button>
    </div>);
}
