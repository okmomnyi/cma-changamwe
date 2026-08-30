import { DateTime } from 'luxon';
export const NAIROBI = 'Africa/Nairobi';
export function nowNairobi(): DateTime {
    return DateTime.now().setZone(NAIROBI);
}
export function todayNairobi(): string {
    return nowNairobi().toISODate()!;
}
export function currentPeriod(): string {
    return nowNairobi().toFormat('yyyy-MM');
}
export function previousPeriod(): string {
    return nowNairobi().minus({ months: 1 }).toFormat('yyyy-MM');
}
export function monthStart(isoDate: string): string {
    return DateTime.fromISO(isoDate, { zone: NAIROBI }).startOf('month').toISODate()!;
}
/** The last calendar day of a `yyyy-MM` period, which is what a snapshot for
 *  that period must be evaluated as of. */
export function periodEnd(period: string): string {
    return DateTime.fromISO(`${period}-01`, { zone: NAIROBI }).endOf('month').toISODate()!;
}
/** True once a period is wholly in the past, so a snapshot of it is final. */
export function periodHasEnded(period: string): boolean {
    return periodEnd(period) < todayNairobi();
}
