'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chave } from '@/components/ui/chave';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio, semAcento, texto2,
  type Situacao, type Tom,
} from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DIAS = [
  { n: 0, l: 'Dom' }, { n: 1, l: 'Seg' }, { n: 2, l: 'Ter' }, { n: 3, l: 'Qua' },
  { n: 4, l: 'Qui' }, { n: 5, l: 'Sex' }, { n: 6, l: 'Sáb' },
];
const PRIORIDADES: { v: string; l: string; curto: string; tom: Tom }[] = [
  { v: 'danger', l: 'Emergência (vermelho)', curto: 'Emergência', tom: 'critico' },
  { v: 'alta', l: 'Alta (âmbar)', curto: 'Alta', tom: 'aviso' },
  { v: 'info', l: 'Informativo (azul)', curto: 'Informativo', tom: 'info' },
  { v: 'ok', l: 'Positivo (verde)', curto: 'Positivo', tom: 'ok' },
];
const FONTES = [
  { v: 'pedidos_balcao', l: 'Pedidos de balcão acumulados' },
  { v: 'pedidos_delivery', l: 'Pedidos de delivery acumulados' },
  { v: 'pedidos_total', l: 'Pedidos em produção (total)' },
];
const vazio = () => ({
  id: '',
  titulo: '',
  detalhe: '',
  prioridade: 'alta',
  tipo: 'agendado',
  horarios: [] as string[],
  diasSemana: [0, 1, 2, 3, 4, 5, 6] as number[],
  condicao: { fonte: 'pedidos_balcao', operador: '>=', limiar: 10 },
  duracaoSeg: 60,
  ativo: true,
});
const prioridadeDe = (a: any) => PRIORIDADES.find((p) => p.v === a.prioridade) ?? PRIORIDADES[1];
/** "10:00 · 14:00 — todos os dias" ou "Pedidos de delivery acumulados >= 8". */
function quando(a: any): string {
  if (a.tipo !== 'agendado') return `${FONTES.find((f) => f.v === a.condicao?.fonte)?.l ?? a.condicao?.fonte ?? '—'} ${a.condicao?.operador ?? ''} ${a.condicao?.limiar ?? ''}`.trim();
  const dias: number[] = a.diasSemana ?? [];
  const quais = dias.length === 7 ? 'todos os dias' : dias.length ? dias.map((d) => DIAS[d]?.l.toLowerCase()).join(', ') : 'nenhum dia';
  return `${(a.horarios ?? []).join(' · ') || 'sem horário'} — ${quais}`;
}
const SITUACOES: Situacao<any>[] = [
  { rotulo: 'Ativos', filtro: (a) => !!a.ativo },
  { rotulo: 'Inativos', filtro: (a) => !a.ativo },
  { rotulo: 'Agendados', filtro: (a) => a.tipo === 'agendado' },
  { rotulo: 'Condicionais', filtro: (a) => a.tipo !== 'agendado' },
];
const ID_TITULO = 'alertas-titulo';

