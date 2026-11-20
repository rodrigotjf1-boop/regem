'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialogo } from '@/components/ui/sobreposto';
import { FiltroBusca, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio, semAcento, type Situacao } from '@/components/ui/lista';
import { GavetaEventoDaLoja } from './gaveta-evento-da-loja';
import { NOME_DO_GRUPO, diaCurto, periodoDe, type ItemDoCalendario, type RespostaDoCalendario } from './tipos';

// DELIVERY › CLIENTES › CALENDÁRIO DE EVENTOS (F2 do docs/plano-perfil-cliente.md; protótipo, aba "Calendário"). O que
// mexe com a loja nos próximos dias: feriados por lei e pontos facultativos, datas comemorativas, dinheiro no bolso, os
// eventos que a loja cadastra e os feriados de Escalas › Feriado / evento. Jogos, clima e séries chegam com a base de
// eventos do Hub DMS; o "mexe na sua loja?" (o efeito medido) é a fase seguinte. Lista no modelo do Estoque: período,
// situações com quantidade, busca, ações na linha, gaveta para criar/editar, diálogo para excluir; vazio, carregando e
// "não li" separados (V37); só a leitura mais nova vale (V64).

const PERIODOS = [
  { dias: 14, rotulo: 'Próximos 14 dias' },
  { dias: 30, rotulo: 'Próximos 30 dias' },
  { dias: 60, rotulo: 'Próximos 60 dias' },
] as const;

const SITUACOES: Situacao<ItemDoCalendario>[] = [
  { rotulo: 'Feriados', filtro: (e) => e.grupo === 'feriado' },
  { rotulo: 'Datas comemorativas', filtro: (e) => e.grupo === 'comemorativa' },
  { rotulo: 'Dinheiro no bolso', filtro: (e) => e.grupo === 'dinheiro' },
  { rotulo: 'Da loja', filtro: (e) => e.origem !== 'regra' },
];

const TOM_DO_GRUPO = { feriado: 'ok', comemorativa: 'info', dinheiro: 'aviso', loja: 'neutro' } as const;

/** "+22% nas últimas 2 vezes": o número em destaque só quando há medida; o resto (sem histórico, pouco) em tom de apoio. */
function EfeitoNaLoja({ efeito }: { efeito?: ItemDoCalendario['efeito'] }) {
  if (!efeito) return <span className="text-secondary-foreground">—</span>;
  const medido = efeito.variacao != null && efeito.forca !== 'sem_efeito';
  return (
    <span className={`text-sm ${medido && efeito.forca !== 'fraco' ? 'font-semibold' : 'text-secondary-foreground'}`}>{efeito.texto}</span>
  );
}

