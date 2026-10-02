'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { fraseEnvio, type EnvioDoPedido } from '@/lib/envios-pedido';

/* eslint-disable @typescript-eslint/no-explicit-any */

// LINHA DO TEMPO DO PEDIDO — os marcos dele (recebido, pronto, saiu, concluído/cancelado) e, em
// cada um, o que o Regem enviou ao canal e ao cliente, com o resultado. Só mostra: nada aqui
// reenvia. Fechada por padrão; só consulta o servidor quando é aberta.

type Linha = { quando: string; tipo: 'marco' | 'enviado' | 'falhou' | 'nao_enviado'; texto: string; detalhe?: string | null };

const hora = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  return hoje
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const ESTILO: Record<Linha['tipo'], { ponto: string; texto: string; marca: string }> = {
  marco: { ponto: 'bg-foreground', texto: 'font-semibold', marca: '' },
  enviado: { ponto: 'bg-ok', texto: '', marca: '✓' },
  falhou: { ponto: 'bg-destructive', texto: 'text-destructive font-medium', marca: '✕' },
  nao_enviado: { ponto: 'bg-warn', texto: 'text-muted-foreground', marca: '–' },
};

function montar(dados: any): Linha[] {
  const p = dados?.pedido ?? {};
  const linhas: Linha[] = [];
  const marco = (quando: string | null | undefined, texto: string, detalhe?: string | null) => {
    if (quando) linhas.push({ quando, tipo: 'marco', texto, detalhe });
  };
  marco(p.criadoEm, 'Pedido recebido');
  marco(p.prontoEm, 'Pedido pronto');
  marco(p.despachadoEm, 'Saiu para entrega');
  marco(p.concluidoEm, 'Pedido concluído');
  marco(p.canceladoEm, 'Pedido cancelado', p.motivoCancelamento);
  for (const e of (dados?.envios ?? []) as EnvioDoPedido[]) {
    linhas.push({
      quando: e.criadoEm,
      tipo: e.resultado,
      texto: fraseEnvio(e),
      detalhe: [e.motivo, e.servidor === 'loja' ? 'tentado pelo servidor da loja' : null].filter(Boolean).join(' · ') || null,
    });
  }
  // marco primeiro quando a hora empata (o envio é consequência dele)
  return linhas.sort((a, b) => new Date(a.quando).getTime() - new Date(b.quando).getTime() || (a.tipo === 'marco' ? -1 : 1));
}

export function LinhaDoTempoPedido({ pedidoId }: { pedidoId: string }) {
  const [aberta, setAberta] = useState(false);
  const [dados, setDados] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      setDados(await api.pedidoLinhaDoTempo(pedidoId));
    } catch (e) {
      setErro((e as any)?.status === 404 ? 'A linha do tempo chega com a próxima atualização do servidor.' : e instanceof Error ? e.message : 'Não foi possível carregar.');
    } finally {
      setCarregando(false);
    }
  }, [pedidoId]);

  function alternar() {
    const abrir = !aberta;
    setAberta(abrir);
    if (abrir) void carregar();
  }

  const linhas = dados ? montar(dados) : [];
  const envios: EnvioDoPedido[] = dados?.envios ?? [];
  const falhas = envios.filter((e) => e.resultado === 'falhou').length;

  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={aberta ? 'true' : 'false'}
          aria-controls="linha-do-tempo-pedido"
          className="flex items-center gap-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <span aria-hidden>{aberta ? '▾' : '▸'}</span>
          Linha do tempo e envios ao canal
          {aberta && falhas > 0 && <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-bold text-destructive">{falhas} falha(s)</span>}
        </button>
        {aberta && (
          <button type="button" onClick={carregar} disabled={carregando} className="text-xs text-muted-foreground hover:text-foreground">
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </button>
        )}
      </div>

      {aberta && (
        <div id="linha-do-tempo-pedido" className="mt-2">
          {erro && <p className="text-xs text-destructive">{erro}</p>}
          {!erro && !dados && <p className="text-xs text-muted-foreground">Carregando…</p>}
          {dados && (
            <>
              <ol className="space-y-1.5">
                {linhas.map((l, i) => {
                  const s = ESTILO[l.tipo];
                  return (
                    <li key={i} className="flex gap-2 text-xs">
                      <span className="w-[84px] flex-none pt-px text-right font-mono text-[11px] text-muted-foreground">{hora(l.quando)}</span>
                      <span className={`mt-1 h-2 w-2 flex-none rounded-full ${s.ponto}`} aria-hidden />
                      <span className="min-w-0">
                        <span className={s.texto}>
                          {s.marca && <span aria-hidden>{s.marca} </span>}
                          {l.texto}
                        </span>
                        {l.detalhe && <span className="block break-words text-[11px] text-muted-foreground">{l.detalhe}</span>}
                      </span>
                    </li>
                  );
                })}
              </ol>
              {envios.length === 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Nenhum envio registrado para este pedido neste servidor. O registro vale para as mudanças de status feitas a partir de agora.
                </p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                {dados.avisoPeloCanal ? 'Neste canal, quem avisa o cliente é o próprio canal. ' : ''}
                Mostra o que este servidor enviou; o registro não reenvia nada.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
