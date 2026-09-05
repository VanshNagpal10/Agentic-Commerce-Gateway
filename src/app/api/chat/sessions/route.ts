import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/chat/sessions?merchantId=xxx — list sessions for the sidebar
// GET /api/chat/sessions?traceId=xxx — load a single session's messages
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const merchantId = searchParams.get('merchantId');
    const traceId = searchParams.get('traceId');

    if (traceId) {
      const session = await db.chatSession.findUnique({
        where: { traceId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      if (!session) {
        return NextResponse.json({ session: null, messages: [] });
      }
      return NextResponse.json({
        session: { id: session.id, traceId: session.traceId, title: session.title, merchantId: session.merchantId, sessionState: session.sessionState ?? null },
        messages: session.messages.map((m) => ({
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls ?? undefined,
          traceId: session.traceId,
        })),
      });
    }

    if (merchantId) {
      const sessions = await db.chatSession.findMany({
        where: { merchantId },
        orderBy: { updatedAt: 'desc' },
        take: 30,
        include: { _count: { select: { messages: true } } },
      });
      return NextResponse.json({
        sessions: sessions.map((s) => ({
          traceId: s.traceId,
          title: s.title,
          updatedAt: s.updatedAt,
          messageCount: s._count.messages,
        })),
      });
    }

    return NextResponse.json({ error: 'merchantId or traceId required' }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/chat/sessions?traceId=xxx — delete a session
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const traceId = searchParams.get('traceId');
    if (!traceId) {
      return NextResponse.json({ error: 'traceId required' }, { status: 400 });
    }
    await db.chatSession.deleteMany({ where: { traceId } });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
