'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ENTREGADOR DO PEDIDO DE MARKETPLACE como o canal vê (mig 294) — hoje a 99:
//  • logística da 99: quem é o entregador da 99 e onde ele está ("chegou na loja"…);
//  • entrega da loja: se o "saiu para entrega" já foi avisado à 99 (o cliente vê no app dela).

export type Logistica = {
  modo: 'logistica_canal' | 'propria_canal';
  canal: string;
  status: number | null;
  situacao: string | null;
  entregadorNome: string | null;
  entregadorTelefone: string | null;
  chegadaLojaPrevista: string | null;
  saidaAvisadaEm: string | null;
  saidaErro: string | null;
};

const hora = (d?: string | null) =>
  d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

export const nomeCanal = (canal?: string) => (canal === '99food' ? '99' : canal === 'ifood' ? 'iFood' : canal ?? '');

/** "99 · Carlos · chegou na loja" (logística do canal). */
export function textoEntregadorDoCanal(l?: Logistica | null): string | null {
  if (!l || l.modo !== 'logistica_canal') return null;
  const partes = [nomeCanal(l.canal), l.entregadorNome || 'entregador designado', l.situacao].filter(Boolean);
  if (l.status === 120 && l.chegadaLojaPrevista) partes.push(`chega ~${hora(l.chegadaLojaPrevista)}`);
  return partes.join(' · ');
}

// Tom pela situação: chegou na loja pede atenção (entregar o pedido a ele); cancelada/interrompida, alerta.
function tom(l: Logistica) {
  if (l.status === 130) return 'bg-warn/15 text-warn';
  if (l.status === 170 || l.status === 190) return 'bg-destructive/10 text-destructive';
  if (l.status === 160) return 'bg-ok/15 text-ok';
  return 'bg-secondary text-foreground';
}

/** Selo curto para a tabela/preview do painel. */
export function SeloEntregadorDoCanal({ l }: { l?: Logistica | null }) {
  const t = textoEntregadorDoCanal(l);
  if (!t || !l) return null;
  return (
    <span className={`inline-block max-w-[260px] truncate rounded-full px-2 py-0.5 text-[11px] font-semibold ${tom(l)}`} title={t}>
      🛵 {t}
    </span>
  );
}

/** Linhas do detalhe do pedido. */
export function DetalheEntregadorDoCanal({ l, codigoColeta }: { l?: Logistica | null; codigoColeta?: string | null }) {
  if (!l) return null;
  if (l.modo === 'logistica_canal') {
    const tel = String(l.entregadorTelefone ?? '').replace(/\D/g, '');
    return (
      <div className="space-y-0.5 text-xs">
        <p className="font-medium">
          🛵 Entregador da {nomeCanal(l.canal)}: {l.entregadorNome || 'designado'}
          {tel && (
            <>
              {' · '}
              <a href={`tel:${tel}`} className="text-primary underline">📞 {l.entregadorTelefone}</a>
            </>
          )}
        </p>
        {l.situacao && (
          <p className="text-muted-foreground">
            Situação: <span className="font-semibold text-foreground">{l.situacao}</span>
            {l.status === 120 && l.chegadaLojaPrevista ? ` · chega ~${hora(l.chegadaLojaPrevista)}` : ''}
          </p>
        )}
        {codigoColeta && (
          <p>
            <span
              className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[11px] font-bold text-primary"
              title="Código de coleta da 99 — combine com o entregador da 99 na entrega do pedido"
            >
              Código de coleta {codigoColeta}
            </span>
          </p>
        )}
      </div>
    );
  }
  // Entrega da loja: o aviso de "saiu para entrega" ao canal.
  if (l.saidaAvisadaEm)
    return <p className="text-xs text-ok">✓ Saída avisada à {nomeCanal(l.canal)} às {hora(l.saidaAvisadaEm)} — o cliente acompanha no app.</p>;
  if (l.saidaErro)
    return <p className="text-xs text-warn">A {nomeCanal(l.canal)} não recebeu o aviso de saída: {l.saidaErro}</p>;
  return null;
}
