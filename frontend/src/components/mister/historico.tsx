'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Gaveta } from '@/components/ui/sobreposto';
import { SkeletonList } from '@/components/ui/skeleton';
import { Filtros, FiltroBusca, FiltroSelect, ListaDados, Selo, Situacoes, TituloLista, Vazio, semAcento } from '@/components/ui/lista';

// MISTER › HISTÓRICO (F1.4 parte B, protótipo `mockups/regem-avisos-na-tela.html` aprovado em 14/11/2026; só o
// presidente). Os avisos da empresa no modelo do Estoque: o título com a contagem, as situações com quantidade, a busca,
// o grupo e o período; a gaveta com a trilha de cada fase (quem recebeu, por onde e quando — o WhatsApp só com os 4
// últimos dígitos). O servidor lê o período; a situação, a busca e o grupo filtram aqui.

type Passo = { fase: string; em: string; destino: string; ok: boolean; nota: string | null };
type Aviso = {
  id: string;
  grupo: string;
  titulo: string;
  detalhe: string | null;
  situacao: 'aberto' | 'resolvido';
  fechouDesligado: boolean;
  abertoEm: string;
  resolvidoEm: string | null;
  escaladoEm: string | null;
  foiPara: string[];
  trilha: Passo[];
};
type Resposta = { contagens: { todos: number; aberto: number; resolvido: number }; limite: number; avisos: Aviso[] };

const GRUPOS = ['Na loja', 'Servidor da loja', 'Fiscal', 'O próprio Mister', 'Documentos e dinheiro', 'Pessoas e ponto'];
const PERIODOS = [
  { v: '7', rotulo: 'Últimos 7 dias' },
  { v: '1', rotulo: 'Hoje' },
  { v: '30', rotulo: 'Últimos 30 dias' },
];

