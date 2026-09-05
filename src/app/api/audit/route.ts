import { NextRequest, NextResponse } from 'next/server';
import { getTraceEvents } from '@/lib/audit';
import { db } from '@/lib/db';

// GET /api/audit?traceId=xxx — Get all audit events for a single trace
// GET /api/audit?merchantId=xxx — Get recent traces grouped for a merchant
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const traceId = searchParams.get('traceId');
    const merchantId = searchParams.get('merchantId');
    const limit = parseInt(searchParams.get('limit') || '100');

    if (traceId) {
      const events = await getTraceEvents(traceId);

      // Also fetch the order for this trace to get buyer intent
      const order = await db.order.findFirst({
        where: { traceId },
        select: { buyerIntent: true, total: true, status: true, createdAt: true },
      });

      const traces = [{
        traceId,
        buyerIntent: order?.buyerIntent || null,
        orderTotal: order?.total ? order.total / 100 : null,
        orderStatus: order?.status || null,
        createdAt: order?.createdAt || (events.length > 0 ? events[0].createdAt : new Date()),
        events: events.map(e => ({
          id: e.id,
          type: e.eventType,
          timestamp: e.createdAt.toISOString(),
          actor: e.actor,
          toolName: e.toolName,
          policyDecision: e.policyDecision,
          policyReason: e.policyReason,
          latencyMs: e.latencyMs,
          details: {
            ...(e.input ? { input: e.input } : {}),
            ...(e.output ? { output: e.output } : {}),
            ...(e.toolName ? { tool: e.toolName } : {}),
            ...(e.policyDecision ? { decision: e.policyDecision } : {}),
            ...(e.policyReason ? { reason: e.policyReason } : {}),
            ...(e.latencyMs ? { latencyMs: e.latencyMs } : {}),
          },
        })),
      }];

      return NextResponse.json({ traces });
    }

    if (merchantId) {
      // Get traces for this merchant's orders
      const orders = await db.order.findMany({
        where: { merchantId },
        select: { traceId: true, buyerIntent: true, total: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      const traceIds = [...new Set(orders.map((o) => o.traceId))];

      if (traceIds.length === 0) {
        return NextResponse.json({ traces: [] });
      }

      const events = await db.auditEvent.findMany({
        where: { traceId: { in: traceIds } },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });

      // Group events by traceId
      const groupedMap = new Map<string, typeof events>();
      for (const event of events) {
        const existing = groupedMap.get(event.traceId) || [];
        existing.push(event);
        groupedMap.set(event.traceId, existing);
      }

      // Build traces with order metadata
      const traces = traceIds
        .filter(tid => groupedMap.has(tid))
        .map(tid => {
          const traceEvents = groupedMap.get(tid)!;
          const order = orders.find(o => o.traceId === tid);
          return {
            traceId: tid,
            buyerIntent: order?.buyerIntent || null,
            orderTotal: order?.total ? order.total / 100 : null,
            orderStatus: order?.status || null,
            createdAt: order?.createdAt || traceEvents[0]?.createdAt || new Date(),
            events: traceEvents.map(e => ({
              id: e.id,
              type: e.eventType,
              timestamp: e.createdAt.toISOString(),
              actor: e.actor,
              toolName: e.toolName,
              policyDecision: e.policyDecision,
              policyReason: e.policyReason,
              latencyMs: e.latencyMs,
              details: {
                ...(e.input ? { input: e.input } : {}),
                ...(e.output ? { output: e.output } : {}),
                ...(e.toolName ? { tool: e.toolName } : {}),
                ...(e.policyDecision ? { decision: e.policyDecision } : {}),
                ...(e.policyReason ? { reason: e.policyReason } : {}),
                ...(e.latencyMs ? { latencyMs: e.latencyMs } : {}),
              },
            })),
          };
        });

      return NextResponse.json({ traces });
    }

    return NextResponse.json({ error: 'traceId or merchantId required' }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
