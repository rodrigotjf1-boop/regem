import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ehServidorLocal } from '../../common/modo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O QUE O ATENDENTE APRENDEU (F4 do atendente virtual, mig 382 — pedido do dono, 08/11/2026: "mais treinamento do nosso
// atendente virtual"; protótipo `mockups/regem-central-atendimento.html`). Em cada resposta do robô — no teste do atendente
// e nas conversas de verdade da Central —, quem é gerente ou presidente escreve como o atendente deveria ter respondido e
// escolhe o assunto: vira um item de CONHECIMENTO (pergunta → resposta), que entra nas instruções do robô de todos os canais.
//
// Uma regra só, fora dos serviços — como `perfis-do-atendente.ts` (F2) e `assuntos-do-atendente.ts` (F3): as instruções do
// robô (cardápio) e a tela (atendimento) importam daqui sem ciclo de módulo. Três partes:
//  • as ESCOLHAS (puras): os assuntos, a origem, os limites e a conferência do que a tela manda;
//  • o TEXTO (puro): a seção "O QUE A LOJA ENSINOU" das instruções — '' sem itens (as instruções ficam IGUAIS às de hoje);
//    preço, taxa, prazo e horário vêm SEMPRE das ferramentas, mesmo que a resposta ensinada traga um número;
//  • o BANCO: `atendente_conhecimento` (só na nuvem), uma linha por item (edição concorrente segura — V82), com o limite de
//    100 por empresa conferido sob a trava da empresa e cada mudança na auditoria.

const logger = new Logger('ConhecimentoDoAtendente');

/** Os assuntos, na ordem da tela e das instruções. */
export const ASSUNTOS_DO_CONHECIMENTO = ['entrega', 'pagamento', 'cardapio', 'horario', 'pedido', 'outro'] as const;
export type AssuntoDoConhecimento = (typeof ASSUNTOS_DO_CONHECIMENTO)[number];
/** Como o assunto aparece (na tela e nas instruções). */
export const NOME_DO_ASSUNTO_DO_CONHECIMENTO: Record<AssuntoDoConhecimento, string> = {
  entrega: 'Entrega',
  pagamento: 'Pagamento',
  cardapio: 'Cardápio',
  horario: 'Horário',
  pedido: 'Pedido',
  outro: 'Outros assuntos',
};
/** De onde veio a correção: o teste do atendente, um caso da Central ou escrita à mão em "O que ele aprendeu". */
export const ORIGENS_DO_CONHECIMENTO = ['teste', 'caso', 'manual'] as const;
export type OrigemDoConhecimento = (typeof ORIGENS_DO_CONHECIMENTO)[number];

/** A pergunta do cliente cabe nisto (uma linha só). */
export const PERGUNTA_MAX = 300;
/** A resposta ensinada cabe nisto. */
export const RESPOSTA_MAX = 600;
/** Quantos itens uma empresa guarda. */
export const LIMITE_DO_CONHECIMENTO = 100;
/** O teto da seção nas instruções do robô (letras): passando, ficam os itens mais novos. */
export const TETO_NAS_INSTRUCOES = 6000;
/** A 2ª chave da trava por empresa ao criar (a 1ª é a empresa; a auditoria usa 0). */
const TRAVA_DO_CONHECIMENTO = 382;

export type ItemDoConhecimento = {
  id: string;
  assunto: AssuntoDoConhecimento;
  pergunta: string;
  resposta: string;
  origem: OrigemDoConhecimento;
  criadoPorNome: string | null;
  criadoEm: string;
  atualizadoEm: string;
};

