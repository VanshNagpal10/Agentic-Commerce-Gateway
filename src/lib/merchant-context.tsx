'use client';
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

type MerchantContextType = {
  merchantId: string;
  setMerchantId: (id: string) => void;
  merchantName: string;
  merchants: { id: string; name: string }[];
  refreshMerchants: () => Promise<void>;
};

// Demo fallback so first paint (and SSR) is deterministic; replaced by the real
// DB list (including newly onboarded stores) once /api/merchant resolves.
const FALLBACK_MERCHANTS = [
  { id: 'merchant_sportgear', name: 'SportGear India' },
  { id: 'merchant_techmart', name: 'TechMart' },
];

const LS_KEY = 'acg_merchant';

const MerchantContext = createContext<MerchantContextType | undefined>(undefined);

export function MerchantProvider({ children }: { children: ReactNode }) {
  // Start with the default on first render (SSR-safe); restore the saved
  // selection in an effect so hydration stays consistent.
  const [merchantId, setMerchantId] = useState<string>(FALLBACK_MERCHANTS[0].id);
  const [merchants, setMerchants] = useState<{ id: string; name: string }[]>(FALLBACK_MERCHANTS);

  const refreshMerchants = useCallback(async () => {
    try {
      const res = await fetch('/api/merchant');
      if (res.ok) {
        const data = await res.json();
        const list = (data.merchants || []).map((m: { id: string; name: string }) => ({
          id: m.id,
          name: m.name,
        }));
        if (list.length > 0) setMerchants(list);
      }
    } catch {
      // non-fatal — keep the current list
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshMerchants();
    const saved = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
    if (saved) setMerchantId(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectMerchant = useCallback((id: string) => {
    setMerchantId(id);
    if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, id);
  }, []);

  const merchantName = merchants.find((m) => m.id === merchantId)?.name || 'Unknown Merchant';

  return (
    <MerchantContext.Provider
      value={{ merchantId, setMerchantId: selectMerchant, merchantName, merchants, refreshMerchants }}
    >
      {children}
    </MerchantContext.Provider>
  );
}

export function useMerchant() {
  const context = useContext(MerchantContext);
  if (!context) {
    throw new Error('useMerchant must be used within a MerchantProvider');
  }
  return context;
}
