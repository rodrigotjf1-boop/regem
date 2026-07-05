'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { api, getToken } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { EntityForm, type FieldDef } from '@/components/cadastros/entity-form';
import { Shell } from '@/components/app-shell/shell';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Lists = {
  unidades: any[];
  setores: any[];
  funcoes: any[];
  colaboradores: any[];
  turnos: any[];
  etiquetas: any[];
  janelasPico: any[];
  fornecedores: any[];
};

const CATEGORIAS = [
  { value: 'execucao', label: 'Execução' },
  { value: 'supervisao', label: 'Supervisão' },
  { value: 'gerente', label: 'Gerente' },
  { value: 'presidente', label: 'Presidente' },
];
const VINCULOS = ['clt', 'horista', 'diarista', 'pj', 'autonomo'].map((v) => ({
  value: v,
  label: v.toUpperCase(),
}));
const DIAS_SEMANA = [
  { value: '', label: 'Todos os dias' },
  { value: '0', label: 'Domingo' },
  { value: '1', label: 'Segunda' },
  { value: '2', label: 'Terça' },
  { value: '3', label: 'Quarta' },
  { value: '4', label: 'Quinta' },
  { value: '5', label: 'Sexta' },
  { value: '6', label: 'Sábado' },
];
const DIA_ABREV: Record<string, string> = {
  '0': 'dom',
  '1': 'seg',
  '2': 'ter',
  '3': 'qua',
  '4': 'qui',
  '5': 'sex',
  '6': 'sáb',
};

// Metadados visuais por seção (passo na ordem de dependência + ícone + dica de vazio).
const META: Record<
  string,
  { step: number; icon: string; nudge?: string }
> = {
  unidade: { step: 1, icon: '🏪' },
  setor: { step: 2, icon: '🧩' },
  funcao: { step: 3, icon: '🎯' },
  colaborador: { step: 4, icon: '👥' },
  turno: { step: 5, icon: '🕐' },
  pico: {
    step: 6,
    icon: '🔥',
    nudge:
      'Cadastre os horários de pico (ex.: almoço 11:30–14:30) para o KDS disparar alertas e a escala de limpeza sugerir as janelas certas.',
  },
  fornecedor: {
    step: 7,
    icon: '📦',
    nudge:
      'Com fornecedores cadastrados, cada recebimento alimenta o histórico de preços e o índice de faltas automaticamente.',
  },
  etiqueta: { step: 8, icon: '🏷️' },
};

