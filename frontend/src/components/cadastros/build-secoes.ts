import { api } from '@/lib/api';
import { type FieldDef } from '@/components/cadastros/entity-form';
import {
  CATEGORIAS,
  VINCULOS,
  DIAS_SEMANA,
  DIA_ABREV,
  type Lists,
} from '@/components/cadastros/constants';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Opt = { value: string; label: string };
export type Secao = {
  key: string;
  titulo: string;
  itens: string[];
  fields: FieldDef[];
  submit: (v: any) => Promise<any>;
};

// Monta as seções de cadastro (ordem de dependência) a partir das listas
// carregadas e das opções derivadas. Mesmas definições de antes — só extraídas.
export function buildSecoes({
  L,
  optU,
  optS,
  optF,
  withNone,
  criarFuncao,
}: {
  L: Lists;
  optU: Opt[];
  optS: Opt[];
  optF: Opt[];
  withNone: (arr: Opt[]) => Opt[];
  criarFuncao: (nome: string) => Promise<Opt>;
}): Secao[] {
  return [
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
}
