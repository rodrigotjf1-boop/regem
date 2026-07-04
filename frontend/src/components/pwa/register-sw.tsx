'use client';

import { useEffect } from 'react';

// Registra o service worker do quiosque (shell offline). Silencioso se indisponível.
export function RegisterSW() {
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return null;
}
