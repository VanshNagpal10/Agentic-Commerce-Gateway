import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { SYSTEM_INSTRUCTION } from '@/lib/gemini';
import { toolDeclarations } from '@/lib/tools/definitions';
import { ToolContext } from '@/lib/tools/handlers';
import { dispatchToolCall } from '@/lib/mcp-client';
import { logAuditEvent } from '@/lib/audit';
import { db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

const groqTools: OpenAI.Chat.Completions.ChatCompletionTool[] = toolDeclarations.map((t) => ({
  type: 'function' as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  },
}));

interface ToolCallResult {
  toolName: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  latencyMs: number;
}

// Compact, server-tracked state carried across turns so the model doesn't
// lose the orderId when we strip raw tool messages from history.
interface SessionState {
  quoteOrderId?: string;
  orderId?: string;
  razorpayOrderId?: string;
  lastStatus?: string;
}

interface ChatRequest {
  message: string;
  merchantId: string;
  history?: OpenAI.Chat.ChatCompletionMessageParam[];
  traceId?: string;
  sessionState?: SessionState;
}

function deriveSessionState(prev: SessionState, toolCalls: ToolCallResult[]): SessionState {
  const next: SessionState = { ...prev };
  for (const tc of toolCalls) {
    const r = tc.result || {};
    if (typeof r.orderId === 'string') {
      next.orderId = r.orderId;
      if (tc.toolName === 'quote_order') next.quoteOrderId = r.orderId;
    }
    if (typeof r.razorpayOrderId === 'string') next.razorpayOrderId = r.razorpayOrderId;
    if (typeof r.status === 'string') next.lastStatus = r.status;
    if (typeof r.orderStatus === 'string') next.lastStatus = r.orderStatus;
  }
  return next;
}

export async function POST(req: NextRequest) {
  try {
    const body: ChatRequest = await req.json();
    const { message, merchantId } = body;
    const traceId = body.traceId || `trace_${uuidv4()}`;

    if (!message || !merchantId) {
      return NextResponse.json(
        { error: 'message and merchantId are required' },
        { status: 400 }
      );
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json({ error: 'GROQ_API_KEY not configured in .env' }, { status: 500 });
    }

    const groq = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });

    const context: ToolContext = { merchantId, traceId, buyerIntent: message };
    // Route governed commerce tools through our own MCP server so the website is a
    // real client of the same gateway Claude uses. Override with MCP_BASE_URL if the
    // MCP server is deployed elsewhere.
    const baseUrl = process.env.MCP_BASE_URL || new URL(req.url).origin;
    const priorState: SessionState = body.sessionState || {};

    // Build a one-line session summary so the model remembers ids across turns.
    const stateLine =
      Object.keys(priorState).length > 0
        ? `\n\nCURRENT SESSION STATE (server-tracked, authoritative):\n${JSON.stringify(priorState)}\nUse these ids for follow-up actions instead of re-searching or re-quoting.`
        : '';

    const history: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    history.push({ role: 'system', content: SYSTEM_INSTRUCTION + stateLine });

    if (body.history && Array.isArray(body.history)) {
      for (const msg of body.history) {
        if (msg.role === 'user' && typeof msg.content === 'string') {
          history.push({ role: 'user', content: msg.content });
        } else if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content) {
          history.push({ role: 'assistant', content: msg.content });
        }
      }
    }

    history.push({ role: 'user', content: message });

    const toolCallResults: ToolCallResult[] = [];
    let maxIterations = 10;
    let finalText = '';
    const turnHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [...history];

    while (maxIterations > 0) {
      maxIterations--;

      const response = await groq.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages: turnHistory,
        tools: groqTools,
        tool_choice: 'auto',
        temperature: 0.3,
      });

      const responseMessage = response.choices[0].message;
      turnHistory.push(responseMessage);

      if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
        finalText = responseMessage.content || '';
        break;
      }

      for (const toolCall of responseMessage.tool_calls) {
        if (toolCall.type !== 'function') continue;
        const toolName = toolCall.function.name;

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          console.error('Failed to parse args from Groq:', toolCall.function.arguments);
        }

        const startTime = Date.now();
        const result = await dispatchToolCall(toolName, args, context, baseUrl);
        const latencyMs = Date.now() - startTime;

        toolCallResults.push({ toolName, args, result, latencyMs });

        turnHistory.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    if (maxIterations === 0 && !finalText) {
      finalText =
        "I've completed several steps. Let me know how you'd like to proceed.";
    }

    const sessionState = deriveSessionState(priorState, toolCallResults);

    await logAuditEvent({
      traceId,
      eventType: 'TOOL_CALL',
      actor: 'agent',
      toolName: 'chat_interaction',
      input: { message, merchantId },
      output: { responseLength: finalText.length, toolCallCount: toolCallResults.length },
    }).catch(() => {});

    const cleanHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    for (const msg of turnHistory) {
      if (msg.role === 'user' && typeof msg.content === 'string') {
        cleanHistory.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content) {
        cleanHistory.push({ role: 'assistant', content: msg.content });
      }
    }

    // ─── Persist to the chat session (best-effort) ───
    try {
      const title = message.length > 60 ? message.slice(0, 57) + '...' : message;
      // Serialize to a plain JSON object for the Prisma `Json?` column (matches the
      // toolCalls idiom below and strips any undefined values).
      const sessionStateJson = JSON.parse(JSON.stringify(sessionState));
      const session = await db.chatSession.upsert({
        where: { traceId },
        update: { updatedAt: new Date(), sessionState: sessionStateJson },
        create: { merchantId, traceId, title, sessionState: sessionStateJson },
      });
      await db.chatMessage.create({
        data: { sessionId: session.id, role: 'user', content: message },
      });
      await db.chatMessage.create({
        data: {
          sessionId: session.id,
          role: 'assistant',
          content: finalText,
          toolCalls: toolCallResults.length
            ? JSON.parse(JSON.stringify(toolCallResults))
            : undefined,
        },
      });
    } catch (err) {
      console.error('Failed to persist chat session:', err);
    }

    return NextResponse.json({
      response: finalText,
      traceId,
      toolCalls: toolCallResults,
      history: cleanHistory,
      sessionState,
    });
  } catch (error: unknown) {
    console.error('Chat API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    let status = 500;
    let friendlyMessage = errorMessage;

    if (errorMessage.includes('429')) {
      friendlyMessage = 'Rate limit reached. Please wait a moment and try again.';
      status = 429;
    } else if (errorMessage.includes('503') || errorMessage.includes('high demand')) {
      friendlyMessage = 'The AI model is temporarily unavailable. Please try again in a moment.';
      status = 503;
    } else if (errorMessage.includes('400') && errorMessage.includes('Tool call validation')) {
      friendlyMessage = 'I had trouble processing that request. Please try rephrasing your question.';
      status = 400;
    }

    return NextResponse.json({ error: friendlyMessage }, { status });
  }
}
