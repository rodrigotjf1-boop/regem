'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DIAS = [
  { n: 0, l: 'Dom' }, { n: 1, l: 'Seg' }, { n: 2, l: 'Ter' }, { n: 3, l: 'Qua' },
  { n: 4, l: 'Qui' }, { n: 5, l: 'Sex' }, { n: 6, l: 'Sáb' },
];
const PRIORIDADES = [
  { v: 'danger', l: 'Emergência (vermelho)' },
  { v: 'alta', l: 'Alta (âmbar)' },
  { v: 'info', l: 'Informativo (azul)' },
  { v: 'ok', l: 'Positivo (verde)' },
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

export default function KdsAlertasPage() {
  const router = useRouter();
  const [lista, setLista] = useState<any[] | null>(null);
  const [form, setForm] = useState<any>(vazio());
  const [novoHorario, setNovoHorario] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setLista((await api.kdsAlertas()) as any[]);
    } catch {
      setLista([]);
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
    carregar();
  }, [router, carregar]);

  function editar(a: any) {
    setForm({
      id: a.id,
      titulo: a.titulo ?? '',
      detalhe: a.detalhe ?? '',
      prioridade: a.prioridade ?? 'alta',
      tipo: a.tipo ?? 'agendado',
      horarios: Array.isArray(a.horarios) ? a.horarios : [],
      diasSemana: Array.isArray(a.diasSemana) ? a.diasSemana : [0, 1, 2, 3, 4, 5, 6],
      condicao: a.condicao ?? { fonte: 'pedidos_balcao', operador: '>=', limiar: 10 },
      duracaoSeg: a.duracaoSeg ?? 60,
      ativo: a.ativo ?? true,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function addHorario() {
    if (!/^\d{2}:\d{2}$/.test(novoHorario)) return;
    if (!form.horarios.includes(novoHorario))
      setForm((f: any) => ({ ...f, horarios: [...f.horarios, novoHorario].sort() }));
    setNovoHorario('');
  }
  const toggleDia = (n: number) =>
    setForm((f: any) => ({
      ...f,
      diasSemana: f.diasSemana.includes(n)
        ? f.diasSemana.filter((d: number) => d !== n)
        : [...f.diasSemana, n].sort(),
    }));

  async function salvar() {
    if (!form.titulo.trim()) return toast.error('Dê um título ao alerta.');
    if (form.tipo === 'agendado' && form.horarios.length === 0)
      return toast.error('Adicione ao menos um horário.');
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
      setForm(vazio());
      await carregar();
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  }

  async function remover(a: any) {
    if (!confirm(`Remover o alerta "${a.titulo}"?`)) return;
    try {
      await api.kdsAlertaRemover(a.id);
      await carregar();
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao remover.');
    }
  }

  async function dispararAgora(a: any) {
    try {
      await api.kdsAlertaDisparar({
        titulo: a.titulo,
        detalhe: a.detalhe,
        prioridade: a.prioridade,
        duracaoSeg: a.duracaoSeg,
      });
      toast.success('Alerta disparado no KDS.');
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao disparar.');
    }
  }

  return (
    <Shell eyebrow="KDS" title="Alertas do rodapé">
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        Mensagens que aparecem no rodapé do KDS. <strong>Agendados</strong> disparam em horários e dias
        marcados (ex.: &quot;Horário de lavar as mãos&quot;); <strong>condicionais</strong> disparam quando um
        limiar é atingido (ex.: muitos pedidos acumulados). A duração controla quanto tempo cada um fica
        no ar — um alerta urgente curto sobrepõe um longo e depois o ciclo do longo volta.
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* Formulário */}
        <Card className="space-y-4 p-4">
          <h2 className="font-display text-sm font-bold">{form.id ? 'Editar alerta' : 'Novo alerta'}</h2>

          <div className="space-y-1">
            <Label className="text-xs">Título</Label>
            <Input value={form.titulo} onChange={(e) => setForm((f: any) => ({ ...f, titulo: e.target.value }))} placeholder="Ex.: Horário de lavar as mãos" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Detalhe (opcional)</Label>
            <Input value={form.detalhe} onChange={(e) => setForm((f: any) => ({ ...f, detalhe: e.target.value }))} placeholder="Texto complementar" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Prioridade / cor</Label>
              <select value={form.prioridade} onChange={(e) => setForm((f: any) => ({ ...f, prioridade: e.target.value }))} className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm">
                {PRIORIDADES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Duração no rodapé (seg)</Label>
              <Input type="number" min={3} max={3600} value={form.duracaoSeg} onChange={(e) => setForm((f: any) => ({ ...f, duracaoSeg: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <div className="flex gap-2">
              {(['agendado', 'condicional'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setForm((f: any) => ({ ...f, tipo: t }))}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${form.tipo === t ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}>
                  {t === 'agendado' ? 'Agendado (horário)' : 'Condicional (limiar)'}
                </button>
              ))}
            </div>
          </div>

          {form.tipo === 'agendado' ? (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Horários</Label>
                <div className="flex flex-wrap gap-1.5">
                  {form.horarios.map((h: string) => (
                    <span key={h} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-mono">
                      {h}
                      <button type="button" onClick={() => setForm((f: any) => ({ ...f, horarios: f.horarios.filter((x: string) => x !== h) }))} className="text-muted-foreground hover:text-destructive">×</button>
                    </span>
                  ))}
                </div>
                <div className="mt-1 flex gap-2">
                  <Input type="time" value={novoHorario} onChange={(e) => setNovoHorario(e.target.value)} className="w-36" />
                  <Button type="button" variant="outline" size="sm" onClick={addHorario}>Adicionar</Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Dias da semana</Label>
                <div className="flex flex-wrap gap-1.5">
                  {DIAS.map((d) => (
                    <button key={d.n} type="button" onClick={() => toggleDia(d.n)} aria-pressed={form.diasSemana.includes(d.n)}
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium ${form.diasSemana.includes(d.n) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
                      {d.l}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3">
              <div className="space-y-1">
                <Label className="text-xs">Quando</Label>
                <select value={form.condicao.fonte} onChange={(e) => setForm((f: any) => ({ ...f, condicao: { ...f.condicao, fonte: e.target.value } }))} className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm">
                  {FONTES.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Operador</Label>
                  <select value={form.condicao.operador} onChange={(e) => setForm((f: any) => ({ ...f, condicao: { ...f.condicao, operador: e.target.value } }))} className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm">
                    {['>=', '>', '<=', '<', '=='].map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Limiar</Label>
                  <Input type="number" min={0} value={form.condicao.limiar} onChange={(e) => setForm((f: any) => ({ ...f, condicao: { ...f.condicao, limiar: Number(e.target.value) } }))} />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">Avaliado a cada ~20s; não repete enquanto ainda está no ar.</p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.ativo} onChange={(e) => setForm((f: any) => ({ ...f, ativo: e.target.checked }))} />
            Ativo
          </label>

          <div className="flex gap-2">
            <Button type="button" onClick={salvar} disabled={salvando} className="flex-1">
              {salvando ? '…' : form.id ? 'Salvar alterações' : 'Criar alerta'}
            </Button>
            {form.id && <Button type="button" variant="outline" onClick={() => setForm(vazio())}>Cancelar</Button>}
          </div>
        </Card>

        {/* Lista */}
        <div className="space-y-2">
          {lista === null && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {lista?.length === 0 && (
            <Card className="p-8 text-center text-muted-foreground">
              <p>Nenhum alerta cadastrado. Crie o primeiro ao lado.</p>
            </Card>
          )}
          {lista?.map((a) => (
            <Card key={a.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="h-8 w-1.5 rounded-full" style={{ background: a.prioridade === 'danger' ? '#FF5A4E' : a.prioridade === 'info' ? '#3BA7E8' : a.prioridade === 'ok' ? '#19C08F' : '#FFB13D' }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{a.titulo} {!a.ativo && <span className="text-xs font-normal text-muted-foreground">(inativo)</span>}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {a.tipo === 'agendado'
                    ? `⏰ ${(a.horarios ?? []).join(', ') || 'sem horário'} · ${(a.diasSemana ?? []).map((d: number) => DIAS[d]?.l).join(' ')}`
                    : `⚙ ${FONTES.find((f) => f.v === a.condicao?.fonte)?.l ?? a.condicao?.fonte} ${a.condicao?.operador} ${a.condicao?.limiar}`}
                  {' · '}{a.duracaoSeg}s
                </p>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => dispararAgora(a)} title="Disparar agora no KDS">Testar</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => editar(a)}>Editar</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => remover(a)} className="text-destructive">Excluir</Button>
            </Card>
          ))}
        </div>
      </div>
    </Shell>
  );
}
