'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AVISO DO PDV — pedido do TOTEM em DINHEIRO que o cliente ainda não pagou no balcão.
// Com a loja em "produzir só após o pagamento", o pedido fica parado até o operador cobrar;
// passou do limite (8 min, vem do servidor), aparece esta faixa nas telas do grupo PDV, com um
// bip quando entra pedido novo no aviso.
//   - Só consulta (a cada 30 s e ao voltar o foco); quem resolve é o operador, na Retirada.
//   - Sem permissão (403) ou servidor ainda sem a rota (404): para de perguntar, em silêncio.
//   - "Dispensar" esconde os pedidos mostrados; pedido novo no aviso faz a faixa voltar.
const INTERVALO_MS = 30_000;
const TELAS = ['/pdv', '/mesas'];

interface Pedido {
  id: string;
  senha: string | null;
  clienteNome: string | null;
  total: number;
  minutos: number;
}

const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const espera = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);

// Dois toques curtos (Web Audio). O navegador só toca depois de alguma interação com a página —
// no PDV o operador está sempre clicando; se ainda não puder, fica só a faixa.
function bip() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    for (const [inicio, freq] of [[0, 880], [0.22, 660]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.2, ctx.currentTime + inicio);
      g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + inicio + 0.18);
      o.start(ctx.currentTime + inicio);
      o.stop(ctx.currentTime + inicio + 0.2);
    }
    setTimeout(() => ctx.close?.(), 700);
  } catch {
    /* silencioso */
  }
}

export function TotemAPagarAviso({ habilitado }: { habilitado: boolean }) {
  const path = usePathname() ?? '';
  const naTela = TELAS.some((t) => path === t || path.startsWith(t + '/'));
  const ativo = habilitado && naTela;
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [limite, setLimite] = useState(8);
  const [dispensados, setDispensados] = useState<string[]>([]);
  const avisados = useRef<Set<string>>(new Set());
  const desistiu = useRef(false);

  useEffect(() => {
    if (!ativo) {
      setPedidos([]);
      return;
    }
    let parar = false;
    const checar = async () => {
      if (desistiu.current || document.visibilityState === 'hidden') return;
      try {
        const r: any = await api.totemAguardandoPagamento();
        if (parar) return;
        const lista: Pedido[] = r?.ativo && Array.isArray(r.pedidos) ? r.pedidos : [];
        if (r?.minutos) setLimite(Number(r.minutos));
        if (lista.some((p) => !avisados.current.has(p.id))) bip();
        for (const p of lista) avisados.current.add(p.id);
        setPedidos(lista);
      } catch (e) {
        const st = (e as any)?.status;
        if (st === 403 || st === 404) desistiu.current = true;
      }
    };
    checar();
    const t = setInterval(checar, INTERVALO_MS);
    window.addEventListener('focus', checar);
    return () => {
      parar = true;
      clearInterval(t);
      window.removeEventListener('focus', checar);
    };
  }, [ativo]);

  const visiveis = pedidos.filter((p) => !dispensados.includes(p.id));
  if (!ativo || visiveis.length === 0) return null;
  const n = visiveis.length;

  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">
      <span className="font-semibold text-destructive">
        ⏱ {n === 1 ? '1 pedido do totem espera' : `${n} pedidos do totem esperam`} pagamento em dinheiro há mais de {limite} min
      </span>
      <ul className="flex min-w-0 flex-wrap gap-1.5">
        {visiveis.slice(0, 6).map((p) => (
          <li key={p.id} className="rounded-full border border-destructive/30 bg-card px-2 py-0.5 text-xs">
            <span className="font-mono font-bold">{p.senha ? `Senha ${p.senha}` : 'Sem senha'}</span>
            <span className="text-muted-foreground"> · {brl(p.total)} · há {espera(p.minutos)}</span>
          </li>
        ))}
        {n > 6 && <li className="self-center text-xs text-muted-foreground">+{n - 6}</li>}
      </ul>
      <div className="ml-auto flex items-center gap-3">
        {path !== '/pdv/retirada' && (
          <Link href="/pdv/retirada" className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90">
            Receber na Retirada
          </Link>
        )}
        <button
          type="button"
          onClick={() => setDispensados((d) => [...new Set([...d, ...visiveis.map((p) => p.id)])])}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Dispensar
        </button>
      </div>
    </div>
  );
}
