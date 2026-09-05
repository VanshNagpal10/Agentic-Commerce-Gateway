import { db } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit';
import { OrderStatus } from '@prisma/client';

const VALID_TRANSITIONS: Record<string, string[]> = {
  'QUOTED': ['POLICY_APPROVED', 'PENDING_APPROVAL', 'POLICY_DENIED', 'CANCELLED'],
  'PENDING_APPROVAL': ['POLICY_APPROVED', 'POLICY_DENIED', 'CANCELLED'],
  'POLICY_APPROVED': ['PAYMENT_PENDING', 'CANCELLED'],
  'PAYMENT_PENDING': ['PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'PAYMENT_UNKNOWN', 'CANCELLED'],
  'PAYMENT_UNKNOWN': ['PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'CANCELLED'],
  'PAYMENT_FAILED': ['PAYMENT_PENDING', 'CANCELLED'],
  'PAYMENT_SUCCESS': ['CONFIRMED', 'CANCELLED'],
  'CONFIRMED': [],
  'CANCELLED': [],
  'POLICY_DENIED': [],
};

export function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export async function transitionOrder(
  orderId: string, 
  newStatus: string, 
  traceId: string, 
  actor?: string
): Promise<{ success: boolean; order?: { id: string; status: string }; error?: string }> {
  try {
    const order = await db.order.findUnique({
      where: { id: orderId }
    });

    if (!order) {
      return { success: false, error: 'Order not found' };
    }

    if (!isValidTransition(order.status, newStatus)) {
      return { success: false, error: `Invalid transition from ${order.status} to ${newStatus}` };
    }

    const updatedOrder = await db.order.update({
      where: { id: orderId },
      data: { status: newStatus as OrderStatus }
    });

    await logAuditEvent({
      traceId,
      eventType: 'STATE_CHANGE',
      actor,
      input: { from: order.status, to: newStatus },
      output: { orderId: updatedOrder.id }
    });

    return { success: true, order: updatedOrder };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}
