'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { naTelaDoTotem, resumoDoTotemAPagar, senhaDoTotem, textoDaFaixa } from '@/lib/totem-a-pagar';
import { useTotemAPagar } from './totem-a-pagar-dados';

// A FAIXA do totem em dinheiro nas telas do PDV, abaixo do topo. O ícone (`TotemAPagarIcone`) mostra a contagem desde a
// chegada; a faixa chama quando pede ação:
//   • pedido PRONTO e NÃO PAGO (a loja produz antes de cobrar): a comida está no balcão e ninguém cobrou — vermelho
//     (pedido do dono, 16/11/2026: "o atendimento recebe a notificação do pedido do totem em dinheiro pronto e não pago");
//   • pedido esperando o pagamento há mais de 8 min (o limite vem do servidor).
// "Dispensar" esconde os pedidos mostrados; pedido novo na faixa a faz voltar. Quem resolve é o operador, na Retirada.
const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const espera = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);

export function TotemAPagarAviso({ habilitado }: { habilitado: boolean }) {
  const path = usePathname() ?? '';
  const { pedidos, minutos } = useTotemAPagar(habilitado && naTelaDoTotem(path));
  const [dispensados, setDispensados] = useState<string[]>([]);

  const r = resumoDoTotemAPagar(pedidos.filter((p) => !dispensados.includes(p.id)));
  const faixa = textoDaFaixa(r, minutos);
  if (!faixa) return null;
  const mostrados = faixa.tom === 'urgente' ? r.prontos : r.atrasados;
  const n = mostrados.length;
  const urgente = faixa.tom === 'urgente';

  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-sm ${
        urgente ? 'border-destructive bg-destructive text-white' : 'border-destructive/40 bg-destructive/10'
      }`}
    >
      <span className={`font-semibold ${urgente ? '' : 'text-destructive'}`}>
        {urgente ? '⚠ ' : '⏱ '}
        {faixa.texto}
      </span>
      <ul className="flex min-w-0 flex-wrap gap-1.5">
        {mostrados.slice(0, 6).map((p) => (
          <li key={p.id} className="rounded-full border border-destructive/30 bg-card px-2 py-0.5 text-xs text-foreground">
            <span className="font-mono font-bold">{senhaDoTotem(p)}</span>
            <span className="text-muted-foreground"> · {brl(p.total)} · há {espera(p.minutos)}</span>
          </li>
        ))}
        {n > 6 && <li className="self-center text-xs">+{n - 6}</li>}
      </ul>
      <div className="ml-auto flex items-center gap-3">
        {path !== '/pdv/retirada' && (
          <Link
            href="/pdv/retirada"
            className={`rounded-md px-3 py-1 text-xs font-semibold hover:opacity-90 ${
              urgente ? 'bg-white text-destructive' : 'bg-primary text-primary-foreground'
            }`}
          >
            Cobrar na Retirada
          </Link>
        )}
        <button
          type="button"
          onClick={() => setDispensados((d) => [...new Set([...d, ...mostrados.map((p) => p.id)])])}
          className={`text-xs font-medium ${urgente ? 'text-white/85 hover:text-white' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Dispensar
        </button>
      </div>
    </div>
  );
}