const ehAssunto = (v: unknown): v is AssuntoDoConhecimento => typeof v === 'string' && (ASSUNTOS_DO_CONHECIMENTO as readonly string[]).includes(v);
const ehOrigem = (v: unknown): v is OrigemDoConhecimento => typeof v === 'string' && (ORIGENS_DO_CONHECIMENTO as readonly string[]).includes(v);
const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Uma linha só: qualquer quebra ou sequência de espaços vira um espaço. */
const umaLinha = (t: string) => t.replace(/\s+/g, ' ').trim();
/** A resposta: as quebras de linha ficam (até 2 seguidas); espaço sobrando nas pontas sai. */
const textoDaResposta = (t: string) =>
  t
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// ───────────────────────── as escolhas (puras) ─────────────────────────

const ESCOLHA_O_ASSUNTO = 'Escolha o assunto: entrega, pagamento, cardápio, horário, pedido ou outro.';

function lerAssunto(v: unknown): AssuntoDoConhecimento {
  if (!ehAssunto(v)) throw new BadRequestException(ESCOLHA_O_ASSUNTO);
  return v;
}

function lerPergunta(v: unknown): string {
  if (typeof v !== 'string') throw new BadRequestException('Escreva a pergunta do cliente.');
  const t = umaLinha(v);
  if (!t) throw new BadRequestException('Escreva a pergunta do cliente.');
  if (t.length > PERGUNTA_MAX) throw new BadRequestException(`A pergunta do cliente: no máximo ${PERGUNTA_MAX} letras.`);
  return t;
}

function lerResposta(v: unknown): string {
  if (typeof v !== 'string') throw new BadRequestException('Escreva como o atendente deve responder.');
  const t = textoDaResposta(v);
  if (!t) throw new BadRequestException('Escreva como o atendente deve responder.');
  if (t.length > RESPOSTA_MAX) throw new BadRequestException(`Como o atendente deve responder: no máximo ${RESPOSTA_MAX} letras.`);
  return t;
}

/**
 * O item novo que a tela mandou, conferido (pura — a rota confere ANTES de gravar, V86): o assunto e a origem só da lista;
 * a pergunta numa linha só, de 1 a 300 letras; a resposta de 1 a 600. Recusa = 400, em pt-BR.
 */
export function lerNovoItem(dto: unknown): { assunto: AssuntoDoConhecimento; pergunta: string; resposta: string; origem: OrigemDoConhecimento } {
  const d = ehObjeto(dto) ? dto : {};
  const assunto = lerAssunto(d.assunto);
  const pergunta = lerPergunta(d.pergunta);
  const resposta = lerResposta(d.resposta);
  if (!ehOrigem(d.origem)) throw new BadRequestException('Diga de onde veio a correção: do teste, de um caso ou escrita à mão.');
  return { assunto, pergunta, resposta, origem: d.origem };
}

/** A mudança de um item (parcial — o que não veio fica, V16); sem nada para mudar = 400. A origem não muda. */
export function lerMudancaDoItem(dto: unknown): Partial<{ assunto: AssuntoDoConhecimento; pergunta: string; resposta: string }> {
  const d = ehObjeto(dto) ? dto : {};
  const m: Partial<{ assunto: AssuntoDoConhecimento; pergunta: string; resposta: string }> = {};
  if (d.assunto !== undefined) m.assunto = lerAssunto(d.assunto);
  if (d.pergunta !== undefined) m.pergunta = lerPergunta(d.pergunta);
  if (d.resposta !== undefined) m.resposta = lerResposta(d.resposta);
  if (!Object.keys(m).length) throw new BadRequestException('Mande o que muda: o assunto, a pergunta ou a resposta.');
  return m;
}

// ───────────────────────── o texto das instruções (puro) ─────────────────────────

/** Como a seção começa (os testes e as instruções reconhecem por ela). */
export const TITULO_DO_CONHECIMENTO = 'O QUE A LOJA ENSINOU (respostas corrigidas pela equipe)';

/** A regra dos números — a resposta ensinada dá o JEITO de responder, nunca o valor (a tela promete isto: V39). */
export const REGRA_DOS_NUMEROS =
  '- Preço, taxa, prazo e horário vêm SEMPRE das ferramentas (o cadastro da loja), mesmo que a resposta ensinada traga um valor: a resposta ensinada dá o jeito de responder, não o número. Se um número daqui for diferente do que a ferramenta trouxer, vale o da ferramenta.';

