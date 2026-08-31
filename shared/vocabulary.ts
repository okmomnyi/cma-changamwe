/**
 * Vocabularies the API and the interface must agree on. Each would otherwise
 * exist three times: a Postgres enum, a Zod validator, and a set of form
 * options. The enum stays in its migration; the other two read from here.
 *
 * Imports nothing, so NodeNext and bundler resolution can both consume it.
 * Adding a value here does not add it to the database: migrate first.
 */

export const EVENT_TYPES = [
    { value: 'mass', label: 'Mass' },
    { value: 'dominica', label: 'Dominica' },
    { value: 'prayer_house_meeting', label: 'Prayer house meeting' },
    { value: 'novena', label: 'Novena' },
    { value: 'seminar', label: 'Seminar' },
    { value: 'pilgrimage', label: 'Pilgrimage' },
    { value: 'national_prayer_day', label: 'National Prayer Day' },
    { value: 'family_day', label: 'Family Day' },
    { value: 'wedding', label: 'Wedding' },
    { value: 'agm', label: 'AGM' },
    { value: 'special_general_meeting', label: 'Special General Meeting' },
    { value: 'choir', label: 'Choir' },
    { value: 'act_of_mercy', label: 'Act of Mercy' },
    { value: 'mentorship', label: 'Mentorship (boys)' },
    { value: 'sports', label: 'Sports' },
    { value: 'shg_activity', label: 'Self Help Group' },
    { value: 'other', label: 'Other' },
] as const;

/**
 * By-laws section 6. `scored` says whether the Matrix has a rule that draws on
 * the category; `other` is recorded and shown but feeds nothing, which the
 * interface says out loud rather than leaving a treasurer to discover.
 */
export const CONTRIBUTION_CATEGORIES = [
    { value: 'diocese_affiliation', label: 'Diocese affiliation', scored: true },
    { value: 'deanery_affiliation', label: 'Deanery affiliation', scored: true },
    { value: 'monthly_subscription', label: 'Monthly subscription', scored: true },
    { value: 'seminar_fee', label: 'Seminar fee', scored: true },
    { value: 'wedding', label: 'Wedding', scored: true },
    { value: 'benevolent_member_spouse', label: 'Benevolent - member or spouse', scored: true },
    { value: 'benevolent_child', label: 'Benevolent - child', scored: true },
    { value: 'benevolent_parent', label: 'Benevolent - parent', scored: true },
    { value: 'sick_admission', label: 'Sick admission', scored: true },
    { value: 'sick_visitation', label: 'Sick visitation (toa ndugu)', scored: true },
    { value: 'archbishop_support', label: 'Archbishop support', scored: true },
    { value: 'other', label: 'Other', scored: false },
] as const;

/** By-laws section 5.3. */
export const WELFARE_SUPPORT_TYPES = [
    { value: 'pre_wedding', label: 'Pre-wedding support' },
    { value: 'wedding_gift', label: 'Wedding gift' },
    { value: 'sickness_advance', label: 'Sickness advance' },
    { value: 'benevolent_member_spouse', label: 'Benevolent, member or spouse' },
    { value: 'benevolent_child', label: 'Benevolent, child' },
    { value: 'benevolent_parent', label: 'Benevolent, parent' },
] as const;

export const ATTENDANCE_STATUSES = [
    { value: 'present', label: 'Present' },
    { value: 'apology', label: 'Apology' },
    { value: 'absent', label: 'Absent' },
] as const;

/**
 * How an attendance row came to be recorded. Phase 9 added a second path:
 * a sheet printed from the register, ticked by hand, then photographed and
 * read. Manual entry is never withdrawn, so an unreadable sheet cannot stop
 * attendance being recorded.
 */
export const ATTENDANCE_SOURCES = [
    { value: 'manual', label: 'Entered by hand' },
    { value: 'omr', label: 'Read off a sheet' },
] as const;

/** Where a photographed sheet has reached in the pipeline. */
export const ATTENDANCE_SCAN_STATUSES = [
    { value: 'uploaded', label: 'Uploaded' },
    { value: 'registered', label: 'Squared up' },
    { value: 'detected', label: 'Read, awaiting review' },
    { value: 'reviewed', label: 'Reviewed' },
    { value: 'committed', label: 'Committed' },
    { value: 'rejected', label: 'Rejected' },
] as const;

export const MEMBERSHIP_STATUSES = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'transferred', label: 'Transferred' },
    { value: 'deceased', label: 'Deceased' },
] as const;

export const MATRIX_STANDINGS = [
    { value: 'in_good_standing', label: 'In good standing' },
    { value: 'below_threshold', label: 'Below the threshold' },
    { value: 'insufficient_history', label: 'Not enough history yet' },
    { value: 'ineligible_gate', label: 'Not currently eligible' },
] as const;

type Vocab = readonly { readonly value: string; readonly label: string }[];

/**
 * The values alone, in the shape Zod's `z.enum` wants, and carrying the literal
 * union rather than widening to `string`. That is what keeps the validator, the
 * handler and the database enum checking each other at compile time.
 */
export function valuesOf<T extends Vocab>(vocab: T): [T[number]['value'], ...T[number]['value'][]] {
    return vocab.map((v) => v.value) as [T[number]['value'], ...T[number]['value'][]];
}


export type EventType = (typeof EVENT_TYPES)[number]['value'];
export type ContributionCategory = (typeof CONTRIBUTION_CATEGORIES)[number]['value'];
export type WelfareSupportType = (typeof WELFARE_SUPPORT_TYPES)[number]['value'];
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]['value'];
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number]['value'];
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number]['value'];
export type AttendanceScanStatus = (typeof ATTENDANCE_SCAN_STATUSES)[number]['value'];
export type MatrixStanding = (typeof MATRIX_STANDINGS)[number]['value'];
