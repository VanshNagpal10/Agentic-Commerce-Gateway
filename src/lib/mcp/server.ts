import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { executeToolCall, ToolContext } from '@/lib/tools/handlers';
import { MCP_TOOL_NAMES, MCP_TOOL_SHAPES, describeTool } from './schemas';

// The MCP server, built on the official @modelcontextprotocol/sdk.
//
// The SDK owns the protocol: initialize + version negotiation, capabilities,
// tools/list (JSON Schema generated from our zod shapes), tools/call argument
// validation, JSON-RPC error codes, ping, notifications. We own only two things:
//   1. which tools exist (the governed whitelist below), and
//   2. what they do (executeToolCall — the same policy engine, state machine and
//      audit trail the website goes through).
//
// The governed surface deliberately EXCLUDES payment execution, verification,
// confirmation and cancellation (initiate_payment, verify_payment, confirm_order,
// cancel_order, get_payment_status). An external agent can discover products,
// quote, policy-check, create an order and obtain a human-authenticated payment
// link — but it can never autonomously move money or mutate a paid order. The
// whitelist is the list of keys in MCP_TOOL_SHAPES; a tool cannot be exposed by
// accident, only by adding a schema for it here.

export const SERVER_INFO = { name: 'agentic-commerce-gateway', version: '1.0.0' };

/**
 * Build a server instance bound to one request's context. A fresh instance per
 * request keeps this stateless and safe under concurrency — merchantId and
 * traceId are captured in the closure rather than shared mutable state.
 */
export function createMcpServer(context: ToolContext): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: { listChanged: false } },
    instructions:
      'Governed commerce gateway. Discover products, quote a cart, check merchant policy, ' +
      'create an order, and create a Razorpay payment link a human opens to pay. ' +
      'Payment is always authenticated by a human — no tool here can capture a charge.',
  });

  for (const name of MCP_TOOL_NAMES) {
    server.registerTool(
      name,
      {
        description: describeTool(name),
        inputSchema: MCP_TOOL_SHAPES[name],
      },
      async (args: Record<string, unknown>) => {
        // Governed execution: policy engine + state machine + audit all apply.
        const result = await executeToolCall(name, args, context);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          isError: typeof result.error === 'string',
        };
      }
    );
  }

  return server;
}

/**
 * A minimal Transport that carries one batch of JSON-RPC messages in and collects
 * the server's replies.
 *
 * Next.js App Router handlers receive a Web `Request` and return a Web `Response`,
 * while the SDK's StreamableHTTPServerTransport is written against Node's
 * IncomingMessage/ServerResponse. Rather than fake a Node socket, we implement the
 * SDK's own Transport interface — the protocol layer above it is entirely the
 * SDK's, and we supply only the HTTP framing that Next requires us to own anyway.
 */
export class CollectingTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;
  sessionId?: string;

  private outbound: JSONRPCMessage[] = [];
  private pending = 0;
  private settle: (() => void) | null = null;

  async start(): Promise<void> {
    // Nothing to open — the HTTP request is the transport.
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.outbound.push(message);
    // A reply carrying an id resolves one of the requests we fed in.
    if ('id' in message && message.id !== undefined && message.id !== null) {
      this.pending -= 1;
      if (this.pending <= 0) this.settle?.();
    }
  }

  async close(): Promise<void> {
    this.onclose?.();
  }

  /**
   * Feed one or more JSON-RPC messages to the server and resolve once every
   * request (i.e. every message with an id) has been answered. Notifications
   * expect no reply, so a batch of only notifications resolves immediately.
   */
  async exchange(messages: JSONRPCMessage[], timeoutMs = 30_000): Promise<JSONRPCMessage[]> {
    this.outbound = [];
    this.pending = messages.filter(
      (m) => 'id' in m && (m as { id?: unknown }).id !== undefined && (m as { id?: unknown }).id !== null
    ).length;

    const done =
      this.pending === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            this.settle = resolve;
            setTimeout(resolve, timeoutMs).unref?.();
          });

    for (const message of messages) this.onmessage?.(message);
    await done;

    return this.outbound;
  }
}