const CABECA_DO_CONHECIMENTO = [
  TITULO_DO_CONHECIMENTO,
  '- Quando a pergunta do cliente combinar com uma destas, responda como a loja ensinou: pode ajustar as palavras ao que o cliente disse e ao seu jeito de conversar, sem mudar o sentido.',
  REGRA_DOS_NUMEROS,
  '- O resto destas instruções continua valendo (cliente chateado, quando chamar uma pessoa, os únicos links que você pode mandar).',
];

/** Um item como entra nas instruções: a pergunta e a resposta em uma linha cada (sem linha em branco no meio da seção). */
const linhasDoItem = (i: Pick<ItemDoConhecimento, 'pergunta' | 'resposta'>) => [`- Cliente: ${umaLinha(i.pergunta)}`, `  Responda: ${umaLinha(i.resposta)}`];

/**
 * A seção "O QUE A LOJA ENSINOU" das instruções do robô (todos os canais). Sem itens → '' — as instruções ficam exatamente
 * as de hoje. Agrupada por assunto (a ordem da tela), cada grupo na ordem em que a loja ensinou. Passando de
 * `TETO_NAS_INSTRUCOES` letras, entram os itens MAIS NOVOS que couberem (o mais velho sai primeiro).
 */
export function blocoDoConhecimento(itens: ReadonlyArray<Pick<ItemDoConhecimento, 'assunto' | 'pergunta' | 'resposta' | 'criadoEm'>> | null | undefined): string {
  const validos = (itens ?? []).filter((i) => ehAssunto(i?.assunto) && umaLinha(String(i?.pergunta ?? '')) && umaLinha(String(i?.resposta ?? '')));
  if (!validos.length) return '';
  const tempo = (i: { criadoEm: string }) => new Date(i.criadoEm).getTime() || 0;
  // Os mais novos primeiro, até o teto (o cabeçalho e o título de cada assunto contam).
  let tamanho = CABECA_DO_CONHECIMENTO.join('\n').length;
  const comTitulo = new Set<AssuntoDoConhecimento>();
  const escolhidos: typeof validos = [];
  for (const i of [...validos].sort((a, b) => tempo(b) - tempo(a))) {
    const extra = linhasDoItem(i).join('\n').length + 1 + (comTitulo.has(i.assunto) ? 0 : NOME_DO_ASSUNTO_DO_CONHECIMENTO[i.assunto].length + 1);
    if (tamanho + extra > TETO_NAS_INSTRUCOES) break; // daqui para trás, só os mais velhos: param aqui
    tamanho += extra;
    comTitulo.add(i.assunto);
    escolhidos.push(i);
  }
  if (!escolhidos.length) return '';
  // As instruções saem a cada conversa: o corte pelo teto é esperado (não é erro) — só na depuração.
  if (escolhidos.length < validos.length)
    logger.debug(`conhecimento do atendente: ${validos.length - escolhidos.length} item(ns) mais velho(s) fora das instruções (teto de ${TETO_NAS_INSTRUCOES} letras)`);
  const linhas = [...CABECA_DO_CONHECIMENTO];
  for (const assunto of ASSUNTOS_DO_CONHECIMENTO) {
    const doAssunto = escolhidos.filter((i) => i.assunto === assunto).sort((a, b) => tempo(a) - tempo(b));
    if (!doAssunto.length) continue;
    linhas.push(NOME_DO_ASSUNTO_DO_CONHECIMENTO[assunto].toUpperCase());
    for (const i of doAssunto) linhas.push(...linhasDoItem(i));
  }
  return linhas.join('\n');
}

// ───────────────────────── o banco ─────────────────────────

const linhasDe = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

