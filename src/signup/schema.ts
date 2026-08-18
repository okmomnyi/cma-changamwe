import { z } from 'zod';
const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => trimmed(max).optional().or(z.literal('')).transform((v) => (v ? v : null));
const mobile = trimmed(20)
    .min(7, 'Enter a valid mobile number')
    .regex(/^[+0-9][0-9\s-]{6,19}$/, 'Enter a valid mobile number');
const currentYear = new Date().getFullYear();
export const personalSchema = z.object({
    full_name: trimmed(160).min(3, 'Enter the full name'),
    year_of_birth: z.coerce
        .number()
        .int()
        .min(1900, 'Enter a valid year of birth')
        .max(currentYear - 16, 'Members must be at least 16 years old'),
    id_or_passport_no: trimmed(40).min(4, 'Enter the ID or passport number'),
    mobile_no: mobile,
    home_parish_diocese: optionalText(160),
    jumuiya: optionalText(120),
    prayer_house_id: z.string().uuid('Choose your prayer house'),
});
export const familySchema = z.object({
    marital_status: z.enum(['married', 'widowed', 'single'], {
        errorMap: () => ({ message: 'Choose a marital status' }),
    }),
    spouse_name: optionalText(160),
    spouse_status: z.enum(['alive', 'deceased']).nullish(),
    father_status: z.enum(['alive', 'deceased']).nullish(),
    mother_status: z.enum(['alive', 'deceased']).nullish(),
});
export const childSchema = z.object({
    name: trimmed(160).min(2, 'Enter the child name'),
    date_of_birth: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker')
        .nullish()
        .or(z.literal(''))
        .transform((v) => (v ? v : null)),
});
export const childrenSchema = z.object({
    children: z.array(childSchema).max(20, 'Contact the Secretary to record more than 20 children'),
});
export const nextOfKinSchema = z.object({
    next_of_kin_name: trimmed(160).min(3, 'Enter the next of kin name'),
    next_of_kin_id_no: optionalText(40),
    next_of_kin_mobile: mobile,
});
export const draftDataSchema = personalSchema
    .merge(familySchema)
    .merge(childrenSchema)
    .merge(nextOfKinSchema)
    .partial();
export const completeDraftSchema = personalSchema
    .merge(familySchema)
    .merge(childrenSchema)
    .merge(nextOfKinSchema)
    .superRefine((data, ctx) => {
    if (data.marital_status === 'married' && !data.spouse_name) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['spouse_name'],
            message: 'Enter your spouse name, or change your marital status',
        });
    }
});
export type DraftData = z.infer<typeof draftDataSchema>;
export type CompleteDraft = z.infer<typeof completeDraftSchema>;
export const STEPS = ['personal', 'family', 'children', 'next_of_kin', 'declaration'] as const;
export type Step = (typeof STEPS)[number];
export function missingMandatory(data: DraftData): string[] {
    const result = completeDraftSchema.safeParse(data);
    if (result.success)
        return [];
    return [...new Set(result.error.issues.map((i) => i.path.join('.')).filter(Boolean))];
}
