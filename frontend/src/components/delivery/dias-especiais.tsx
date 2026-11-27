'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { hojeNaLoja } from '@/lib/hoje-na-loja';
import {
  EVENTO_DIAS_ESPECIAIS,
  NOME_DO_DIA,
  avisarQueMudou,
  curto,
  dataValida,
  diaDaSemana,
  diasEntre,
  faixaDeHoras,
  fraseDaVolta,
  minusculo,
  normalDoDia,
  porExtenso,
  proximaAberturaDepois,
  somarDias,
  textosDoOutroHorario,
} from '@/lib/dia-especial';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Chave } from '@/components/ui/chave';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import { Selo, Vazio, brl, texto2 } from '@/components/ui/lista';
import { cn } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS DIAS ESPECIAIS DO HORÁRIO (H1b; protótipo `mockups/regem-dias-especiais.html`, parte "Na loja", aprovado 27/11/2026).
// Delivery › Configurações › Horários, abaixo da semana: a lista no modelo das outras (situações que filtram, ações na
// linha), criar e editar em gaveta, excluir em diálogo e o diálogo dos pedidos agendados no dia (decisão 7: avisa e lista,
// nunca cancela). A regra do horário de uma data mora no servidor (`common/horario-da-data.ts`); esta tela só grava pelas
// rotas `cardapio/dias-especiais`, que conferem tudo de novo (o período, o nome, as horas e os dias que se cruzam).

type Funcionamento = 'fechada' | 'horario' | 'normal';
type Conjunto = 'todos' | 'entrega' | 'retirada';
type Situacao = 'proximos' | 'passados' | 'sem_resposta';
/** Um feriado sem resposta (H2a): da lei, da Escala ou do calendário do Marketing — `normal` = o horário da semana do dia. */
export type FeriadoSemResposta = { chave: string; data: string; nome: string; origem: 'lei' | 'ponto_facultativo' | 'escala' | 'calendario'; normal: string | null };
type SemResposta = { itens: FeriadoSemResposta[]; fontes: { calendario: boolean } };
const NOME_DA_ORIGEM: Record<FeriadoSemResposta['origem'], string> = {
  lei: 'Feriado por lei',
  ponto_facultativo: 'Ponto facultativo',
  escala: 'Feriado cadastrado em Escalas › Feriado / evento',
  calendario: 'Feriado da cidade, cadastrado em Delivery › Clientes › Calendário de eventos',
};
export type DiaEspecial = {
  id: string;
  data: string;
  dataFim: string | null;
  nome: string;
  funcionamento: Funcionamento;
  abre: string | null;
  fecha: string | null;
  conjunto: Conjunto;
  avisoAntes: boolean;
  pausarCanais: boolean;
  feriadoChave: string | null;
  origem: string;
  criadoEm?: string;
  agendados: number;
  /** H3: o que o iFood e a 99 vão ter no primeiro dia (vazio sem a pausa automática ligada). */
  pausas?: { canal: 'ifood' | 'food99'; desde: string; ate: string | null }[];
};

/** O selo da pausa: "iFood e 99 pausados no dia" ou "iFood pausado das 21:00 às 23:00". */
export function textoDasPausas(pausas: DiaEspecial['pausas']): string {
  const p = pausas ?? [];
  const ifood = p.filter((x) => x.canal === 'ifood');
  const tem99 = p.some((x) => x.canal === 'food99');
  if (ifood.length && tem99) return 'iFood e 99 pausados no dia';
  if (ifood.length) return `iFood pausado ${ifood.map((j) => `das ${j.desde} às ${j.ate}`).join(' e ')}`;
  return tem99 ? '99 pausada no dia' : '';
}
type Agendado = { id: string; numero: string | null; cliente: string | null; quando: string; total: number; forma: string | null; pago: boolean };

const textoDoNormal = (n: { abre: string; fecha: string } | null) => (n ? faixaDeHoras(n.abre, n.fecha) : 'fechada');

export type SemanaDaLoja = { horarios?: any[]; horariosRetirada?: any[]; horarioUnico?: boolean };
const semanaDe = (s: SemanaDaLoja, conjunto: Conjunto) => (s.horarioUnico !== false || conjunto !== 'retirada' ? s.horarios : s.horariosRetirada);

function titulo(e: Pick<DiaEspecial, 'data' | 'dataFim' | 'nome'>): string {
  const quando = e.dataFim && e.dataFim !== e.data ? `${porExtenso(e.data)} a ${minusculo(porExtenso(e.dataFim))}` : porExtenso(e.data);
  return `${quando} · ${e.nome}`;
}
const dataBr = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) : '');