export function CalendarioDaLoja() {
  const [dias, setDias] = useState<number>(14);
  const [dados, setDados] = useState<RespostaDoCalendario | null>(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [gaveta, setGaveta] = useState<{ evento: ItemDoCalendario | null } | null>(null);
  const [excluir, setExcluir] = useState<ItemDoCalendario | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const leitura = useRef(0);

  const carregar = useCallback(async (n: number) => {
    const minha = ++leitura.current;
    setErro('');
    setDados(null);
    try {
      const p = periodoDe(n);
      const r = (await api.calendarioDaLoja(p.de, p.ate)) as RespostaDoCalendario;
      if (minha === leitura.current) setDados(r);
    } catch (e) {
      if (minha === leitura.current) setErro(e instanceof Error && e.message ? e.message : 'Não consegui ler o calendário agora.');
    }
  }, []);
  useEffect(() => {
    void carregar(dias);
  }, [carregar, dias]);

  async function confirmarExclusao() {
    if (!excluir?.id) return;
    setExcluindo(true);
    try {
      await api.calendarioExcluirEvento(excluir.id);
      toast.success('Evento excluído do calendário.');
      setExcluir(null);
      void carregar(dias);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Não consegui excluir o evento agora. Tente de novo.');
    } finally {
      setExcluindo(false);
    }
  }

  const lista = dados?.eventos ?? [];
  const b = semAcento(busca);
  const base = lista.filter((e) => !b || semAcento(`${e.nome} ${e.detalhe}`).includes(b));
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const limpar = () => {
    setBusca('');
    setSit(-1);
  };

  return (
    <section className="space-y-4" aria-labelledby="calendario-titulo">
      <TituloLista
        id="calendario-titulo"
        titulo="Calendário de eventos"
        total={lista.length}
        mostrando={linhas.length}
        um="evento"
        varios="eventos"
        extra={PERIODOS.find((p) => p.dias === dias)?.rotulo.toLowerCase()}
      >
        <Button type="button" onClick={() => setGaveta({ evento: null })}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Evento da loja
        </Button>
      </TituloLista>
      <p className="text-sm text-secondary-foreground">
        Feriados, datas comemorativas, dinheiro no bolso e os eventos da sua loja. “Mexe na loja?” compara os pedidos de
        delivery das vezes anteriores do evento com o mesmo dia da semana sem evento. Jogos, clima e séries entram quando a
        base de eventos do Hub DMS estiver no ar.
      </p>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
        {PERIODOS.map((p) => (
          <button
            key={p.dias}
            type="button"
            aria-pressed={dias === p.dias}
            onClick={() => setDias(p.dias)}
            className={`inline-flex min-h-10 items-center rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              dias === p.dias ? 'border-foreground bg-foreground text-background' : 'border-input bg-card text-secondary-foreground hover:text-foreground'
            }`}
          >
            {p.rotulo}
          </button>
        ))}
      </div>

      {erro ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 basis-60">Não consegui ler o calendário agora. ({erro})</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void carregar(dias)}>
            Tentar de novo
          </Button>
        </div>
      ) : !dados ? (
        <div className="space-y-3" aria-busy="true" aria-label="Carregando o calendário">
          <Skeleton className="h-10" />
          <Skeleton className="h-56" />
        </div>
      ) : (
        <>
          <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} todas={{ rotulo: 'Todos', filtro: () => true }} />
          <Filtros>
            <FiltroBusca id="calendario-busca" valor={busca} aoMudar={setBusca} placeholder="Nome do evento" />
          </Filtros>
          {linhas.length === 0 ? (
            busca.trim() || sit >= 0 ? (
              <Vazio aoLimpar={limpar} />
            ) : (
              <Vazio>
                <span className="block">
                  Nenhum evento neste período. Cadastre o que mexe com a sua loja em “＋ Evento da loja” ou o feriado da cidade em
                  Escalas › Feriado / evento.
                </span>
              </Vazio>
            )
          ) : (
            <ListaDados
              legenda="Eventos do calendário da loja"
              linhas={linhas}
              chave={(e) => e.chave}
              nome={(e) => e.nome}
              colunas={[
                {
                  titulo: 'Evento',
                  celula: (e) => (
                    <NomeComApoio nome={e.nome} apoio={e.detalhe}>
                      {e.confianca === 'costume' && <Selo tom="neutro">costume</Selo>}
                    </NomeComApoio>
                  ),
                },
                { titulo: 'Dia', celula: (e) => <span className="whitespace-nowrap font-mono">{diaCurto(e.dia)}{e.hora ? ` · ${e.hora}` : ''}</span> },
                { titulo: 'Tipo', celula: (e) => <Selo tom={TOM_DO_GRUPO[e.grupo]}>{NOME_DO_GRUPO[e.grupo]}</Selo> },
                { titulo: 'Mexe na loja?', celula: (e) => <EfeitoNaLoja efeito={e.efeito} /> },
              ]}
              acoes={(e) =>
                e.origem === 'loja' && e.podeEditar
                  ? [
                      { rotulo: 'Editar', icone: Pencil, aoClicar: (x) => setGaveta({ evento: x }) },
                      { rotulo: 'Excluir', icone: Trash2, tom: 'perigo', aoClicar: (x) => setExcluir(x) },
                    ]
                  : []
              }
            />
          )}
          <p className="text-xs text-secondary-foreground">
            O feriado da cidade que já está em{' '}
            <Link href="/escala" className="font-semibold underline underline-offset-2">
              Escalas › Feriado / evento
            </Link>{' '}
            aparece aqui sozinho. As datas sem lei (como o Dia dos Pais e o vale do dia 20) vêm marcadas como costume.
          </p>
        </>
      )}

      {gaveta && (
        <GavetaEventoDaLoja
          evento={gaveta.evento}
          diaInicial={periodoDe(1).de}
          aoFechar={() => setGaveta(null)}
          aoSalvar={() => {
            setGaveta(null);
            void carregar(dias);
          }}
        />
      )}
      {excluir && (
        <Dialogo
          titulo="Excluir o evento?"
          aoFechar={() => setExcluir(null)}
          alerta
          rodape={
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setExcluir(null)} disabled={excluindo}>
                Cancelar
              </Button>
              <Button type="button" variant="destructive" onClick={() => void confirmarExclusao()} disabled={excluindo}>
                {excluindo ? 'Excluindo…' : 'Excluir evento'}
              </Button>
            </div>
          }
        >
          <p className="text-sm">
            “{excluir.nome}” sai do calendário{excluir.repete && excluir.repete !== 'nao' ? ', com todas as repetições' : ''}.
          </p>
        </Dialogo>
      )}
    </section>
  );
}