const quando = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 86_400_000);
  const dia = (x: Date) => x.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  if (dia(d) === dia(hoje)) return `hoje ${hora}`;
  if (dia(d) === dia(ontem)) return `ontem ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })} ${hora}`;
};
const duracao = (de: string, ate: string | null) => {
  const min = Math.max(1, Math.round(((ate ? new Date(ate).getTime() : Date.now()) - new Date(de).getTime()) / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
};

function SituacaoDoAviso({ a }: { a: Aviso }) {
  if (a.situacao === 'aberto') return <Selo tom={a.escaladoEm ? 'critico' : 'aviso'}>aberto há {duracao(a.abertoEm, null)}{a.escaladoEm ? ' · escalou' : ''}</Selo>;
  if (a.fechouDesligado) return <Selo tom="neutro">fechado (aviso desligado)</Selo>;
  return <Selo tom="ok">resolvido em {duracao(a.abertoEm, a.resolvidoEm)}</Selo>;
}

export function HistoricoDosAvisos() {
  const [dias, setDias] = useState('7');
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState(false);
  const [busca, setBusca] = useState('');
  const [grupo, setGrupo] = useState('');
  const [situacao, setSituacao] = useState(-1);
  const [aberto, setAberto] = useState<Aviso | null>(null);

  const carregar = useCallback(async (d: string) => {
    setErro(false);
    setDados(null);
    try {
      setDados((await api.get(`/mister/avisos/historico?dias=${d}`)) as Resposta);
    } catch {
      setErro(true);
    }
  }, []);
  useEffect(() => void carregar(dias), [dias, carregar]);

  const base = useMemo(() => {
    const t = semAcento(busca.trim());
    return (dados?.avisos ?? []).filter((a) => (!grupo || a.grupo === grupo) && (!t || semAcento(a.titulo).includes(t)));
  }, [dados, busca, grupo]);
  const situacoes = [
    { rotulo: 'Abertos', filtro: (a: Aviso) => a.situacao === 'aberto', tom: 'aviso' as const },
    { rotulo: 'Resolvidos', filtro: (a: Aviso) => a.situacao === 'resolvido' },
  ];
  const linhas = situacao < 0 ? base : base.filter(situacoes[situacao].filtro);
  const limpar = () => {
    setBusca('');
    setGrupo('');
    setSituacao(-1);
  };

  if (erro)
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        Não consegui carregar o histórico dos avisos.{' '}
        <Button variant="outline" className="ml-2" onClick={() => void carregar(dias)}>
          Tentar de novo
        </Button>
      </div>
    );

  return (
    <section className="space-y-4" aria-labelledby="historico-avisos">
      <TituloLista
        id="historico-avisos"
        titulo="Histórico dos avisos"
        total={dados?.avisos.length ?? 0}
        mostrando={linhas.length}
        um="aviso"
        varios="avisos"
        extra={`${PERIODOS.find((p) => p.v === dias)?.rotulo.toLowerCase()} · os abertos aparecem sempre · o resolvido fica 90 dias`}
      />
      {!dados ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          <Situacoes base={base} opcoes={situacoes} valor={situacao} aoMudar={setSituacao} />
          <Filtros emLinha>
            <FiltroBusca id="hist-busca" valor={busca} aoMudar={setBusca} placeholder="Buscar aviso" />
            <FiltroSelect id="hist-grupo" rotulo="Grupo" todos="Todos os grupos" opcoes={GRUPOS} valor={grupo} aoMudar={setGrupo} />
            <FiltroSelect id="hist-periodo" rotulo="Período" opcoes={PERIODOS} valor={dias} aoMudar={setDias} />
          </Filtros>
          {dados.avisos.length >= dados.limite && (
            <p className="text-sm text-muted-foreground" role="status">
              Mostrando os {dados.limite} avisos mais recentes do período. Escolha um período menor para ver os outros.
            </p>
          )}
          {dados.avisos.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground">
              <span className="mb-1 block text-2xl" aria-hidden>
                ✅
              </span>
              Nenhum aviso no período. Quando algo sair do lugar, ele aparece aqui com a trilha.
            </p>
          ) : linhas.length === 0 ? (
            <Vazio aoLimpar={limpar}>Nenhum aviso com esses filtros.</Vazio>
          ) : (
            <ListaDados
              legenda="Avisos da empresa, com quando abriram, a situação e para onde foram"
              linhas={linhas}
              chave={(a) => a.id}
              nome={(a) => a.titulo}
              colunas={[
                { titulo: 'Aviso', celula: (a) => <span className="font-semibold">{a.titulo}</span> },
                { titulo: 'Grupo', celula: (a) => <Selo tom="neutro">{a.grupo}</Selo> },
                { titulo: 'Abriu', celula: (a) => <span className="whitespace-nowrap font-mono">{quando(a.abertoEm)}</span> },
                { titulo: 'Situação', celula: (a) => <SituacaoDoAviso a={a} /> },
                {
                  titulo: 'Foi para',
                  celula: (a) =>
                    a.foiPara.length ? (
                      <span className="flex flex-wrap gap-1">
                        {a.foiPara.map((d) => (
                          <Selo key={d} tom="neutro">
                            {d}
                          </Selo>
                        ))}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">ninguém recebeu</span>
                    ),
                },
              ]}
              acoes={() => [{ rotulo: 'Ver', icone: Eye, aoClicar: (a: Aviso) => setAberto(a) }]}
            />
          )}
        </>
      )}
      {aberto && <GavetaDoAviso a={aberto} aoFechar={() => setAberto(null)} />}
    </section>
  );
}

function GavetaDoAviso({ a, aoFechar }: { a: Aviso; aoFechar: () => void }) {
  return (
    <Gaveta titulo="Aviso" aoFechar={aoFechar}>
      <p className="flex flex-wrap gap-2">
        <Selo tom="neutro">{a.grupo}</Selo>
        <SituacaoDoAviso a={a} />
      </p>
      <h3 className="mt-2 font-display text-lg font-semibold">{a.titulo}</h3>
      {a.detalhe && <p className="text-sm text-muted-foreground">{a.detalhe}</p>}
      <h4 className="mt-4 font-display font-semibold">Trilha</h4>
      {a.trilha.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma entrega registrada.</p>
      ) : (
        <ol className="mt-2 space-y-3 border-l-2 border-border pl-4">
          {a.trilha.map((p, i) => (
            <li key={`${p.em}-${i}`} className="relative">
              <span className={`absolute -left-[23px] top-1.5 h-3 w-3 rounded-full ${p.ok ? 'bg-ok' : 'bg-muted-foreground/40'}`} aria-hidden />
              <p className="text-sm">
                <span className="font-mono font-semibold">{p.em ? quando(p.em) : ''}</span> · {p.fase}
              </p>
              <p className="text-sm text-muted-foreground">
                {p.destino} {p.ok ? '✓' : '— não saiu'}
                {p.nota ? ` · ${p.nota}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-xs text-muted-foreground">A trilha guarda só os 4 últimos dígitos de quem recebeu, nunca o telefone inteiro.</p>
    </Gaveta>
  );
}
