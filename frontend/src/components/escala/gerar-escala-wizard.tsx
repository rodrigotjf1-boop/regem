'use client';

import { useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { JORNADAS } from '@/components/cadastros/constants';

/* eslint-disable @typescript-eslint/no-explicit-any */

const selectCls = 'flex h-10 w-full rounded-md border border-input bg-card px-2 text-sm';
const DIAS = [
  { v: 1, l: 'Seg' }, { v: 2, l: 'Ter' }, { v: 3, l: 'Qua' }, { v: 4, l: 'Qui' },
  { v: 5, l: 'Sex' }, { v: 6, l: 'Sáb' }, { v: 0, l: 'Dom' },
];
const PERIODOS = [
  { v: 'dia', l: '1 dia' },
  { v: '1', l: '1 mês' }, { v: '3', l: '3 meses' }, { v: '6', l: '6 meses' }, { v: '12', l: '1 ano' },
];

// Espelha regras-escala.ts (só para PRÉ-VISUALIZAR; o servidor é a fonte da verdade).
const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
const fromMin = (x: number) => { const t = ((Math.round(x) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
function horasEntre(ini: string, fim: string) { let d = toMin(fim) - toMin(ini); if (d <= 0) d += 1440; return d / 60; }
function pausaSugerida(entrada: string, saida: string) {
  const jm = Math.round(horasEntre(entrada, saida) * 60);
  const dur = jm / 60 > 6 ? 60 : jm / 60 > 4 ? 15 : 0;
  if (!dur) return { pausaInicio: '', pausaFim: '' };
  const ini = toMin(entrada) + Math.round(jm / 2 - dur / 2);
  return { pausaInicio: fromMin(ini), pausaFim: fromMin(ini + dur) };
}
// Ciclo automático (folga anda sozinha): 12x36 e 5x1. Os que somam 7 (5x2/6x1/4x3)
// são por dia da semana — o usuário escolhe os dias de folga.
const ehCiclo = (t: string) => t === '12x36' || t === '5x1';
// Nº EXATO de folgas que o tipo exige (soma 7). null = ciclo/livre.
const folgasExigidas = (t: string): number | null =>
  t === '5x2' ? 2 : t === '6x1' ? 1 : t === '4x3' ? 3 : null;
// Jornada máxima/dia por tipo (espelha o backend) — base do alerta CLT. null = sem teto.
const jornadaMaxima = (t: string): number | null =>
  t === '12x36' ? 12 : t === '4x3' ? 11 : t === '5x2' || t === '5x1' ? 8.8 : t === '6x1' ? 7.34 : null;
function addMeses(iso: string, m: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + m);
  d.setUTCDate(d.getUTCDate() - 1); // fim inclusivo
  return d.toISOString().slice(0, 10);
}

export function GerarEscalaWizard({
  dataInicial,
  colabs,
  etiquetas,
  colaboradorInicial,
  etiquetaInicial,
  colaboradoresDoDia,
  onClose,
  onGenerated,
}: {
  dataInicial: string;
  colabs: any[];
  etiquetas: any[];
  colaboradorInicial?: string;
  etiquetaInicial?: string;
  colaboradoresDoDia?: string[]; // edição: lista os escalados do dia (sem filtro por função)
  onClose: () => void;
  onGenerated: () => void;
}) {
  const colabIni = colabs.find((c) => c.id === colaboradorInicial);
  const [colaboradorId, setColaboradorId] = useState(colaboradorInicial ?? '');
  const [etiquetaId, setEtiquetaId] = useState(etiquetaInicial ?? '');
  const [jornadaTipo, setJornadaTipo] = useState(
    colabIni?.jornadaTipo && colabIni.jornadaTipo !== 'outro' ? colabIni.jornadaTipo : '5x2',
  );
  const [horaInicio, setHoraInicio] = useState('08:00');
  const [horaFim, setHoraFim] = useState('16:00');
  const pausa = useMemo(() => pausaSugerida(horaInicio, horaFim), [horaInicio, horaFim]);
  const [pausaInicio, setPausaInicio] = useState('');
  const [pausaFim, setPausaFim] = useState('');
  const [folgas, setFolgas] = useState<number[]>([0, 6]); // sáb/dom
  const [dataInicio, setDataInicio] = useState(dataInicial);
  const [periodo, setPeriodo] = useState('dia'); // 'dia' | '1' | '3' | '6' | '12'
  const [feriadosFechar, setFeriadosFechar] = useState(true);
  const [respeitarClt, setRespeitarClt] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const recorrente = periodo !== 'dia';

  // Alerta CLT ao vivo: jornada (fim − início) acima do máximo do tipo de escala.
  const jornadaHoras = horasEntre(horaInicio, horaFim);
  const maxJornada = jornadaMaxima(jornadaTipo);
  const cltForaDaLei = respeitarClt && maxJornada != null && jornadaHoras > maxJornada + 0.02;

  // Pausa efetiva = editada pelo usuário, ou a sugerida pela CLT.
  const pausaIni = pausaInicio || pausa.pausaInicio;
  const pausaF = pausaFim || pausa.pausaFim;
  const dataFim = useMemo(
    () => (recorrente ? addMeses(dataInicio, Number(periodo)) : dataInicio),
    [dataInicio, periodo, recorrente],
  );
  // Folga editável em todo tipo por dia da semana (5x2/6x1/4x3); só 5x1 e 12x36
  // (ciclos) não escolhem os dias. No modo "1 dia" a folga é ignorada na geração.
  const perguntaFolga = !ehCiclo(jornadaTipo);

  const need = folgasExigidas(jornadaTipo);

  // Filtra colaboradores pela função da vaga (etiqueta) → não mostra gente de
  // outro setor. Vaga sem função selecionada = mostra todos.
  const funcaoDaVaga = useMemo(
    () => etiquetas.find((e) => e.id === etiquetaId)?.funcaoId ?? null,
    [etiquetas, etiquetaId],
  );
  // Edição a partir do card do dia: lista TODOS os escalados daquele dia (sem filtro
  // por função). Caso contrário (nova alocação), filtra pela função da vaga.
  const colabsElegiveis = useMemo(() => {
    if (colaboradoresDoDia && colaboradoresDoDia.length)
      return colabs.filter((c) => colaboradoresDoDia.includes(c.id));
    return funcaoDaVaga ? colabs.filter((c) => (c.funcaoIds ?? []).includes(funcaoDaVaga)) : colabs;
  }, [colabs, funcaoDaVaga, colaboradoresDoDia]);
  function escolherEtiqueta(id: string) {
    setEtiquetaId(id);
    // No modo "dia" não reseta o colaborador (os do dia não são presos à função).
    if (colaboradoresDoDia?.length) return;
    const fn = etiquetas.find((e) => e.id === id)?.funcaoId ?? null;
    if (fn && colaboradorId) {
      const c = colabs.find((x) => x.id === colaboradorId);
      if (!(c?.funcaoIds ?? []).includes(fn)) setColaboradorId('');
    }
  }

  // Troca de tipo respeita a regra: apara folgas a mais (ex.: 5x2→6x1 mantém 1).
  function trocarTipo(t: string) {
    setJornadaTipo(t);
    const n = folgasExigidas(t);
    if (n !== null) setFolgas((f) => f.slice(0, n));
  }
  function escolherColab(id: string) {
    setColaboradorId(id);
    const c = colabs.find((x) => x.id === id);
    if (c?.jornadaTipo && c.jornadaTipo !== 'outro') trocarTipo(c.jornadaTipo);
  }
  const toggleFolga = (d: number) =>
    setFolgas((f) => {
      if (f.includes(d)) return f.filter((x) => x !== d);
      // Regra inquebrável: não deixa passar do nº de folgas do tipo.
      if (need !== null && f.length >= need) {
        toast.error(`A escala ${jornadaTipo} permite só ${need} dia(s) de folga por semana.`);
        return f;
      }
      return [...f, d];
    });

  async function gerar() {
    if (!colaboradorId) return toast.error('Escolha o colaborador.');
    if (!etiquetaId) return toast.error('Escolha a vaga (etiqueta).');
    // Folga só é obrigatória na escala recorrente (semana), não no dia avulso.
    if (recorrente && need !== null && folgas.length !== need) {
      return toast.error(
        folgas.length < need
          ? `Faltam ${need - folgas.length} dia(s) de folga: a escala ${jornadaTipo} exige exatamente ${need}.`
          : `A escala ${jornadaTipo} permite só ${need} folga(s) — remova ${folgas.length - need}.`,
      );
    }
    if (perguntaFolga && need === null && folgas.length === 0)
      return toast.error('Marque ao menos 1 dia de folga.');
    setSalvando(true);
    try {
      const r: any = await api.gerarEscala({
        colaboradorId,
        etiquetaId,
        jornadaTipo,
        horaInicio,
        horaFim,
        pausaInicio: pausaIni || undefined,
        pausaFim: pausaF || undefined,
        folgasSemana: perguntaFolga ? folgas : undefined,
        dataInicio,
        dataFim,
        feriadosFechar,
        respeitarClt,
      });
      const av = (r?.avisos ?? []).length ? ` (${r.avisos.length} aviso(s) CLT)` : '';
      toast.success(`Escala gerada: ${r.criadas} dia(s) preenchido(s)${av}.`);
      onGenerated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao gerar escala');
    } finally {
      setSalvando(false);
    }
  }

  const nomeColab = colabs.find((c) => c.id === colaboradorId)?.nome ?? '';
  const fmt = (iso: string) => iso.split('-').reverse().join('/');

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <Card className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <CalendarRange className="h-5 w-5 text-primary" />
          <h2 className="font-display text-base font-bold">Gerar escala</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Colaborador</Label>
            <select aria-label="Colaborador" className={selectCls} value={colaboradorId} onChange={(e) => escolherColab(e.target.value)}>
              <option value="">— escolher —</option>
              {colabsElegiveis.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            {funcaoDaVaga && colabsElegiveis.length === 0 && (
              <p className="text-xs text-warn">Nenhum colaborador nesta função/setor.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Vaga (etiqueta)</Label>
            <select aria-label="Vaga (etiqueta)" className={selectCls} value={etiquetaId} onChange={(e) => escolherEtiqueta(e.target.value)}>
              <option value="">— escolher —</option>
              {etiquetas.map((et) => <option key={et.id} value={et.id}>{et.sigla}{et.setorNome ? ` · ${et.setorNome}` : ''}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Tipo de escala</Label>
          <select aria-label="Tipo de escala" className={selectCls} value={jornadaTipo} onChange={(e) => trocarTipo(e.target.value)}>
            {JORNADAS.filter((j) => j.value !== 'outro').map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Entrada</Label>
            <Input type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Saída</Label>
            <Input type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} />
          </div>
        </div>

        <div className="rounded-md border border-border bg-secondary/40 p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Pausa (intervalo) sugerida pela CLT — editável:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input type="time" value={pausaIni} onChange={(e) => setPausaInicio(e.target.value)} aria-label="Início da pausa" />
            <Input type="time" value={pausaF} onChange={(e) => setPausaFim(e.target.value)} aria-label="Fim da pausa" />
          </div>
          {!pausaIni && <p className="mt-1 text-xs text-muted-foreground">Jornada ≤ 4h: sem intervalo obrigatório.</p>}
        </div>

        {perguntaFolga ? (
          <div className="space-y-1.5">
            <Label className="text-xs">
              Dias de folga na semana{need !== null ? ` (${need})` : ''}
              {!recorrente && <span className="ml-1 text-muted-foreground">· usados na recorrência</span>}
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {DIAS.map((d) => (
                <button key={d.v} type="button" onClick={() => toggleFolga(d.v)} aria-pressed={folgas.includes(d.v)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${folgas.includes(d.v) ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}>
                  {d.l}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded-md bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            {jornadaTipo === '12x36'
              ? '12x36: folga automática (trabalha um dia, folga o próximo).'
              : '5x1: folga automática (revezamento de 6 dias).'}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">{recorrente ? 'Início' : 'Dia'}</Label>
            <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Recorrência</Label>
            <select aria-label="Recorrência" className={selectCls} value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
              {PERIODOS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
            </select>
          </div>
        </div>

        {recorrente && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={feriadosFechar} onChange={(e) => setFeriadosFechar(e.target.checked)} />
            Fechar nos feriados (não escalar nos feriados cadastrados)
          </label>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={respeitarClt} onChange={(e) => setRespeitarClt(e.target.checked)} />
          Levar em conta regras da CLT vigente
        </label>
        {cltForaDaLei && (
          <p className="rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">
            ⚠️ Jornada de {jornadaHoras.toFixed(1)}h/dia acima do máximo da escala {jornadaTipo}
            {' '}(~{maxJornada}h) — fora do praticado nas leis trabalhistas.
          </p>
        )}

        <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 text-xs">
          {nomeColab ? <><strong>{nomeColab}</strong> · {jornadaTipo} · {horaInicio}–{horaFim}<br /></> : null}
          {recorrente
            ? <>Preenche de <strong>{fmt(dataInicio)}</strong> a <strong>{fmt(dataFim)}</strong>{feriadosFechar ? ', pulando feriados' : ''}.</>
            : <>Aloca no dia <strong>{fmt(dataInicio)}</strong>.</>}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="button" onClick={gerar} disabled={salvando}>{salvando ? 'Gerando…' : 'Gerar escala'}</Button>
        </div>
      </Card>
    </div>
  );
}
