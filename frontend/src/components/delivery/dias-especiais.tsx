'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { hojeNaLoja } from '@/lib/hoje-na-loja';
import {
  NOME_DO_DIA,
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
type Situacao = 'proximos' | 'passados';
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
};
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
  const [dados, setDados] = useState<{ contagem: { proximos: number; passados: number }; itens: DiaEspecial[] } | null>(null);
  const [erro, setErro] = useState('');
  const [gaveta, setGaveta] = useState<{ item: DiaEspecial | null } | null>(null);
  const [excluir, setExcluir] = useState<DiaEspecial | null>(null);
  const leitura = useRef(0);

  // Só a resposta da leitura mais nova vale (V64): trocar a situação no meio de uma leitura não mostra a velha.
  const carregar = useCallback(async (s: Situacao) => {
    const minha = ++leitura.current;
    setErro('');
    try {
      const r: any = await api.diasEspeciaisDoHorario(s);
      if (minha !== leitura.current) return;
      setDados({ contagem: r?.contagem ?? { proximos: 0, passados: 0 }, itens: Array.isArray(r?.itens) ? r.itens : [] });
    } catch (e) {
      if (minha === leitura.current) setErro(e instanceof Error && e.message ? e.message : 'Não deu para ler os dias especiais.');
    }
  }, []);
  useEffect(() => {
    void carregar(situacao);
  }, [carregar, situacao]);

  const trocar = (s: Situacao) => {
    if (s === situacao) return;
    setDados(null);
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

      {(total > 0 || situacao === 'passados') && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Situação">
          <button type="button" aria-pressed={situacao === 'proximos'} className={ficha(situacao === 'proximos')} onClick={() => trocar('proximos')}>
            Próximos <span className={conta(situacao === 'proximos')}>{contagem?.proximos ?? 0}</span>
          </button>
          <button type="button" aria-pressed={situacao === 'passados'} className={ficha(situacao === 'passados')} onClick={() => trocar('passados')}>
            Passados <span className={conta(situacao === 'passados')}>{contagem?.passados ?? 0}</span>
          </button>
        </div>
      )}

      {erro ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">
          <span className="min-w-0">{erro}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void carregar(situacao)}>Tentar de novo</Button>
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
              <span>A loja segue o horário da semana todos os dias.</span>
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

      {gaveta && (
        <GavetaDoDia
          item={gaveta.item}
          semana={semana}
          aoFechar={() => setGaveta(null)}
          aoExcluir={(e) => setExcluir(e)}
          aoSalvar={() => {
            setGaveta(null);
            void carregar(situacao);
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
            void carregar(situacao);
          }}
        />
      )}
    </section>
  );
}

// ── a gaveta de criar e editar ───────────────────────────────────────────────────────────────────────────────────
type Form = { data: string; dataFim: string; nome: string; funcionamento: Funcionamento; abre: string; fecha: string; conjunto: Conjunto; avisoAntes: boolean; avisoMexido: boolean };

function formDe(item: DiaEspecial | null): Form {
  if (!item) return { data: '', dataFim: '', nome: '', funcionamento: 'fechada', abre: '', fecha: '', conjunto: 'todos', avisoAntes: true, avisoMexido: false };
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

function GavetaDoDia({ item, semana, aoFechar, aoSalvar, aoExcluir }: { item: DiaEspecial | null; semana: SemanaDaLoja; aoFechar: () => void; aoSalvar: () => void; aoExcluir: (e: DiaEspecial) => void }) {
  const id = useId();
  const [f, setF] = useState<Form>(() => formDe(item));
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
    // A edição leva o que a gaveta não mostra (a pausa dos canais é da fase H3; a ligação com um feriado), senão o servidor
    // voltaria ao padrão: ausente não pode virar "desligado" calado (V16).
    if (item) {
      corpo.pausarCanais = item.pausarCanais;
      corpo.feriadoChave = item.feriadoChave;
    }
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
              <span className={`block text-xs ${texto2}`}>Só confirma que nesse dia vale o horário da semana.</span>
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
        </p>
        {erro && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3" role="alert">{erro}</p>}
      </div>
    </Dialogo>
  );
}
