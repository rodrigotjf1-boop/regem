'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { api, clearToken, getToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BottomNav } from '@/components/app-shell/bottom-nav';
import { EntityForm, type FieldDef } from '@/components/cadastros/entity-form';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Lists = {
  unidades: any[];
  setores: any[];
  funcoes: any[];
  colaboradores: any[];
  turnos: any[];
  etiquetas: any[];
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

export default function CadastrosPage() {
  const router = useRouter();
  const [L, setL] = useState<Lists | null>(null);
  const [erro, setErro] = useState('');
  const [ver, setVer] = useState(0);

  const reload = useCallback(async () => {
    try {
      const [unidades, setores, funcoes, colaboradores, turnos, etiquetas] =
        await Promise.all([
          api.get('/unidades'),
          api.get('/setores'),
          api.get('/funcoes'),
          api.get('/colaboradores'),
          api.get('/turnos'),
          api.get('/etiquetas'),
        ]);
      setL({ unidades, setores, funcoes, colaboradores, turnos, etiquetas });
      setVer((v) => v + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    reload();
  }, [reload, router]);

  function sair() {
    clearToken();
    router.replace('/');
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
        { name: 'funcaoId', label: 'Função', type: 'select', options: withNone(optF) },
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
        {
          name: 'horaInicio',
          label: 'Início (HH:MM)',
          type: 'text',
          required: true,
          placeholder: '11:00',
        },
        {
          name: 'horaFim',
          label: 'Fim (HH:MM)',
          type: 'text',
          required: true,
          placeholder: '15:00',
        },
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
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
              R
            </div>
            <p className="text-sm font-semibold">Cadastros</p>
          </div>
          <Button variant="ghost" size="icon" onClick={sair} aria-label="Sair">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4 pb-24">
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
              Crie uma unidade primeiro (seção abaixo).
            </p>
          )}
        </Card>
        {secoes.map((sec) => (
          <Card key={sec.key} className="p-4">
            <h2 className="mb-3 font-semibold">{sec.titulo}</h2>
            {sec.itens.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {sec.itens.map((n: string, i: number) => (
                  <span
                    key={i}
                    className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground"
                  >
                    {n}
                  </span>
                ))}
              </div>
            )}
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
        ))}
      </main>
      <BottomNav />
    </div>
  );
}
