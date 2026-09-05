import { db } from '@/lib/db';

export async function logAuditEvent(params: {
  traceId: string;
  eventType: string; // TOOL_CALL, POLICY_DECISION, STATE_CHANGE, PAYMENT_EVENT, ERROR
  actor?: string;
  toolName?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output?: any;
  policyDecision?: string;
  policyReason?: string;
  latencyMs?: number;
}): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        traceId: params.traceId,
        eventType: params.eventType,
        actor: params.actor,
        toolName: params.toolName,
        input: params.input ?? undefined,
        output: params.output ?? undefined,
        policyDecision: params.policyDecision,
        policyReason: params.policyReason,
        latencyMs: params.latencyMs,
      }
    });
  } catch (error) {
    // Silently handle audit log errors to prevent blocking main flows
    console.error('Failed to log audit event:', error);
  }
}

export async function getTraceEvents(traceId: string) {
  return db.auditEvent.findMany({
    where: { traceId },
    orderBy: { createdAt: 'asc' }
  });
}
