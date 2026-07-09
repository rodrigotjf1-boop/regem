import { api } from '@/lib/api';
import { type FieldDef } from '@/components/cadastros/entity-form';
import {
  CATEGORIAS,
  VINCULOS,
  JORNADAS,
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
  // Edição / exclusão (Cadastros CRUD). rows = objetos completos (com id).
  rows?: any[];
  rowLabel?: (r: any) => string;
  update?: (id: string, v: any) => Promise<any>;
  remove?: (id: string) => Promise<any>;
  editHide?: string[]; // campos ocultos no modo edição
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
  const optColab: Opt[] = L.colaboradores.map((c: any) => ({ value: c.id, label: c.nome }));
  const base: Secao[] = [
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
        { name: 'cor', label: 'Cor do setor', type: 'color', defaultValue: '#94a3b8' },
      ] as FieldDef[],
      submit: (v: any) =>
        api.post('/setores', {
          unidadeId: v.unidadeId,
          nome: v.nome,
          icone: v.icone || undefined,
          cor: v.cor || undefined,
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
        {
          name: 'gerarEtiqueta',
          label: 'Gerar etiqueta (vaga) da função? (precisa de setor)',
          type: 'select',
          options: [
            { value: '1', label: 'Sim' },
            { value: '', label: 'Não' },
          ],
          defaultValue: '1',
        },
        {
          name: 'sigla',
          label: 'Sigla da etiqueta (opcional — vazio gera do nome)',
          type: 'text',
          placeholder: 'ex.: AUXC',
        },
      ] as FieldDef[],
      submit: (v: any) =>
        api.post('/funcoes', {
          nome: v.nome,
          categoria: v.categoria,
          setorId: v.setorId || undefined,
          gerarEtiqueta: v.gerarEtiqueta === '1',
          sigla: v.sigla || undefined,
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
          name: 'funcaoIds',
          label: 'Funções (uma ou mais)',
          type: 'multiselect',
          options: optF,
        },
        {
          name: 'vinculo',
          label: 'Vínculo',
          type: 'select',
          options: VINCULOS,
          defaultValue: 'clt',
        },
        {
          name: 'jornadaTipo',
          label: 'Tipo de escala/jornada',
          type: 'select',
          options: JORNADAS,
          defaultValue: 'outro',
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
          funcaoIds: v.funcaoIds ? v.funcaoIds.split(',').filter(Boolean) : [],
          vinculo: v.vinculo,
          jornadaTipo: v.jornadaTipo || undefined,
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
        { name: 'pausaInicio', label: 'Início da pausa (opcional)', type: 'time' },
        { name: 'pausaFim', label: 'Fim da pausa (opcional)', type: 'time' },
      ] as FieldDef[],
      submit: (v: any) =>
        api.post('/turnos', {
          unidadeId: v.unidadeId,
          nome: v.nome,
          horaInicio: v.horaInicio,
          horaFim: v.horaFim,
          pausaInicio: v.pausaInicio || undefined,
          pausaFim: v.pausaFim || undefined,
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
    {
      key: 'dia_especial',
      titulo: 'Dias importantes',
      itens: (L.diasEspeciais ?? []).map(
        (d: any) =>
          `${d.data}${d.dataFim ? `–${d.dataFim}` : ''} · ${d.nome} (${d.tipo})`,
      ),
      fields: [
        { name: 'data', label: 'Data', type: 'date', required: true },
        { name: 'dataFim', label: 'Até (opcional — período)', type: 'date' },
        {
          name: 'tipo',
          label: 'Tipo',
          type: 'select',
          options: [
            { value: 'feriado', label: 'Feriado' },
            { value: 'ferias', label: 'Férias' },
            { value: 'evento', label: 'Evento' },
            { value: 'folga', label: 'Folga' },
            { value: 'outro', label: 'Outro' },
          ],
          defaultValue: 'feriado',
        },
        {
          name: 'nome',
          label: 'Nome',
          type: 'text',
          required: true,
          placeholder: 'Ex.: Natal / Férias da Maria',
        },
        {
          name: 'colaboradorId',
          label: 'Colaborador (só p/ férias/folga de 1 pessoa)',
          type: 'select',
          options: withNone(optColab),
        },
      ] as FieldDef[],
      submit: (v: any) =>
        api.post('/dias-especiais', {
          data: v.data,
          dataFim: v.dataFim || undefined,
          tipo: v.tipo,
          nome: v.nome,
          colaboradorId: v.colaboradorId || undefined,
        }),
    },
  ];

  const diaLabel = (d: any) =>
    `${d.data}${d.dataFim ? `–${d.dataFim}` : ''} · ${d.nome} (${d.tipo})`;
  const picoLabel = (p: any) =>
    `${p.nome} · ${
      p.diaSemana == null ? 'todos' : DIA_ABREV[String(p.diaSemana)]
    } ${String(p.horaInicio).slice(0, 5)}–${String(p.horaFim).slice(0, 5)}`;

  // Edição/exclusão por seção (mesclado por key, sem repetir os forms).
  const extra: Record<string, Partial<Secao>> = {
    unidade: {
      rows: L.unidades,
      rowLabel: (u) => u.nome,
      update: (id, v) => api.patch(`/unidades/${id}`, { nome: v.nome }),
      remove: (id) => api.del(`/unidades/${id}`),
    },
    setor: {
      rows: L.setores,
      rowLabel: (s) => s.nome,
      editHide: ['unidadeId'],
      update: (id, v) =>
        api.patch(`/setores/${id}`, {
          nome: v.nome,
          icone: v.icone || undefined,
          cor: v.cor || undefined,
        }),
      remove: (id) => api.del(`/setores/${id}`),
    },
    funcao: {
      rows: L.funcoes,
      rowLabel: (f) => `${f.nome} (${f.categoria})`,
      editHide: ['gerarEtiqueta', 'sigla'],
      update: (id, v) =>
        api.patch(`/funcoes/${id}`, {
          nome: v.nome,
          categoria: v.categoria,
          setorId: v.setorId || undefined,
        }),
      remove: (id) => api.del(`/funcoes/${id}`),
    },
    colaborador: {
      rows: L.colaboradores,
      rowLabel: (c) => c.nome,
      update: (id, v) =>
        api.patch(`/colaboradores/${id}`, {
          nome: v.nome,
          fotoRef: v.fotoRef || undefined,
          funcaoIds: v.funcaoIds ? v.funcaoIds.split(',').filter(Boolean) : [],
          vinculo: v.vinculo,
          jornadaTipo: v.jornadaTipo || undefined,
          pin: v.pin || undefined,
        }),
      remove: (id) => api.del(`/colaboradores/${id}`),
    },
    turno: {
      rows: L.turnos,
      rowLabel: (t) => t.nome,
      editHide: ['unidadeId'],
      update: (id, v) =>
        api.patch(`/turnos/${id}`, {
          nome: v.nome,
          horaInicio: v.horaInicio,
          horaFim: v.horaFim,
          pausaInicio: v.pausaInicio || undefined,
          pausaFim: v.pausaFim || undefined,
        }),
      remove: (id) => api.del(`/turnos/${id}`),
    },
    pico: {
      rows: L.janelasPico,
      rowLabel: picoLabel,
      editHide: ['unidadeId'],
      update: (id, v) =>
        api.patch(`/janelas-pico/${id}`, {
          nome: v.nome,
          diaSemana: v.diaSemana === '' ? undefined : Number(v.diaSemana),
          horaInicio: v.horaInicio,
          horaFim: v.horaFim,
        }),
      remove: (id) => api.del(`/janelas-pico/${id}`),
    },
    fornecedor: {
      rows: L.fornecedores,
      rowLabel: (f) => f.nome,
      update: (id, v) =>
        api.patch(`/fornecedores/${id}`, {
          nome: v.nome,
          cnpj: v.cnpj || undefined,
          contato: v.contato || undefined,
          telefone: v.telefone || undefined,
          email: v.email || undefined,
          obs: v.obs || undefined,
        }),
      remove: (id) => api.del(`/fornecedores/${id}`),
    },
    etiqueta: {
      rows: L.etiquetas,
      rowLabel: (e) => `${e.sigla}${e.contador}`,
      editHide: ['setorId', 'funcaoId'],
      update: (id, v) =>
        api.patch(`/etiquetas/${id}`, {
          sigla: v.sigla,
          contador: v.contador ? Number(v.contador) : undefined,
        }),
      remove: (id) => api.del(`/etiquetas/${id}`),
    },
    dia_especial: {
      rows: L.diasEspeciais ?? [],
      rowLabel: diaLabel,
      update: (id, v) =>
        api.patch(`/dias-especiais/${id}`, {
          data: v.data,
          dataFim: v.dataFim || undefined,
          tipo: v.tipo,
          nome: v.nome,
          colaboradorId: v.colaboradorId || undefined,
        }),
      remove: (id) => api.del(`/dias-especiais/${id}`),
    },
  };

  return base.map((s) => ({ ...s, ...extra[s.key] }));
}
