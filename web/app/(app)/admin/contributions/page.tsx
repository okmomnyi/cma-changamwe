'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useResource } from '@/lib/useResource';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { contributionLabel, formatDate, formatKes, formatMonth } from '@/lib/format';
import styles from '@/components/Forms.module.css';
import { DownloadButton } from '@/components/DownloadButton';
import { summariseError } from '@/lib/formErrors';
import { CONTRIBUTION_CATEGORIES } from '@shared/vocabulary';
const CATEGORIES = CONTRIBUTION_CATEGORIES;
interface Row {
    id: string;
    member_id: string;
    full_name: string;
    category: string;
    amount: string;
    date: string;
    contribution_month: string | null;
    affiliation_year: number | null;
    event_title: string | null;
    note: string | null;
}
interface ListResponse {
    contributions: Row[];
    total: number;
    total_amount: string;
}
interface MembersResponse {
    members: Array<{
        id: string;
        full_name: string;
        prayer_house: string;
    }>;
}
export default function ContributionsPage() {
    const [adding, setAdding] = useState(false);
    const [memberId, setMemberId] = useState('');
    const [category, setCategory] = useState('monthly_subscription');
    const [amount, setAmount] = useState('100');
    const [date, setDate] = useState('');
    const [month, setMonth] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const list = useResource<ListResponse>('/api/admin/contributions?limit=50');
    const members = useResource<MembersResponse>('/api/admin/members?limit=200');
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            await api('/api/admin/contributions', {
                method: 'POST',
                body: JSON.stringify({
                    member_id: memberId,
                    category,
                    amount: Number(amount),
                    date: date || undefined,
                    contribution_month: month ? `${month}-01` : null,
                    note: note.trim() || null,
                }),
            });
            setNotice('Contribution recorded, and that member score has been recalculated.');
            setAmount('100');
            setNote('');
            list.reload();
        }
        catch (err) {
            setError(summariseError(err));
        }
        finally {
            setBusy(false);
        }
    }
    return (<>
      <PageHeader title="Matoleo" description="Contributions recorded against members, by category." actions={<>
            <DownloadButton url="/api/exports/admin/exports/contributions.pdf" filename="cma-changamwe-matoleo.pdf" label="Statement"/>
            <button type="button" className="btn btnPrimary" onClick={() => setAdding((o) => !o)} aria-expanded={adding}>
              <Plus size={15} aria-hidden="true"/>
              {adding ? 'Close' : 'Record a contribution'}
            </button>
          </>}/>

      {adding ? (<section className="card" style={{ marginBottom: 'var(--space-5)' }} aria-label="Record a contribution">
          <div className="cardHeader"><h2>Record a contribution</h2></div>
          <div className="cardBody">
            <form className={styles.form} onSubmit={submit} noValidate>
              {error ? <p className={styles.error} role="alert">{error}</p> : null}
              {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

              <div className={styles.grid}>
                <div className="field">
                  <label className="fieldLabel" htmlFor="member">Member</label>
                  <select id="member" className="input" value={memberId} required onChange={(e) => setMemberId(e.target.value)}>
                    <option value="">Choose a member</option>
                    {members.data?.members.map((m) => (<option key={m.id} value={m.id}>{m.full_name} ({m.prayer_house})</option>))}
                  </select>
                </div>

                <div className="field">
                  <label className="fieldLabel" htmlFor="category">Category</label>
                  <select id="category" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                    {CATEGORIES.map((c) => (<option key={c.value} value={c.value}>
                      {c.scored ? c.label : `${c.label} (does not feed the Matrix)`}
                    </option>))}
                  </select>
                  {category === 'other' ? (
                    <p className="subtle small">
                      Recorded and shown in the member history, but scored by no Matrix item. Use
                      a named category wherever one fits, so the payment counts.
                    </p>
                  ) : null}
                </div>

                <div className="field">
                  <label className="fieldLabel" htmlFor="amount">Amount (KES)</label>
                  <input id="amount" className="input" type="number" min={0} step="1" value={amount} required onChange={(e) => setAmount(e.target.value)}/>
                </div>

                <div className="field">
                  <label className="fieldLabel" htmlFor="date">Date received</label>
                  <input id="date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-describedby="date-hint"/>
                  <p id="date-hint" className="subtle small">Defaults to today.</p>
                </div>

                {category === 'monthly_subscription' ? (<div className="field">
                    <label className="fieldLabel" htmlFor="month">Month it pays for</label>
                    <input id="month" className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-describedby="month-hint"/>
                    <p id="month-hint" className="subtle small">
                      Leave blank to use the month received. Set it when paying arrears.
                    </p>
                  </div>) : null}
              </div>

              <div className="field">
                <label className="fieldLabel" htmlFor="note">Note</label>
                <input id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)}/>
              </div>

              <button type="submit" className="btn btnPrimary" disabled={busy || !memberId || !amount}>
                {busy ? 'Recording...' : 'Record contribution'}
              </button>
            </form>
          </div>
        </section>) : null}

      <section className="card">
        <div className="cardHeader">
          <h2>Recent contributions</h2>
          {list.data ? (<span className="subtle small">
              {list.data.total} entries - {formatKes(list.data.total_amount)}
            </span>) : null}
        </div>

        {list.loading ? <LoadingState label="Loading the ledger"/> : null}
        {list.error ? <ErrorState error={list.error} onRetry={list.reload}/> : null}

        {list.data && list.data.contributions.length === 0 ? (<EmptyState title="Nothing recorded yet" description="Use Record a contribution to add the first entry."/>) : null}

        {list.data && list.data.contributions.length > 0 ? (<div className="tableScroll">
            <table className="table">
              <caption className="srOnly">Recent contributions</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Member</th>
                  <th scope="col">Category</th>
                  <th scope="col">Applies to</th>
                  <th scope="col" className="numeric">Amount</th>
                </tr>
              </thead>
              <tbody>
                {list.data.contributions.map((row) => (<tr key={row.id}>
                    <td data-label="Date" style={{ whiteSpace: 'nowrap' }}>{formatDate(row.date)}</td>
                    <td data-label="Member">{row.full_name}</td>
                    <td data-label="Category">{contributionLabel(row.category)}</td>
                    <td data-label="Applies to" className="muted">
                      {row.contribution_month ? formatMonth(row.contribution_month)
                    : row.affiliation_year ? `Year ${row.affiliation_year}`
                        : row.event_title ?? '--'}
                    </td>
                    <td data-label="Amount" className="numeric">{formatKes(row.amount)}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>) : null}
      </section>
    </>);
}
