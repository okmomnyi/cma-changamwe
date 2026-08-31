import type { PoolClient } from 'pg';
import { query } from '../db/pool.js';
export type AuditEntityType = 'member' | 'attendance' | 'contribution' | 'office' | 'user' | 'event' | 'welfare_claim' | 'attendance_sheet' | 'attendance_scan';
export type AuditAction = 'create' | 'update' | 'delete';
export interface AuditActor {
    userId: string | null;
    requestId?: string | null;
    ip?: string | null;
}
export interface AuditEntry {
    entityType: AuditEntityType;
    entityId: string | null;
    action: AuditAction;
    fieldChanged?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
}
function serialise(value: unknown): string | null {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'string')
        return value;
    if (value instanceof Date)
        return value.toISOString();
    return JSON.stringify(value);
}
export async function writeAudit(client: PoolClient, entry: AuditEntry, actor: AuditActor): Promise<void> {
    await query(`INSERT INTO audit_log
       (entity_type, entity_id, action, field_changed, old_value, new_value,
        changed_by, request_id, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
        entry.entityType,
        entry.entityId,
        entry.action,
        entry.fieldChanged ?? null,
        serialise(entry.oldValue),
        serialise(entry.newValue),
        actor.userId,
        actor.requestId ?? null,
        actor.ip ?? null,
    ], client);
}
export async function auditFieldChanges(client: PoolClient, params: {
    entityType: AuditEntityType;
    entityId: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    fields: readonly string[];
}, actor: AuditActor): Promise<string[]> {
    const changed: string[] = [];
    for (const field of params.fields) {
        const oldValue = serialise(params.before[field]);
        const newValue = serialise(params.after[field]);
        if (oldValue === newValue)
            continue;
        changed.push(field);
        await writeAudit(client, {
            entityType: params.entityType,
            entityId: params.entityId,
            action: 'update',
            fieldChanged: field,
            oldValue,
            newValue,
        }, actor);
    }
    return changed;
}
