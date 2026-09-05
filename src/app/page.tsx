'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMerchant } from '@/lib/merchant-context';
import {
  Store, Package, Shield, Zap, Loader2, CheckCircle, AlertTriangle, Plus,
  TrendingUp, Bot, ArrowRight, Clock, LogIn, ShoppingBag,
} from 'lucide-react';

const STEPS = [
  {
    icon: Store,
    title: 'Create your store',
    desc: 'Your catalog gets a governed MCP endpoint in seconds — no integration to build.',
  },
  {
    icon: Package,
    title: 'Upload your catalog',
    desc: 'Products become agent-readable: real prices, stock, and delivery estimates.',
  },
  {
    icon: Shield,
    title: 'Set your guardrails',
    desc: 'Spend limits, approval thresholds, restricted categories — you decide what agents may do.',
  },
  {
    icon: Zap,
    title: 'Go live to AI buyers',
    desc: 'Any MCP-connected agent (Claude and friends) can now discover and buy from you.',
  },
];

// The Track 1 argument, in the merchant's own terms.
const GROWTH = [
  {
    icon: TrendingUp,
    stat: 'A new demand channel',
    title: 'Sell where buyers now ask',
    desc:
      'Shoppers are starting their purchase inside an AI assistant, not a search bar. A store that no agent can read is invisible in that channel. Onboarding here makes your catalog quotable and buyable by any MCP agent — new revenue on top of your existing site, not a migration.',
  },
  {
    icon: Clock,
    stat: 'Minutes, not a quarter',
    title: 'No integration to build',
    desc:
      'No SDK, no API contract to negotiate per agent. You upload products and set guardrails; the gateway handles discovery, quoting, policy, payment links and reconciliation. Time-to-first-agent-order is measured in minutes.',
  },
  {
    icon: Shield,
    stat: 'Zero runaway spend',
    title: 'Growth you can actually approve',
    desc:
      'The reason merchants block agents is loss of control. Here every purchase clears a deterministic policy engine — auto-spend band, approval queue, restricted categories, retry caps — and payment is always authenticated by a human. You open the channel without handing over your money.',
  },
  {
    icon: Bot,
    stat: 'Attributed per channel',
    title: 'Prove the lift',
    desc:
      'Your dashboard separates agent-driven revenue from website revenue, with an audit trail per order. You can see what the new channel earned, which policies gated it, and exactly which tool calls got there.',
  },
];

type MerchantRow = {
  id: string;
  name: string;
  _count?: { products: number; orders: number };
};

