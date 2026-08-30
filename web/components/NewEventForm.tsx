'use client';

import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { api } from '@/lib/api';
import styles from './Forms.module.css';
import { summariseError } from '@/lib/formErrors';
import { EVENT_TYPES } from '@shared/vocabulary';
const TYPES = EVENT_TYPES;

const ORDINALS = [
    { value: 1, label: '1st' },
    { value: 2, label: '2nd' },
    { value: 3, label: '3rd' },
    { value: 4, label: '4th' },
    { value: 5, label: 'Last' },
];
const MATRIX_KEYS = [
    { value: '', label: 'Does not feed the Matrix' },
    { value: 'fridays', label: 'Fridays' },
    { value: 'dominica', label: 'Dominica' },
    { value: 'seminars', label: 'Seminars' },
    { value: 'novena', label: 'Novena' },
];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export function NewEventForm({ onCreated }: {
    onCreated: () => void;
}) {
    const [mode, setMode] = useState<'single' | 'weekly' | 'novena'>('single');
    const [type, setType] = useState('mass');
    const [subtype, setSubtype] = useState('');
    const [matrixKey, setMatrixKey] = useState('');
    const [title, setTitle] = useState('');
    const [date, setDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [weekday, setWeekday] = useState('5');
    const [pattern, setPattern] = useState<'weekly' | 'monthly'>('weekly');
    const [ordinals, setOrdinals] = useState<number[]>([2, 4]);
    const [days, setDays] = useState('9');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            if (mode === 'novena') {
                const result = await api<{
                    count: number;
                }>('/api/admin/events/novena', {
                    method: 'POST',
                    body: JSON.stringify({ title: title || 'Novena', start_date: date, days: Number(days) }),
                });
                setNotice(`Created a novena of ${result.count} days, sharing one series.`);
            }
            else if (mode === 'weekly') {
                const result = await api<{
                    count: number;
                }>('/api/admin/events/recurring', {
                    method: 'POST',
                    body: JSON.stringify({
                        type, subtype: subtype || null, matrix_item_key: matrixKey || null,
                        title, start_date: date, end_date: endDate, weekday: Number(weekday),
                        pattern,
                        ...(pattern === 'monthly' ? { ordinals } : {}),
                    }),
                });
                setNotice(`Created ${result.count} events.`);
            }
            else {
                await api('/api/admin/events', {
                    method: 'POST',
                    body: JSON.stringify({
                        type, subtype: subtype || null, matrix_item_key: matrixKey || null, title, date,
                    }),
                });
                setNotice('Event created.');
            }
            setTitle('');
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

      <div className="field">
        <span className="fieldLabel" id="mode-label">What are you adding?</span>
        <div className={styles.segmented} role="radiogroup" aria-labelledby="mode-label">
          {([['single', 'One event'], ['weekly', 'A weekly series'], ['novena', 'A novena']] as const)
            .map(([value, label]) => (<label key={value} className={styles.segment}>
                <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)}/>
                <span>{label}</span>
              </label>))}
        </div>
      </div>

      {mode !== 'novena' ? (<>
          <div className={styles.grid}>
            <div className="field">
              <label className="fieldLabel" htmlFor="event-type">Type</label>
              <select id="event-type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="fieldLabel" htmlFor="event-subtype">Subtype</label>
              <input id="event-subtype" className="input" value={subtype} placeholder="e.g. friday" onChange={(e) => setSubtype(e.target.value)}/>
            </div>
          </div>

          <div className="field">
            <label className="fieldLabel" htmlFor="matrix-key">Matrix item</label>
            <select id="matrix-key" className="input" value={matrixKey} onChange={(e) => setMatrixKey(e.target.value)} aria-describedby="matrix-hint">
              {MATRIX_KEYS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <p id="matrix-hint" className="subtle small">
              Only tagged events are scored. Tag Friday mass as Fridays; leave Wednesday mass untagged.
            </p>
          </div>
        </>) : null}

      <div className="field">
        <label className="fieldLabel" htmlFor="event-title">Title</label>
        <input id="event-title" className="input" value={title} required placeholder={mode === 'novena' ? 'e.g. Novena to Mt. Yosefu' : 'e.g. Friday Mass'} onChange={(e) => setTitle(e.target.value)}/>
      </div>

      <div className={styles.grid}>
        <div className="field">
          <label className="fieldLabel" htmlFor="event-date">
            {mode === 'single' ? 'Date' : 'Start date'}
          </label>
          <input id="event-date" className="input" type="date" value={date} required onChange={(e) => setDate(e.target.value)}/>
        </div>

        {mode === 'weekly' ? (<>
            <div className="field">
              <label className="fieldLabel" htmlFor="event-end">End date</label>
              <input id="event-end" className="input" type="date" value={endDate} required onChange={(e) => setEndDate(e.target.value)}/>
            </div>
            <div className="field">
              <label className="fieldLabel" htmlFor="event-weekday">Day of the week</label>
              <select id="event-weekday" className="input" value={weekday} onChange={(e) => setWeekday(e.target.value)}>
                {WEEKDAYS.map((day, i) => <option key={day} value={i + 1}>{day}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="fieldLabel" htmlFor="event-pattern">How often</label>
              <select id="event-pattern" className="input" value={pattern}
                onChange={(e) => setPattern(e.target.value as 'weekly' | 'monthly')}
                aria-describedby="pattern-hint">
                <option value="weekly">Every week</option>
                <option value="monthly">Chosen weeks of the month</option>
              </select>
              <p id="pattern-hint" className="subtle small">
                {pattern === 'weekly'
                  ? 'For the weekly mass, held every Wednesday or Friday.'
                  : 'For prayer house meetings on the 2nd and 4th Monday, Dominica on the 1st Sunday, or the AGM on the 3rd Sunday.'}
              </p>
            </div>
          </>) : null}

        {mode === 'weekly' && pattern === 'monthly' ? (
          <fieldset className={styles.ordinals}>
            <legend className="fieldLabel">Which weeks</legend>
            <div className={styles.ordinalRow}>
              {ORDINALS.map((o) => (
                <label key={o.value} className={styles.ordinal}>
                  <input type="checkbox" checked={ordinals.includes(o.value)}
                    onChange={(e) => setOrdinals((current) => (e.target.checked
                      ? [...current, o.value].sort((a, b) => a - b)
                      : current.filter((v) => v !== o.value)))}/>
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {mode === 'novena' ? (<div className="field">
            <label className="fieldLabel" htmlFor="novena-days">Number of days</label>
            <input id="novena-days" className="input" type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} aria-describedby="novena-hint"/>
            <p id="novena-hint" className="subtle small">
              One event per day, all sharing a series. The Matrix counts the days.
            </p>
          </div>) : null}
      </div>

      <button type="submit" className="btn btnPrimary"
        disabled={busy || !title.trim() || !date
          || (mode === 'weekly' && pattern === 'monthly' && ordinals.length === 0)}>
        <CalendarPlus size={15} aria-hidden="true"/>
        {busy ? 'Creating...' : 'Create'}
      </button>
    </form>);
}
