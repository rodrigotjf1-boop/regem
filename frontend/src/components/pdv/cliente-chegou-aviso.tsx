'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { tocar } from '@/components/atendimento/alerta-de-atendimento';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "CHEGUEI" NA RETIRADA — o aviso em QUALQUER TELA (Onda 3, mig 354; protótipo, aba "Loja: cliente chegou").
// O cliente que vai retirar avisou que chegou (página do pedido ou WhatsApp): aparece o aviso, com o som do sino DESTE
// computador (o mesmo do atendimento). Também avisa quando o cliente pede de novo e, uma vez, quando ele espera mais que
// o tempo do ajuste sem ninguém entregar. Com o ajuste "só na Retirada, no painel e no KDS", só avisa na Retirada.
//   - Só lê (a cada 20 s, ao voltar o foco); com a aba escondida, não pergunta.
//   - A primeira leitura é a base (quem já estava esperando aparece no quadro da Retirada, sem aviso).
//   - "Cheguei" desligado na loja: pergunta de novo só a cada 5 min. Sem permissão (403) ou servidor sem a rota (404):
//     para de perguntar.
const INTERVALO_MS = 20_000;
const DESLIGADO_MS = 5 * 60_000;
const RETIRADA = '/pdv/retirada';

type Chegada = {
  pedidoId: string;
  numero: string;
  nome: string;
  onde: 'balcao' | 'porta' | null;
  obs: string | null;
  chegouEm: string;
  deNovoEm: string | null;
  pronto: boolean;
};

const quem = (c: Chegada) => c.nome || 'O cliente';
const ondeTxt = (c: Chegada) =>
  c.onde === 'balcao' ? 'no balcão' : c.onde === 'porta' ? `na porta${c.obs ? `: ${c.obs}` : ''}` : c.obs ?? '';

export function ClienteChegouAviso({ habilitado }: { habilitado: boolean }) {
  const path = usePathname() ?? '';
  const pathRef = useRef(path);
  pathRef.current = path;
  const vistos = useRef<Map<string, { aviso: string; escalou: boolean }> | null>(null);
  const desistiu = useRef(false);

  useEffect(() => {
    if (!habilitado) return;
    let parar = false;
    let rodando = false;
    let pausaAte = 0;
    const checar = async () => {
      if (parar || rodando || desistiu.current || document.visibilityState === 'hidden' || Date.now() < pausaAte) return;
      rodando = true;
      try {
        const r: any = await api.retiradaChegadas();
        if (parar) return;
        if (!r?.ativo) {
          pausaAte = Date.now() + DESLIGADO_MS;
          vistos.current = new Map();
          return;
        }
        const lista: Chegada[] = Array.isArray(r.chegadas) ? r.chegadas : [];
        const mostrar = r.todasTelas !== false || pathRef.current === RETIRADA;
        const base = vistos.current === null;
        const mapa = vistos.current ?? new Map();
        const agora = Date.now();
        const limiteMs = Math.max(1, Number(r.deNovoMin) || 5) * 60_000;
        for (const c of lista) {
          const aviso = c.deNovoEm ?? c.chegouEm;
          const esperaMs = agora - Date.parse(c.chegouEm);
          const antes = mapa.get(c.pedidoId);
          if (!antes) {
            mapa.set(c.pedidoId, { aviso, escalou: esperaMs >= limiteMs });
            if (!base && mostrar) {
              const onde = ondeTxt(c);
              toast.info(
                `🙋 ${quem(c)} chegou para retirar o pedido ${c.numero}${onde ? ` · ${onde}` : ''} · ${c.pronto ? 'pronto' : 'em preparo'}. Veja em PDV · Balcão › Retirada / Encomendas.`,
                12_000,
              );
              tocar('novo');
            }
            continue;
          }
          if (antes.aviso !== aviso) {
            antes.aviso = aviso;
            if (mostrar) {
              toast.info(`🙋 ${quem(c)} avisou de novo que chegou · pedido ${c.numero}.`, 12_000);
              tocar('escalado');
            }
          }
          if (!antes.escalou && esperaMs >= limiteMs) {
            antes.escalou = true;
            if (mostrar) {
              toast.error(`⏰ ${quem(c)} espera há ${Math.floor(esperaMs / 60_000)} min para retirar o pedido ${c.numero}.`, 15_000);
              tocar('escalado');
            }
          }
        }
        for (const id of [...mapa.keys()]) if (!lista.some((c) => c.pedidoId === id)) mapa.delete(id);
        vistos.current = mapa;
      } catch (e) {
        const st = (e as any)?.status;
        if (st === 403 || st === 404) desistiu.current = true;
      } finally {
        rodando = false;
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
  }, [habilitado]);

  return null;
}