export default function MerchantLandingPage() {
  const router = useRouter();
  const { refreshMerchants, setMerchantId } = useMerchant();
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [stores, setStores] = useState<MerchantRow[]>([]);

  const loadStores = useCallback(async () => {
    try {
      const res = await fetch('/api/merchant');
      if (res.ok) {
        const data = await res.json();
        setStores(data.merchants || []);
      }
    } catch {
      // non-fatal — the create form is the primary path
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStores();
  }, [loadStores]);

  const slug = (handle || name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const merchantId = slug ? `merchant_${slug}` : '';
  const mcpUrl =
    typeof window !== 'undefined' && merchantId
      ? `${window.location.origin}/api/mcp?merchantId=${merchantId}`
      : merchantId
        ? `/api/mcp?merchantId=${merchantId}`
        : '';

  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        acg: { command: 'npx', args: ['mcp-remote', mcpUrl || 'https://your-app/api/mcp?merchantId=…'] },
      },
    },
    null,
    2
  );

  const openStore = (id: string) => {
    setMerchantId(id);
    router.push('/merchant');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), handle: handle.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not create your store.');
        return;
      }
      await refreshMerchants();
      setMerchantId(data.merchant.id);
      router.push('/merchant');
    } catch {
      setError('Network error creating your store.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen chat-bg flex flex-col">
      {/* Header */}
      <header className="bg-[#0D121B] text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="text-xl font-bold tracking-tight flex items-center">
            <span className="text-blue-500 mr-2 text-2xl">⚡</span> Agentic Commerce
          </div>
          <span className="text-[11px] font-medium text-gray-400 uppercase tracking-widest border-l border-[#2B3545] pl-3 flex items-center">
            Powered by <span className="italic font-bold ml-1 text-gray-300">Razorpay</span>
          </span>
        </div>
        <div className="flex items-center space-x-4">
          <Link
            href="/buyer"
            className="text-[13px] font-medium text-gray-400 hover:text-white flex items-center space-x-1.5 transition-colors"
          >
            <ShoppingBag size={14} />
            <span>See a buyer agent shop</span>
          </Link>
          <Link
            href="/merchant"
            className="text-[13px] font-medium text-gray-300 hover:text-white flex items-center space-x-1.5 transition-colors"
          >
            <LogIn size={14} />
            <span>Open my console</span>
          </Link>
        </div>
      </header>

      <div className="flex-1 max-w-5xl w-full mx-auto px-4 py-10">
        {/* Hero */}
        <div className="text-center mb-10">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-3 py-1 mb-4">
            <TrendingUp size={12} /> For merchants — a new revenue channel
          </span>
          <h1 className="text-3xl font-bold text-gray-900">Bring your brand to AI buyers</h1>
          <p className="text-[15px] text-gray-500 mt-2 max-w-2xl mx-auto">
            Your storefront used to be a website. Now it&apos;s every AI agent on the internet.
            Onboard your catalog once — every MCP-connected agent can discover your products and
            place governed orders, with your guardrails and a full audit trail.
          </p>
          <div className="flex items-center justify-center gap-3 mt-6">
            <a
              href="#create"
              className="bg-[#2B6CB0] hover:bg-blue-700 text-white px-5 py-2.5 rounded text-[13px] font-bold transition-colors flex items-center gap-2"
            >
              <Plus size={14} /> Onboard my store
            </a>
            <Link
              href="/merchant"
              className="bg-white border border-gray-200 hover:border-blue-300 text-gray-700 px-5 py-2.5 rounded text-[13px] font-bold transition-colors flex items-center gap-2"
            >
              I already have a store <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        {/* Why it grows revenue */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
          {GROWTH.map((g) => (
            <div key={g.title} className="bg-white rounded-lg border border-gray-200 p-5 shadow-xs">
              <div className="flex items-center space-x-2.5 mb-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center flex-shrink-0">
                  <g.icon size={16} className="text-emerald-600" />
                </div>
                <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
                  {g.stat}
                </span>
              </div>
              <h3 className="text-[14px] font-bold text-gray-900">{g.title}</h3>
              <p className="text-[12px] text-gray-500 mt-1 leading-relaxed">{g.desc}</p>
            </div>
          ))}
        </div>

        {/* Steps */}
        <h2 className="text-[15px] font-bold text-gray-900 mb-1">How you go live</h2>
        <p className="text-[12px] text-gray-500 mb-4">Four steps, all self-serve.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          {STEPS.map((step, i) => (
            <div key={step.title} className="bg-white rounded-lg border border-gray-200 p-5 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center">
                  <step.icon size={16} className="text-blue-600" />
                </div>
                <span className="text-[11px] font-bold text-gray-300">STEP {i + 1}</span>
              </div>
              <h3 className="text-[13px] font-bold text-gray-900">{step.title}</h3>
              <p className="text-[12px] text-gray-500 mt-1 leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>

        {/* Create form + preview */}
        <div id="create" className="grid grid-cols-1 lg:grid-cols-2 gap-6 scroll-mt-6">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
            <h2 className="text-[15px] font-bold text-gray-900 mb-1">Create your store</h2>
            <p className="text-[12px] text-gray-500 mb-5">
              You&apos;ll land straight in your console with a default policy (auto-approve up to
              ₹5,000, approvals to ₹10,000) — tune it on the Policies page.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[13px] font-bold text-gray-700 mb-1.5">Store name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. UrbanThread"
                  className="w-full p-2.5 border border-gray-200 rounded text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-[13px] font-bold text-gray-700 mb-1.5">
                  Store handle <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="used in your agent endpoint — defaults from the name"
                  className="w-full p-2.5 border border-gray-200 rounded text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>

              {error && (
                <div className="p-3 rounded-lg text-[13px] font-medium bg-red-50 text-red-700 border border-red-200 flex items-center space-x-2">
                  <AlertTriangle size={14} />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!name.trim() || creating}
                className="w-full flex items-center justify-center gap-2 bg-[#2B6CB0] hover:bg-blue-700 text-white px-4 py-2.5 rounded text-[13px] font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                <span>{creating ? 'Creating your store...' : 'Create store & open console'}</span>
              </button>
              <p className="text-[11px] text-gray-400 text-center">
                Demo build — production adds per-store sign-in and API keys.
              </p>
            </form>
          </div>

          {/* Live endpoint preview */}
          <div className="bg-[#0D121B] text-white rounded-lg shadow-sm p-6 flex flex-col">
            <div className="flex items-center space-x-2 mb-4">
              <Zap size={18} className="text-blue-400" />
              <h2 className="text-[15px] font-bold">Your agent endpoint</h2>
            </div>
            <p className="text-[12px] text-gray-400 mb-4">
              The moment your store exists, this MCP endpoint serves your governed catalog to any
              AI agent. Buyers connect their agent once — and can buy from you without you building
              anything.
            </p>

            <div className="bg-[#1A2230] border border-[#2B3545] rounded p-3 mb-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                MCP endpoint
              </p>
              <code className={`text-[12px] font-mono ${merchantId ? 'text-emerald-400' : 'text-gray-500'}`}>
                {mcpUrl || '— type a store name to see yours —'}
              </code>
            </div>

            <div className="bg-[#1A2230] border border-[#2B3545] rounded p-3 flex-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                Buyer connects their agent (e.g. Claude Desktop)
              </p>
              <pre className="text-[11px] font-mono text-gray-300 overflow-x-auto">
                {claudeConfig}
              </pre>
            </div>

            <div className="flex items-start space-x-2 mt-4 text-[11px] text-gray-400">
              <CheckCircle size={13} className="text-emerald-400 mt-0.5 flex-shrink-0" />
              <p>
                Every agent order arrives policy-checked, human-paid (Razorpay payment link), and
                fully traced in your console.
              </p>
            </div>
          </div>
        </div>

        {/* Existing stores — the "log in" path for a merchant who already onboarded */}
        {stores.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm mt-6">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-[15px] font-bold text-gray-900">Already onboarded?</h2>
                <p className="text-[12px] text-gray-500 mt-0.5">
                  Pick your store to open its console — catalog, policies, approvals, and traces.
                </p>
              </div>
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                {stores.length} store{stores.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="divide-y divide-gray-100">
              {stores.map((s) => (
                <button
                  key={s.id}
                  onClick={() => openStore(s.id)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-blue-50 transition-colors group text-left"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-8 h-8 rounded bg-blue-50 border border-blue-200 flex items-center justify-center group-hover:bg-blue-100 flex-shrink-0">
                      <Store size={14} className="text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[13px] font-bold text-gray-900">{s.name}</span>
                      <p className="text-[11px] text-gray-500 font-mono truncate">
                        /api/mcp?merchantId={s.id}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4 flex-shrink-0">
                    <span className="text-[11px] text-gray-400">
                      {s._count?.products ?? 0} products · {s._count?.orders ?? 0} orders
                    </span>
                    <ArrowRight size={14} className="text-gray-300 group-hover:text-blue-500" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footnote */}
        <p className="text-center text-[12px] text-gray-400 mt-8">
          Curious what the buyer sees?{' '}
          <Link href="/buyer" className="text-blue-600 font-medium hover:text-blue-700">
            Try the reference AI buyer chat
          </Link>{' '}
          — it hits the same governed gateway an external agent does.
        </p>
      </div>
    </div>
  );
}