const COLUNAS = sql`id, assunto, pergunta, resposta, origem, criado_por_nome as "criadoPorNome", criado_em as "criadoEm", atualizado_em as "atualizadoEm"`;

function itemDaLinha(l: any): ItemDoConhecimento {
  return {
    id: String(l.id),
    assunto: l.assunto,
    pergunta: l.pergunta,
    resposta: l.resposta,
    origem: l.origem,
    criadoPorNome: l.criadoPorNome ?? null,
    criadoEm: iso(l.criadoEm),
    atualizadoEm: iso(l.atualizadoEm),
  };
}

/** A ordem da lista: o assunto (na ordem da tela) e, dentro dele, a ordem em que a loja ensinou. */
const ORDEM = sql`array_position(array['entrega', 'pagamento', 'cardapio', 'horario', 'pedido', 'outro']::text[], assunto), criado_em, id`;

/** Os itens da empresa, na ordem da tela (assunto, depois quando a loja ensinou). */
export async function itensDaEmpresa(db: any, tenantId: string): Promise<ItemDoConhecimento[]> {
  const r = await db.execute(sql`
    select ${COLUNAS} from atendente_conhecimento where tenant_id = ${tenantId}::uuid order by ${ORDEM} limit ${LIMITE_DO_CONHECIMENTO + 50}`);
  return linhasDe(r).map(itemDaLinha);
}

/**
 * Os itens da empresa para as instruções do robô. Num banco sem a 382 (ou no servidor da loja — V1): nenhum — as
 * instruções de hoje. Lido sem derrubar transação (a tabela é conferida antes).
 */
export async function itensParaAsInstrucoes(db: any, tenantId: string): Promise<ItemDoConhecimento[]> {
  if (ehServidorLocal() || !tenantId) return [];
  const [tem] = linhasDe(await db.execute(sql`select to_regclass(current_schema() || '.atendente_conhecimento') is not null as tem`));
  if (!tem?.tem) return [];
  return itensDaEmpresa(db, tenantId);
}

/** Quem mexe (para a gravação e a auditoria). */
export type QuemEnsina = { tenantId: string; colaboradorId: string; categoria?: string | null; nome?: string | null };
/** Uma linha de auditoria — o `AuditoriaService.registrar` (opcional: os testes montam sem ele). */
export type RegistrarAuditoria = (e: Record<string, unknown>) => Promise<unknown> | unknown;

const auditoria = (quem: QuemEnsina, acao: string, id: string, detalhe: Record<string, unknown>) => ({
  tenantId: quem.tenantId,
  atorId: quem.colaboradorId,
  atorPerfil: quem.categoria,
  tipo: 'config',
  acao,
  entidadeTipo: 'atendente_conhecimento',
  entidadeId: id,
  detalhe,
});

/**
 * Cria um item. Toda recusa vem ANTES de gravar (V86): a conferência (400) e o limite de 100 por empresa (409
 * `LIMITE_CONHECIMENTO`), contado sob a trava da empresa — dois "Salvar" ao mesmo tempo não passam do limite. Na auditoria:
 * `atendente_conhecimento_criado` com o assunto, a pergunta, a resposta e a origem.
 */
