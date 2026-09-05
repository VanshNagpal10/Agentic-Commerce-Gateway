import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { transitionOrder } from '@/lib/state-machine';
import { logAuditEvent } from '@/lib/audit';

// GET /api/approvals?merchantId=xxx — Get pending approvals
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const merchantId = searchParams.get('merchantId');

    if (!merchantId) {
      return NextResponse.json({ error: 'merchantId required' }, { status: 400 });
    }

    const pendingOrders = await db.order.findMany({
      where: {
        merchantId,
        status: 'PENDING_APPROVAL',
      },
      orderBy: { createdAt: 'desc' },
      include: {
        payments: true,
      },
    });

    // Get policy reasons from audit events
    const ordersWithReasons = await Promise.all(
      pendingOrders.map(async (order) => {
        const policyEvent = await db.auditEvent.findFirst({
          where: {
            traceId: order.traceId,
            eventType: 'POLICY_DECISION',
            policyDecision: 'APPROVAL_REQUIRED',
          },
          orderBy: { createdAt: 'desc' },
        });

        return {
          ...order,
          totalRupees: order.total / 100,
          policyReason: policyEvent?.policyReason || 'Amount exceeds autonomous spend limit',
        };
      })
    );

    return NextResponse.json({ approvals: ordersWithReasons });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/approvals — Approve or deny an order
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderId, decision } = body; // decision: 'approve' | 'deny'

    if (!orderId || !decision) {
      return NextResponse.json({ error: 'orderId and decision required' }, { status: 400 });
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (order.status !== 'PENDING_APPROVAL') {
      return NextResponse.json({ error: 'Order is not pending approval' }, { status: 400 });
    }

    const newStatus = decision === 'approve' ? 'POLICY_APPROVED' : 'POLICY_DENIED';
    const result = await transitionOrder(orderId, newStatus, order.traceId, 'merchant');

    await logAuditEvent({
      traceId: order.traceId,
      eventType: 'POLICY_DECISION',
      actor: 'merchant',
      toolName: 'manual_approval',
      input: { orderId, decision },
      output: { newStatus },
      policyDecision: decision === 'approve' ? 'ALLOW' : 'DENY',
      policyReason: decision === 'approve' ? 'Manually approved by merchant' : 'Manually denied by merchant',
    });

    return NextResponse.json({
      success: result.success,
      order: result.order,
      decision,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
