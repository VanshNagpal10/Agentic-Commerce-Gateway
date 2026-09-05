/**
 * Scenario harness for the Agentic Commerce Gateway.
 * Runs synthetic buyer flows against the real tools + policy engine + state machine.
 * Razorpay network calls are stubbed so this runs without hitting the gateway.
 *
 *   npm run eval
 */
// Fake keys BEFORE importing anything that reads them, so razorpayConfigured()
// returns true without touching real credentials. No real network call is made
// because we stub razorpay.orders below.
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_EVALSTUB';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'evalstubsecret';

import { db } from '../src/lib/db';
import { razorpay, type RazorpaySettlementState } from '../src/lib/razorpay';
import { executeToolCall, type ToolContext } from '../src/lib/tools/handlers';
import { v4 as uuidv4 } from 'uuid';

const MERCHANT = 'merchant_sportgear';

// ─── Stub Razorpay so no real network/charges happen ───
// razorpay.orders is a mutable object property, so we can swap it. The real
// fetchRazorpayOrderState() delegates to these methods, so stubbing them is
// enough to exercise the full status-fetch / recovery path deterministically.
let mockSettlement: RazorpaySettlementState = 'UNKNOWN';
let rzpOrderCounter = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(razorpay as any).orders = {
  create: async (opts: { amount: number }) => ({
    id: `order_MOCK${++rzpOrderCounter}`,
    amount: opts.amount,
    status: 'created',
  }),
  fetch: async (id: string) => ({ id, status: mockSettlement === 'PAID' ? 'paid' : 'created' }),
  fetchPayments: async () =>
    mockSettlement === 'PAID'
      ? { items: [{ id: 'pay_MOCK1', status: 'captured' }] }
      : { items: [] },
};

interface Result { name: string; pass: boolean; detail: string; traceId: string; }
const results: Result[] = [];

function ctx(traceId: string): ToolContext {
  return { merchantId: MERCHANT, traceId };
}

async function findProduct(where: Record<string, unknown>) {
  const p = await db.product.findFirst({ where: { merchantId: MERCHANT, ...where } });
  if (!p) throw new Error(`No product for ${JSON.stringify(where)}`);
  return p;
}

async function record(name: string, traceId: string, fn: () => Promise<{ pass: boolean; detail: string }>) {
  try {
    const { pass, detail } = await fn();
    results.push({ name, pass, detail, traceId });
  } catch (e: unknown) {
    results.push({ name, pass: false, detail: `threw: ${e instanceof Error ? e.message : e}`, traceId });
  }
}

async function scenarioHappyPath() {
  const traceId = `eval_happy_${uuidv4()}`;
  await record('Happy path (allow → approved)', traceId, async () => {
    const shoe = await findProduct({ category: 'running_shoes' });
    const quote = await executeToolCall('quote_order', { items: [{ productId: shoe.id, quantity: 1 }] }, ctx(traceId));
    const orderId = quote.orderId as string;
    const created = await executeToolCall('create_order', { quoteOrderId: orderId }, ctx(traceId));
    const order = await db.order.findUnique({ where: { id: orderId } });
    const pass = created.policyDecision === 'ALLOW' && order?.status === 'POLICY_APPROVED';
    return { pass, detail: `decision=${created.policyDecision} status=${order?.status}` };
  });
}

async function scenarioPolicyDeny() {
  const traceId = `eval_deny_${uuidv4()}`;
  await record('Policy deny (gift_cards restricted)', traceId, async () => {
    let gift = await db.product.findFirst({ where: { merchantId: MERCHANT, category: 'gift_cards' } });
    if (!gift) {
      gift = await db.product.create({
        data: {
          merchantId: MERCHANT, sku: `EVAL-GC-${Date.now()}`, title: 'Eval Gift Card',
          description: 'Temporary eval gift card product for restricted-category testing.',
          category: 'gift_cards', price: 200000, stock: 100, deliveryDays: 1,
        },
      });
    }
    const quote = await executeToolCall('quote_order', { items: [{ productId: gift.id, quantity: 1 }] }, ctx(traceId));
    const orderId = quote.orderId as string;
    const created = await executeToolCall('create_order', { quoteOrderId: orderId }, ctx(traceId));
    const order = await db.order.findUnique({ where: { id: orderId } });
    const payments = await db.payment.count({ where: { orderId } });
    const pass = created.policyDecision === 'DENY' && order?.status === 'POLICY_DENIED' && payments === 0;
    return { pass, detail: `decision=${created.policyDecision} status=${order?.status} payments=${payments}` };
  });
}

async function scenarioApprovalRequired() {
  const traceId = `eval_approval_${uuidv4()}`;
  await record('Approval required + merchant approve', traceId, async () => {
    const policy = await db.policy.findUnique({ where: { merchantId: MERCHANT } });
    if (!policy) return { pass: false, detail: 'no policy' };
    // Pick a product priced between maxAutoSpend and approvalThreshold.
    const target = await db.product.findFirst({
      where: { merchantId: MERCHANT, price: { gt: policy.maxAutoSpend, lte: policy.approvalThreshold } },
    });
    if (!target) return { pass: false, detail: 'no product in approval band' };
    const quote = await executeToolCall('quote_order', { items: [{ productId: target.id, quantity: 1 }] }, ctx(traceId));
    const orderId = quote.orderId as string;
    const created = await executeToolCall('create_order', { quoteOrderId: orderId }, ctx(traceId));
    if (created.policyDecision !== 'APPROVAL_REQUIRED') {
      return { pass: false, detail: `expected APPROVAL_REQUIRED got ${created.policyDecision}` };
    }
    // Simulate merchant approval via the state machine.
    const { transitionOrder } = await import('../src/lib/state-machine');
    await transitionOrder(orderId, 'POLICY_APPROVED', traceId, 'merchant');
    const order = await db.order.findUnique({ where: { id: orderId } });
    return { pass: order?.status === 'POLICY_APPROVED', detail: `finalStatus=${order?.status}` };
  });
}