export async function criarItem(db: any, quem: QuemEnsina, dto: unknown, registrar?: RegistrarAuditoria): Promise<ItemDoConhecimento> {
  const novo = lerNovoItem(dto);
  const item = await db.transaction(async (tx: any) => {
    // A trava da TRANSAÇÃO por empresa (a técnica da auditoria — V24; nunca a da sessão com pool, V10): o segundo "Salvar"
    // espera o primeiro gravar e conta o item dele.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${quem.tenantId}::text), ${TRAVA_DO_CONHECIMENTO}::int)`);
    const [{ n }] = linhasDe(await tx.execute(sql`select count(*)::int as n from atendente_conhecimento where tenant_id = ${quem.tenantId}::uuid`));
    if (n >= LIMITE_DO_CONHECIMENTO)
      throw new ConflictException({
        statusCode: 409,
        code: 'LIMITE_CONHECIMENTO',
        message: `O atendente já guarda ${LIMITE_DO_CONHECIMENTO} respostas ensinadas. Apague ou junte algumas em "O que ele aprendeu" antes de ensinar outra.`,
      });
    const [l] = linhasDe(
      await tx.execute(sql`
        insert into atendente_conhecimento (tenant_id, assunto, pergunta, resposta, origem, criado_por, criado_por_nome)
        values (${quem.tenantId}::uuid, ${novo.assunto}, ${novo.pergunta}, ${novo.resposta}, ${novo.origem},
                ${UUID_RE.test(String(quem.colaboradorId ?? '')) ? quem.colaboradorId : null}::uuid, ${quem.nome ?? null})
        returning ${COLUNAS}`),
    );
    return itemDaLinha(l);
  });
  await registrar?.(auditoria(quem, 'atendente_conhecimento_criado', item.id, { assunto: item.assunto, pergunta: item.pergunta, resposta: item.resposta, origem: item.origem }));
  return item;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const naoAchei = () => new NotFoundException('Resposta ensinada não encontrada.');

/**
 * Edita um item da empresa (parcial: só o que veio — o assunto, a pergunta e/ou a resposta). Item de outra empresa (ou que
 * não existe) = 404; a conferência vem antes (400). Grava SÓ os campos que mudaram (dois editando campos diferentes não se
 * desfazem). Na auditoria: `atendente_conhecimento_alterado` com cada campo de → para.
 */
export async function editarItem(db: any, quem: QuemEnsina, id: string, dto: unknown, registrar?: RegistrarAuditoria): Promise<ItemDoConhecimento> {
  if (!UUID_RE.test(String(id ?? ''))) throw naoAchei();
  const m = lerMudancaDoItem(dto);
  const [antes] = linhasDe(await db.execute(sql`select ${COLUNAS} from atendente_conhecimento where tenant_id = ${quem.tenantId}::uuid and id = ${id}::uuid`));
  if (!antes) throw naoAchei();
  const mudou = (Object.keys(m) as Array<keyof typeof m>).filter((k) => m[k] !== antes[k]);
  if (!mudou.length) return itemDaLinha(antes);
  const sets = sql.join(
    mudou.map((k) => sql`${sql.raw(k)} = ${m[k] as string}`),
    sql`, `,
  );
  const [l] = linhasDe(
    await db.execute(sql`
      update atendente_conhecimento set ${sets}, atualizado_em = clock_timestamp()
       where tenant_id = ${quem.tenantId}::uuid and id = ${id}::uuid
       returning ${COLUNAS}`),
  );
  if (!l) throw naoAchei(); // apagado entre a leitura e a gravação
  await registrar?.(auditoria(quem, 'atendente_conhecimento_alterado', id, { mudancas: mudou.map((k) => ({ campo: k, de: antes[k], para: m[k] })) }));
  return itemDaLinha(l);
}

/** Apaga um item da empresa (de outra empresa = 404). Na auditoria: `atendente_conhecimento_apagado` com o que era. */
export async function apagarItem(db: any, quem: QuemEnsina, id: string, registrar?: RegistrarAuditoria): Promise<{ ok: true }> {
  if (!UUID_RE.test(String(id ?? ''))) throw naoAchei();
  const [l] = linhasDe(
    await db.execute(sql`delete from atendente_conhecimento where tenant_id = ${quem.tenantId}::uuid and id = ${id}::uuid returning ${COLUNAS}`),
  );
  if (!l) throw naoAchei();
  await registrar?.(auditoria(quem, 'atendente_conhecimento_apagado', id, { assunto: l.assunto, pergunta: l.pergunta, resposta: l.resposta, origem: l.origem }));
  return { ok: true };
}
