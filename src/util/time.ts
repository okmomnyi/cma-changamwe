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
export function monthStart(isoDate: string): string {
    return DateTime.fromISO(isoDate, { zone: NAIROBI }).startOf('month').toISODate()!;
}
export function rollingWindowStart(months: number, end: string = todayNairobi()): string {
    return DateTime.fromISO(end, { zone: NAIROBI })
        .minus({ months })
        .plus({ days: 1 })
        .toISODate()!;
}
export function currentAffiliationYear(): number {
    return nowNairobi().year;
}
