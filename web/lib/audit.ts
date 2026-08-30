/**
 * Turns an audit row into something a Secretary can read.
 *
 * The log stores whatever the change was: a single field with its old and new
 * value, or a JSON blob for a record that was created or removed. Neither reads
 * well raw, so this renders a sentence and, where it helps, the fields beneath.
 */

export interface AuditRow {
    id: string;
    entity_type: string;
    entity_id: string | null;
    action: string;
    field_changed: string | null;
    old_value: string | null;
    new_value: string | null;
    changed_at: string;
    changed_by_username: string | null;
    changed_by_name: string | null;
}

export interface AuditDetail {
    label: string;
    from?: string;
    to?: string;
}

export interface AuditDescription {
    summary: string;
    details: AuditDetail[];
}

const FIELD_LABELS: Record<string, string> = {
    full_name: 'Full name',
    year_of_birth: 'Year of birth',
    id_or_passport_no: 'ID or passport number',
    mobile_no: 'Mobile number',
    home_parish_diocese: 'Home parish or diocese',
    jumuiya: 'Jumuiya',
    prayer_house_id: 'Prayer house',
    prayer_house: 'Prayer house',
    marital_status: 'Marital status',
    spouse_name: 'Spouse name',
    spouse_status: 'Spouse',
    father_status: 'Father',
    mother_status: 'Mother',
    next_of_kin_name: 'Next of kin',
    next_of_kin_id_no: 'Next of kin ID',
    next_of_kin_mobile: 'Next of kin mobile',
    membership_status: 'Membership',
    profile_locked: 'Bio-data complete',
    declaration_accepted_at: 'Declaration accepted',
    children: 'Children',
    photo: 'Photograph',
    email: 'Email address',
    password_hash: 'Password',
    username: 'Username',
    office_key: 'Office',
    scope: 'Level',
    term_start: 'Term began',
    term_end: 'Term ended',
    status: 'Status',
    reason: 'Reason',
    title: 'Title',
    date: 'Date',
    matrix_item_key: 'Counts toward',
    category: 'Category',
    amount: 'Amount',
    contribution_month: 'For the month',
    affiliation_year: 'For the year',
    note: 'Note',
    support_type: 'Kind of support',
    subject_name: 'Concerning',
    period: 'Month used',
    standing_relied_on: 'Standing',
    score_relied_on: 'Score',
    payment_reference: 'Payment reference',
    paid_on: 'Paid on',
    decision_note: 'Decision note',
    override_reason: 'Committee exception',
    term_limit_override: 'Committee exception',
    source: 'Entered by',
    series: 'Repeats',
    replaced: 'Replaced',
    novena_series_id: 'Novena series',
    day: 'Day',
    joined_on: 'Commissioned on',
    member: 'Member',
};

/** Identifiers and internal keys carry nothing a reader can use. */
const HIDDEN = new Set([
    'member_id', 'event_id', 'child_id', 'user_id', 'matrix_score_id',
    'prayer_house_id', 'novena_series_id', 'replaced', 'id',
]);

const RECORD_NAMES: Record<string, string> = {
    member: 'member',
    attendance: 'attendance',
    contribution: 'contribution',
    office: 'office term',
    user: 'account',
    event: 'event',
    welfare_claim: 'welfare claim',
};

const ACTION_VERBS: Record<string, Record<string, string>> = {
    create: {
        member: 'Enrolled a member',
        attendance: 'Recorded attendance',
        contribution: 'Recorded a contribution',
        office: 'Opened an office term',
        user: 'Created an account',
        event: 'Added an event',
        welfare_claim: 'Opened a welfare claim',
    },
    update: {
        member: 'Changed a member record',
        attendance: 'Changed an attendance entry',
        contribution: 'Changed a contribution',
        office: 'Changed an office term',
        user: 'Changed an account',
        event: 'Changed an event',
        welfare_claim: 'Changed a welfare claim',
    },
    delete: {
        member: 'Removed a member',
        attendance: 'Removed an attendance entry',
        contribution: 'Removed a contribution',
        office: 'Removed an office term',
        user: 'Removed an account',
        event: 'Removed an event',
        welfare_claim: 'Removed a welfare claim',
    },
};