async function scenarioIdempotency() {
  const traceId = `eval_idem_${uuidv4()}`;
  await record('Idempotency (same cart → same order)', traceId, async () => {
    const shoe = await findProduct({ category: 'running_shoes' });
    const q1 = await executeToolCall('quote_order', { items: [{ productId: shoe.id, quantity: 2 }] }, ctx(traceId));
    const q2 = await executeToolCall('quote_order', { items: [{ productId: shoe.id, quantity: 2 }] }, ctx(traceId));
    const pass = q1.orderId === q2.orderId && q2.idempotent === true;
    return { pass, detail: `order1=${q1.orderId} order2=${q2.orderId} idempotent=${q2.idempotent}` };
  });
}

async function scenarioInvalidTransition() {
  const traceId = `eval_badjump_${uuidv4()}`;
  await record('Invalid transition rejected (QUOTED → CONFIRMED)', traceId, async () => {
    const shoe = await findProduct({ category: 'running_shoes' });
    const quote = await executeToolCall('quote_order', { items: [{ productId: shoe.id, quantity: 1 }] }, ctx(traceId));
    const orderId = quote.orderId as string;
    const { transitionOrder } = await import('../src/lib/state-machine');
    const res = await transitionOrder(orderId, 'CONFIRMED', traceId, 'agent');
    const order = await db.order.findUnique({ where: { id: orderId } });
    const pass = res.success === false && order?.status === 'QUOTED';
    return { pass, detail: `rejected=${!res.success} status=${order?.status}` };
  });
}

async function scenarioFailureRecovery() {
  const traceId = `eval_recovery_${uuidv4()}`;
  await record('Failure recovery (timeout → unknown → no double order)', traceId, async () => {
    const shoe = await findProduct({ category: 'running_shoes' });
    const quote = await executeToolCall('quote_order', { items: [{ productId: shoe.id, quantity: 1 }] }, ctx(traceId));
    const orderId = quote.orderId as string;
    await executeToolCall('create_order', { quoteOrderId: orderId }, ctx(traceId));
    await executeToolCall('initiate_payment', { orderId }, ctx(traceId));
    const afterInit = await db.payment.count({ where: { orderId } });

    // Simulate timeout: status is unknown.
    mockSettlement = 'UNKNOWN';
    const s1 = await executeToolCall('get_payment_status', { orderId }, ctx(traceId));
    const order1 = await db.order.findUnique({ where: { id: orderId } });

    // get_payment_status must NOT create a second Razorpay order.
    const afterStatus = await db.payment.count({ where: { orderId } });

    // Now the payment actually settles as PAID.
    mockSettlement = 'PAID';
    const s2 = await executeToolCall('get_payment_status', { orderId }, ctx(traceId));
    const order2 = await db.order.findUnique({ where: { id: orderId } });

    const pass =
      s1.paymentStatus === 'UNKNOWN' &&
      order1?.status === 'PAYMENT_UNKNOWN' &&
      afterInit === afterStatus &&
      s2.paymentStatus === 'SUCCESS' &&
      order2?.status === 'PAYMENT_SUCCESS';
    return {
      pass,
      detail: `unknown=${s1.paymentStatus}/${order1?.status} noDup=${afterInit === afterStatus} recovered=${s2.paymentStatus}/${order2?.status}`,
    };
  });
}

async function scenarioRetryCap() {
  const traceId = `eval_retrycap_${uuidv4()}`;
  await record('Retry cap (attempts >= maxRetries → DENY)', traceId, async () => {
    const policy = await db.policy.findUnique({ where: { merchantId: MERCHANT } });
    const attempts = (policy?.maxRetries ?? 1) + 1;
    const res = await executeToolCall(
      'check_policy',
      { action: 'payment_retry', amount: 1000, currentAttempts: attempts },
      ctx(traceId)
    );
    return { pass: res.decision === 'DENY', detail: `attempts=${attempts} decision=${res.decision}` };
  });
}

async function main() {
  console.log('\n🧪 Running ACG scenario harness (Razorpay stubbed)\n');

  await scenarioHappyPath();
  await scenarioPolicyDeny();
  await scenarioApprovalRequired();
  await scenarioIdempotency();
  await scenarioInvalidTransition();
  await scenarioFailureRecovery();
  await scenarioRetryCap();

  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
  console.log(pad('SCENARIO', 46) + pad('RESULT', 8) + 'DETAIL');
  console.log('─'.repeat(110));
  for (const r of results) {
    console.log(pad(r.name, 46) + pad(r.pass ? '✅ PASS' : '❌ FAIL', 8) + r.detail);
  }
  console.log('─'.repeat(110));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} scenarios passed.\n`);

  await db.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
