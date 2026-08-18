const NAIROBI = 'Africa/Nairobi';
export function formatDate(value: string | null | undefined): string {
    if (!value)
        return '--';
    const date = new Date(value.length <= 10 ? `${value}T12:00:00+03:00` : value);
    if (Number.isNaN(date.getTime()))
        return '--';
    return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: NAIROBI,
    }).format(date);
}
export function formatDateTime(value: string | null | undefined): string {
    if (!value)
        return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return '--';
    return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: NAIROBI,
    }).format(date);
}
export function formatMonth(value: string | null | undefined): string {
    if (!value)
        return '--';
    const date = new Date(`${value.slice(0, 10)}T12:00:00+03:00`);
    if (Number.isNaN(date.getTime()))
        return '--';
    return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: NAIROBI }).format(date);
}
export function formatKes(amount: string | number | null | undefined): string {
    if (amount === null || amount === undefined)
        return '--';
    const value = typeof amount === 'string' ? Number(amount) : amount;
    if (Number.isNaN(value))
        return '--';
    return `KES ${value.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
const CONTRIBUTION_LABELS: Record<string, string> = {
    diocese_affiliation: 'Diocese affiliation',
    deanery_affiliation: 'Deanery affiliation',
    monthly_subscription: 'Monthly subscription',
    seminar_fee: 'Seminar fee',
    wedding: 'Wedding',
    benevolent_member_spouse: 'Benevolent - member or spouse',
    benevolent_child: 'Benevolent - child',
    benevolent_parent: 'Benevolent - parent',
    sick_admission: 'Sick admission',
    sick_visitation: 'Sick visitation (toa ndugu)',
    archbishop_support: 'Archbishop support',
    other: 'Other',
};
const OFFICE_LABELS: Record<string, string> = {
    coordinator: 'Coordinator',
    asst_coordinator: 'Assistant Coordinator',
    secretary: 'Secretary',
    asst_secretary: 'Assistant Secretary',
    treasurer: 'Treasurer',
    organizing_sec: 'Organizing Secretary',
    asst_organizing_sec: 'Assistant Organizing Secretary',
    liturgist: 'Liturgist',
    marriage_counselor: 'Marriage Counselor',
    shg_rep: 'SHG Representative',
};
const EVENT_LABELS: Record<string, string> = {
    mass: 'Mass',
    dominica: 'Dominica',
    prayer_house_meeting: 'Prayer house meeting',
    novena: 'Novena',
    seminar: 'Seminar',
    pilgrimage: 'Pilgrimage',
    national_prayer_day: 'National Prayer Day',
    family_day: 'Family Day',
    wedding: 'Wedding',
    agm: 'AGM',
    special_general_meeting: 'Special General Meeting',
    other: 'Other',
};
const MATRIX_ITEM_LABELS: Record<string, string> = {
    fridays: 'Fridays',
    dominica: 'Dominica',
    seminars: 'Seminars',
    novena: 'Novena',
};
function labelFrom(map: Record<string, string>, key: string | null | undefined): string {
    if (!key)
        return '--';
    return map[key] ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
export const contributionLabel = (k: string | null | undefined) => labelFrom(CONTRIBUTION_LABELS, k);
export const officeLabel = (k: string | null | undefined) => labelFrom(OFFICE_LABELS, k);
export const eventTypeLabel = (k: string | null | undefined) => labelFrom(EVENT_LABELS, k);
export const matrixItemLabel = (k: string | null | undefined) => labelFrom(MATRIX_ITEM_LABELS, k);
export function titleCase(value: string | null | undefined): string {
    if (!value)
        return '--';
    return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