// Configurações → Alertas do KDS (mockup `mockups/regem-configuracoes.html`): as mensagens do rodapé do
// KDS, em lista. Ligar e desligar é na linha; criar e editar, na gaveta; testar e excluir pedem confirmação.
export default function KdsAlertasPage() {
  const router = useRouter();
  const [lista, setLista] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [prioridade, setPrioridade] = useState('');
  const [editando, setEditando] = useState<any | null>(null);
  const [testando, setTestando] = useState<any | null>(null);
  const [excluindo, setExcluindo] = useState<any | null>(null);
  const [gravando, setGravando] = useState<string | null>(null); // id do alerta com a chave sendo gravada

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const r: any = await api.kdsAlertas();
      setLista(Array.isArray(r) ? r : []);
    } catch (e) {
      setLista([]);
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar os alertas.');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    if (!['presidente', 'gerente'].includes(getCategoria() ?? '')) {
      router.replace('/meu-dia');
      return;
    }
    void carregar();
  }, [router, carregar]);

  async function ligar(a: any, ativo: boolean) {
    setGravando(a.id);
    try {
      await api.kdsAlertaAtualizar(a.id, { ativo });
      toast.success(ativo ? `"${a.titulo}" ligado.` : `"${a.titulo}" desligado.`);
      await carregar();
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao salvar.');
    } finally {
      setGravando(null);
    }
  }

  if (lista === null)
    return (
      <Shell eyebrow="Configurações" title="Alertas do KDS">
        <SkeletonList rows={4} />
      </Shell>
    );

  const b = semAcento(busca);
  const base = lista.filter((a) => (!b || semAcento(`${a.titulo} ${a.detalhe ?? ''}`).includes(b)) && (!prioridade || a.prioridade === prioridade));
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || prioridade || sit >= 0);
  const limpar = () => { setBusca(''); setPrioridade(''); setSit(-1); };

  return (
    <Shell eyebrow="Configurações" title="Alertas do KDS">
      <section className="space-y-3" aria-labelledby={ID_TITULO}>
        <TituloLista id={ID_TITULO} titulo="Alertas do rodapé do KDS" total={lista.length} mostrando={linhas.length} um="alerta" varios="alertas">
          <Button type="button" onClick={() => setEditando(vazio())}><Plus className="h-4 w-4" aria-hidden="true" /> Novo alerta</Button>
        </TituloLista>
        <p className={`max-w-3xl text-sm ${texto2}`}>
          Mensagens que aparecem no rodapé do KDS. <strong>Agendados</strong> disparam em horários e dias marcados (ex.: &quot;Horário de
          lavar as mãos&quot;); <strong>condicionais</strong> disparam quando um limiar é atingido (ex.: muitos pedidos acumulados). A
          duração controla quanto tempo cada um fica no ar — um alerta urgente curto sobrepõe um longo e depois o ciclo do longo volta.
        </p>

        {erro ? (
          <Card className="flex flex-wrap items-center justify-center gap-3 p-8 text-center text-sm">
            <span role="alert">{erro}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => { setLista(null); void carregar(); }}>Tentar de novo</Button>
          </Card>
        ) : (
          <>
            <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
            <Filtros>
              <FiltroBusca id="alertas-busca" valor={busca} aoMudar={setBusca} placeholder="Título do alerta" />
              <FiltroSelect id="alertas-prioridade" rotulo="Prioridade" todos="Todas as prioridades" opcoes={PRIORIDADES.map((p) => ({ v: p.v, rotulo: p.curto }))} valor={prioridade} aoMudar={setPrioridade} />
            </Filtros>
            {lista.length === 0 ? (
              <Vazio>Nenhum alerta cadastrado. Crie o primeiro em &quot;Novo alerta&quot;.</Vazio>
            ) : linhas.length === 0 ? (
              <Vazio aoLimpar={limpar} />
            ) : (
              <ListaDados
                legenda="Alertas do rodapé do KDS"
                linhas={linhas}
                chave={(a) => a.id}
                nome={(a) => a.titulo}
                colunas={[
                  { titulo: 'Alerta', celula: (a) => <NomeComApoio nome={a.titulo} apoio={a.detalhe || undefined} /> },
                  { titulo: 'Tipo', celula: (a) => (a.tipo === 'agendado' ? 'Agendado' : 'Condicional') },
                  { titulo: 'Quando', celula: (a) => quando(a) },
                  { titulo: 'Prioridade', celula: (a) => <Selo tom={prioridadeDe(a).tom}>{prioridadeDe(a).curto}</Selo> },
                  { titulo: 'Duração', celula: (a) => <span className="whitespace-nowrap font-mono">{a.duracaoSeg} s</span> },
                  { titulo: 'Ativo', celula: (a) => <Chave ligada={!!a.ativo} rotulo={`Alerta ${a.titulo} ativo`} ocupada={gravando === a.id} aoMudar={(v) => void ligar(a, v)} /> },
                ]}
                acoes={() => [
                  { rotulo: 'Testar', icone: Play, aoClicar: setTestando },
                  { rotulo: 'Editar', icone: Pencil, aoClicar: setEditando },
                  { rotulo: 'Excluir', icone: Trash2, aoClicar: setExcluindo, tom: 'perigo' as const },
                ]}
              />
            )}
            {filtrando && linhas.length > 0 && (
              <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
            )}
          </>
        )}
      </section>

      {editando && <AlertaForm item={editando} aoFechar={() => setEditando(null)} aoSalvar={async () => { setEditando(null); await carregar(); }} />}
      {testando && <TestarAlerta alerta={testando} aoFechar={() => setTestando(null)} />}
      {excluindo && (
        <ExcluirAlerta
          alerta={excluindo}
          aoFechar={() => setExcluindo(null)}
          aoExcluir={async () => {
            setExcluindo(null);
            await carregar();
            document.getElementById(ID_TITULO)?.focus(); // a linha (e o botão que abriu) saiu da lista
          }}
        />
      )}
    </Shell>
  );
}

