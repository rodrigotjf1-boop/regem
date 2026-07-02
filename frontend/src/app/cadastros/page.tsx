'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LogOut } from 'lucide-react';
import { api, clearToken, getToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BottomNav } from '@/components/app-shell/bottom-nav';
import { EntityForm, type FieldDef } from '@/components/cadastros/entity-form';
import { Shell } from '@/components/app-shell/shell';

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

export default function CadastrosPage() {
  const router = useRouter();
  const [L, setL] = useState<Lists | null>(null);
  const [erro, setErro] = useState('');
  const [ver, setVer] = useState(0);
  const [sel, setSel] = useState<string | null>(null);

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

  function sair() {
    clearToken();
    router.replace('/entrar');
  }

  if (!L) {
    return (
      <div className="grid min-h-dvh place-items-center text-muted-foreground">
        {erro || 'Carregando…'}
      </div>
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
      <div className="max-w-3xl space-y-4">
        {sel === null ? (
          <>
            <Card className="border-primary/30 bg-primary/5 p-4">
              <h2 className="mb-1 font-semibold">Template por ramo</h2>
              <p className="mb-3 text-sm text-muted-foreground">
                Cria setores, funções, etiquetas, tipos de ocorrência e itens de
                estoque de uma vez — sem cadastrar tudo à mão.
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

            <div className="grid grid-cols-2 gap-3">
              {secoes.map((sec) => (
                <button
                  key={sec.key}
                  type="button"
                  onClick={() => setSel(sec.key)}
                  className="flex flex-col items-start gap-0.5 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/50"
                >
                  <span className="font-display font-semibold">{sec.titulo}</span>
                  <span className="text-sm text-muted-foreground">
                    {sec.itens.length} cadastrado(s)
                  </span>
                </button>
              ))}
            </div>
          </>
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
