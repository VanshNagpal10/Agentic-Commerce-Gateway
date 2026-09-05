import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer, CollectingTransport } from '@/lib/mcp/server';
import { ToolContext } from '@/lib/tools/handlers';

// MCP endpoint over Streamable HTTP, built on the official
// @modelcontextprotocol/sdk. This route is only the HTTP layer: it resolves the
// merchant + trace for the request, hands the JSON-RPC body to an SDK server
// instance, and returns what the SDK produced. All protocol behaviour —
// initialize, capability negotiation, tools/list, argument validation on
// tools/call, error codes — belongs to the SDK. See src/lib/mcp/server.ts.
//
// Stateless by design: each POST is an independent JSON-RPC exchange answered
// with application/json (no SSE session). That is spec-compliant and is all
// `npx mcp-remote` and the MCP Inspector need.

export const runtime = 'nodejs'; // Prisma + Razorpay need the Node runtime, not Edge.
export const dynamic = 'force-dynamic'; // Never statically optimize a protocol endpoint.

const DEFAULT_MERCHANT_ID = 'merchant_sportgear';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, x-trace-id, mcp-session-id, mcp-protocol-version',
};

function parseError(message = 'Parse error') {
  return { jsonrpc: '2.0' as const, id: null, error: { code: -32700, message } };
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const merchantId = searchParams.get('merchantId') || DEFAULT_MERCHANT_ID;
  // A caller may thread its own traceId (header or query) so a whole agent session
  // lands under one trace in the console; otherwise each call gets a fresh trace.
  const traceId =
    req.headers.get('x-trace-id') || searchParams.get('traceId') || `trace_${uuidv4()}`;
  const context: ToolContext = { merchantId, traceId, actor: 'agent' };

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(parseError(), { status: 400, headers: CORS_HEADERS });
  }

  // JSON-RPC allows a single message or a batch.
  const messages = (Array.isArray(body) ? body : [body]) as JSONRPCMessage[];
  if (messages.length === 0) {
    return NextResponse.json(parseError('Empty batch'), { status: 400, headers: CORS_HEADERS });
  }

  const server = createMcpServer(context);
  const transport = new CollectingTransport();

  try {
    await server.connect(transport);
    const replies = await transport.exchange(messages);

    // Notifications carry no id and expect no body — acknowledge with 202.
    if (replies.length === 0) {
      return new NextResponse(null, { status: 202, headers: CORS_HEADERS });
    }
    return NextResponse.json(Array.isArray(body) ? replies : replies[0], { headers: CORS_HEADERS });
  } finally {
    await server.close().catch(() => {});
  }
}

// This stateless server does not open a server→client SSE stream.
export async function GET() {
  return new NextResponse('Method Not Allowed', {
    status: 405,
    headers: { ...CORS_HEADERS, Allow: 'POST, OPTIONS' },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
