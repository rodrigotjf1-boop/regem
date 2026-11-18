'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { texto2 } from '@/components/ui/lista';
import { cn } from '@/lib/utils';

// O CUSTO ESTIMADO DA CAMPANHA ANTES DE ENVIAR (G3 do protótipo `mockups/regem-whatsapp-gasto.html`, decisão 6): o público
// × o preço por mensagem que a própria conta pagou (sem histórico, o publicado da Meta). Para o presidente, também o gasto
// do mês e o alerta que a campanha faz passar. Só informa: não bloqueia o envio.

type Estimativa =
  | { oficial: false }
  | {
      oficial: true;
      grupo: 'marketing' | 'utilidade' | 'autenticacao';
      mensagens: number;
      preco: number;
      fonte: 'conta' | 'tabela';
      moeda: string | null;
      estimativa: number;
      mes?: { custoDoMes: number; depois: number; alertasLigados: boolean; passaDe: number | null; proximo: number | null };
    };

const NOME: Record<string, string> = { marketing: 'marketing', utilidade: 'utilidade', autenticacao: 'autenticação' };
const reais = (n: number, moeda?: string | null) => {
  try {
    return n.toLocaleString('pt-BR', { style: 'currency', currency: moeda || 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
  } catch {
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
};
const reais2 = (n: number, moeda?: string | null) => {
  try {
    return n.toLocaleString('pt-BR', { style: 'currency', currency: moeda || 'BRL' });
  } catch {
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
};

export function CustoDaCampanha({ mensagens, categoria }: { mensagens: number | null; categoria: string | null | undefined }) {
  const [e, setE] = useState<Estimativa | null>(null);
  const [erro, setErro] = useState(false);
  // Só a resposta do pedido mais novo vale (V64): trocar o público rápido não deixa a resposta velha por cima.
  const pedido = useRef(0);
  useEffect(() => {
    if (mensagens == null) return;
    const meu = ++pedido.current;
    setErro(false);
    api
      .whatsappGastoEstimativa(mensagens, categoria || 'MARKETING')
      .then((r) => meu === pedido.current && setE(r as Estimativa))
      .catch(() => meu === pedido.current && setErro(true));
  }, [mensagens, categoria]);

  if (mensagens == null || erro || !e || !e.oficial) return null;
  const moeda = e.moeda;
  return (
    <div className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs" data-custo-da-campanha>
      <p>
        Custo estimado na Meta: <strong className="font-mono">~{reais2(e.estimativa, moeda)}</strong> ({e.mensagens.toLocaleString('pt-BR')} ×{' '}
        <span className="font-mono">~{reais(e.preco, moeda)}</span>,{' '}
        {e.fonte === 'conta' ? `o preço de ${NOME[e.grupo]} que a sua conta pagou nos últimos 60 dias` : `o preço publicado da Meta para ${NOME[e.grupo]}`}). A
        Meta cobra só o que for entregue.
      </p>
      {e.mes && (
        <p className={cn('mt-1', e.mes.passaDe !== null ? 'font-semibold text-foreground' : texto2)} data-custo-do-mes>
          Gasto deste mês até agora: <span className="font-mono">{reais2(e.mes.custoDoMes, moeda)}</span>. Com esta campanha vai a cerca de{' '}
          <span className="font-mono">{reais2(e.mes.depois, moeda)}</span>
          {e.mes.passaDe !== null
            ? ` e passa do alerta de ${reais2(e.mes.passaDe, moeda)} — o Mister avisa quando passar.`
            : e.mes.proximo !== null
              ? `; o próximo alerta é de ${reais2(e.mes.proximo, moeda)}.`
              : e.mes.alertasLigados
                ? '.'
                : '. Os alertas de gasto ficam no Mister › Avisos e relatórios.'}
        </p>
      )}
    </div>
  );
}
