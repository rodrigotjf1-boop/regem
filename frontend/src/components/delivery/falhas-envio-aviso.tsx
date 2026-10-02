'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { fraseEnvio } from '@/lib/envios-pedido';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AVISO DO PAINEL — o que o Regem tentou enviar ao canal (ou ao cliente) e FALHOU nas últimas
// 24 h. Antes a falha era silenciosa: o pedido mudava aqui e o canal não ficava sabendo.
//   - Só consulta (a cada 60 s e ao voltar o foco); nada aqui reenvia.
//   - 403 ou 404 (servidor ainda sem a rota): para de perguntar, em silêncio.
//   - "Dispensar" esconde até aparecer uma falha nova.
const INTERVALO_MS = 60_000;

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function FalhasEnvioAviso({ onAbrirPedido }: { onAbrirPedido?: (pedidoId: string) => void }) {
  const [dados, setDados] = useState<{ total: number; pedidos: number; itens: any[] } | null>(null);
  const [aberto, setAberto] = useState(false);
  const [dispensadaAte, setDispensadaAte] = useState<string | null>(null); // id da falha mais recente dispensada
  const desistiu = useRef(false);

  useEffect(() => {
    let parar = false;
    const checar = async () => {
      if (desistiu.current || document.visibilityState === 'hidden') return;
      try {
        const r: any = await api.falhasDeEnvio();
        if (!parar) setDados(r?.total > 0 ? r : null);
      } catch (e) {
        const st = (e as any)?.status;
        if (st === 403 || st === 404) desistiu.current = true;
      }
    };
    void checar();
    const t = setInterval(checar, INTERVALO_MS);
    window.addEventListener('focus', checar);
    return () => {
      parar = true;
      clearInterval(t);
      window.removeEventListener('focus', checar);
    };
  }, []);

  if (!dados || !dados.itens.length) return null;
  const maisRecente = String(dados.itens[0].id);
  if (dispensadaAte === maisRecente) return null;

  return (
    <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-destructive">
          ⚠ {dados.total === 1 ? '1 envio falhou' : `${dados.total} envios falharam`} nas últimas 24 h
          {dados.pedidos > 1 ? ` (${dados.pedidos} pedidos)` : ''}
        </span>
        <span className="text-xs text-muted-foreground">O pedido mudou aqui, mas o canal ou o cliente não recebeu.</span>
        <div className="ml-auto flex items-center gap-3">
          <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto ? 'true' : 'false'} className="text-xs font-semibold text-destructive hover:underline">
            {aberto ? 'Ocultar' : 'Ver'}
          </button>
          <button type="button" onClick={() => setDispensadaAte(maisRecente)} className="text-xs font-medium text-muted-foreground hover:text-foreground">
            Dispensar
          </button>
        </div>
      </div>
      {aberto && (
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {dados.itens.map((f) => (
            <li key={f.id} className="flex flex-wrap items-baseline gap-x-2 rounded-md bg-card px-2 py-1 text-xs">
              <span className="font-mono text-[11px] text-muted-foreground">{hora(f.criadoEm)}</span>
              {onAbrirPedido ? (
                <button type="button" onClick={() => onAbrirPedido(f.pedidoId)} className="font-mono font-bold hover:underline" title="Abrir o pedido">
                  #{f.numero ?? f.displayId ?? '—'}
                </button>
              ) : (
                <span className="font-mono font-bold">#{f.numero ?? f.displayId ?? '—'}</span>
              )}
              <span>{fraseEnvio({ destino: f.destino, acao: f.acao, resultado: 'falhou' })}</span>
              {f.motivo && <span className="min-w-0 break-words text-muted-foreground">— {f.motivo}</span>}
            </li>
          ))}
          {dados.total > dados.itens.length && <li className="px-2 text-[11px] text-muted-foreground">Mostrando as {dados.itens.length} mais recentes.</li>}
        </ul>
      )}
    </div>
  );
}