/** A linha de apoio: como a loja fica, o normal daquele dia, a que horário vale, o aviso e quem cadastrou. */
function descricao(e: DiaEspecial, semana: SemanaDaLoja): string {
  const periodo = !!e.dataFim && e.dataFim !== e.data;
  const partes: string[] = [];
  if (e.funcionamento === 'fechada') partes.push(periodo ? `Fechada os ${diasEntre(e.data, e.dataFim!)} dias` : 'Fechada o dia todo');
  else if (e.funcionamento === 'horario') {
    const faixa = faixaDeHoras(String(e.abre), String(e.fecha));
    partes.push(`${faixa.charAt(0).toUpperCase()}${faixa.slice(1)}${periodo ? ` nos ${diasEntre(e.data, e.dataFim!)} dias` : ''}`);
    if (!periodo) partes.push(`o normal é ${textoDoNormal(normalDoDia(semanaDe(semana, e.conjunto), e.data))}`);
  } else partes.push('Horário normal da semana (confirmado)');
  if (semana.horarioUnico === false || e.conjunto !== 'todos')
    partes.push(e.conjunto === 'entrega' ? 'só o delivery' : e.conjunto === 'retirada' ? 'só a retirada' : 'delivery e retirada');
  if (e.funcionamento !== 'normal' && e.avisoAntes) partes.push(`aviso no cardápio desde ${minusculo(porExtenso(somarDias(e.data, -3)))}`);
  if (e.origem === 'mister') partes.push(`cadastrado pelo Mister em ${dataBr(e.criadoEm)}`);
  return partes.join(' · ');
}

