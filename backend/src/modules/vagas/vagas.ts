import { BadRequestException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { telefoneCadastro } from '../../common/telefone-chave';
import { cepValido, telefoneValido } from '../../common/validadores-br';
import { exigirBooleano } from '../../common/exigir';

/* eslint-disable @typescript-eslint/no-explicit-any */

// VAGAS E CANDIDATOS (F1, mig 389 — plano aprovado pelo dono em 10/11/2026).
// As regras puras ficam aqui, fora do serviço: o que a página aceita, como a ficha do candidato é lida e conferida, o
// código público da página e o protocolo. A tela (`frontend/src/lib/vagas-ficha.ts`) confere as mesmas regras para avisar
// antes de enviar; quem decide é o servidor.

// ── listas fechadas (o que a tela oferece; qualquer outro valor é recusado) ──────────────────────────────────────────
export const SETORES = ['chapa', 'fritadeira', 'montagem', 'producao', 'atendimento', 'delivery', 'nenhum'] as const;
export const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'] as const;
export const TEMPOS = ['ate6m', '6m1a', '1a2a', '2a'] as const;
export const VINCULOS = ['carteira', 'informal'] as const;
export const CARGOS = ['lider_turno', 'supervisor', 'gerente', 'outro'] as const;
export const EQUIPES = ['ate5', '6a15', '16'] as const;
export const GRAU_ATUAL = ['fundamental', 'medio', 'eja', 'tecnico', 'faculdade', 'pos'] as const;
export const GRAU_FINAL = ['fund_inc', 'fund', 'medio_inc', 'medio', 'tecnico', 'sup_inc', 'superior'] as const;
export const TURNOS_ESTUDO = ['manha', 'tarde', 'noite', 'ead'] as const;
export const MEIOS = ['publico', 'uber', 'pe', 'bike', 'proprio'] as const;
export const UBER_MOTIVOS = ['sem_onibus', 'madrugada', 'rapido', 'seguranca', 'outro'] as const;
export const COMECA = ['imediato', '15d', '30d', 'aviso'] as const;
export const SEXOS = ['feminino', 'masculino', 'outro', 'nao_informar'] as const;
export const ORIGENS_DECLARADAS = ['qr_loja', 'instagram', 'whatsapp', 'indicacao', 'outro'] as const;
export const SITUACOES = ['novo', 'analise', 'entrevista', 'aprovado', 'contratado', 'banco', 'reprovado'] as const;
export type Situacao = (typeof SITUACOES)[number];
export const ESCALAS = ['12x36', '5x2'] as const;

// As perguntas extras que a loja liga e desliga (Página de vagas › Perguntas extras). Todas nascem ligadas.
export const PERGUNTAS_EXTRAS = ['cnh', 'feriados', 'ja_trabalhou', 'indicacao', 'sobre'] as const;
export type PerguntaExtra = (typeof PERGUNTAS_EXTRAS)[number];

// Versões dos textos que o candidato aceita (guardadas na ficha). Mudou o texto → nova versão.
export const VERSAO_GUARDA = 'guarda-v1';
export const VERSAO_COMUNICACAO = 'comunicacao-v1';

// ── a página de vagas ──────────────────────────────────────────────────────────────────────────────────────────────
export interface FuncaoDaPagina {
  codigo: string;
  nome: string;
  salario: string;
  lideranca: boolean;
  aberta: boolean;
}
export interface HorarioDaPagina {
  ativa: boolean;
  inicio: string;
  fim: string;
}
export interface HorariosDaPagina {
  '12x36': HorarioDaPagina;
  '5x2': HorarioDaPagina;
  horista: HorarioDaPagina & { dias: string[] };
}
export interface PaginaDeVagas {
  ligada: boolean;
  titulo: string;
  frase: string;
  funcoes: FuncaoDaPagina[];
  beneficios: string[];
  vagaFixa: boolean;
  horista: boolean;
  horarios: HorariosDaPagina;
  idadeMinima: number;
  guardaMeses: number;
  perguntas: Record<PerguntaExtra, boolean>;
  corPrincipal: string | null;
  corDestaque: string | null;
}

/** A página de uma loja que ainda não salvou nada: desligada, com as funções comuns de food service e os horários do
 *  piloto (12x36 das 15h às 3h; 5x2 e horista das 19h às 3h — dono, 10/11/2026). A loja ajusta antes de ligar. */
export function paginaPadrao(): PaginaDeVagas {
  return {
    ligada: false,
    titulo: 'Venha fazer parte do nosso time!',
    frase: 'Vagas fixas, escalas e horistas.',
    funcoes: [
      { codigo: 'chapeiro', nome: 'Chapeiro(a)', salario: '', lideranca: false, aberta: true },
      { codigo: 'auxiliar', nome: 'Auxiliar de cozinha', salario: 'Salário mínimo / piso da categoria', lideranca: false, aberta: true },
      { codigo: 'atendimento', nome: 'Atendimento', salario: '', lideranca: false, aberta: true },
      { codigo: 'supervisao', nome: 'Supervisor(a) de cozinha', salario: '', lideranca: true, aberta: true },
      { codigo: 'gerencia', nome: 'Gerência', salario: '', lideranca: true, aberta: true },
    ],
    beneficios: [],
    vagaFixa: true,
    horista: true,
    horarios: {
      '12x36': { ativa: true, inicio: '15:00', fim: '03:00' },
      '5x2': { ativa: true, inicio: '19:00', fim: '03:00' },
      horista: { ativa: true, inicio: '19:00', fim: '03:00', dias: ['sex', 'sab', 'dom'] },
    },
    idadeMinima: 18,
    guardaMeses: 12,
    perguntas: { cnh: true, feriados: true, ja_trabalhou: true, indicacao: true, sobre: true },
    corPrincipal: null,
    corDestaque: null,
  };
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const COR = /^#[0-9a-fA-F]{6}$/;
const CODIGO_FUNCAO = /^[a-z0-9_]{2,30}$/;

const texto = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const ehObjeto = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const recusar = (message: string, campo?: string): never => {
  throw new BadRequestException({ message, code: 'VAGAS_INVALIDO', campo: campo ?? null });
};

function lerHorario(v: unknown, atual: HorarioDaPagina, nome: string): HorarioDaPagina {
  if (v === undefined) return atual;
  if (!ehObjeto(v)) recusar(`Horário da ${nome}: formato inválido.`, 'horarios');
  const o = v as Record<string, any>;
  const inicio = o.inicio === undefined ? atual.inicio : String(o.inicio);
  const fim = o.fim === undefined ? atual.fim : String(o.fim);
  if (!HORA.test(inicio) || !HORA.test(fim)) recusar(`Horário da ${nome}: use HH:MM (ex.: 19:00).`, 'horarios');
  return { ativa: o.ativa === undefined ? atual.ativa : exigirBooleano(o.ativa, `${nome}.ativa`), inicio, fim };
}

/**
 * Lê o que a tela manda salvar na Página de vagas. O que não vem fica como está (V16); liga/desliga só com booleano de
 * verdade (V15). Ligar exige o mínimo para a página fazer sentido: uma função aberta e um tipo de vaga com horário.
 */
export function lerPagina(dto: unknown, atual: PaginaDeVagas): PaginaDeVagas {
  if (!ehObjeto(dto)) recusar('Ajustes da página: formato inválido.');
  const d = dto as Record<string, any>;
  const p: PaginaDeVagas = JSON.parse(JSON.stringify(atual));
  if (d.ligada !== undefined) p.ligada = exigirBooleano(d.ligada, 'ligada');
  if (d.titulo !== undefined) p.titulo = texto(d.titulo, 80);
  if (d.frase !== undefined) p.frase = texto(d.frase, 160);
  if (d.funcoes !== undefined) {
    if (!Array.isArray(d.funcoes) || d.funcoes.length > 20) recusar('Funções: mande uma lista de até 20.', 'funcoes');
    const vistos = new Set<string>();
    p.funcoes = (d.funcoes as any[]).map((f, i) => {
      if (!ehObjeto(f)) recusar(`Função ${i + 1}: formato inválido.`, 'funcoes');
      const nome = texto(f.nome, 60);
      if (!nome) recusar(`Função ${i + 1}: escreva o nome.`, 'funcoes');
      const codigo = String(f.codigo ?? '').trim() || slug(nome).replace(/-/g, '_').slice(0, 30);
      if (!CODIGO_FUNCAO.test(codigo)) recusar(`Função "${nome}": código inválido.`, 'funcoes');
      if (vistos.has(codigo)) recusar(`Função "${nome}" repetida.`, 'funcoes');
      vistos.add(codigo);
      return {
        codigo,
        nome,
        salario: texto(f.salario, 60),
        lideranca: f.lideranca === undefined ? false : exigirBooleano(f.lideranca, `funcoes[${i}].lideranca`),
        aberta: f.aberta === undefined ? true : exigirBooleano(f.aberta, `funcoes[${i}].aberta`),
      };
    });
  }
  if (d.beneficios !== undefined) {
    if (!Array.isArray(d.beneficios) || d.beneficios.length > 10) recusar('Benefícios: mande uma lista de até 10.', 'beneficios');
    p.beneficios = (d.beneficios as any[]).map((b) => texto(b, 120)).filter(Boolean);
  }
  if (d.vagaFixa !== undefined) p.vagaFixa = exigirBooleano(d.vagaFixa, 'vagaFixa');
  if (d.horista !== undefined) p.horista = exigirBooleano(d.horista, 'horista');
  if (d.horarios !== undefined) {
    if (!ehObjeto(d.horarios)) recusar('Horários: formato inválido.', 'horarios');
    const h = d.horarios as Record<string, any>;
    p.horarios['12x36'] = lerHorario(h['12x36'], p.horarios['12x36'], 'escala 12x36');
    p.horarios['5x2'] = lerHorario(h['5x2'], p.horarios['5x2'], 'escala 5x2');
    const hor = lerHorario(h.horista, p.horarios.horista, 'vaga de horista');
    let dias = p.horarios.horista.dias;
    if (h.horista && (h.horista as any).dias !== undefined) {
      const ds = (h.horista as any).dias;
      if (!Array.isArray(ds) || ds.some((x: any) => !(DIAS as readonly string[]).includes(x)))
        recusar('Dias do horista: use seg, ter, qua, qui, sex, sab, dom.', 'horarios');
      dias = DIAS.filter((x) => ds.includes(x));
    }
    p.horarios.horista = { ...hor, dias };
  }
  if (d.idadeMinima !== undefined) {
    const n = Number(d.idadeMinima);
    if (!Number.isInteger(n) || n < 14 || n > 24) recusar('Idade mínima: entre 14 e 24 anos.', 'idadeMinima');
    p.idadeMinima = n;
  }
  if (d.guardaMeses !== undefined) {
    const n = Number(d.guardaMeses);
    if (![6, 12, 24].includes(n)) recusar('Guardar fichas: 6, 12 ou 24 meses.', 'guardaMeses');
    p.guardaMeses = n;
  }
  if (d.perguntas !== undefined) {
    if (!ehObjeto(d.perguntas)) recusar('Perguntas extras: formato inválido.', 'perguntas');
    for (const [k, v] of Object.entries(d.perguntas as Record<string, unknown>)) {
      if (!(PERGUNTAS_EXTRAS as readonly string[]).includes(k)) recusar(`Pergunta extra "${k}" não existe.`, 'perguntas');
      p.perguntas[k as PerguntaExtra] = exigirBooleano(v, `perguntas.${k}`);
    }
  }
  for (const campo of ['corPrincipal', 'corDestaque'] as const) {
    if (d[campo] === undefined) continue;
    const v = d[campo] === null || d[campo] === '' ? null : String(d[campo]);
    if (v !== null && !COR.test(v)) recusar('Cor: use o formato #RRGGBB.', campo);
    p[campo] = v ? v.toUpperCase() : null;
  }
  if (p.ligada) {
    if (!p.funcoes.some((f) => f.aberta)) recusar('Para ligar a página, deixe pelo menos uma função aberta.', 'funcoes');
    const fixaOk = p.vagaFixa && (p.horarios['12x36'].ativa || p.horarios['5x2'].ativa);
    const horistaOk = p.horista && p.horarios.horista.ativa && p.horarios.horista.dias.length > 0;
    if (!fixaOk && !horistaOk) recusar('Para ligar a página, deixe um tipo de vaga com horário (fixa ou horista).', 'horarios');
  }
  return p;
}

/** A página como a tela da loja e o servidor guardam, lida da linha do banco (o que faltar vem do padrão). */
export function paginaDaLinha(l: Record<string, any> | undefined | null): PaginaDeVagas {
  const p = paginaPadrao();
  if (!l) return p;
  const h = ehObjeto(l.horarios) ? l.horarios : {};
  const mesclar = (base: HorarioDaPagina, v: any): HorarioDaPagina =>
    ehObjeto(v)
      ? { ativa: v.ativa !== false, inicio: HORA.test(String(v.inicio)) ? String(v.inicio) : base.inicio, fim: HORA.test(String(v.fim)) ? String(v.fim) : base.fim }
      : base;
  return {
    ligada: l.ligada === true,
    titulo: l.titulo ?? p.titulo,
    frase: l.frase ?? p.frase,
    funcoes: Array.isArray(l.funcoes) ? l.funcoes : p.funcoes,
    beneficios: Array.isArray(l.beneficios) ? l.beneficios : p.beneficios,
    vagaFixa: l.vaga_fixa !== false,
    horista: l.horista !== false,
    horarios: {
      '12x36': mesclar(p.horarios['12x36'], h['12x36']),
      '5x2': mesclar(p.horarios['5x2'], h['5x2']),
      horista: {
        ...mesclar(p.horarios.horista, h.horista),
        dias: Array.isArray(h.horista?.dias) ? h.horista.dias.filter((x: any) => (DIAS as readonly string[]).includes(x)) : p.horarios.horista.dias,
      },
    },
    idadeMinima: Number(l.idade_minima ?? p.idadeMinima),
    guardaMeses: Number(l.guarda_meses ?? p.guardaMeses),
    perguntas: { ...p.perguntas, ...(ehObjeto(l.perguntas) ? l.perguntas : {}) },
    corPrincipal: l.cor_principal ?? null,
    corDestaque: l.cor_destaque ?? null,
  };
}

// ── os textos que o candidato aceita (a página pública mostra estes, para o texto e a versão andarem juntos) ─────────
export function termoDaGuarda(loja: string, meses: number): string {
  return `Concordo que ${loja} guarde estas informações por até ${meses} meses para seleção de vagas. Posso pedir para apagar quando quiser.`;
}
export function termoDaComunicacao(loja: string): { resumo: string; texto: string[] } {
  return {
    resumo: `Quero receber mensagens e e-mails de ${loja} no WhatsApp e no e-mail que informei: sobre a minha candidatura, novas vagas e novidades da loja.`,
    texto: [
      `Ao marcar esta opção, autorizo ${loja} a me enviar mensagens pelo WhatsApp e e-mails, nos contatos desta ficha, sobre: o andamento da minha candidatura (como convite para entrevista); novas vagas abertas na loja; e novidades e avisos da loja.`,
      'As mensagens podem vir da equipe da loja ou do atendimento automático dela. Posso cancelar quando quiser: respondendo SAIR no WhatsApp, pelo link no fim de cada e-mail ou pedindo à gerência. Cancelar não apaga a minha ficha.',
      'Esta autorização é opcional e não muda a análise da minha candidatura. Sem ela, a loja fala comigo só sobre esta candidatura.',
    ],
  };
}

// ── a ficha do candidato ───────────────────────────────────────────────────────────────────────────────────────────
export interface ExperienciaDaFicha {
  tipo: 'trabalho' | 'lideranca';
  empresa: string;
  funcao: string | null;
  cargo: string | null;
  equipe: string | null;
  tempo: string;
  vinculo: string;
  atual: boolean;
  descricao: string | null;
}
export interface CursoDaFicha {
  nome: string;
  onde: string;
  situacao: string;
}
export interface FichaLida {
  nome: string;
  nascimento: string;
  idade: number;
  sexo: string | null;
  telefone: string;
  email: string | null;
  funcoes: string[];
  setores: string[];
  tipoVaga: 'fixa' | 'horista' | 'tanto';
  escala: string | null;
  dias: string[];
  obsHorarios: string | null;
  experiencia: 'sim' | 'outra' | 'primeiro';
  liderou: boolean | null;
  experiencias: ExperienciaDaFicha[];
  estuda: boolean;
  grauEstudo: string;
  escola: string;
  turnoEstudo: string | null;
  cursosSituacao: 'fazendo' | 'fez' | 'nunca';
  cursos: CursoDaFicha[];
  cep: string;
  rua: string | null;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  meios: string[];
  conducoes: number | null;
  uberMotivo: string | null;
  uberObs: string | null;
  valorIda: number | null;
  valorVolta: number | null;
  trabalhando: boolean;
  comeca: string;
  respostas: Record<string, string>;
  origemDeclarada: string | null;
  comunicacao: boolean;
}

const um = <T extends string>(v: unknown, lista: readonly T[], msg: string, campo: string): T => {
  const s = String(v ?? '');
  if (!(lista as readonly string[]).includes(s)) recusar(msg, campo);
  return s as T;
};
const varios = (v: unknown, lista: readonly string[], msg: string, campo: string, min = 1): string[] => {
  if (!Array.isArray(v)) recusar(msg, campo);
  const arr = [...new Set((v as unknown[]).map((x) => String(x)))];
  if (arr.length < min || arr.some((x) => !lista.includes(x))) recusar(msg, campo);
  return lista.filter((x) => arr.includes(x));
};
const simNao = (v: unknown, msg: string, campo: string): boolean => {
  if (v === true || v === 'sim') return true;
  if (v === false || v === 'nao') return false;
  return recusar(msg, campo);
};
const reais = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

/** Idade completa em `hoje` (YYYY-MM-DD) de quem nasceu em `nascimento` (YYYY-MM-DD). */
export function idadeEm(nascimento: string, hoje: string): number {
  const [an, mn, dn] = nascimento.split('-').map(Number);
  const [ah, mh, dh] = hoje.split('-').map(Number);
  let idade = ah - an;
  if (mh < mn || (mh === mn && dh < dn)) idade--;
  return idade;
}

/**
 * Lê e confere a ficha que a página pública manda. Tudo o que a tela pede é conferido de novo aqui (a tela só ajuda):
 * as funções têm de estar ABERTAS na página, a escala ativa, a idade acima da mínima, e o consentimento da guarda marcado.
 * Recusa com a primeira falta, em português, com o campo.
 */
export function lerFicha(dto: unknown, pagina: PaginaDeVagas, hoje: string): FichaLida {
  if (!ehObjeto(dto)) recusar('Ficha: formato inválido.');
  const d = dto as Record<string, any>;

  // 1 · você
  const nome = texto(d.nome, 120);
  if (nome.split(' ').filter(Boolean).length < 2) recusar('Escreva o nome e o sobrenome.', 'nome');
  const nascimento = String(d.nascimento ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nascimento) || Number.isNaN(Date.parse(`${nascimento}T12:00:00Z`)))
    recusar('Escolha a data de nascimento.', 'nascimento');
  const idade = idadeEm(nascimento, hoje);
  if (idade < pagina.idadeMinima) recusar(`As vagas desta página são para quem tem ${pagina.idadeMinima} anos ou mais.`, 'nascimento');
  if (idade > 90) recusar('Confira a data de nascimento.', 'nascimento');
  const sexo = d.sexo ? um(d.sexo, SEXOS, 'Sexo: opção inválida.', 'sexo') : null;
  // Sem o 55 ANTES de conferir: "+55 21 9…" é o mesmo número (ERR-135) e o validador só aceita 10 ou 11 dígitos.
  const telefone = telefoneCadastro(d.whatsapp);
  if (!telefoneValido(telefone)) recusar('Digite o WhatsApp com DDD. Ex.: (21) 9XXXX-XXXX.', 'whatsapp');
  const email = texto(d.email, 160) || null;
  if (email && !/^\S+@\S+\.\S+$/.test(email)) recusar('Confira o e-mail (ou deixe em branco).', 'email');

  // 2 · a vaga
  const abertas = pagina.funcoes.filter((f) => f.aberta);
  const funcoes = varios(d.funcoes, abertas.map((f) => f.codigo), 'Escolha pelo menos uma das funções abertas.', 'funcoes');
  const setores = varios(d.setores, SETORES, 'Marque pelo menos um setor (ou "Ainda não tenho prática").', 'setores');
  if (setores.includes('nenhum') && setores.length > 1) recusar('"Ainda não tenho prática" vai sozinho.', 'setores');

  // 3 · horários (o horário sai da escala — dono, 10/11/2026)
  const tipoVaga = um(d.tipo, ['fixa', 'horista', 'tanto'] as const, 'Escolha o tipo de vaga.', 'tipo');
  if (tipoVaga !== 'horista' && !pagina.vagaFixa) recusar('Esta página não tem vaga fixa no momento.', 'tipo');
  if (tipoVaga !== 'fixa' && !pagina.horista) recusar('Esta página não tem vaga de horista no momento.', 'tipo');
  let escala: string | null = null;
  if (tipoVaga !== 'horista') {
    const ativas = ESCALAS.filter((e) => pagina.horarios[e].ativa);
    escala = um(d.escala, [...ativas, 'tanto'] as readonly string[], 'Escolha a escala.', 'escala');
  }
  let dias: string[] = [];
  if (tipoVaga !== 'fixa') dias = varios(d.dias, DIAS, 'Marque os dias em que você pode trabalhar.', 'dias');
  const obsHorarios = texto(d.obs_horarios, 200) || null;

  // 4 · experiência
  const experiencia = um(d.experiencia, ['sim', 'outra', 'primeiro'] as const, 'Responda sobre a sua experiência.', 'experiencia');
  const experiencias: ExperienciaDaFicha[] = [];
  if (experiencia !== 'primeiro') {
    const lista = Array.isArray(d.exps) ? d.exps : [];
    if (!lista.length || lista.length > 10) recusar('Conte pelo menos uma experiência (até 10).', 'exps');
    lista.forEach((x: any, i: number) => {
      const empresa = texto(x?.empresa, 120);
      const funcao = texto(x?.funcao, 80);
      if (!empresa || !funcao) recusar(`Experiência ${i + 1}: falta onde ou a função.`, 'exps');
      experiencias.push({
        tipo: 'trabalho',
        empresa,
        funcao,
        cargo: null,
        equipe: null,
        tempo: um(x?.tempo, TEMPOS, `Experiência ${i + 1}: falta por quanto tempo.`, 'exps'),
        vinculo: um(x?.vinculo, VINCULOS, `Experiência ${i + 1}: falta o vínculo (carteira ou informal).`, 'exps'),
        atual: x?.atual === true,
        descricao: texto(x?.descricao, 300) || null,
      });
    });
  }
  const liderancaMarcada = funcoes.some((c) => abertas.find((f) => f.codigo === c)?.lideranca);
  let liderou: boolean | null = null;
  if (liderancaMarcada) {
    liderou = simNao(d.liderou, 'Responda se já trabalhou como líder, supervisor(a) ou gerente.', 'liderou');
    if (liderou) {
      const lista = Array.isArray(d.lids) ? d.lids : [];
      if (!lista.length || lista.length > 10) recusar('Conte pelo menos uma experiência de liderança (até 10).', 'lids');
      lista.forEach((x: any, i: number) => {
        const empresa = texto(x?.empresa, 120);
        const descricao = texto(x?.descricao, 400);
        if (!empresa) recusar(`Liderança ${i + 1}: falta a empresa.`, 'lids');
        if (!descricao) recusar(`Liderança ${i + 1}: conte o que você fazia.`, 'lids');
        experiencias.push({
          tipo: 'lideranca',
          empresa,
          funcao: null,
          cargo: um(x?.cargo, CARGOS, `Liderança ${i + 1}: falta o cargo.`, 'lids'),
          equipe: um(x?.equipe, EQUIPES, `Liderança ${i + 1}: falta o tamanho da equipe.`, 'lids'),
          tempo: um(x?.tempo, TEMPOS, `Liderança ${i + 1}: falta por quanto tempo.`, 'lids'),
          vinculo: um(x?.vinculo, VINCULOS, `Liderança ${i + 1}: falta o vínculo (carteira ou informal).`, 'lids'),
          atual: false,
          descricao,
        });
      });
    }
  }

  // 5 · estudos e cursos
  const estuda = simNao(d.estuda, 'Responda se você ainda estuda.', 'estuda');
  const grauEstudo = estuda
    ? um(d.grau_atual, GRAU_ATUAL, 'Escolha o que você está cursando.', 'grau_atual')
    : um(d.grau_final, GRAU_FINAL, 'Escolha até onde você estudou.', 'grau_final');
  const escola = texto(d.escola, 120);
  if (!escola) recusar(estuda ? 'Escreva onde você estuda.' : 'Escreva onde você estudou por último.', 'escola');
  const turnoEstudo = estuda ? um(d.turno_estudo, TURNOS_ESTUDO, 'Escolha o turno da sua aula.', 'turno_estudo') : null;
  const cursosSituacao = um(d.cursos_sit, ['fazendo', 'fez', 'nunca'] as const, 'Responda sobre cursos.', 'cursos_sit');
  const cursos: CursoDaFicha[] = [];
  if (cursosSituacao !== 'nunca') {
    const lista = Array.isArray(d.cursos) ? d.cursos : [];
    if (!lista.length || lista.length > 10) recusar('Conte pelo menos um curso (até 10).', 'cursos');
    lista.forEach((x: any, i: number) => {
      const nomeCurso = texto(x?.nome, 80);
      const onde = texto(x?.onde, 80);
      if (!nomeCurso || !onde) recusar(`Curso ${i + 1}: falta qual curso ou onde.`, 'cursos');
      cursos.push({ nome: nomeCurso, onde, situacao: um(x?.situacao, ['fazendo', 'concluido', 'parou'] as const, `Curso ${i + 1}: falta a situação.`, 'cursos') });
    });
  }

  // 6 · onde mora e como chega
  const cep = String(d.cep ?? '').replace(/\D/g, '');
  if (!cepValido(cep)) recusar('Digite o CEP com 8 números.', 'cep');
  const numero = texto(d.numero, 10);
  if (!numero) recusar('Coloque o número da casa.', 'numero');
  const bairro = texto(d.bairro, 80);
  if (!bairro) recusar('Coloque o bairro.', 'bairro');
  const cidade = texto(d.cidade, 80);
  if (!cidade) recusar('Coloque a cidade.', 'cidade');
  const meios = varios(d.meio, MEIOS, 'Conte como você viria para o trabalho.', 'meio');
  let conducoes: number | null = null;
  if (meios.includes('publico')) {
    conducoes = Number(d.conducoes);
    if (!Number.isInteger(conducoes) || conducoes < 1 || conducoes > 4) recusar('Diga quantas conduções você pega.', 'conducoes');
  }
  let uberMotivo: string | null = null;
  let uberObs: string | null = null;
  if (meios.includes('uber')) {
    uberMotivo = um(d.uber_motivo, UBER_MOTIVOS, 'Conte por que usaria Uber.', 'uber_motivo');
    uberObs = texto(d.uber_obs, 200) || null;
    if (uberMotivo === 'outro' && !uberObs) recusar('Escreva o motivo do Uber.', 'uber_motivo');
  }
  let valorIda: number | null = null;
  let valorVolta: number | null = null;
  if (meios.includes('publico') || meios.includes('uber')) {
    valorIda = reais(d.valor_ida);
    valorVolta = reais(d.valor_volta);
    const ok = (n: number | null) => n !== null && Number.isFinite(n) && n > 0 && n <= 500;
    if (!ok(valorIda) || !ok(valorVolta)) recusar('Informe quanto gasta de condução na ida e na volta.', 'valor');
  }

  // 7 · para terminar
  const trabalhando = simNao(d.trabalhando, 'Responda se está trabalhando agora.', 'trabalhando');
  const comeca = um(d.comeca, COMECA, 'Escolha quando pode começar.', 'comeca');
  if (comeca === 'aviso' && !trabalhando) recusar('"Depois do aviso prévio" só para quem trabalha hoje.', 'comeca');
  const respostas: Record<string, string> = {};
  if (pagina.perguntas.cnh && setores.includes('delivery')) {
    respostas.cnh = um(d.cnh, ['sim', 'tirando', 'nao'] as const, 'Responda sobre a CNH.', 'cnh');
    respostas.moto = um(d.moto, ['sim', 'nao'] as const, 'Responda sobre a moto.', 'moto');
  }
  if (pagina.perguntas.feriados && d.feriados) respostas.feriados = um(d.feriados, ['sim', 'alguns', 'nao'] as const, 'Feriados: opção inválida.', 'feriados');
  if (pagina.perguntas.ja_trabalhou && d.ja_trabalhou) respostas.ja_trabalhou = um(d.ja_trabalhou, ['sim', 'nao'] as const, 'Opção inválida.', 'ja_trabalhou');
  if (pagina.perguntas.indicacao && d.indicado_por) respostas.indicado_por = texto(d.indicado_por, 80);
  if (pagina.perguntas.sobre && d.sobre) respostas.sobre = texto(d.sobre, 400);
  const origemDeclarada = d.origem_declarada ? um(d.origem_declarada, ORIGENS_DECLARADAS, 'Como ficou sabendo: opção inválida.', 'origem') : null;
  if (d.consentimento !== true) recusar('Para enviar, marque que concorda com a guarda dos dados.', 'consentimento');
  const comunicacao = d.comunicacao === true;

  return {
    nome, nascimento, idade, sexo, telefone, email, funcoes, setores, tipoVaga, escala, dias, obsHorarios,
    experiencia, liderou, experiencias, estuda, grauEstudo, escola, turnoEstudo, cursosSituacao, cursos,
    cep, rua: texto(d.rua, 120) || null, numero, complemento: texto(d.complemento, 60) || null, bairro, cidade,
    meios, conducoes, uberMotivo, uberObs, valorIda, valorVolta, trabalhando, comeca, respostas, origemDeclarada, comunicacao,
  };
}

/** A marca de origem do link (`?o=balcao`): só letras minúsculas, números e hífen; outra coisa vira nula. */
export function lerOrigem(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,29}$/.test(s) ? s : null;
}

/** Endereço público a partir do nome da loja: minúsculas, sem acento, hífen no lugar do resto. */
export function slug(nome: string): string {
  const s = String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return s.length >= 3 ? s : `vagas-${s || 'loja'}`.slice(0, 32);
}

// Sem 0/O, 1/I/L: o candidato lê o protocolo ao telefone.
const ALFABETO_PROTOCOLO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** O número que o candidato guarda (ex.: K7Q2XD — mostrado como K7Q-2XD). Único por empresa (o banco confere). */
export function gerarProtocolo(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALFABETO_PROTOCOLO[randomInt(ALFABETO_PROTOCOLO.length)];
  return s;
}

/** A situação que a tela pede: só as da lista. */
export function lerSituacao(v: unknown): Situacao {
  return um(v, SITUACOES, 'Situação inválida.', 'situacao');
}
