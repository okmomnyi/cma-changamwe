import { DateTime } from 'luxon';
import { query, type Queryable } from '../db/pool.js';
import { NAIROBI, todayNairobi } from '../util/time.js';
import { configList, configNumber, type MatrixConfig } from './config.js';
import type { MatrixRule } from './rules.js';
export interface Tally {
    memberId: string;
    count: number;
    total: number;
}
interface EvalContext {
    rule: MatrixRule;
    config: MatrixConfig;
    memberIds: string[];
    asOf: string;
    client?: Queryable;
}
function categoriesFor(rule: MatrixRule, config: MatrixConfig): string[] {
    const filter = rule.source_filter ?? {};
    if (Array.isArray(filter.categories))
        return filter.categories as string[];
    if (typeof filter.categories_config === 'string') {
        return configList(config, filter.categories_config, []);
    }
    return [];
}
function rollingStart(months: number, asOf: string): string {
    return DateTime.fromISO(asOf, { zone: NAIROBI }).minus({ months }).plus({ days: 1 }).toISODate()!;
}
function rows(result: {
    rows: Array<{
        member_id: string;
        count: string;
        total: string;
    }>;
}): Tally[] {
    return result.rows.map((r) => ({
        memberId: r.member_id,
        count: Number(r.count),
        total: Number(r.total),
    }));
}
const SATISFIED = `a.status IN ('present','apology')`;
const JOINED = 'm.created_at::date';
async function attendanceRollingMonths(ctx: EvalContext): Promise<Tally[]> {
    const key = String(ctx.rule.source_filter?.event_matrix_item_key ?? ctx.rule.item_key);
    const start = rollingStart(ctx.rule.window_value ?? 1, ctx.asOf);
    const result = await query<{
        member_id: string;
        count: string;
        total: string;
    }>(`WITH scoped AS (
       SELECT e.id, e.date FROM events e
       WHERE e.matrix_item_key = $2 AND e.date >= $3::date AND e.date <= $4::date
     )
     SELECT m.id AS member_id,
            count(s.id)::text AS total,
            count(a.id) FILTER (WHERE ${SATISFIED})::text AS count
     FROM members m
     LEFT JOIN scoped s ON s.date >= ${JOINED}
     LEFT JOIN attendance a ON a.member_id = m.id AND a.event_id = s.id
     WHERE m.id = ANY($1::uuid[])
     GROUP BY m.id`, [ctx.memberIds, key, start, ctx.asOf], ctx.client);
    return rows(result);
}
async function attendanceLastNOccurrences(ctx: EvalContext): Promise<Tally[]> {
    const key = String(ctx.rule.source_filter?.event_matrix_item_key ?? ctx.rule.item_key);
    const result = await query<{
        member_id: string;
        count: string;
        total: string;
    }>(`SELECT m.id AS member_id,
            COALESCE(t.total, 0)::text AS total,
            COALESCE(t.count, 0)::text AS count
     FROM members m
     LEFT JOIN LATERAL (
       SELECT count(*) AS total,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM attendance a
                WHERE a.member_id = m.id AND a.event_id = e.id AND ${SATISFIED}
              )) AS count
       FROM (
         SELECT ev.id FROM events ev
         WHERE ev.matrix_item_key = $2 AND ev.date <= $3::date AND ev.date >= ${JOINED}
         ORDER BY ev.date DESC, ev.id
         LIMIT $4
       ) e
     ) t ON true
     WHERE m.id = ANY($1::uuid[])`, [ctx.memberIds, key, ctx.asOf, ctx.rule.window_value ?? 3], ctx.client);
    return rows(result);
}
async function attendanceLastNSeries(ctx: EvalContext): Promise<Tally[]> {
    const key = String(ctx.rule.source_filter?.event_matrix_item_key ?? ctx.rule.item_key);
    const result = await query<{
        member_id: string;
        count: string;
        total: string;
    }>(`SELECT m.id AS member_id,
            COALESCE(t.total, 0)::text AS total,
            COALESCE(t.count, 0)::text AS count
     FROM members m
     LEFT JOIN LATERAL (
       SELECT count(*) AS total,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM attendance a
                WHERE a.member_id = m.id AND a.event_id = d.id AND ${SATISFIED}
              )) AS count
       FROM (
         SELECT ev.id
         FROM events ev
         JOIN (
           SELECT COALESCE(e2.novena_series_id, e2.id) AS series_id, max(e2.date) AS last_day
           FROM events e2
           WHERE e2.matrix_item_key = $2 AND e2.date <= $3::date AND e2.date >= ${JOINED}
           GROUP BY COALESCE(e2.novena_series_id, e2.id)
           ORDER BY last_day DESC, series_id
           LIMIT $4
         ) s ON s.series_id = COALESCE(ev.novena_series_id, ev.id)
         WHERE ev.matrix_item_key = $2 AND ev.date <= $3::date AND ev.date >= ${JOINED}
       ) d
     ) t ON true
     WHERE m.id = ANY($1::uuid[])`, [ctx.memberIds, key, ctx.asOf, ctx.rule.window_value ?? 3], ctx.client);
    return rows(result);
}
async function contributionMandatory(ctx: EvalContext): Promise<Tally[]> {
    const categories = categoriesFor(ctx.rule, ctx.config);
    const filter = ctx.rule.source_filter ?? {};
    const minAmount = typeof filter.min_amount === 'number'
        ? filter.min_amount
        : configNumber(ctx.config, String(filter.min_amount_config ?? ''), ctx.config.affiliation_min_amount);
    const year = DateTime.fromISO(ctx.asOf, { zone: NAIROBI }).year;
    const result = await query<{
        member_id: string;
        count: string;
        total: string;
    }>(`SELECT m.id AS member_id,
            '1' AS total,
            (CASE WHEN COALESCE(sum(c.amount), 0) >= $3 THEN 1 ELSE 0 END)::text AS count
     FROM members m
     LEFT JOIN contributions c
       ON c.member_id = m.id
      AND c.category = ANY($2::contribution_category[])
      AND c.affiliation_year = $4
      AND c.date <= $5::date
     WHERE m.id = ANY($1::uuid[])
     GROUP BY m.id`, [ctx.memberIds, categories, minAmount, year, ctx.asOf], ctx.client);
    return rows(result);
}
async function contributionMonthly(ctx: EvalContext): Promise<Tally[]> {
    const categories = categoriesFor(ctx.rule, ctx.config);
    const filter = ctx.rule.source_filter ?? {};
    const expected = configNumber(ctx.config, String(filter.expected_amount_config ?? ''), ctx.config.expected_monthly);
    const months = ctx.rule.window_value ?? 6;
    const satisfiedExpr = ctx.config.monthly_partial_satisfies
        ? 'COALESCE(sum(c.amount), 0) > 0'
        : 'COALESCE(sum(c.amount), 0) >= $4';
    const result = await query<{
        member_id: string;
        count: string;
        total: string;
    }>(`WITH months AS (
       SELECT generate_series(
                date_trunc('month', $3::date) - (($5::int - 1) || ' months')::interval,
                date_trunc('month', $3::date),
                interval '1 month'
              )::date AS month_start
     )
     SELECT m.id AS member_id,
            count(mo.month_start)::text AS total,
            count(*) FILTER (WHERE paid.satisfied)::text AS count
     FROM members m
     LEFT JOIN months mo ON mo.month_start >= date_trunc('month', m.created_at)::date
     LEFT JOIN LATERAL (
       SELECT (${satisfiedExpr}) AS satisfied
       FROM contributions c
       WHERE c.member_id = m.id
         AND c.category = ANY($2::contribution_category[])
         AND c.contribution_month = mo.month_start
     ) paid ON true
     WHERE m.id = ANY($1::uuid[])
     GROUP BY m.id`, [ctx.memberIds, categories, ctx.asOf, expected, months], ctx.client);
    return rows(result);
}
async function contributionLastNOccurrences(ctx: EvalContext): Promise<Tally[]> {
    const categories = categoriesFor(ctx.rule, ctx.config);
    const limit = ctx.rule.window_value ?? 3;
    const result = await query<{
        member_id: string;
        count: string;
        total: string;
    }>(`SELECT m.id AS member_id,
            COALESCE(t.total, 0)::text AS total,
            COALESCE(t.count, 0)::text AS count
     FROM members m
     LEFT JOIN LATERAL (
       SELECT count(*) AS total,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM contributions c2
                WHERE c2.member_id = m.id
                  AND c2.category = ANY($2::contribution_category[])
                  AND COALESCE(c2.event_id::text, c2.date::text) = o.occurrence_key
              )) AS count
       FROM (
         SELECT COALESCE(c.event_id::text, c.date::text) AS occurrence_key,
                max(c.date) AS occurred_on
         FROM contributions c
         WHERE c.category = ANY($2::contribution_category[])
           AND c.date <= $3::date
           AND c.date >= ${JOINED}
         GROUP BY COALESCE(c.event_id::text, c.date::text)
         ORDER BY occurred_on DESC, occurrence_key
         LIMIT $4
       ) o
     ) t ON true
     WHERE m.id = ANY($1::uuid[])`, [ctx.memberIds, categories, ctx.asOf, limit], ctx.client);
    return rows(result);
}
async function contributionFrequency(ctx: EvalContext): Promise<Tally[]> {
    const categories = categoriesFor(ctx.rule, ctx.config);
    const filter = ctx.rule.source_filter ?? {};
    const eventType = String(filter.occurrence_event_type ?? 'wedding');
    const months = ctx.rule.window_value ?? ctx.config.weddings_window_months;
    const start = rollingStart(months, ctx.asOf);
    const result = await query<{
        member_id: string;
        count: string;
        total: string;
    }>(`WITH occurrences AS (
       SELECT e.id, e.date FROM events e
       WHERE e.type = $4::event_type AND e.date >= $3::date AND e.date <= $5::date
     )
     SELECT m.id AS member_id,
            count(o.id)::text AS total,
            count(o.id) FILTER (WHERE EXISTS (
              SELECT 1 FROM contributions c
              WHERE c.member_id = m.id
                AND c.category = ANY($2::contribution_category[])
                AND c.event_id = o.id
            ))::text AS count
     FROM members m
     LEFT JOIN occurrences o ON o.date >= ${JOINED}
     WHERE m.id = ANY($1::uuid[])
     GROUP BY m.id`, [ctx.memberIds, categories, start, eventType, ctx.asOf], ctx.client);
    return rows(result);
}
export async function evaluateRule(rule: MatrixRule, config: MatrixConfig, memberIds: string[], options: {
    asOf?: string;
    client?: Queryable;
} = {}): Promise<Tally[]> {
    const ctx: EvalContext = {
        rule, config, memberIds,
        asOf: options.asOf ?? todayNairobi(),
        client: options.client,
    };
    if (rule.source_kind === 'attendance') {
        switch (rule.window_type) {
            case 'rolling_months': return attendanceRollingMonths(ctx);
            case 'last_n_occurrences': return attendanceLastNOccurrences(ctx);
            case 'last_n_series': return attendanceLastNSeries(ctx);
            default:
                throw new Error(`window_type "${rule.window_type}" is not valid for an attendance rule`);
        }
    }
    switch (rule.window_type) {
        case 'mandatory': return contributionMandatory(ctx);
        case 'rolling_months':
            return ctx.rule.source_filter?.per === 'month'
                ? contributionMonthly(ctx)
                : contributionLastNOccurrences(ctx);
        case 'last_n_occurrences': return contributionLastNOccurrences(ctx);
        case 'frequency': return contributionFrequency(ctx);
        default:
            throw new Error(`window_type "${rule.window_type}" is not valid for a contribution rule`);
    }
}