// ── a lista ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function DiasEspeciais({ semana, pode: podeNaTela }: { semana: SemanaDaLoja; pode: boolean }) {
  // Quem muda: presidente e gerente — as rotas `cardapio/dias-especiais` recusam os outros (o "gestor" desta tela inclui a
  // supervisão). Lido depois de montar: a página é pré-renderizada e o token está no navegador.
  const [pode, setPode] = useState(false);
  useEffect(() => setPode(podeNaTela && ['presidente', 'gerente'].includes(getCategoria() ?? '')), [podeNaTela]);
  const [situacao, setSituacao] = useState<Situacao>('proximos');
  const [dados, setDados] = useState<{ contagem: { proximos: number; passados: number }; itens: DiaEspecial[]; pausaAutomatica: boolean } | null>(null);
  const [erro, setErro] = useState('');
  const [semResposta, setSemResposta] = useState<SemResposta | { erro: string } | null>(null);
  const [respondendo, setRespondendo] = useState('');
  const [gaveta, setGaveta] = useState<{ item: DiaEspecial | null; inicial?: Partial<Form>; feriadoChave?: string | null } | null>(null);
  const [excluir, setExcluir] = useState<DiaEspecial | null>(null);
  const leitura = useRef(0);
  const leituraDosFeriados = useRef(0);
  const abriuDoEndereco = useRef(false);
  // A lista do servidor tem duas situações; "Sem resposta" mostra os feriados (leitura própria).
  const daLista: 'proximos' | 'passados' = situacao === 'passados' ? 'passados' : 'proximos';

  // Só a resposta da leitura mais nova vale (V64): trocar a situação no meio de uma leitura não mostra a velha.
  const carregar = useCallback(async (s: 'proximos' | 'passados') => {
    const minha = ++leitura.current;
    setErro('');
    try {
      const r: any = await api.diasEspeciaisDoHorario(s);
      if (minha !== leitura.current) return;
      setDados({ contagem: r?.contagem ?? { proximos: 0, passados: 0 }, itens: Array.isArray(r?.itens) ? r.itens : [], pausaAutomatica: r?.pausaAutomatica === true });
    } catch (e) {
      if (minha === leitura.current) setErro(e instanceof Error && e.message ? e.message : 'Não deu para ler os dias especiais.');
    }
  }, []);
  // Os feriados sem resposta (H2a): os próximos 60 dias, em estado próprio (outro formato — V64).
  const carregarFeriados = useCallback(async () => {
    const minha = ++leituraDosFeriados.current;
    try {
      const r: any = await api.diasEspeciaisSemResposta();
      if (minha !== leituraDosFeriados.current) return;
      setSemResposta({ itens: Array.isArray(r?.itens) ? r.itens : [], fontes: { calendario: r?.fontes?.calendario !== false } });
    } catch (e) {
      if (minha === leituraDosFeriados.current) setSemResposta({ erro: e instanceof Error && e.message ? e.message : 'Não deu para ler os feriados.' });
    }
  }, []);
  useEffect(() => {
    void carregar(daLista);
  }, [carregar, daLista]);
  useEffect(() => {
    void carregarFeriados();
  }, [carregarFeriados]);
  // Gravou aqui ou na faixa do topo (`avisarQueMudou`): relê a lista e os feriados.
  useEffect(() => {
    const mudou = () => {
      void carregar(daLista);
      void carregarFeriados();
    };
    window.addEventListener(EVENTO_DIAS_ESPECIAIS, mudou);
    return () => window.removeEventListener(EVENTO_DIAS_ESPECIAIS, mudou);
  }, [carregar, carregarFeriados, daLista]);

  const feriados = semResposta && 'itens' in semResposta ? semResposta.itens : [];
  // "Outro horário…" da faixa da tela (`?feriado=<chave>`): abre a gaveta daquele feriado, uma vez, quando a lista chega.
  useEffect(() => {
    if (abriuDoEndereco.current || !pode || !feriados.length) return;
    let chave: string | null = null;
    try {
      chave = new URLSearchParams(window.location.search).get('feriado');
    } catch {
      /* endereço sem consulta */
    }
    const f = chave ? feriados.find((x) => x.chave === chave) : null;
    abriuDoEndereco.current = true;
    if (f) setGaveta({ item: null, inicial: { data: f.data, nome: f.nome.slice(0, 40), funcionamento: 'horario' }, feriadoChave: f.chave });
  }, [pode, feriados]);

  /** "Fechada" e "Horário normal" gravam na hora (protótipo); "Outro horário…" abre a gaveta. */
  async function responder(f: FeriadoSemResposta, funcionamento: 'fechada' | 'normal') {
    if (respondendo) return;
    setRespondendo(f.chave);
    try {
      await api.criarDiaEspecialDoHorario({ data: f.data, nome: f.nome.slice(0, 40), funcionamento, feriadoChave: f.chave });
      toast.success(funcionamento === 'fechada' ? `${porExtenso(f.data)}: a loja fica fechada (${f.nome}).` : `${porExtenso(f.data)}: vale o horário normal da semana.`);
      avisarQueMudou(); // esta lista e a faixa do topo releem pelo aviso
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Não deu para gravar a resposta.');
    } finally {
      setRespondendo('');
    }
  }

  const trocar = (s: Situacao) => {
    if (s === situacao) return;
    if ((s === 'passados') !== (situacao === 'passados')) setDados(null);
    setSituacao(s);
  };
  const contagem = dados?.contagem;
  const total = (contagem?.proximos ?? 0) + (contagem?.passados ?? 0);
  const ficha = (ligada: boolean) =>
    cn(
      'inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      ligada ? 'border-foreground bg-foreground text-background' : `border-input bg-card ${texto2} hover:border-secondary-foreground hover:text-foreground`,
    );
  const conta = (ligada: boolean) => cn('rounded-full px-2 py-px font-mono text-xs', ligada ? 'bg-background/20 text-background' : 'bg-secondary text-foreground');

  return (
    <section className="space-y-3 border-t border-border pt-5" aria-labelledby="dias-especiais-titulo">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 id="dias-especiais-titulo" className="font-display text-lg font-bold">
            Dias especiais {contagem && <span className="font-mono text-base text-secondary-foreground">{contagem.proximos}</span>}
          </h3>
          <p className={`text-xs ${texto2}`}>
            Um dia (ou um período) em que a loja fecha ou abre em outro horário. Vale para o cardápio, o agendado, o atendente do WhatsApp e o Mister.
          </p>
        </div>
        {pode && (
          <Button type="button" onClick={() => setGaveta({ item: null })}>
            ＋ Adicionar dia especial
          </Button>
        )}
      </div>

      {(total > 0 || feriados.length > 0 || situacao !== 'proximos') && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Situação">
          <button type="button" aria-pressed={situacao === 'proximos'} className={ficha(situacao === 'proximos')} onClick={() => trocar('proximos')}>
            Próximos <span className={conta(situacao === 'proximos')}>{contagem?.proximos ?? 0}</span>
          </button>
          {(feriados.length > 0 || situacao === 'sem_resposta') && (
            <button type="button" aria-pressed={situacao === 'sem_resposta'} className={ficha(situacao === 'sem_resposta')} onClick={() => trocar('sem_resposta')}>
              Sem resposta{' '}
              <span className={cn(conta(situacao === 'sem_resposta'), situacao !== 'sem_resposta' && feriados.length > 0 && 'bg-warn/15')}>{feriados.length}</span>
            </button>
          )}
          <button type="button" aria-pressed={situacao === 'passados'} className={ficha(situacao === 'passados')} onClick={() => trocar('passados')}>
            Passados <span className={conta(situacao === 'passados')}>{contagem?.passados ?? 0}</span>
          </button>
        </div>
      )}

      {situacao === 'sem_resposta' ? (
        <FeriadosSemResposta estado={semResposta} pode={pode} respondendo={respondendo} aoResponder={responder} aoOutroHorario={(f) => setGaveta({ item: null, inicial: { data: f.data, nome: f.nome.slice(0, 40), funcionamento: 'horario' }, feriadoChave: f.chave })} aoTentar={() => void carregarFeriados()} />
      ) : erro ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">
          <span className="min-w-0">{erro}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void carregar(daLista)}>Tentar de novo</Button>
        </div>
      ) : !dados ? (
        <p className={`text-sm ${texto2}`} role="status">Carregando os dias especiais…</p>
      ) : !dados.itens.length ? (
        <Vazio>
          {situacao === 'passados' ? (
            <span>Nenhum dia especial passado.</span>
          ) : (
            <span className="flex flex-col items-center gap-2">
              <b className="text-foreground">Nenhum dia especial</b>
              <span>A loja segue o horário da semana todos os dias. Os próximos feriados aparecem abaixo 60 dias antes, para você dizer como a loja fica.</span>
              {pode && (
                <Button type="button" variant="outline" onClick={() => setGaveta({ item: null })}>Adicionar dia especial</Button>
              )}
            </span>
          )}
        </Vazio>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card" aria-label={situacao === 'passados' ? 'Dias especiais passados' : 'Próximos dias especiais'}>
          {dados.itens.map((e) => (
            <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="min-w-0 flex-1 basis-64">
                <p className="break-words font-bold">{titulo(e)}</p>
                <p className={`break-words text-xs ${texto2}`}>{descricao(e, semana)}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {e.funcionamento === 'fechada' ? <Selo tom="critico">fechada</Selo> : e.funcionamento === 'horario' ? <Selo tom="aviso">outro horário</Selo> : <Selo tom="ok">horário normal</Selo>}
                  {e.dataFim && e.dataFim !== e.data && <Selo tom="info">período</Selo>}
                  {!!textoDasPausas(e.pausas) && <Selo quebrar>{textoDasPausas(e.pausas)}</Selo>}
                  {e.agendados > 0 && <Selo tom="aviso">{e.agendados === 1 ? '1 agendado' : `${e.agendados} agendados`}</Selo>}
                </div>
              </div>
              {pode && situacao === 'proximos' && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setGaveta({ item: e })} aria-label={`Editar ${titulo(e)}`}>Editar</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setExcluir(e)} aria-label={`Excluir ${titulo(e)}`}>Excluir</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Os próximos feriados sem resposta, embaixo da lista dos próximos (protótipo, "Na loja"). */}
      {situacao === 'proximos' && feriados.length > 0 && (
        <div className="space-y-2 pt-2">
          <h4 className="font-display text-base font-bold">Próximos feriados sem resposta</h4>
          <FeriadosSemResposta estado={semResposta} pode={pode} respondendo={respondendo} aoResponder={responder} aoOutroHorario={(f) => setGaveta({ item: null, inicial: { data: f.data, nome: f.nome.slice(0, 40), funcionamento: 'horario' }, feriadoChave: f.chave })} aoTentar={() => void carregarFeriados()} />
        </div>
      )}

      {gaveta && (
        <GavetaDoDia
          item={gaveta.item}
          inicial={gaveta.inicial}
          feriadoChave={gaveta.feriadoChave ?? null}
          pausaAutomatica={!!dados?.pausaAutomatica}
          semana={semana}
          aoFechar={() => setGaveta(null)}
          aoExcluir={(e) => setExcluir(e)}
          aoSalvar={() => {
            setGaveta(null);
            avisarQueMudou();
          }}
        />
      )}
      {excluir && (
        <ExcluirDia
          item={excluir}
          semana={semana}
          aoFechar={() => setExcluir(null)}
          aoExcluir={() => {
            setExcluir(null);
            setGaveta(null);
            avisarQueMudou();
          }}
        />
      )}
    </section>
  );
}

