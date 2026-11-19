'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FiltroBusca, FiltroSelect, Filtros, ListaDados, Selo, Situacoes, TituloLista, Vazio, semAcento, type Situacao } from '@/components/ui/lista';
import { Estrelas } from './estrelas';
import { GavetaAvaliacao } from './gaveta-avaliacao';
import { NOMES_DA_NOTA, PERIODOS_DA_NOTA, porOnde, quandoFoi, type Avaliacao, type RespostaAvaliacoes } from './tipos';

// DELIVERY › AVALIAÇÕES (mig 453, fase A1 do protótipo `mockups/regem-avaliacao-pedido.html`, aba "Delivery ›
// Avaliações"): as notas que os clientes deram aos pedidos do Regem, no modelo do Estoque — o título com a contagem, os
// números do período (que o servidor conta no período INTEIRO), as situações que filtram, a busca, "por onde", a lista que
// vira cartões no estreito (`ListaDados`) e a gaveta de cada avaliação. Vazio, carregando e "não li" separados (V37).

const ROTULO_BAIXA: Record<number, string> = { 1: 'Nota 1', 2: 'Nota 1 ou 2', 3: 'Nota 1, 2 ou 3' };

export function Avaliacoes() {
  const [periodo, setPeriodo] = useState<'hoje' | '7' | '30'>('7');
  const [dados, setDados] = useState<RespostaAvaliacoes | null>(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [origem, setOrigem] = useState('');
  const [sit, setSit] = useState(-1);
  const [aberta, setAberta] = useState<Avaliacao | null>(null);
  // Só a resposta da leitura mais nova vale (V64): trocar de período rápido não deixa a lista velha por cima da nova.
  const leitura = useRef(0);

  const carregar = useCallback(async (p: string) => {
    const minha = ++leitura.current;
    setErro('');
    setDados(null);
    try {
      const r = (await api.deliveryAvaliacoes(p)) as RespostaAvaliacoes;
      if (minha === leitura.current) setDados(r);
    } catch (e) {
      if (minha === leitura.current) setErro(e instanceof Error && e.message ? e.message : 'Não consegui ler as avaliações agora.');
    }
  }, []);
  useEffect(() => {
    void carregar(periodo);
  }, [carregar, periodo]);

  const frase = PERIODOS_DA_NOTA.find((p) => p.v === periodo)?.frase ?? '';
  const casoAte = dados?.ajustes.casoAte ?? 2;
  const SITUACOES: Situacao<Avaliacao>[] = [
    { rotulo: ROTULO_BAIXA[casoAte] ?? `Até a nota ${casoAte}`, filtro: (a) => a.nota <= casoAte, tom: 'critico' },
    { rotulo: 'Com comentário', filtro: (a) => !!a.comentario },
    { rotulo: 'Caso aberto', filtro: (a) => !!a.caso && a.caso.status !== 'resolvido', tom: 'aviso' },
  ];

  const lista = dados?.lista ?? [];
  const b = semAcento(busca.replace('#', ''));
  const base = lista.filter(
    (a) => (!origem || a.origem === origem) && (!b || semAcento(`${a.pedido.cliente ?? ''} ${a.pedido.numero ?? ''}`).includes(b)),
  );
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || origem || sit >= 0);
  const limpar = () => {
    setBusca('');
    setOrigem('');
    setSit(-1);
  };

  const k = dados?.kpis;
  const taxa = k && k.entregues > 0 ? Math.min(100, Math.round((k.avaliacoes / k.entregues) * 100)) : null;
  const maior = k ? Math.max(1, ...[1, 2, 3, 4, 5].map((n) => k.notas[n] ?? 0)) : 1;

  return (
    <section className="space-y-4" aria-labelledby="avaliacoes-titulo">
      <TituloLista
        id="avaliacoes-titulo"
        titulo="Avaliações"
        total={k?.avaliacoes ?? 0}
        mostrando={linhas.length}
        um="avaliação"
        varios="avaliações"
        extra="as notas dos pedidos do Regem"
      />
      <p className="text-sm text-secondary-foreground">
        As notas que os clientes deram aos pedidos do Regem, pelo WhatsApp oficial ou pela página do pedido. A nota {casoAte === 1 ? '1' : casoAte === 2 ? '1 ou 2' : '1, 2 ou 3'} também
        vira caso no Atendimento.
      </p>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
        {PERIODOS_DA_NOTA.map((p) => (
          <button
            key={p.v}
            type="button"
            aria-pressed={periodo === p.v}
            onClick={() => setPeriodo(p.v)}
            className={`inline-flex min-h-10 items-center rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              periodo === p.v ? 'border-foreground bg-foreground text-background' : 'border-input bg-card text-secondary-foreground hover:text-foreground'
            }`}
          >
            {p.rotulo}
          </button>
        ))}
      </div>

      {erro ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 basis-60">Não consegui ler as avaliações agora. As notas continuam sendo gravadas. ({erro})</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void carregar(periodo)}>
            Tentar de novo
          </Button>
        </div>
      ) : !dados ? (
        <div className="space-y-3" aria-busy="true" aria-label="Carregando as avaliações">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-56" />
        </div>
      ) : k && k.avaliacoes === 0 ? (
        <Vazio>
          <div className="w-full space-y-2">
          <span className="block font-semibold text-foreground">Nenhuma avaliação {frase}</span>
          <span className="block">
            {dados.ajustes.ativa
              ? 'As notas chegam depois do “Tudo certo 👍” no WhatsApp oficial e pela página do pedido.'
              : 'O “Pedir uma nota depois da entrega” está desligado: ligue em Delivery › Configurações › Robô de atendimento.'}
          </span>
          <span className="mt-2 flex flex-wrap justify-center gap-2">
            <Link
              href="/delivery/configuracoes?aba=robo"
              className="inline-flex min-h-10 items-center rounded-md border border-input px-3 text-sm font-semibold hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Ver o ajuste
            </Link>
            {periodo !== '30' && (
              <Button type="button" variant="outline" onClick={() => setPeriodo('30')}>
                Ver 30 dias
              </Button>
            )}
          </span>
          </div>
        </Vazio>
      ) : k ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-primary/50 bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-secondary-foreground">Nota média</p>
              <p className="font-mono text-3xl font-bold">{k.media != null ? k.media.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'}</p>
              <p className="text-xs text-secondary-foreground">
                {k.avaliacoes} {k.avaliacoes === 1 ? 'avaliação' : 'avaliações'} · {PERIODOS_DA_NOTA.find((p) => p.v === periodo)?.rotulo.toLowerCase()}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-secondary-foreground">Avaliaram</p>
              <p className="font-mono text-3xl font-bold">{taxa != null ? `${taxa}%` : '—'}</p>
              <p className="text-xs text-secondary-foreground">
                {k.avaliacoes} de {k.entregues} {k.entregues === 1 ? 'pedido entregue' : 'pedidos entregues'} do Regem
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-secondary-foreground" id="avaliacoes-notas">
                Notas
              </p>
              <ul className="mt-1 space-y-1" aria-labelledby="avaliacoes-notas">
                {[5, 4, 3, 2, 1].map((n) => {
                  const q = k.notas[n] ?? 0;
                  return (
                    <li key={n} className="grid grid-cols-[3.5rem_1fr_2rem] items-center gap-2 text-xs">
                      <span className="whitespace-nowrap text-primary" aria-label={`nota ${n}`}>
                        {'★'.repeat(n)}
                      </span>
                      <span className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${(q / maior) * 100}%` }} />
                      </span>
                      <span className="text-right font-mono">{q}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
          <Filtros>
            <FiltroBusca id="avaliacoes-busca" valor={busca} aoMudar={setBusca} placeholder="Cliente ou nº do pedido" />
            <FiltroSelect
              id="avaliacoes-origem"
              rotulo="Por onde"
              todos="Todas"
              opcoes={[
                { v: 'pagina', rotulo: 'Página do pedido' },
                { v: 'whatsapp', rotulo: 'WhatsApp' },
              ]}
              valor={origem}
              aoMudar={setOrigem}
            />
          </Filtros>

          {linhas.length === 0 ? (
            <Vazio aoLimpar={limpar} />
          ) : (
            <ListaDados
              legenda="Avaliações dos pedidos"
              linhas={linhas}
              chave={(a) => a.id}
              nome={(a) => (a.pedido.numero ? `pedido ${a.pedido.numero}` : 'pedido sem número')}
              colunas={[
                {
                  titulo: 'Nota',
                  celula: (a) => (
                    <span className="block">
                      <Estrelas nota={a.nota} />
                      <span className="block text-xs text-secondary-foreground">{NOMES_DA_NOTA[a.nota]}</span>
                    </span>
                  ),
                },
                {
                  titulo: 'Pedido',
                  celula: (a) => (
                    <span className="block">
                      <span className="font-mono">{a.pedido.numero ? `#${a.pedido.numero}` : '—'}</span>
                      {a.pedido.minutos != null && <span className="block text-xs text-secondary-foreground">entregue em {a.pedido.minutos} min</span>}
                    </span>
                  ),
                },
                {
                  titulo: 'Cliente',
                  celula: (a) => (
                    <span className="block">
                      <span className="break-words">{a.pedido.cliente ?? '—'}</span>
                      <span className="block text-xs text-secondary-foreground">{porOnde(a.origem)}</span>
                    </span>
                  ),
                },
                {
                  titulo: 'O que pesou e o comentário',
                  celula: (a) => (
                    <span className="block min-w-0 space-y-1">
                      {a.pesou.length ? (
                        <span className="flex flex-wrap gap-1">
                          {a.pesou.map((p) => (
                            <span key={p} className="rounded-full border border-border bg-secondary px-2 py-px text-xs font-semibold">
                              {p}
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {a.comentario ? <span className="block break-words text-sm">“{a.comentario}”</span> : !a.pesou.length ? <span className="text-secondary-foreground">—</span> : null}
                      {a.caso && <Selo tom={a.caso.status !== 'resolvido' ? 'aviso' : 'ok'}>caso {a.caso.status !== 'resolvido' ? 'aberto' : 'resolvido'}</Selo>}
                    </span>
                  ),
                },
                { titulo: 'Quando', celula: (a) => <span className="whitespace-nowrap font-mono text-xs">{quandoFoi(a.em)}</span> },
              ]}
              acoes={(a) => [{ rotulo: 'Ver', icone: Eye, aoClicar: () => setAberta(a) }]}
            />
          )}
          {filtrando && linhas.length > 0 && (
            <p>
              <Button type="button" variant="outline" size="sm" onClick={limpar}>
                Limpar filtros
              </Button>
            </p>
          )}
          {dados.mais && <p className="text-xs text-secondary-foreground">A lista mostra as 1.000 avaliações mais novas; os números de cima contam o período inteiro.</p>}
          <p className="text-xs text-secondary-foreground">
            No Atendimento: a nota baixa abre o caso “Avaliação” ligado ao pedido. Se o mesmo telefone tem um caso aberto há menos
            de 12 h, a avaliação entra nele em vez de abrir outro.
          </p>
        </>
      ) : null}

      {aberta && <GavetaAvaliacao a={aberta} aoFechar={() => setAberta(null)} />}
    </section>
  );
}
