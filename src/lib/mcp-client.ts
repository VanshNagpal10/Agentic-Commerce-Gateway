import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { executeToolCall, ToolContext } from '@/lib/tools/handlers';
import { MCP_TOOL_NAMES } from '@/lib/mcp/schemas';

// The website's own MCP client, built on the official @modelcontextprotocol/sdk.
//
// The buyer chat backend (/api/chat) does not reach into the tool layer for the
// governed commerce tools — it connects to our own /api/mcp endpoint as a real MCP
// client, so "the website and Claude talk to the same gateway" is literally true
// rather than a claim on an architecture diagram. The SDK owns the protocol
// (initialize + version negotiation, notifications/initialized, JSON-RPC framing,
// error mapping); we own only which tools route over MCP and what happens when the
// round-trip fails.

const CLIENT_INFO = { name: 'acg-buyer-website', version: '1.0.0' };

// The governed commerce tools the MCP server owns — read from the single source
// of truth the server registers from, so the two can no longer drift. Anything
// not here (payment execution, verification, confirmation, cancellation, payment
// status) stays first-party and in-process.
const MCP_ROUTED_TOOLS = new Set<string>(MCP_TOOL_NAMES);

interface McpSession {
  ready: Promise<Client>;
  expiresAt: number;
}

// One MCP session per buyer conversation. The handshake costs two round-trips, so
// re-running it for every tool call would triple the traffic of a single chat turn.
// Keyed by trace, so a conversation reuses its session and two buyers never share
// one. The server is stateless and holds no SSE stream open, so a cached session is
// just a warm client object — there is no socket to leak.
const SESSION_TTL_MS = 10 * 60_000;
const MAX_SESSIONS = 32;
const sessions = new Map<string, McpSession>();

const sessionKey = (baseUrl: string, context: ToolContext) =>
  `${baseUrl}|${context.merchantId}|${context.traceId}`;

function dropSession(key: string): void {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  // Close in the background — a failed close must never surface to the buyer.
  session.ready.then((client) => client.close()).catch(() => {});
}

function openSession(key: string, baseUrl: string, context: ToolContext): Promise<Client> {
  const cached = sessions.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    cached.expiresAt = Date.now() + SESSION_TTL_MS;
    return cached.ready;
  }
  if (cached) dropSession(key);

  const url = new URL(`${baseUrl}/api/mcp`);
  url.searchParams.set('merchantId', context.merchantId);

  const client = new Client(CLIENT_INFO);
  const transport = new StreamableHTTPClientTransport(url, {
    // Threads the conversation's trace onto every MCP request so everything the
    // agent did lands under one trace in the merchant console.
    requestInit: { headers: { 'x-trace-id': context.traceId } },
  });

  // Storing the in-flight promise means concurrent tool calls in the same turn
  // share one handshake instead of racing to open duplicate sessions.
  const ready = client.connect(transport).then(() => client);
  ready.catch(() => sessions.delete(key)); // never cache a failed handshake
  sessions.set(key, { ready, expiresAt: Date.now() + SESSION_TTL_MS });

  // Bounded cache: evict the oldest session rather than grow without limit.
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    dropSession(oldest);
  }

  return ready;
}

/**
 * Pull the first text content block out of an MCP tool result. The SDK's
 * `callTool` return type is widened by the legacy-compatibility result shape, so
 * we narrow it here rather than trusting an index signature.
 */
function firstTextBlock(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      return (block as { text: string }).text;
    }
  }
  return null;
}

/**
 * Call one governed tool over MCP against our own /api/mcp endpoint and return the
 * parsed tool-result object.
 */
async function callMcpTool(
  baseUrl: string,
  name: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  const key = sessionKey(baseUrl, context);
  try {
    const client = await openSession(key, baseUrl, context);
    const result = await client.callTool({ name, arguments: args });

    const text = firstTextBlock(result.content);
    if (text === null) throw new Error('MCP returned no text content');

    // The tool result is JSON-encoded inside the MCP text content block. A
    // tool-level error (e.g. "Product not found") arrives here as { error } with
    // isError set — that is a valid result the agent should see and reason about,
    // NOT a transport failure, so we return it as-is rather than falling back.
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    // A session that just failed must not be reused by the next tool call.
    dropSession(key);
    throw err;
  }
}

/**
 * Dispatch a tool call. Governed commerce tools go through the MCP server over HTTP
 * (so the website is literally a client of the same gateway Claude connects to);
 * payment execution + mutation tools stay first-party in-process. If the MCP
 * round-trip fails at the transport level, we fall back to calling the tool
 * in-process — the website shares the same executeToolCall layer either way, so it
 * never breaks.
 */
export async function dispatchToolCall(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolContext,
  baseUrl: string | null
): Promise<Record<string, unknown>> {
  if (baseUrl && MCP_ROUTED_TOOLS.has(toolName)) {
    try {
      return await callMcpTool(baseUrl, toolName, args, context);
    } catch (err) {
      console.error(`MCP dispatch for ${toolName} failed; falling back in-process:`, err);
    }
  }
  return executeToolCall(toolName, args, context);
}