export function fieldLabel(key: string): string {
    return FIELD_LABELS[key] ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function readable(value: unknown): string {
    if (value === null || value === undefined || value === '') return 'nothing';
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) {
        if (value.length === 0) return 'none';
        return value.map((v) => (typeof v === 'object' && v !== null
            ? Object.values(v as Record<string, unknown>).filter(Boolean).join(', ')
            : String(v))).join('; ');
    }
    if (typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>)
            .filter(([k]) => !HIDDEN.has(k))
            .map(([k, v]) => `${fieldLabel(k)}: ${readable(v)}`)
            .join(', ');
    }
    const text = String(value);
    // A bare uuid means nothing to a reader.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return 'a record';
    if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.slice(0, 10);
    if (text === 'true') return 'yes';
    if (text === 'false') return 'no';
    return text.replace(/_/g, ' ');
}

function parse(value: string | null): unknown {
    if (value === null) return null;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return value;
    }
}

export function describeAudit(row: AuditRow): AuditDescription {
    const record = RECORD_NAMES[row.entity_type] ?? row.entity_type.replace(/_/g, ' ');
    const verb = ACTION_VERBS[row.action]?.[row.entity_type]
        ?? `${row.action.replace(/^./, (c) => c.toUpperCase())}d a ${record}`;

    const oldValue = parse(row.old_value);
    const newValue = parse(row.new_value);
    const details: AuditDetail[] = [];

    // A single named field that moved from one value to another.
    if (row.field_changed) {
        const label = fieldLabel(row.field_changed);
        // Some entries put a whole object on both sides even when a field is named.
        if (typeof newValue === 'object' && newValue !== null && !Array.isArray(newValue)) {
            const after = newValue as Record<string, unknown>;
            const before = (typeof oldValue === 'object' && oldValue !== null ? oldValue : {}) as Record<string, unknown>;
            for (const [key, value] of Object.entries(after)) {
                if (HIDDEN.has(key)) continue;
                const shown = readable(value);
                if (shown === 'nothing' || shown === 'none') continue;
                const was = before[key] === undefined ? undefined : readable(before[key]);
                details.push(was !== undefined && was !== shown && was !== 'nothing'
                    ? { label: fieldLabel(key), from: was, to: shown }
                    : { label: fieldLabel(key), to: shown });
            }
            return { summary: `${verb}: ${label.toLowerCase()}`, details };
        }
        const from = readable(oldValue);
        const to = readable(newValue);
        details.push(from === 'nothing' ? { label, to } : { label, from, to });
        return { summary: verb, details };
    }

    // A whole record, created or removed. A field that was never set carries
    // nothing worth a line of its own.
    const blob = (newValue ?? oldValue);
    if (typeof blob === 'object' && blob !== null && !Array.isArray(blob)) {
        for (const [key, value] of Object.entries(blob as Record<string, unknown>)) {
            if (HIDDEN.has(key)) continue;
            const shown = readable(value);
            if (shown === 'nothing' || shown === 'none') continue;
            details.push({ label: fieldLabel(key), to: shown });
        }
    }
    else if (blob !== null) {
        details.push({ label: 'Value', to: readable(blob) });
    }

    return { summary: verb, details };
}

/** The one line worth leading with, so a scan reads as prose. */
export function auditHeadline(row: AuditRow): string {
    const blob = parse(row.new_value ?? row.old_value);
    if (typeof blob === 'object' && blob !== null && !Array.isArray(blob)) {
        const o = blob as Record<string, unknown>;
        const name = o.full_name ?? o.member ?? o.title ?? o.username ?? o.subject_name;
        if (typeof name === 'string' && name) return name;
    }
    return '';
}
