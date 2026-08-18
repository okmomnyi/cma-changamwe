'use client';

import { CircleSlash, Coins, HeartHandshake, Sparkles } from 'lucide-react';
import styles from './MatrixBreakdown.module.css';
export interface MatrixItem {
    item_key: string;
    label: string;
    category: 'spirituality' | 'financial';
    applied: boolean;
    count: number;
    total: number;
    ratio: number | null;
    points: number;
    score: number;
    threshold_pct: number;
    threshold_met: boolean | null;
    hard_gate: boolean;
    window: string;
}
export interface MatrixPayload {
    spirituality_score: number;
    financial_score: number;
    total_score: number;
    attainable_total: number;
    attainable_spirituality: number;
    attainable_financial: number;
    standing: string;
    gate: {
        passed: boolean;
        affiliation_paid: boolean;
        profile_locked: boolean;
        reasons: string[];
    };
    thresholds: {
        overall: number;
        spirituality: number;
        financial: number;
        enforced_category_mins: boolean;
    };
    items: MatrixItem[];
}
const STANDING: Record<string, {
    label: string;
    className: string;
}> = {
    in_good_standing: { label: 'In good standing', className: 'pillPresent' },
    below_threshold: { label: 'Below threshold', className: 'pillApology' },
    insufficient_history: { label: 'Not enough history', className: 'pillNeutral' },
    ineligible_gate: { label: 'Not eligible', className: 'pillAbsent' },
};
export function StandingBadge({ standing }: {
    standing: string;
}) {
    const meta = STANDING[standing] ?? { label: standing, className: 'pillNeutral' };
    return <span className={`pill ${meta.className}`}>{meta.label}</span>;
}
function itemState(item: MatrixItem): 'na' | 'full' | 'strong' | 'partial' | 'weak' {
    if (!item.applied || item.ratio === null)
        return 'na';
    if (item.ratio >= 1)
        return 'full';
    if (item.threshold_met)
        return 'strong';
    if (item.ratio >= 0.4)
        return 'partial';
    return 'weak';
}
const STATE_LABEL: Record<string, string> = {
    na: 'Not applicable',
    full: 'Complete',
    strong: 'Above the guide',
    partial: 'Below the guide',
    weak: 'Well below the guide',
};
function ItemCard({ item }: {
    item: MatrixItem;
}) {
    const state = itemState(item);
    const percent = item.ratio === null ? 0 : Math.round(item.ratio * 100);
    return (<article className={`${styles.item} ${styles[state]}`} aria-labelledby={`item-${item.item_key}`}>
      <header className={styles.itemHeader}>
        <div>
          <h4 id={`item-${item.item_key}`} className={styles.itemTitle}>{item.label}</h4>
          <p className={styles.itemWindow}>{item.window}</p>
        </div>
        <span className={styles.itemPoints}>
          {item.applied ? item.score.toFixed(2) : '--'}
          <span className={styles.itemPointsMax}>/ {item.points.toFixed(0)}</span>
        </span>
      </header>

      {item.applied ? (<>
          <div className={styles.meterRow}>
            <div className={styles.meter} role="meter" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${item.label}: ${item.count} of ${item.total}`}>
              <span className={styles.meterFill} style={{ width: `${percent}%` }}/>
              
              <span className={styles.guideMark} style={{ left: `${item.threshold_pct}%` }} aria-hidden="true"/>
            </div>
            <span className={styles.meterValue}>{percent}%</span>
          </div>

          <dl className={styles.itemFacts}>
            <div>
              <dt>Counted</dt>
              <dd>{item.count} of {item.total}</dd>
            </div>
            <div>
              <dt>Guide</dt>
              <dd>{item.threshold_pct}%</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd className={styles.stateWord}>{STATE_LABEL[state]}</dd>
            </div>
          </dl>

          {item.hard_gate && !item.threshold_met ? (<p className={styles.hardGate}>
              This item is set as a hard gate, so missing the guide scores it zero.
            </p>) : null}
        </>) : (<p className={styles.naNote}>
          <CircleSlash size={14} aria-hidden="true"/>
          Nothing of this kind was held in your window, so it counts neither for nor against you.
        </p>)}
    </article>);
}
export function MatrixBreakdown({ data }: {
    data: MatrixPayload;
}) {
    const groups = [
        {
            key: 'spirituality' as const,
            label: 'Spirituality',
            icon: Sparkles,
            earned: data.spirituality_score,
            attainable: data.attainable_spirituality,
            blurb: 'Attendance at the association programme.',
        },
        {
            key: 'financial' as const,
            label: 'Financial',
            icon: Coins,
            earned: data.financial_score,
            attainable: data.attainable_financial,
            blurb: 'Affiliation, subscriptions and the collections held.',
        },
    ];
    return (<div className="stack">
      {groups.map((group) => {
            const items = data.items.filter((i) => i.category === group.key);
            if (items.length === 0)
                return null;
            const Icon = group.icon;
            return (<section key={group.key} aria-labelledby={`group-${group.key}`}>
            <div className={styles.groupHeader}>
              <div className="row">
                <span className={styles.groupIcon} aria-hidden="true"><Icon size={16}/></span>
                <div>
                  <h3 id={`group-${group.key}`} className={styles.groupTitle}>{group.label}</h3>
                  <p className="subtle small">{group.blurb}</p>
                </div>
              </div>
              <p className={styles.groupScore}>
                {group.earned.toFixed(2)}
                <span className="subtle small"> of {group.attainable.toFixed(0)} points</span>
              </p>
            </div>

            <div className={styles.itemGrid}>
              {items.map((item) => <ItemCard key={item.item_key} item={item}/>)}
            </div>
          </section>);
        })}

      <p className={styles.footNote}>
        <HeartHandshake size={14} aria-hidden="true"/>
        Every item is scored proportionally: {'"'}counted{'"'} divided by {'"'}of{'"'}, times the points.
        The guide percentage is a flag for follow-up, not a penalty, so falling under it still earns
        the full proportional share.
      </p>
    </div>);
}
