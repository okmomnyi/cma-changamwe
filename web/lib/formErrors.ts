import { ApiError } from './api';
const FIELD_LABELS: Record<string, string> = {
    full_name: 'Full name',
    year_of_birth: 'Year of birth',
    id_or_passport_no: 'ID or passport number',
    mobile_no: 'Mobile number',
    home_parish_diocese: 'Home parish or diocese',
    jumuiya: 'Jumuiya',
    prayer_house_id: 'Prayer house',
    marital_status: 'Marital status',
    spouse_name: 'Spouse name',
    spouse_status: 'Spouse status',
    father_status: 'Father',
    mother_status: 'Mother',
    children: 'Children',
    next_of_kin_name: 'Next of kin name',
    next_of_kin_id_no: 'Next of kin ID number',
    next_of_kin_mobile: 'Next of kin mobile',
    username: 'Username',
    password: 'Password',
    declaration_accepted: 'Declaration',
    email: 'Email address',
    new_email: 'New email address',
    current_password: 'Current password',
    code: 'Verification code',
    member_id: 'Member',
    category: 'Category',
    amount: 'Amount',
    date: 'Date',
    contribution_month: 'Month it pays for',
    title: 'Title',
    type: 'Type',
    matrix_item_key: 'Matrix item',
    start_date: 'Start date',
    end_date: 'End date',
    weekday: 'Day of the week',
    office_key: 'Office',
    incoming_member_id: 'Incoming holder',
};
export function fieldLabel(path: string): string {
    const leaf = path.split('.').filter((part) => !/^\d+$/.test(part)).pop() ?? path;
    return FIELD_LABELS[leaf]
        ?? FIELD_LABELS[path]
        ?? leaf.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
export function fieldErrorsFrom(error: unknown): Record<string, string> {
    const result: Record<string, string> = {};
    if (!(error instanceof ApiError))
        return result;
    for (const issue of error.fields ?? []) {
        if (issue.path)
            result[issue.path] = issue.message;
    }
    const details = error.details as {
        missing?: string[];
    } | undefined;
    for (const path of details?.missing ?? []) {
        result[path] ??= 'This is required before you can finish.';
    }
    return result;
}
export function summariseError(error: unknown, fallback = 'Could not reach the server.'): string {
    if (!(error instanceof ApiError))
        return fallback;
    const fields = fieldErrorsFrom(error);
    const names = [...new Set(Object.keys(fields).map(fieldLabel))];
    if (names.length === 0)
        return error.message;
    if (names.length === 1)
        return `${names[0]}: ${Object.values(fields)[0]}`;
    return `${error.message} Check: ${names.join(', ')}.`;
}
