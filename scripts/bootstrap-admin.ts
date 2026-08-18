import 'dotenv/config';
import { hashPassword } from '../src/auth/password.js';
import { closePool, queryOne, withTransaction } from '../src/db/pool.js';
import { writeAudit } from '../src/audit/audit.js';
import { todayNairobi } from '../src/util/time.js';
function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
function required(name: string): string {
    const value = arg(name);
    if (!value) {
        console.error(`Missing --${name}`);
        process.exit(1);
    }
    return value;
}
const input = {
    fullName: required('name'),
    idNo: required('id-no'),
    mobile: required('mobile'),
    yearOfBirth: Number(required('year-of-birth')),
    prayerHouse: required('prayer-house'),
    maritalStatus: arg('marital-status') ?? 'married',
    nextOfKinName: required('next-of-kin'),
    nextOfKinMobile: required('next-of-kin-mobile'),
    username: required('username'),
    email: required('email'),
    password: required('password'),
    office: arg('office') ?? 'coordinator',
};
if (input.password.length < 12) {
    console.error('Refusing to create an administrator with a password under 12 characters.');
    process.exit(1);
}
try {
    const passwordHash = await hashPassword(input.password);
    const result = await withTransaction(async (client) => {
        const house = await queryOne<{
            id: string;
        }>(`SELECT id FROM prayer_houses WHERE lower(name) = lower($1)`, [input.prayerHouse], client);
        if (!house)
            throw new Error(`Unknown prayer house "${input.prayerHouse}"`);
        const member = await queryOne<{
            id: string;
        }>(`INSERT INTO members
         (full_name, year_of_birth, id_or_passport_no, mobile_no, prayer_house_id,
          marital_status, next_of_kin_name, next_of_kin_mobile,
          profile_locked, declaration_accepted_at)
       VALUES ($1, $2, $3, $4, $5, $6::marital_status, $7, $8, true, now())
       RETURNING id`, [
            input.fullName, input.yearOfBirth, input.idNo, input.mobile, house.id,
            input.maritalStatus, input.nextOfKinName, input.nextOfKinMobile,
        ], client);
        if (!member)
            throw new Error('member insert returned no row');
        const user = await queryOne<{
            id: string;
        }>(`INSERT INTO users (member_id, username, password_hash, email, email_verified)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id`, [member.id, input.username, passwordHash, input.email], client);
        if (!user)
            throw new Error('user insert returned no row');
        const office = await queryOne<{
            id: string;
        }>(`INSERT INTO office_holders (member_id, office_key, scope, term_start)
       VALUES ($1, $2, 'parish', $3::date)
       RETURNING id`, [member.id, input.office, todayNairobi()], client);
        if (!office)
            throw new Error('office insert returned no row');
        const actor = { userId: user.id, requestId: 'bootstrap-admin' };
        await writeAudit(client, {
            entityType: 'member', entityId: member.id, action: 'create',
            newValue: { full_name: input.fullName, prayer_house: input.prayerHouse, source: 'bootstrap' },
        }, actor);
        await writeAudit(client, {
            entityType: 'user', entityId: user.id, action: 'create',
            newValue: { username: input.username, email: input.email, source: 'bootstrap' },
        }, actor);
        await writeAudit(client, {
            entityType: 'office', entityId: office.id, action: 'create',
            newValue: { office_key: input.office, member_id: member.id, term_start: todayNairobi() },
        }, actor);
        return { memberId: member.id, userId: user.id };
    });
    console.log('Administrator created.');
    console.log(`  member id : ${result.memberId}`);
    console.log(`  user id   : ${result.userId}`);
    console.log(`  username  : ${input.username}`);
    console.log(`  office    : ${input.office} (term open, confers admin while sitting)`);
}
catch (err) {
    console.error('Bootstrap failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
}
finally {
    await closePool();
}