// ── os feriados sem resposta (H2a) ───────────────────────────────────────────────────────────────────────────────
function FeriadosSemResposta({
  estado,
  pode,
  respondendo,
  aoResponder,
  aoOutroHorario,
  aoTentar,
}: {
  estado: SemResposta | { erro: string } | null;
  pode: boolean;
  respondendo: string;
  aoResponder: (f: FeriadoSemResposta, como: 'fechada' | 'normal') => void;
  aoOutroHorario: (f: FeriadoSemResposta) => void;
  aoTentar: () => void;
}) {
  if (!estado) return <p className={`text-sm ${texto2}`} role="status">Carregando os feriados…</p>;
  if ('erro' in estado)
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">
        <span className="min-w-0">{estado.erro}</span>
        <Button type="button" variant="outline" size="sm" onClick={aoTentar}>Tentar de novo</Button>
      </div>
    );
  return (
    <div className="space-y-2">
      <p className={`text-xs ${texto2}`}>
        Os feriados por lei, os pontos facultativos, o feriado da cidade (Delivery › Clientes › Calendário de eventos) e os de Escalas › Feriado / evento aparecem aqui 60 dias antes. Sem resposta, vale o horário da semana.
      </p>
      {!estado.fontes.calendario && (
        <p className={`text-xs ${texto2}`} role="status">
          O feriado da cidade do calendário de eventos não foi lido aqui: ele aparece quando o Regem é aberto pela internet.
        </p>
      )}
      {!estado.itens.length ? (
        <Vazio>
          <span>Nenhum feriado sem resposta nos próximos 60 dias.</span>
        </Vazio>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-warn/40 bg-warn/5" aria-label="Feriados sem resposta">
          {estado.itens.map((f) => (
            <li key={f.chave} className="flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="min-w-0 flex-1 basis-64">
                <p className="break-words font-bold">{porExtenso(f.data)} · {f.nome}</p>
                <p className={`break-words text-xs ${texto2}`}>
                  {NOME_DA_ORIGEM[f.origem]} · o normal de {minusculo(NOME_DO_DIA[diaDaSemana(f.data)])} é {f.normal ?? 'fechada'}
                </p>
              </div>
              {pode && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={!!respondendo} onClick={() => aoResponder(f, 'normal')} aria-label={`Horário normal em ${porExtenso(f.data)} · ${f.nome}`}>Horário normal</Button>
                  <Button type="button" variant="outline" size="sm" disabled={!!respondendo} onClick={() => aoResponder(f, 'fechada')} aria-label={`Fechada em ${porExtenso(f.data)} · ${f.nome}`}>Fechada</Button>
                  <Button type="button" variant="outline" size="sm" disabled={!!respondendo} onClick={() => aoOutroHorario(f)} aria-label={`Outro horário em ${porExtenso(f.data)} · ${f.nome}`}>Outro horário…</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── a gaveta de criar e editar ───────────────────────────────────────────────────────────────────────────────────
type Form = { data: string; dataFim: string; nome: string; funcionamento: Funcionamento; abre: string; fecha: string; conjunto: Conjunto; avisoAntes: boolean; avisoMexido: boolean; pausarCanais: boolean };

function formDe(item: DiaEspecial | null): Form {
  // A pausa do iFood e da 99 nasce LIGADA no dia novo (decisão 5).
  if (!item) return { data: '', dataFim: '', nome: '', funcionamento: 'fechada', abre: '', fecha: '', conjunto: 'todos', avisoAntes: true, avisoMexido: false, pausarCanais: true };
  return {
    data: item.data,
    dataFim: item.dataFim ?? '',
    nome: item.nome,
    funcionamento: item.funcionamento,
    abre: item.abre ?? '',
    fecha: item.fecha ?? '',
    conjunto: item.conjunto,
    avisoAntes: item.avisoAntes,
    avisoMexido: true,
    pausarCanais: item.pausarCanais !== false,
  };
}

/** O que o cliente vê no cardápio no dia — o mesmo texto da faixa da vitrine (`AvisoLoja`). */
function previaDoCardapio(f: Form, semana: SemanaDaLoja): string {
  if (f.funcionamento === 'normal') return 'Nada muda: vale o horário da semana.';
  if (f.funcionamento === 'horario') {
    if (!f.abre || !f.fecha) return 'Escolha a hora em que abre e a hora em que fecha.';
    const t = textosDoOutroHorario(f.nome || '…', f.abre, f.fecha);
    return `${t.titulo} · ${t.texto}`;
  }
  const fim = f.dataFim || f.data;
  const volta = dataValida(fim) ? proximaAberturaDepois(f.data, fim, semanaDe(semana, f.conjunto)) : null;
  return `Fechado hoje · ${f.nome || '…'}.${volta ? ` ${fraseDaVolta(volta)}` : ''}`;
}

function GavetaDoDia({
  item,
  inicial,
  feriadoChave,
  pausaAutomatica,
  semana,
  aoFechar,
  aoSalvar,
  aoExcluir,
}: {
  item: DiaEspecial | null;
  /** O dia novo que vem de um feriado sem resposta ("Outro horário…"): a data, o nome e o como-fica já escolhidos. */
  inicial?: Partial<Form>;
  /** A chave do feriado respondido (vai para `feriado_chave`: ele sai da lista dos sem resposta). */
  feriadoChave: string | null;
  /** H3: a pausa sozinha do iFood e da 99 está ligada (a variável da distribuição) — só então a chave aparece. */
  pausaAutomatica: boolean;
  semana: SemanaDaLoja;
  aoFechar: () => void;
  aoSalvar: () => void;
  aoExcluir: (e: DiaEspecial) => void;
}) {
  const id = useId();
  const [f, setF] = useState<Form>(() => {
    const base = { ...formDe(item), ...(item ? {} : inicial ?? {}) };
    // "Outro horário" começa pelo horário normal daquele dia (a pessoa só ajusta), como ao escolher a opção.
    if (base.funcionamento === 'horario' && !base.abre && dataValida(base.data)) {
      const n = normalDoDia(semanaDe(semana, base.conjunto), base.data);
      return { ...base, abre: n?.abre ?? '18:00', fecha: n?.fecha ?? '22:00', avisoAntes: base.avisoMexido ? base.avisoAntes : false };
    }
    return base;
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [agendados, setAgendados] = useState<{ itens: Agendado[] } | { erro: true } | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const leitura = useRef(0);
  const hoje = hojeNaLoja();
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));
  const normal = dataValida(f.data) ? normalDoDia(semanaDe(semana, f.conjunto), f.data) : null;

  // Os pedidos agendados do dia (ou do período): lidos ao escolher a data, para avisar antes de salvar (decisão 7).
  useEffect(() => {
    const minha = ++leitura.current;
    if (!dataValida(f.data) || f.funcionamento === 'normal' || (f.dataFim && (!dataValida(f.dataFim) || f.dataFim < f.data))) {
      setAgendados(null);
      return;
    }
    setAgendados(null);
    api
      .agendadosDoPeriodo(f.data, f.dataFim || undefined)
      .then((r: any) => {
        if (minha === leitura.current) setAgendados({ itens: Array.isArray(r?.itens) ? r.itens : [] });
      })
      .catch(() => {
        if (minha === leitura.current) setAgendados({ erro: true });
      });
  }, [f.data, f.dataFim, f.funcionamento]);

  function escolherFuncionamento(v: Funcionamento) {
    setF((x) => ({
      ...x,
      funcionamento: v,
      // O aviso segue a decisão 6 (ligado no dia fechado, desligado no de outro horário) até a pessoa mexer nele.
      avisoAntes: x.avisoMexido ? x.avisoAntes : v === 'fechada',
      // Outro horário começa pelo normal daquele dia (a pessoa só ajusta).
      abre: v === 'horario' && !x.abre ? normal?.abre ?? '18:00' : x.abre,
      fecha: v === 'horario' && !x.fecha ? normal?.fecha ?? '22:00' : x.fecha,
    }));
  }

  const listaDeAgendados = agendados && 'itens' in agendados ? agendados.itens : [];
  const falta = !dataValida(f.data) ? 'Escolha o dia.' : !f.nome.trim() ? 'Escreva o nome que o cliente vê.' : f.funcionamento === 'horario' && (!f.abre || !f.fecha) ? 'Escolha a hora em que abre e a hora em que fecha.' : '';

  async function gravar() {
    if (salvando || falta) return;
    setSalvando(true);
    setErro('');
    const corpo: Record<string, unknown> = {
      data: f.data,
      dataFim: f.dataFim || null,
      nome: f.nome.trim(),
      funcionamento: f.funcionamento,
      abre: f.funcionamento === 'horario' ? f.abre : null,
      fecha: f.funcionamento === 'horario' ? f.fecha : null,
      conjunto: semana.horarioUnico !== false ? 'todos' : f.conjunto,
      avisoAntes: f.funcionamento === 'normal' ? false : f.avisoAntes,
    };
    // A pausa dos canais: a chave da gaveta quando a pausa sozinha está ligada (H3); sem ela, a edição leva o valor que já
    // estava (V16) e o dia novo vai sem o campo (o servidor usa o padrão da decisão 5). A ligação com um feriado também vai.
    if (pausaAutomatica) corpo.pausarCanais = f.funcionamento === 'normal' ? false : f.pausarCanais;
    else if (item) corpo.pausarCanais = item.pausarCanais;
    if (item) corpo.feriadoChave = item.feriadoChave;
    else if (feriadoChave) corpo.feriadoChave = feriadoChave;
    try {
      if (item) await api.editarDiaEspecialDoHorario(item.id, corpo);
      else await api.criarDiaEspecialDoHorario(corpo);
      toast.success(`Dia especial salvo: ${titulo({ data: f.data, dataFim: f.dataFim || null, nome: f.nome.trim() })}.`);
      aoSalvar();
    } catch (e) {
      setConfirmar(false);
      setErro(e instanceof Error && e.message ? e.message : 'Não deu para salvar o dia especial.');
    } finally {
      setSalvando(false);
    }
  }
  function salvar() {
    if (f.funcionamento !== 'normal' && listaDeAgendados.length > 0) setConfirmar(true);
    else void gravar();
  }

  const quando = dataValida(f.data) ? titulo({ data: f.data, dataFim: f.dataFim || null, nome: f.nome.trim() || '…' }) : '';
  return (
    <Gaveta
      titulo={item ? 'Editar dia especial' : 'Novo dia especial'}
      aoFechar={aoFechar}
      rodape={
        <>
          {item && (
            <Button type="button" variant="outline" className="mr-auto" onClick={() => aoExcluir(item)}>Excluir dia</Button>
          )}
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={salvando || !!falta} title={falta || undefined}>
            {salvando ? 'Salvando…' : 'Salvar dia'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {quando && <p className={`text-sm ${texto2}`}>{quando}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-dia`} className="text-xs">Dia</Label>
            <Input id={`${id}-dia`} type="date" min={hoje} value={f.data} onChange={(e) => set({ data: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-ate`} className="text-xs">Até (para um período)</Label>
            <Input id={`${id}-ate`} type="date" min={f.data || hoje} value={f.dataFim} onChange={(e) => set({ dataFim: e.target.value })} aria-describedby={`${id}-ate-ajuda`} />
            <p id={`${id}-ate-ajuda`} className={`text-xs ${texto2}`}>Vazio = só este dia.</p>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-nome`} className="text-xs">Nome que o cliente vê</Label>
          <Input id={`${id}-nome`} value={f.nome} maxLength={40} placeholder="Ex.: Natal" onChange={(e) => set({ nome: e.target.value })} aria-describedby={`${id}-nome-ajuda`} />
          <p id={`${id}-nome-ajuda`} className={`text-xs ${texto2}`}>Aparece no cardápio e na resposta do atendente.</p>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-bold">Como a loja fica</legend>
          <label className={cn('flex cursor-pointer gap-3 rounded-lg border p-3', f.funcionamento === 'fechada' ? 'border-foreground' : 'border-border')}>
            <input type="radio" name={`${id}-como`} className="mt-1 h-4 w-4 accent-primary" checked={f.funcionamento === 'fechada'} onChange={() => escolherFuncionamento('fechada')} />
            <span className="min-w-0">
              <b className="block text-sm">Fechada o dia todo</b>
              <span className={`block text-xs ${texto2}`}>O cardápio não aceita pedido nesse dia e o agendado não oferece horário.</span>
            </span>
          </label>
          <div className={cn('rounded-lg border p-3', f.funcionamento === 'horario' ? 'border-foreground' : 'border-border')}>
            <label className="flex cursor-pointer gap-3">
              <input type="radio" name={`${id}-como`} className="mt-1 h-4 w-4 accent-primary" checked={f.funcionamento === 'horario'} onChange={() => escolherFuncionamento('horario')} />
              <span className="min-w-0">
                <b className="block text-sm">Outro horário</b>
                <span className={`block text-xs ${texto2}`}>
                  {dataValida(f.data) && !(f.dataFim && f.dataFim !== f.data)
                    ? `O normal de ${minusculo(NOME_DO_DIA[diaDaSemana(f.data)])} é ${textoDoNormal(normal)}.`
                    : 'A loja abre e fecha nas horas que você escolher.'}
                </span>
              </span>
            </label>
            {f.funcionamento === 'horario' && (
              <div className="mt-2 flex flex-wrap gap-3 pl-7">
                <div className="space-y-1">
                  <Label htmlFor={`${id}-abre`} className="text-xs">Abre</Label>
                  <Input id={`${id}-abre`} type="time" className="w-32" value={f.abre} onChange={(e) => set({ abre: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${id}-fecha`} className="text-xs">Fecha</Label>
                  <Input id={`${id}-fecha`} type="time" className="w-32" value={f.fecha} onChange={(e) => set({ fecha: e.target.value })} />
                </div>
              </div>
            )}
          </div>
          <label className={cn('flex cursor-pointer gap-3 rounded-lg border p-3', f.funcionamento === 'normal' ? 'border-foreground' : 'border-border')}>
            <input type="radio" name={`${id}-como`} className="mt-1 h-4 w-4 accent-primary" checked={f.funcionamento === 'normal'} onChange={() => escolherFuncionamento('normal')} />
            <span className="min-w-0">
              <b className="block text-sm">Horário normal</b>
              <span className={`block text-xs ${texto2}`}>Só confirma: nesse dia vale o horário da semana, e o Regem para de perguntar sobre o feriado.</span>
            </span>
          </label>
        </fieldset>

        {semana.horarioUnico === false && (
          <fieldset className="space-y-1">
            <legend className="mb-1 text-xs font-bold">Vale para</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {([['todos', 'Delivery e retirada'], ['entrega', 'Só o delivery'], ['retirada', 'Só a retirada']] as const).map(([v, r]) => (
                <label key={v} className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name={`${id}-vale`} className="h-4 w-4 accent-primary" checked={f.conjunto === v} onChange={() => set({ conjunto: v })} />
                  {r}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {f.funcionamento !== 'normal' && (
          <div className="flex items-start justify-between gap-3 border-t border-border pt-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold" id={`${id}-aviso-rotulo`}>Avisar no cardápio 3 dias antes</p>
              <p className={`text-xs ${texto2}`}>
                {dataValida(f.data)
                  ? `A partir de ${minusculo(porExtenso(somarDias(f.data, -3)))}, no topo do cardápio.`
                  : 'Uma faixa no topo do cardápio, a partir de 3 dias antes.'}
              </p>
            </div>
            <Chave ligada={f.avisoAntes} rotulo="Avisar no cardápio 3 dias antes" aoMudar={(v) => set({ avisoAntes: v, avisoMexido: true })} />
          </div>
        )}

        {/* H3 (decisão 5): a pausa sozinha do iFood e da 99 — só quando ela está ligada e o dia vale para o delivery. */}
        {pausaAutomatica && f.funcionamento !== 'normal' && (semana.horarioUnico !== false || f.conjunto !== 'retirada') && (
          <div className="flex items-start justify-between gap-3 border-t border-border pt-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Pausar o iFood e a 99</p>
              <p className={`text-xs ${texto2}`}>
                {f.funcionamento === 'fechada'
                  ? 'O iFood fica pausado nas horas em que a loja abriria, e a 99 até o fim do dia. Pela pausa do painel do Delivery: dá para reabrir lá.'
                  : 'O iFood fica pausado nas horas da semana em que a loja não vai abrir. A 99 só pausa o dia inteiro fechado. Pela pausa do painel do Delivery: dá para reabrir lá.'}
              </p>
            </div>
            <Chave ligada={f.pausarCanais} rotulo="Pausar o iFood e a 99" aoMudar={(v) => set({ pausarCanais: v })} />
          </div>
        )}

        {dataValida(f.data) && (
          <div className="space-y-2 rounded-lg bg-secondary p-3 text-sm">
            <p>
              <b className="block text-xs uppercase tracking-wide text-secondary-foreground">O cliente vê no cardápio, no dia</b>
              {previaDoCardapio(f, semana)}
            </p>
          </div>
        )}

        {agendados && 'erro' in agendados && (
          <p className={`text-xs ${texto2}`} role="status">Não deu para conferir os pedidos agendados deste dia.</p>
        )}
        {listaDeAgendados.length > 0 && (
          <div className="space-y-2 rounded-lg border border-warn/50 bg-warn/10 p-3 text-sm" role="status">
            <p>
              <b>
                {listaDeAgendados.length === 1 ? '1 pedido agendado' : `${listaDeAgendados.length} pedidos agendados`} para {f.dataFim && f.dataFim !== f.data ? 'esse período' : minusculo(porExtenso(f.data))}
              </b>{' '}
              ({listaDeAgendados.map((a) => `#${a.numero ?? a.id.slice(0, 6)}`).join(', ')}). Salvar o dia especial não cancela os pedidos.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmar(true)}>Ver os agendados</Button>
          </div>
        )}

        {erro && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">{erro}</p>
        )}
      </div>

      {confirmar && (
        <Dialogo
          alerta
          titulo={`Há ${listaDeAgendados.length === 1 ? '1 pedido agendado' : `${listaDeAgendados.length} pedidos agendados`} para ${f.dataFim && f.dataFim !== f.data ? 'esse período' : minusculo(porExtenso(f.data))}`}
          aoFechar={() => setConfirmar(false)}
          rodape={
            <>
              <a href="/delivery?situacao=agendados" className={buttonVariants({ variant: 'outline' })}>Ver os agendados</a>
              <Button type="button" onClick={() => void gravar()} disabled={salvando || !!falta}>
                {salvando ? 'Salvando…' : 'Salvar mesmo assim'}
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <p>Salvar o dia especial não cancela estes pedidos. Fale com os clientes e mude o horário, ou cancele, em Delivery › Painel › Agendados.</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {listaDeAgendados.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 px-3 py-2">
                  <span className="min-w-0 break-words"><b>#{a.numero ?? a.id.slice(0, 6)}</b>{a.cliente ? ` · ${a.cliente}` : ''}</span>
                  <span className="font-mono text-xs">
                    {a.quando.slice(11, 16)} · {curto(a.quando.slice(0, 10))} · {brl(a.total)} · {a.pago ? 'pago' : 'a pagar'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Dialogo>
      )}
    </Gaveta>
  );
}

// ── excluir ──────────────────────────────────────────────────────────────────────────────────────────────────────
function ExcluirDia({ item, semana, aoFechar, aoExcluir }: { item: DiaEspecial; semana: SemanaDaLoja; aoFechar: () => void; aoExcluir: () => void }) {
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState('');
  const periodo = !!item.dataFim && item.dataFim !== item.data;
  const volta = periodo
    ? 'A loja volta ao horário da semana nesses dias.'
    : `A loja volta ao horário de ${minusculo(NOME_DO_DIA[diaDaSemana(item.data)])}: ${textoDoNormal(normalDoDia(semanaDe(semana, item.conjunto), item.data))}.`;
  async function confirmar() {
    if (excluindo) return;
    setExcluindo(true);
    setErro('');
    try {
      await api.excluirDiaEspecialDoHorario(item.id);
      toast.success(`Dia especial excluído: ${titulo(item)}.`);
      aoExcluir();
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : 'Não deu para excluir o dia especial.');
    } finally {
      setExcluindo(false);
    }
  }
  return (
    <Dialogo
      alerta
      titulo={`Excluir o dia especial de ${periodo ? `${curto(item.data)} a ${curto(item.dataFim!)}` : minusculo(porExtenso(item.data))}?`}
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" variant="destructive" onClick={() => void confirmar()} disabled={excluindo}>
            {excluindo ? 'Excluindo…' : 'Excluir'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          {volta} O cardápio, o agendado e o atendente passam a usar esse horário na hora.
          {item.pausas?.length
            ? ' A pausa do iFood e da 99 marcada para esse dia não acontece mais; a que já estiver valendo continua até reabrir no painel do Delivery.'
            : ''}
        </p>
        {erro && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3" role="alert">{erro}</p>}
      </div>
    </Dialogo>
  );
}
