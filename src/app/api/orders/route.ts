import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/orders?merchantId=xxx — order stats + recent orders for the dashboard
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const merchantId = searchParams.get('merchantId');

    if (!merchantId) {
      return NextResponse.json({ error: 'merchantId required' }, { status: 400 });
    }

    // Website conversations persist a ChatSession per traceId; external MCP
    // agents (Claude etc.) do not — so orders on a trace with no ChatSession
    // arrived through the agent channel. Used for the "AI agent orders" stat.
    const chatSessions = await db.chatSession.findMany({
      where: { merchantId },
      select: { traceId: true },
    });
    const chatTraceIds = chatSessions.map((s) => s.traceId);

    const [total, pending, confirmed, failed, cancelled, denied, agentOrders, revenueAgg, agentRevenueAgg, recent] = await Promise.all([
      db.order.count({ where: { merchantId } }),
      db.order.count({ where: { merchantId, status: 'PENDING_APPROVAL' } }),
      db.order.count({ where: { merchantId, status: 'CONFIRMED' } }),
      db.order.count({ where: { merchantId, status: 'PAYMENT_FAILED' } }),
      db.order.count({ where: { merchantId, status: 'CANCELLED' } }),
      db.order.count({ where: { merchantId, status: 'POLICY_DENIED' } }),
      db.order.count({ where: { merchantId, traceId: { notIn: chatTraceIds } } }),
      // Revenue = money actually collected (CONFIRMED only), in paise.
      db.order.aggregate({ where: { merchantId, status: 'CONFIRMED' }, _sum: { total: true } }),
      // The agentic channel's share of that revenue — the Track 1 growth number.
      db.order.aggregate({
        where: { merchantId, status: 'CONFIRMED', traceId: { notIn: chatTraceIds } },
        _sum: { total: true },
      }),
      db.order.findMany({
        where: { merchantId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          total: true,
          createdAt: true,
          buyerIntent: true,
          traceId: true,
        },
      }),
    ]);

    const revenuePaise = revenueAgg._sum.total || 0;
    const agentRevenuePaise = agentRevenueAgg._sum.total || 0;

    return NextResponse.json({
      stats: {
        total,
        pending,
        confirmed,
        failed,
        cancelled,
        denied,
        agentOrders,
        // Rupees for display; DB keeps paise.
        revenue: revenuePaise / 100,
        agentRevenue: agentRevenuePaise / 100,
        avgOrderValue: confirmed > 0 ? Math.round(revenuePaise / confirmed) / 100 : 0,
        agentRevenueShare: revenuePaise > 0 ? Math.round((agentRevenuePaise / revenuePaise) * 100) : 0,
      },
      recentOrders: recent.map((o) => ({
        id: o.id,
        status: o.status,
        total: o.total / 100,
        createdAt: o.createdAt,
        buyerIntent: o.buyerIntent,
        traceId: o.traceId,
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
