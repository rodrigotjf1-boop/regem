'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken } from '@/lib/api';

export type UiPrefs = {
  sidebar: 'expanded' | 'collapsed';
  side: 'left' | 'right';
};

const DEFAULTS: UiPrefs = { sidebar: 'expanded', side: 'left' };
const KEY = 'regem_ui';

function normalizar(p: any): UiPrefs {
  return {
    sidebar: p?.sidebar === 'collapsed' ? 'collapsed' : 'expanded',
    side: p?.side === 'right' ? 'right' : 'left',
  };
}

function lerLocal(): UiPrefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizar(JSON.parse(raw)) : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/**
 * Preferências de UI do shell. localStorage = paint instantâneo; o servidor é a
 * fonte da verdade entre dispositivos (reconciliado no load). `set` é otimista.
 */
export function useUiPrefs() {
  const [prefs, setPrefs] = useState<UiPrefs>(DEFAULTS);
  const [carregado, setCarregado] = useState(false);
  const ref = useRef<UiPrefs>(DEFAULTS);

  const aplicar = useCallback((next: UiPrefs, persistir: boolean) => {
    ref.current = next;
    setPrefs(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage indisponível */
    }
    if (persistir && getToken()) api.patchPrefs(next).catch(() => {});
  }, []);

  useEffect(() => {
    const local = lerLocal();
    ref.current = local;
    setPrefs(local);
    setCarregado(true);
    if (!getToken()) return;
    // Reconcilia com o servidor (fonte da verdade entre dispositivos) sem re-PATCH.
    api
      .getPrefs()
      .then((srv: any) => {
        if (!srv || (srv.sidebar == null && srv.side == null)) return;
        const merged = normalizar({
          sidebar: srv.sidebar ?? ref.current.sidebar,
          side: srv.side ?? ref.current.side,
        });
        aplicar(merged, false);
      })
      .catch(() => {
        /* offline / sem prefs → fica no localStorage */
      });
  }, [aplicar]);

  const set = useCallback(
    (patch: Partial<UiPrefs>) => aplicar({ ...ref.current, ...patch }, true),
    [aplicar],
  );

  const toggleColapso = useCallback(
    () =>
      set({
        sidebar: ref.current.sidebar === 'collapsed' ? 'expanded' : 'collapsed',
      }),
    [set],
  );

  return { prefs, set, toggleColapso, carregado };
}
