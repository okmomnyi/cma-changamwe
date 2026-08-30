import { query, type Queryable } from '../db/pool.js';
export interface Principal {
    userId: string;
    memberId: string;
    username: string;
    email: string;
    emailVerified: boolean;
    profileLocked: boolean;
    offices: string[];
    adminOffices: string[];
    isAdmin: boolean;
}
interface PrincipalRow {
    user_id: string;
    member_id: string;
    username: string;
    email: string;
    email_verified: boolean;
    profile_locked: boolean;
    offices: string[] | null;
    admin_offices: string[] | null;
}
export async function loadPrincipal(userId: string, client?: Queryable): Promise<Principal | null> {
    const res = await query<PrincipalRow>(`WITH admin_cfg AS (
       SELECT v AS office_key
       FROM matrix_config c,
            LATERAL jsonb_array_elements_text(c.value) AS v
       WHERE c.key = 'admin_offices'
     ),
     held AS (
       SELECT oh.office_key, oh.scope
       FROM office_holders oh
       JOIN users u ON u.member_id = oh.member_id
       WHERE u.id = $1 AND oh.term_end IS NULL
     )
     SELECT u.id AS user_id,
            u.member_id,
            u.username,
            u.email,
            u.email_verified,
            m.profile_locked,
            (SELECT array_agg(office_key ORDER BY office_key) FROM held) AS offices,
            -- Scope matters. The governance structure runs parish above prayer
            -- house, so a house coordinator holds authority over that house and
            -- not over the parish. Only a sitting parish term confers
            -- administrative access.
            (SELECT array_agg(office_key ORDER BY office_key)
               FROM held
               WHERE scope = 'parish'
                 AND office_key IN (SELECT office_key FROM admin_cfg)) AS admin_offices
     FROM users u
     JOIN members m ON m.id = u.member_id
     WHERE u.id = $1`, [userId], client);
    const row = res.rows[0];
    if (!row)
        return null;
    const adminOffices = row.admin_offices ?? [];
    return {
        userId: row.user_id,
        memberId: row.member_id,
        username: row.username,
        email: row.email,
        emailVerified: row.email_verified,
        profileLocked: row.profile_locked,
        offices: row.offices ?? [],
        adminOffices,
        isAdmin: adminOffices.length > 0,
    };
}
