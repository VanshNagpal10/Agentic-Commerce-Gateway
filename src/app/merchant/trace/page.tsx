'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMerchant } from '@/lib/merchant-context';
import { ChevronDown, ChevronRight, Activity, Terminal, ShieldAlert, CheckCircle2, AlertCircle, RefreshCcw, Clock } from 'lucide-react';

type TraceEvent = {
  id: string;
  type: string;
  timestamp: string;
  actor?: string;
  toolName?: string;
  policyDecision?: string;
  policyReason?: string;
  latencyMs?: number;
  details: Record<string, unknown>;
};

type TraceGroup = {
  traceId: string;
  buyerIntent?: string | null;
  orderTotal?: number | null;
  orderStatus?: string | null;
  createdAt?: string;
  events: TraceEvent[];
};

export default function TracePage() {
  const { merchantId } = useMerchant();
  const searchParams = useSearchParams();
  const traceIdParam = searchParams.get('traceId');

  const [traces, setTraces] = useState<TraceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const fetchTraces = useCallback(async () => {
    setLoading(true);
    try {
      const url = traceIdParam
        ? `/api/audit?traceId=${traceIdParam}`
        : `/api/audit?merchantId=${merchantId}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const fetchedTraces: TraceGroup[] = data.traces || [];
        setTraces(fetchedTraces);
        // Auto-expand first trace or the specific trace requested
        if (fetchedTraces.length > 0) {
          setExpanded(prev => ({ ...prev, [fetchedTraces[0].traceId]: true }));
        }
      }
    } catch (err) {
      console.error('Failed to fetch traces:', err);
    } finally {
      setLoading(false);
    }
  }, [merchantId, traceIdParam]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTraces();
  }, [fetchTraces]);

  const toggleExpand = (traceId: string) => {
    setExpanded(prev => ({ ...prev, [traceId]: !prev[traceId] }));
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'TOOL_CALL': return <Terminal className="w-4 h-4 text-blue-500" />;
      case 'POLICY_DECISION': return <ShieldAlert className="w-4 h-4 text-amber-500" />;
      case 'STATE_CHANGE': return <Activity className="w-4 h-4 text-gray-500" />;
      case 'PAYMENT_EVENT': return <CheckCircle2 className="w-4 h-4 text-purple-500" />;
      case 'ERROR': return <AlertCircle className="w-4 h-4 text-red-500" />;
      default: return <Activity className="w-4 h-4 text-gray-500" />;
    }
  };

  const getEventLabel = (evt: TraceEvent) => {
    if (evt.toolName && evt.type === 'TOOL_CALL') return evt.toolName;
    if (evt.policyDecision) return `${evt.type} → ${evt.policyDecision}`;
    return evt.type;
  };

  const getEventColor = (type: string) => {
    switch (type) {
      case 'TOOL_CALL': return 'border-l-blue-500';
      case 'POLICY_DECISION': return 'border-l-amber-500';
      case 'STATE_CHANGE': return 'border-l-gray-400';
      case 'PAYMENT_EVENT': return 'border-l-purple-500';
      case 'ERROR': return 'border-l-red-500';
      default: return 'border-l-gray-300';
    }
  };

  const getStatusBadge = (status: string | null | undefined) => {
    if (!status) return null;
    const colors: Record<string, string> = {
      CONFIRMED: 'bg-emerald-100 text-emerald-700',
      PAYMENT_SUCCESS: 'bg-emerald-100 text-emerald-700',
      POLICY_APPROVED: 'bg-blue-100 text-blue-700',
      PENDING_APPROVAL: 'bg-amber-100 text-amber-700',
      POLICY_DENIED: 'bg-red-100 text-red-700',
      PAYMENT_FAILED: 'bg-red-100 text-red-700',
      QUOTED: 'bg-gray-100 text-gray-700',
      CANCELLED: 'bg-gray-100 text-gray-500',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
        {status.replace(/_/g, ' ')}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Execution Trace</h1>
          <p className="text-[13px] text-gray-500 mt-1">
            {traceIdParam ? `Viewing trace: ${traceIdParam.substring(0, 20)}...` : 'All recent agent interactions'}
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={fetchTraces}
            className="flex items-center space-x-2 px-3 py-1.5 text-[13px] font-medium text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition-colors"
          >
            <RefreshCcw size={14} />
            <span>Refresh</span>
          </button>
          <div className="text-[13px] text-emerald-600 flex items-center space-x-1.5 bg-emerald-50 px-3 py-1.5 rounded border border-emerald-200">
            <Activity size={14} />
            <span className="font-medium">Real-time monitoring active</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-gray-100 rounded-lg"></div>
          <div className="h-20 bg-gray-100 rounded-lg"></div>
        </div>
      ) : traces.length === 0 ? (
        <div className="bg-white p-12 rounded-lg border border-gray-200 text-center">
          <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Activity className="w-8 h-8 text-gray-300" />
          </div>
          <h3 className="text-base font-bold text-gray-900 mb-1">No trace events recorded yet</h3>
          <p className="text-[13px] text-gray-500 max-w-md mx-auto">
            Use the AI chat to interact with a merchant store. Every tool call, policy decision, and state change will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {traces.map((trace) => (
            <div key={trace.traceId} className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
              <button
                onClick={() => toggleExpand(trace.traceId)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
              >
                <div className="flex items-center space-x-3 flex-1 min-w-0">
                  {expanded[trace.traceId] ? <ChevronDown size={18} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={18} className="text-gray-400 flex-shrink-0" />}
                  <div className="min-w-0">
                    <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                      <span className="font-mono text-[13px] font-bold text-gray-800 truncate">
                        {trace.traceId.substring(0, 24)}...
                      </span>
                      <span className="text-[11px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-bold">
                        {trace.events.length} events
                      </span>
                      {getStatusBadge(trace.orderStatus)}
                    </div>
                    {trace.buyerIntent && (
                      <p className="text-[12px] text-gray-500 mt-1 truncate">
                        &quot;{trace.buyerIntent}&quot;
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-4 flex-shrink-0 ml-4">
                  {trace.orderTotal && (
                    <span className="text-[13px] font-bold text-gray-700">
                      ₹{trace.orderTotal.toLocaleString('en-IN')}
                    </span>
                  )}
                  <span className="text-[11px] text-gray-400 flex items-center space-x-1">
                    <Clock size={12} />
                    <span>{trace.events[0]?.timestamp ? new Date(trace.events[0].timestamp).toLocaleTimeString() : ''}</span>
                  </span>
                </div>
              </button>

              {expanded[trace.traceId] && (
                <div className="border-t border-gray-200 bg-[#0D121B] text-gray-300">
                  <div className="p-6">
                    <div className="space-y-3">
                      {trace.events.map((evt, idx) => (
                        <div key={evt.id || idx} className={`border-l-2 ${getEventColor(evt.type)} pl-4 py-2`}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center space-x-2">
                              {getEventIcon(evt.type)}
                              <span className="text-[13px] font-bold text-white">
                                {getEventLabel(evt)}
                              </span>
                              {evt.actor && evt.actor !== 'agent' && (
                                <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded font-bold">
                                  {evt.actor}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center space-x-3">
                              {evt.latencyMs && (
                                <span className="text-[11px] text-gray-400 font-mono">{evt.latencyMs}ms</span>
                              )}
                              <span className="text-[11px] text-gray-500 font-mono">
                                {new Date(evt.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                          </div>
                          {evt.policyDecision && (
                            <div className="mt-1 mb-1">
                              <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                                evt.policyDecision === 'ALLOW' ? 'bg-emerald-500/20 text-emerald-300' :
                                evt.policyDecision === 'APPROVAL_REQUIRED' ? 'bg-amber-500/20 text-amber-300' :
                                'bg-red-500/20 text-red-300'
                              }`}>
                                {evt.policyDecision}
                              </span>
                              {evt.policyReason && (
                                <span className="text-[11px] text-gray-400 ml-2">{evt.policyReason}</span>
                              )}
                            </div>
                          )}
                          <pre className="mt-2 bg-[#1A2230] p-3 rounded text-[11px] font-mono overflow-x-auto text-emerald-400 leading-relaxed">
                            {JSON.stringify(evt.details, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