// ── criar / editar (gaveta) ─────────────────────────────────────────────────────────────────
function AlertaForm({ item, aoFechar, aoSalvar }: { item: any; aoFechar: () => void; aoSalvar: () => void }) {
  const formId = useId();
  const [form, setForm] = useState<any>(() => ({
    ...vazio(),
    ...item,
    detalhe: item.detalhe ?? '',
    horarios: Array.isArray(item.horarios) ? item.horarios : [],
    diasSemana: Array.isArray(item.diasSemana) ? item.diasSemana : [0, 1, 2, 3, 4, 5, 6],
    condicao: item.condicao ?? { fonte: 'pedidos_balcao', operador: '>=', limiar: 10 },
  }));
  const [novoHorario, setNovoHorario] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const muda = (campos: any) => setForm((f: any) => ({ ...f, ...campos }));

  function addHorario() {
    if (!/^\d{2}:\d{2}$/.test(novoHorario)) return;
    if (!form.horarios.includes(novoHorario)) muda({ horarios: [...form.horarios, novoHorario].sort() });
    setNovoHorario('');
  }
  const toggleDia = (n: number) =>
    muda({ diasSemana: form.diasSemana.includes(n) ? form.diasSemana.filter((d: number) => d !== n) : [...form.diasSemana, n].sort() });

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (salvando) return;
    if (!form.titulo.trim()) {
      setErro('Dê um título ao alerta.');
      document.getElementById('alerta-titulo')?.focus();
      return;
    }
    if (form.tipo === 'agendado' && form.horarios.length === 0) {
      setErro('Adicione ao menos um horário.');
      document.getElementById('alerta-horario')?.focus();
      return;
    }
    setErro('');
    setSalvando(true);
    const body = {
      titulo: form.titulo,
      detalhe: form.detalhe || null,
      prioridade: form.prioridade,
      tipo: form.tipo,
      horarios: form.horarios,
      diasSemana: form.diasSemana,
      condicao: form.tipo === 'condicional' ? form.condicao : null,
      duracaoSeg: Number(form.duracaoSeg) || 60,
      ativo: form.ativo,
    };
    try {
      if (form.id) await api.kdsAlertaAtualizar(form.id, body);
      else await api.kdsAlertaCriar(body);
      toast.success('Alerta salvo.');
      aoSalvar();
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar.');
      setSalvando(false);
    }
  }
  const opcao = (ligada: boolean) =>
    `min-h-11 border-r border-input px-2 text-sm font-semibold last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
      ligada ? 'bg-foreground text-background' : 'bg-card text-foreground hover:bg-secondary'
    }`;
  const ficha = (ligada: boolean) =>
    `min-h-10 rounded-full border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      ligada ? 'border-primary bg-primary/15 text-foreground' : `border-input bg-card ${texto2}`
    }`;

  return (
    <Gaveta
      titulo={form.id ? 'Editar alerta' : 'Novo alerta'}
      aoFechar={aoFechar}
      voltarPara={ID_TITULO}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" form={formId} disabled={salvando}>{salvando ? 'Salvando…' : form.id ? 'Salvar alterações' : 'Criar alerta'}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={salvar} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="alerta-titulo">Título</Label>
          <Input id="alerta-titulo" data-foco-inicial value={form.titulo} onChange={(e) => muda({ titulo: e.target.value })} placeholder="Ex.: Horário de lavar as mãos" autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="alerta-detalhe">Detalhe (opcional)</Label>
          <Input id="alerta-detalhe" value={form.detalhe} onChange={(e) => muda({ detalhe: e.target.value })} placeholder="Texto complementar" autoComplete="off" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="alerta-prioridade">Prioridade / cor</Label>
            <Select id="alerta-prioridade" value={form.prioridade} onChange={(e) => muda({ prioridade: e.target.value })}>
              {PRIORIDADES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alerta-duracao">Duração no rodapé (seg)</Label>
            <Input id="alerta-duracao" type="number" min={3} max={3600} inputMode="numeric" value={form.duracaoSeg} onChange={(e) => muda({ duracaoSeg: e.target.value })} />
          </div>
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium">Tipo</span>
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-input" role="group" aria-label="Tipo do alerta">
            <button type="button" aria-pressed={form.tipo === 'agendado'} className={opcao(form.tipo === 'agendado')} onClick={() => muda({ tipo: 'agendado' })}>Agendado (horário)</button>
            <button type="button" aria-pressed={form.tipo === 'condicional'} className={opcao(form.tipo === 'condicional')} onClick={() => muda({ tipo: 'condicional' })}>Condicional (limiar)</button>
          </div>
        </div>

        {form.tipo === 'agendado' ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="alerta-horario">Horários</Label>
              {form.horarios.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="Horários marcados">
                  {form.horarios.map((h: string) => (
                    <li key={h}>
                      <button type="button" className={`${ficha(true)} inline-flex items-center gap-1.5 font-mono`} aria-label={`Remover o horário ${h}`}
                        onClick={() => muda({ horarios: form.horarios.filter((x: string) => x !== h) })}>
                        {h} <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input id="alerta-horario" type="time" value={novoHorario} onChange={(e) => setNovoHorario(e.target.value)} className="w-36" />
                <Button type="button" variant="outline" onClick={addHorario}>Adicionar</Button>
              </div>
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium">Dias da semana</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias da semana">
                {DIAS.map((d) => (
                  <button key={d.n} type="button" onClick={() => toggleDia(d.n)} aria-pressed={form.diasSemana.includes(d.n)} className={ficha(form.diasSemana.includes(d.n))}>
                    {d.l}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="alerta-fonte">Quando</Label>
              <Select id="alerta-fonte" value={form.condicao.fonte} onChange={(e) => muda({ condicao: { ...form.condicao, fonte: e.target.value } })}>
                {FONTES.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="alerta-operador">Operador</Label>
                <Select id="alerta-operador" value={form.condicao.operador} onChange={(e) => muda({ condicao: { ...form.condicao, operador: e.target.value } })}>
                  {['>=', '>', '<=', '<', '=='].map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alerta-limiar">Limiar</Label>
                <Input id="alerta-limiar" type="number" min={0} inputMode="numeric" value={form.condicao.limiar} onChange={(e) => muda({ condicao: { ...form.condicao, limiar: Number(e.target.value) } })} />
              </div>
            </div>
            <p className={`text-xs ${texto2}`}>Avaliado a cada ~20s; não repete enquanto ainda está no ar.</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Ativo</span>
          <Chave ligada={!!form.ativo} rotulo="Alerta ativo" aoMudar={(v) => muda({ ativo: v })} />
        </div>
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      </form>
    </Gaveta>
  );
}

// ── testar (dispara de verdade) ─────────────────────────────────────────────────────────────
function TestarAlerta({ alerta: a, aoFechar }: { alerta: any; aoFechar: () => void }) {
  const [enviando, setEnviando] = useState(false);
  async function disparar() {
    if (enviando) return;
    setEnviando(true);
    try {
      await api.kdsAlertaDisparar({ titulo: a.titulo, detalhe: a.detalhe, prioridade: a.prioridade, duracaoSeg: a.duracaoSeg });
      toast.success('Alerta disparado no KDS.');
      aoFechar();
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao disparar.');
      setEnviando(false);
    }
  }
  return (
    <Dialogo alerta titulo="Testar o alerta agora?" aoFechar={aoFechar} voltarPara={ID_TITULO}
      rodape={
        <>
          <Button type="button" variant="outline" data-foco-inicial onClick={aoFechar} disabled={enviando}>Cancelar</Button>
          <Button type="button" onClick={disparar} disabled={enviando}>{enviando ? 'Disparando…' : 'Disparar no KDS'}</Button>
        </>
      }>
      <p className="text-sm">
        <b>{a.titulo}</b> aparece agora, de verdade, na tela de todos os KDS da empresa, por {a.duracaoSeg} segundos.
      </p>
    </Dialogo>
  );
}

// ── excluir ─────────────────────────────────────────────────────────────────────────────────
function ExcluirAlerta({ alerta: a, aoFechar, aoExcluir }: { alerta: any; aoFechar: () => void; aoExcluir: () => void }) {
  const [apagando, setApagando] = useState(false);
  const [erro, setErro] = useState('');
  async function confirmar() {
    if (apagando) return;
    setErro('');
    setApagando(true);
    try {
      await api.kdsAlertaRemover(a.id);
      toast.success('Alerta removido.');
      aoExcluir();
    } catch (e: any) {
      setErro(e?.message || 'Falha ao remover.');
      setApagando(false);
    }
  }
  return (
    <Dialogo alerta titulo="Excluir alerta" aoFechar={aoFechar} voltarPara={ID_TITULO}
      rodape={
        <>
          <Button type="button" variant="outline" data-foco-inicial onClick={aoFechar} disabled={apagando}>Cancelar</Button>
          <Button type="button" variant="destructive" onClick={confirmar} disabled={apagando}>{apagando ? 'Excluindo…' : 'Excluir alerta'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <p>Excluir <b>{a.titulo}</b>?</p>
        <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">
          O alerta é apagado e deixa de aparecer no KDS. Para só parar de exibir, desligue a chave “Ativo”. Não dá para desfazer por aqui.
        </p>
        {erro && <p role="alert" className="font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}