export default function CadastrosPage() {
  const router = useRouter();
  const [L, setL] = useState<Lists | null>(null);
  const [erro, setErro] = useState('');
  const [ver, setVer] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  const reload = useCallback(async () => {
    try {
      const [
        unidades,
        setores,
        funcoes,
        colaboradores,
        turnos,
        etiquetas,
        janelasPico,
        fornecedores,
      ] = await Promise.all([
        api.get('/unidades'),
        api.get('/setores'),
        api.get('/funcoes'),
        api.get('/colaboradores'),
        api.get('/turnos'),
        api.get('/etiquetas'),
        api.janelasPico(),
        api.fornecedores(),
      ]);
      setL({
        unidades,
        setores,
        funcoes,
        colaboradores,
        turnos,
        etiquetas,
        janelasPico,
        fornecedores,
      });
      setVer((v) => v + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
  }, [reload, router]);

  if (!L) {
    return (
      <Shell eyebrow="Gestão" title="Cadastros">
        {erro ? (
          <EmptyState
            icon="⚠️"
            title="Não foi possível carregar"
            description={erro}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="flex items-center gap-3 p-4">
                <Skeleton className="h-10 w-10 flex-none rounded-xl" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="mt-2 h-3 w-1/2" />
                </div>
                <Skeleton className="h-8 w-8 flex-none rounded-lg" />
              </Card>
            ))}
          </div>
        )}
      </Shell>
    );
  }

  const optU = L.unidades.map((u: any) => ({ value: u.id, label: u.nome }));
  const optS = L.setores.map((s: any) => ({ value: s.id, label: s.nome }));
  const optF = L.funcoes.map((f: any) => ({ value: f.id, label: f.nome }));
  const withNone = (arr: any[]) => [{ value: '', label: '— nenhum —' }, ...arr];
  const criarFuncao = async (nome: string) => {
    const f: any = await api.post('/funcoes', { nome, categoria: 'execucao' });
    return { value: f.id, label: f.nome };
  };

  const secoes = [
    {
      key: 'unidade',
      titulo: 'Unidades',
      itens: L.unidades.map((u: any) => u.nome),
      fields: [
        {
          name: 'nome',
          label: 'Nome',
          type: 'text',
          required: true,
          placeholder: 'Ex.: Matriz',
        },
      ] as FieldDef[],
      submit: (v: any) => api.post('/unidades', { nome: v.nome }),
    },
    {
      key: 'setor',
      titulo: 'Setores',
      itens: L.setores.map((s: any) => s.nome),
      fields: [
        {
          name: 'unidadeId',
          label: 'Unidade',
          type: 'select',
          required: true,
          options: optU,
          defaultValue: optU[0]?.value,
        },
        {
          name: 'nome',
          label: 'Nome',
          type: 'text',
          required: true,
          placeholder: 'Ex.: Cozinha',
        },
        { name: 'icone', label: 'Ícone (opcional)', type: 'text', placeholder: 'cozinha' },
      ] as FieldDef[],
      submit: (v: any) =>
        api.post('/setores', {
          unidadeId: v.unidadeId,
          nome: v.nome,
          icone: v.icone || undefined,
        }),
    },
    {
      key: 'funcao',
      titulo: 'Funções',
      itens: L.funcoes.map((f: any) => `${f.nome} (${f.categoria})`),
      fields: [
        {
          name: 'nome',
          label: 'Nome',
          type: 'text',
          required: true,
          placeholder: 'Ex.: Aux. Cozinha',
        },
        {
          name: 'categoria',
          label: 'Categoria',
          type: 'select',
          options: CATEGORIAS,
          defaultValue: 'execucao',
        },
        { name: 'setorId', label: 'Setor', type: 'select', options: withNone(optS) },
      ] as FieldDef[],
      submit: (v: any) =>
        api.post('/funcoes', {
          nome: v.nome,
          categoria: v.categoria,
          setorId: v.setorId || undefined,
        }),
    },
    {
      key: 'colaborador',
      titulo: 'Colaboradores',
      itens: L.colaboradores.map((c: any) => c.nome),
      fields: [
        {
          name: 'nome',
          label: 'Nome',
          type: 'text',
          required: true,
          placeholder: 'Ex.: Maria',
        },
        { name: 'fotoRef', label: 'Foto (opcional)', type: 'image' },
        {
          name: 'funcaoId',
          label: 'Função',
          type: 'select',
          options: withNone(optF),
          onCreate: criarFuncao,
        },
        {
          name: 'vinculo',
          label: 'Vínculo',
          type: 'select',
          options: VINCULOS,
          defaultValue: 'clt',
        },
        {
          name: 'pin',
          label: 'PIN (opcional, 4-6 díg.)',
          type: 'text',
          placeholder: 'ex.: 1234',
        },
      ] as FieldDef[],
      submit: (v: any) =>
        api.post('/colaboradores', {
          nome: v.nome,
          fotoRef: v.fotoRef || undefined,
          funcaoId: v.funcaoId || undefined,
          vinculo: v.vinculo,
          pin: v.pin || undefined,
        }),
    },
    {
      key: 'turno',
      titulo: 'Turnos',
      itens: L.turnos.map((t: any) => t.nome),
      fields: [
        {
          name: 'unidadeId',
          label: 'Unidade',
          type: 'select',
          required: true,
          options: optU,
          defaultValue: optU[0]?.value,
        },
        {
          name: 'nome',
          label: 'Nome',
          type: 'text',
          required: true,
          placeholder: 'Ex.: Almoço',
        },
        { name: 'horaInicio', label: 'Início', type: 'time', required: true },
        { name: 'horaFim', label: 'Fim', type: 'time', required: true },
      ] as FieldDef[],
      submit: (v: any) =>
        api.post('/turnos', {
          unidadeId: v.unidadeId,
          nome: v.nome,
          horaInicio: v.horaInicio,
          horaFim: v.horaFim,
        }),
    },
    {
      key: 'pico',
      titulo: 'Janelas de pico',
      itens: L.janelasPico.map(
        (p: any) =>
          `${p.nome} · ${
            p.diaSemana == null ? 'todos' : DIA_ABREV[String(p.diaSemana)]
          } ${String(p.horaInicio).slice(0, 5)}–${String(p.horaFim).slice(0, 5)}`,
      ),
      fields: [
        {
          name: 'unidadeId',
          label: 'Unidade',
          type: 'select',
          required: true,
          options: optU,
          defaultValue: optU[0]?.value,
        },
        {
          name: 'nome',
          label: 'Nome',
          type: 'text',
          required: true,
          placeholder: 'Ex.: Almoço',
        },
        {
          name: 'diaSemana',
          label: 'Dia da semana',
          type: 'select',
          options: DIAS_SEMANA,
          defaultValue: '',
        },
        { name: 'horaInicio', label: 'Início', type: 'time', required: true },
        { name: 'horaFim', label: 'Fim', type: 'time', required: true },
      ] as FieldDef[],
      submit: (v: any) =>
        api.post('/janelas-pico', {
          unidadeId: v.unidadeId,
          nome: v.nome,
          diaSemana: v.diaSemana === '' ? undefined : Number(v.diaSemana),
          horaInicio: v.horaInicio,
          horaFim: v.horaFim,
        }),
    },
    {
      key: 'fornecedor',
      titulo: 'Fornecedores',
      itens: L.fornecedores.map((f: any) => f.nome),
      fields: [
        {
          name: 'nome',
          label: 'Nome',
          type: 'text',
          required: true,
          placeholder: 'Ex.: Distribuidora X',
        },
        { name: 'cnpj', label: 'CNPJ', type: 'text', placeholder: '00.000.000/0000-00' },
        {
          name: 'contato',
          label: 'Contato',
          type: 'text',
          placeholder: 'Nome do responsável',
        },
        {
          name: 'telefone',
          label: 'Telefone',
          type: 'text',
          placeholder: '(00) 00000-0000',
        },
        {
          name: 'email',
          label: 'E-mail',
          type: 'text',
          placeholder: 'contato@fornecedor.com',
        },
        { name: 'obs', label: 'Observações', type: 'text' },
      ] as FieldDef[],
      submit: (v: any) =>
        api.post('/fornecedores', {
          nome: v.nome,
          cnpj: v.cnpj || undefined,
          contato: v.contato || undefined,
          telefone: v.telefone || undefined,
          email: v.email || undefined,
          obs: v.obs || undefined,
        }),
    },
    {
      key: 'etiqueta',
      titulo: 'Etiquetas (vagas)',
      itens: L.etiquetas.map((e: any) => `${e.sigla}${e.contador}`),
      fields: [
        {
          name: 'setorId',
          label: 'Setor',
          type: 'select',
          required: true,
          options: optS,
          defaultValue: optS[0]?.value,
        },
        {
          name: 'funcaoId',
          label: 'Função',
          type: 'select',
          required: true,
          options: optF,
          defaultValue: optF[0]?.value,
          onCreate: criarFuncao,
        },
        {
          name: 'sigla',
          label: 'Sigla',
          type: 'text',
          required: true,
          placeholder: 'AUXC',
        },
        { name: 'contador', label: 'Número', type: 'text', placeholder: '1' },
      ] as FieldDef[],
      submit: (v: any) =>
        api.post('/etiquetas', {
          setorId: v.setorId,
          funcaoId: v.funcaoId,
          sigla: v.sigla,
          contador: v.contador ? Number(v.contador) : undefined,
        }),
    },
  ];

  return (
    <Shell eyebrow="Gestão" title="Cadastros">
      <div className="max-w-5xl space-y-5">
        {sel === null ? (
          (() => {
            const feitas = secoes.filter((s) => s.itens.length > 0).length;
            const pct = Math.round((feitas / secoes.length) * 100);
            const q = busca.trim().toLowerCase();
            const visiveis = secoes.filter(
              (s) => !q || s.titulo.toLowerCase().includes(q) || s.key.includes(q),
            );
            const tint = (key: string) =>
              key === 'pico' || key === 'fornecedor'
                ? 'bg-warn/10'
                : key === 'colaborador' || key === 'turno'
                  ? 'bg-ok/10'
                  : 'bg-info/10';
            return (
              <>
                {/* Busca */}
                <div className="relative max-w-sm">
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    type="search"
                    placeholder="Buscar cadastro… (ex.: funções)"
                    aria-label="Buscar cadastro"
                    className="h-11 w-full rounded-lg border border-input bg-card pl-3 pr-3 text-sm"
                  />
                </div>

                {/* Barra de completude */}
                <Card className="p-5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <b className="font-display text-sm font-bold">
                      Configuração da unidade
                    </b>
                    <span className="font-mono text-sm font-bold text-primary">
                      {pct}%
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {feitas} de {secoes.length} cadastros com dados
                    </span>
                  </div>
                  <div className="my-3 h-2 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-700"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </Card>

                {/* Template por ramo */}
                <Card className="border-primary/40 bg-primary/5 p-5">
                  <h2 className="font-display text-sm font-bold">Template por ramo</h2>
                  <p className="mb-3 mt-1 max-w-xl text-sm text-muted-foreground">
                    Cria setores, funções, etiquetas, tipos de ocorrência e itens de
                    estoque de uma vez — sem cadastrar tudo à mão. Nada existente é
                    apagado.
                  </p>
                  {optU.length > 0 ? (
                    <EntityForm
                      key={`tpl-${ver}`}
                      submitLabel="Aplicar Food Service"
                      fields={
                        [
                          {
                            name: 'unidadeId',
                            label: 'Unidade',
                            type: 'select',
                            required: true,
                            options: optU,
                            defaultValue: optU[0]?.value,
                          },
                        ] as FieldDef[]
                      }
                      onSubmit={async (v) => {
                        await api.post('/onboarding/template', {
                          unidadeId: v.unidadeId,
                          ramo: 'food_service',
                        });
                        await reload();
                      }}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Crie uma unidade primeiro (em Unidades).
                    </p>
                  )}
                </Card>

                {/* Grid por dependência */}
                <p className="px-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Ordem sugerida — cada etapa habilita a próxima
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visiveis.map((sec) => {
                    const m = META[sec.key];
                    const zero = sec.itens.length === 0;
                    return (
                      <button
                        key={sec.key}
                        type="button"
                        onClick={() => setSel(sec.key)}
                        className={`relative flex flex-col gap-3 rounded-2xl border bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 ${
                          zero ? 'border-dashed border-input' : 'border-border'
                        }`}
                      >
                        {zero && m?.nudge && (
                          <span className="absolute -top-2 left-4 rounded-full bg-primary px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-primary-foreground">
                            Comece por aqui
                          </span>
                        )}
                        <div className="flex items-start gap-3">
                          <div
                            className={`grid h-10 w-10 flex-none place-items-center rounded-xl text-lg ${tint(
                              sec.key,
                            )}`}
                          >
                            {m?.icon ?? '📋'}
                          </div>
                          <div>
                            <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
                              Passo {m?.step ?? '—'}
                            </div>
                            <h3 className="font-display text-[15px] font-bold">
                              {sec.titulo}
                            </h3>
                          </div>
                          <span className="ml-auto grid h-8 w-8 flex-none place-items-center rounded-lg border border-border bg-secondary text-base text-muted-foreground">
                            ＋
                          </span>
                        </div>
                        <div
                          className={`font-mono text-2xl font-bold ${
                            zero ? 'text-muted-foreground' : ''
                          }`}
                        >
                          {sec.itens.length}{' '}
                          <small className="font-sans text-xs font-medium text-muted-foreground">
                            cadastrado(s)
                          </small>
                        </div>
                        {zero && m?.nudge ? (
                          <div className="rounded-lg bg-info/10 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                            💡 {m.nudge}
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            {zero ? 'Ainda sem cadastros' : 'Toque para ver e adicionar'}
                          </div>
                        )}
                      </button>
                    );
                  })}
                  {visiveis.length === 0 && (
                    <div className="col-span-full rounded-2xl border border-dashed border-input bg-secondary/50 p-10 text-center text-sm text-muted-foreground">
                      🔍 Nenhum cadastro encontrado para “{busca}”.
                    </div>
                  )}
                </div>

                {/* Produtos & Equipamentos (fora da cadeia de dependência) */}
                <button
                  type="button"
                  onClick={() => router.push('/produtos')}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40"
                >
                  <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-ok/10 text-lg">
                    🍔
                  </div>
                  <div>
                    <h3 className="font-display text-[15px] font-bold">
                      Produtos & Catálogo
                    </h3>
                    <span className="text-sm text-muted-foreground">
                      O que se vende no PDV — categorias, fichas, variações, combos
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => router.push('/equipamentos')}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40"
                >
                  <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-info/10 text-lg">
                    🖥️
                  </div>
                  <div>
                    <h3 className="font-display text-[15px] font-bold">
                      Equipamentos & Apps
                    </h3>
                    <span className="text-sm text-muted-foreground">
                      Cadastrar KDS e Terminais de Ponto (device token)
                    </span>
                  </div>
                </button>
              </>
            );
          })()
        ) : (
          (() => {
            const sec = secoes.find((x) => x.key === sel);
            if (!sec) return null;
            return (
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => setSel(null)}
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" /> Cadastros
                </button>

                <Card className="p-4">
                  <h2 className="mb-3 font-display text-lg font-semibold">
                    {sec.titulo}
                  </h2>
                  <EntityForm
                    key={`${sec.key}-${ver}`}
                    fields={sec.fields}
                    submitLabel="Adicionar"
                    onSubmit={async (v) => {
                      await sec.submit(v);
                      await reload();
                    }}
                  />
                </Card>

                {sec.itens.length > 0 && (
                  <Card className="p-4">
                    <p className="mb-2 text-sm font-medium text-muted-foreground">
                      Cadastrados ({sec.itens.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {sec.itens.map((n: string, i: number) => (
                        <span
                          key={i}
                          className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground"
                        >
                          {n}
                        </span>
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            );
          })()
        )}
      </div>
    </Shell>
  );
}
