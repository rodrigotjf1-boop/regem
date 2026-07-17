import { api, getCategoria } from '@/lib/api';
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
  // Etiqueta (vaga) não pode ser do presidente/C&O — só funções operacionais.
  const optFSemPresidente: Opt[] = L.funcoes
    .filter((f: any) => f.categoria !== 'presidente')
    .map((f: any) => ({ value: f.id, label: f.nome }));

  // RBAC de cadastro de colaborador: quem pode criar quem (nível da função).
  //  - presidente: cria qualquer nível (inclusive outro presidente — sociedades);
  //  - gerente: só supervisão e execução (não gerente, não presidente).
  const NIVEL: Record<string, number> = { presidente: 4, gerente: 3, supervisao: 2, execucao: 1 };
  const ator = getCategoria() ?? 'execucao';
  const podeCriar = (cat: string) =>
    cat === 'presidente' ? ator === 'presidente' : (NIVEL[ator] ?? 0) > (NIVEL[cat] ?? 0);
  const optFColab: Opt[] = L.funcoes
    .filter((f: any) => podeCriar(f.categoria))
    .map((f: any) => ({ value: f.id, label: `${f.nome} (${f.categoria})` }));
  // Categoria por função (para decidir login por senha).
  const funcCat: Record<string, string> = Object.fromEntries(
    L.funcoes.map((f: any) => [f.id, f.categoria]),
  );
  // Alguma função selecionada é de gestão (presidente/gerente/supervisão)? → login por e-mail+senha.
  const ehGestao = (v: Record<string, string>) =>
    (v.funcaoIds ?? '')
      .split(',')
      .filter(Boolean)
      .some((id) => ['presidente', 'gerente', 'supervisao'].includes(funcCat[id]));
  // Dias da semana sem a opção "todos" (para o intervalo do pico).
  const DIAS_SO = DIAS_SEMANA.filter((d) => d.value !== '');
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
        { name: 'setorIds', label: 'Setores (um ou mais)', type: 'multiselect', options: optS },
      ] as FieldDef[],
      submit: (v: any) =>
        api.post('/funcoes', {
          nome: v.nome,
          categoria: v.categoria,
          setorIds: v.setorIds ? v.setorIds.split(',').filter(Boolean) : [],
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
          options: optFColab,
        },
        // Login por e-mail+senha só aparece quando a função é de gestão
        // (presidente/gerente/supervisão). Execução acessa por PIN no terminal.
        {
          name: 'email',
          label: 'E-mail de login',
          type: 'text',
          placeholder: 'voce@empresa.com',
          showIf: (v) => ehGestao(v),
        },
        {
          name: 'senha',
          label: 'Senha de login (mín. 6)',
          type: 'password',
          placeholder: '••••••',
          showIf: (v) => ehGestao(v),
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
          label: 'PIN — acesso ao terminal de ponto (opcional, 4-6 díg.)',
          type: 'text',
          placeholder: 'ex.: 1234',
        },
      ] as FieldDef[],
      submit: (v: any) =>
        api.post('/colaboradores', {
          nome: v.nome,
          email: v.email || undefined,
          senha: v.senha || undefined,
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
            p.diaSemana == null
              ? 'todos'
              : p.diaSemanaFim != null
                ? `${DIA_ABREV[String(p.diaSemana)]}–${DIA_ABREV[String(p.diaSemanaFim)]}`
                : DIA_ABREV[String(p.diaSemana)]
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
          options: [...DIAS_SEMANA, { value: 'range', label: 'Personalizar (intervalo)…' }],
          defaultValue: '',
          fromRow: (r: any) =>
            r.diaSemanaFim != null ? 'range' : r.diaSemana == null ? '' : String(r.diaSemana),
        },
        {
          name: 'diaSemanaIni',
          label: 'Do dia',
          type: 'select',
          options: DIAS_SO,
          defaultValue: '1',
          showIf: (v) => v.diaSemana === 'range',
          fromRow: (r: any) => (r.diaSemana == null ? '1' : String(r.diaSemana)),
        },
        {
          name: 'diaSemanaFim',
          label: 'Até o dia',
          type: 'select',
          options: DIAS_SO,
          defaultValue: '5',
          showIf: (v) => v.diaSemana === 'range',
          fromRow: (r: any) => (r.diaSemanaFim == null ? '5' : String(r.diaSemanaFim)),
        },
        { name: 'horaInicio', label: 'Início', type: 'time', required: true },
        { name: 'horaFim', label: 'Fim', type: 'time', required: true },
      ] as FieldDef[],
      submit: (v: any) =>
        api.post('/janelas-pico', {
          unidadeId: v.unidadeId,
          nome: v.nome,
          diaSemana:
            v.diaSemana === 'range'
              ? Number(v.diaSemanaIni)
              : v.diaSemana === ''
                ? undefined
                : Number(v.diaSemana),
          diaSemanaFim: v.diaSemana === 'range' ? Number(v.diaSemanaFim) : undefined,
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
          options: optFSemPresidente,
          defaultValue: optFSemPresidente[0]?.value,
          onCreate: criarFuncao,
        },
        {
          name: 'sigla',
          label: 'Sigla',
          type: 'text',
          required: true,
          placeholder: 'Ex.: AUXC1 Auxiliar de cozinha 1',
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

  const picoDias = (p: any) =>
    p.diaSemana == null
      ? 'todos'
      : p.diaSemanaFim != null
        ? `${DIA_ABREV[String(p.diaSemana)]}–${DIA_ABREV[String(p.diaSemanaFim)]}`
        : DIA_ABREV[String(p.diaSemana)];
  const picoLabel = (p: any) =>
    `${p.nome} · ${picoDias(p)} ${String(p.horaInicio).slice(0, 5)}–${String(p.horaFim).slice(0, 5)}`;

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
      update: (id, v) =>
        api.patch(`/funcoes/${id}`, {
          nome: v.nome,
          categoria: v.categoria,
          setorIds: v.setorIds ? v.setorIds.split(',').filter(Boolean) : [],
        }),
      remove: (id) => api.del(`/funcoes/${id}`),
    },
    colaborador: {
      rows: L.colaboradores,
      rowLabel: (c) => c.nome,
      update: (id, v) =>
        api.patch(`/colaboradores/${id}`, {
          nome: v.nome,
          email: v.email ?? undefined,
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
          diaSemana:
            v.diaSemana === 'range'
              ? Number(v.diaSemanaIni)
              : v.diaSemana === ''
                ? undefined
                : Number(v.diaSemana),
          diaSemanaFim: v.diaSemana === 'range' ? Number(v.diaSemanaFim) : undefined,
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
  };

  return base.map((s) => ({ ...s, ...extra[s.key] }));
}
