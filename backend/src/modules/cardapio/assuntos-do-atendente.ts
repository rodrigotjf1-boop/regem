import { BadRequestException, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { ehServidorLocal } from '../../common/modo';
import type { ResumoDoRobo } from '../atendimento/resumo-do-robo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS ASSUNTOS QUE NÃO SÃO PEDIDO (F3 do atendente virtual, mig 381 — pedido do dono, 07/11/2026: "no Direct vêm dúvidas de
// pedido, mas também temas mais complexos: fornecedores tentando contato com o responsável, pessoas perguntando sobre
// emprego — a ideia é o nosso atendimento virtual administrar isso"; protótipo `mockups/regem-central-atendimento.html`,
// versão 12, grupo "Assuntos que não são pedido" e os casos `rr1`/`rr2`).
//
// Uma regra só, fora dos serviços — como `perfis-do-atendente.ts` (F2) e `atendimento/horario-da-equipe.ts` (F1): as
// instruções do robô (cardápio), os ajustes e a fila (atendimento), o caso do WhatsApp (`abrir-chamado.ts`), o do Direct
// (instagram), a pausa do robô (whatsapp) e a ponte do chat importam daqui sem ciclo de módulo. Quatro partes:
//  • as ESCOLHAS (puras): os assuntos, o que o robô faz em cada um (Como hoje · Deixa recado para o responsável · Responde
//    que não é por aqui) e o que ele diz no fim; a conferência do que a tela manda e a leitura tolerante do banco;
//  • o TEXTO (puro): a seção que entra nas instruções do robô — '' com tudo em "Como hoje" (as instruções ficam IGUAIS);
//  • o RECADO PARA O RESPONSÁVEL no caso: `detalhe.responsavel = { assunto, em }` (sem mexer na estrutura de
//    `atendimento_chamado`, que sincroniza). Esse caso NÃO entra na fila da equipe nem no tempo de espera, NÃO toca, NÃO
//    avisa o gerente e NÃO cala o robô; só gerente e presidente o veem (situação 'responsavel' da fila). Não depende do
//    horário da equipe (não é o recado da abertura da F1);
//  • o BANCO: `robo_config.atendente_assuntos` (só na nuvem), lido sem derrubar transação e gravado campo a campo (V82).

const logger = new Logger('AssuntosDoAtendente');

/** Os assuntos que não são pedido, na ordem da tela. */
export const ASSUNTOS_DO_ATENDENTE = ['fornecedor', 'vaga', 'parceria'] as const;
export type AssuntoDoAtendente = (typeof ASSUNTOS_DO_ATENDENTE)[number];
/** O que o robô faz: `hoje` = "Como hoje: chama a equipe" (o padrão); `recado` = deixa recado para o responsável; `nao` =
 * responde que não é por aqui (sem chamar ninguém). */
export const MODOS_DO_ASSUNTO = ['hoje', 'recado', 'nao'] as const;
export type ModoDoAssunto = (typeof MODOS_DO_ASSUNTO)[number];
/** O que o robô diz cabe nisto (uma linha só). */
export const TEXTO_DO_ASSUNTO_MAX = 300;

export type AjusteDoAssunto = { modo: ModoDoAssunto; texto: string | null };
export type AssuntosDoAtendente = Record<AssuntoDoAtendente, AjusteDoAssunto>;
/** Nasce em "Como hoje", sem texto: NADA muda até a loja escolher (versão 12). */
export const AJUSTE_DO_ASSUNTO_PADRAO: AjusteDoAssunto = { modo: 'hoje', texto: null };
export const assuntosPadrao = (): AssuntosDoAtendente => ({
  fornecedor: { ...AJUSTE_DO_ASSUNTO_PADRAO },
  vaga: { ...AJUSTE_DO_ASSUNTO_PADRAO },
  parceria: { ...AJUSTE_DO_ASSUNTO_PADRAO },
});

/** Como o assunto aparece nas mensagens de recusa. */
export const NOME_DO_ASSUNTO: Record<AssuntoDoAtendente, string> = { fornecedor: 'Fornecedor', vaga: 'Vaga de emprego', parceria: 'Parceria' };

/** O que o robô diz ao deixar o recado, quando a loja não escreveu o dela. */
export const TEXTO_PADRAO_DO_RECADO: Record<AssuntoDoAtendente, string> = {
  fornecedor: 'Obrigado pelo contato! Já passei a sua proposta ao responsável. Se houver interesse, ele fala com você por aqui.',
  vaga: 'Que bom que você quer trabalhar com a gente! Deixei o seu contato com o responsável. Quando abrir uma vaga, ele fala com você.',
  parceria: 'Obrigado pelo interesse! Já passei ao responsável, que responde por aqui.',
};
/** O que o robô diz em "Responde que não é por aqui" (qualquer assunto), quando a loja não escreveu o dela. */
export const TEXTO_PADRAO_NAO = 'Obrigado pelo contato! Esse assunto não é tratado por aqui.';

const ehAssunto = (v: unknown): v is AssuntoDoAtendente => typeof v === 'string' && (ASSUNTOS_DO_ATENDENTE as readonly string[]).includes(v);
const ehModo = (v: unknown): v is ModoDoAssunto => typeof v === 'string' && (MODOS_DO_ASSUNTO as readonly string[]).includes(v);
const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Uma linha só: qualquer quebra ou sequência de espaços vira um espaço. */
const umaLinha = (t: string) => t.replace(/\s+/g, ' ').trim();

// ───────────────────────── as escolhas (puras) ─────────────────────────

/**
 * O que a tela mandou para "Assuntos que não são pedido", conferido — por assunto e campo, parcial (V16: o que não veio
 * fica). Pura: a rota confere ANTES de gravar qualquer grupo dos ajustes (V86). Texto vazio = o padrão (null); com quebra
 * de linha, uma linha só. Assunto desconhecido, modo fora da lista ou texto longo = recusa (400), em pt-BR.
 */
export function lerAssuntosDoAtendente(dto: unknown): Partial<Record<AssuntoDoAtendente, Partial<AjusteDoAssunto>>> {
  if (dto === undefined || dto === null) return {};
  if (!ehObjeto(dto)) throw new BadRequestException('Assuntos que não são pedido: mande o que o robô faz em cada assunto.');
  const parcial: Partial<Record<AssuntoDoAtendente, Partial<AjusteDoAssunto>>> = {};
  for (const [assunto, valor] of Object.entries(dto)) {
    if (!ehAssunto(assunto))
      throw new BadRequestException(
        `Assuntos que não são pedido: o assunto "${String(assunto).slice(0, 40)}" não existe (só fornecedor, vaga de emprego e parceria).`,
      );
    if (valor === undefined) continue;
    const nome = NOME_DO_ASSUNTO[assunto];
    if (!ehObjeto(valor)) throw new BadRequestException(`${nome}: mande o que o robô faz e o que ele diz.`);
    const a: Partial<AjusteDoAssunto> = {};
    if (valor.modo !== undefined) {
      if (!ehModo(valor.modo))
        throw new BadRequestException(`${nome}: escolha "Como hoje", "Deixa recado para o responsável" ou "Responde que não é por aqui".`);
      a.modo = valor.modo;
    }
    if (valor.texto !== undefined) {
      if (valor.texto !== null && typeof valor.texto !== 'string')
        throw new BadRequestException(`${nome}: escreva o que o robô diz (ou deixe vazio para usar o padrão).`);
      const t = typeof valor.texto === 'string' ? umaLinha(valor.texto) : '';
      if (t.length > TEXTO_DO_ASSUNTO_MAX) throw new BadRequestException(`${nome}: no máximo ${TEXTO_DO_ASSUNTO_MAX} letras.`);
      a.texto = t || null;
    }
    parcial[assunto] = a;
  }
  return parcial;
}

/** O texto que veio do banco: uma linha, até 300 letras (sem cortar um emoji ao meio); vazio ou não texto = null. */
function textoDaLinha(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = umaLinha(v).slice(0, TEXTO_DO_ASSUNTO_MAX).replace(/[\uD800-\uDBFF]$/, '').trim();
  return t || null;
}

/** Um assunto como veio do banco, com os padrões no que faltar ou vier fora da lista. */
function assuntoDaLinha(v: unknown): AjusteDoAssunto {
  const o = ehObjeto(v) ? v : {};
  return { modo: ehModo(o.modo) ? o.modo : AJUSTE_DO_ASSUNTO_PADRAO.modo, texto: textoDaLinha(o.texto) };
}

/**
 * Os assuntos de uma linha do banco (`robo_config.atendente_assuntos`, ou o texto JSON dela): sempre os três, com os
 * padrões no que faltar; valor estranho (lixo no jsonb, chave a mais, tipo errado) → o padrão daquele campo.
 */
export function assuntosDaLinha(v: unknown): AssuntosDoAtendente {
  let o: unknown = v;
  if (typeof o === 'string') {
    try {
      o = JSON.parse(o);
    } catch {
      o = null;
    }
  }
  const linha = ehObjeto(o) ? o : {};
  return { fornecedor: assuntoDaLinha(linha.fornecedor), vaga: assuntoDaLinha(linha.vaga), parceria: assuntoDaLinha(linha.parceria) };
}

/**
 * O que o robô diz ao cliente no assunto: com recado, o texto da loja ou o padrão do assunto; em "não é por aqui", o texto
 * da loja ou o padrão de "não é por aqui"; em "Como hoje", nada (null — o robô segue as instruções de sempre).
 */
export function textoDoAssunto(assuntos: unknown, assunto: AssuntoDoAtendente): string | null {
  const a = assuntoDaLinha(ehObjeto(assuntos) ? assuntos[assunto] : undefined);
  if (a.modo === 'recado') return a.texto ?? TEXTO_PADRAO_DO_RECADO[assunto];
  if (a.modo === 'nao') return a.texto ?? TEXTO_PADRAO_NAO;
  return null;
}

/** O `tipo` que o robô mandou no "chamar atendente" é um assunto em "recado" na empresa? Então o assunto; senão null. */
export function assuntoEmRecado(assuntos: unknown, tipo: unknown): AssuntoDoAtendente | null {
  if (!ehAssunto(tipo)) return null;
  return assuntoDaLinha(ehObjeto(assuntos) ? assuntos[tipo] : undefined).modo === 'recado' ? tipo : null;
}

// ───────────────────────── o texto das instruções (puro) ─────────────────────────

/** Como cada assunto aparece nas instruções do robô (o que reconhecer). */
const ASSUNTO_NAS_INSTRUCOES: Record<AssuntoDoAtendente, string> = {
  fornecedor: 'FORNECEDOR OU PROPOSTA COMERCIAL (quer vender produto, serviço ou embalagem para a loja, ou falar com quem compra)',
  vaga: 'VAGA DE EMPREGO (quer trabalhar na loja, pergunta se estão contratando ou quer mandar currículo)',
  parceria: 'PARCERIA, INFLUENCIADOR OU IMPRENSA (divulgação, evento, permuta ou reportagem)',
};

/** Onde o robô fala: no WhatsApp o contato é o próprio número da conversa; no Direct, o robô pergunta. */
export type CanalDosAssuntos = 'whatsapp' | 'direct';

/** Como a seção começa (os testes e as instruções reconhecem por ela). */
export const TITULO_DOS_ASSUNTOS = 'ASSUNTOS QUE NÃO SÃO PEDIDO (escolhidos pela loja)';

/**
 * A seção "ASSUNTOS QUE NÃO SÃO PEDIDO" das instruções do robô, para o canal. Com todos os assuntos em "Como hoje" → '' —
 * as instruções ficam exatamente as de hoje. Cada assunto em "recado" ensina a deixar o recado (pergunta o mínimo, uma
 * por vez; nunca promete; `chamar_atendente` com `tipo` = o assunto e a mensagem em "Assunto / Quem / Contato / Já fiz";
 * responde com o `paraOCliente` que voltar, sem "em instantes" nem posição, e segue a conversa). Cada assunto em "nao"
 * manda responder com educação o texto da loja (ou o padrão) e não chamar ninguém. "Como hoje" não é citado.
 */
export function blocoDasInstrucoes(assuntos: unknown, canal: CanalDosAssuntos): string {
  const a = assuntosDaLinha(assuntos);
  const comRecado = ASSUNTOS_DO_ATENDENTE.filter((x) => a[x].modo === 'recado');
  const naoEPorAqui = ASSUNTOS_DO_ATENDENTE.filter((x) => a[x].modo === 'nao');
  if (!comRecado.length && !naoEPorAqui.length) return '';
  const linhas: string[] = [
    TITULO_DOS_ASSUNTOS,
    '- Às vezes quem escreve não quer pedir nada: é um fornecedor, alguém procurando emprego ou uma proposta de parceria. Nos assuntos abaixo, faça o que a loja escolheu (isso vale no lugar da regra 7 de REGRAS QUE NUNCA MUDAM). Reconheça o assunto pelo que a pessoa diz; na dúvida, pergunte em uma frase o que ela precisa.',
  ];
  for (const x of ASSUNTOS_DO_ATENDENTE) {
    if (a[x].modo === 'recado') linhas.push(`- ${ASSUNTO_NAS_INSTRUCOES[x]}: deixe um RECADO PARA O RESPONSÁVEL (tipo = ${x}; veja como abaixo).`);
    else if (a[x].modo === 'nao')
      linhas.push(
        `- ${ASSUNTO_NAS_INSTRUCOES[x]}: não é tratado por aqui. Responda com educação, exatamente: "${textoDoAssunto(a, x)}" Não chame ninguém (não use chamar_atendente) e não peça dados.`,
      );
  }
  if (comRecado.length) {
    const contatoPergunta =
      canal === 'direct'
        ? 'e o melhor contato para o responsável falar com ela (telefone ou e-mail — aqui pode pedir, porque é para o responsável responder, não para consultar nada; se ela preferir, pode ser por aqui no Direct)'
        : 'e não peça telefone: o contato é este número do WhatsApp (se a pessoa der outro, anote)';
    const contatoLinha = canal === 'direct' ? 'o contato que a pessoa deu (ou "por aqui no Direct")' : 'este WhatsApp (e o outro contato, se a pessoa deu)';
    const tipos = comRecado.join(', ');
    linhas.push(
      '- RECADO PARA O RESPONSÁVEL, passo a passo:',
      `  1. Pergunte só o mínimo, UMA pergunta por vez, e só o que a pessoa ainda não disse: o nome; a empresa (fornecedor ou parceria) ou a função que ela quer (vaga); o assunto, em uma frase; ${contatoPergunta}.`,
      '  2. Nunca prometa vaga, entrevista, compra, parceria, prazo nem resposta.',
      `  3. Com as respostas, use chamar_atendente com tipo = o do assunto (${tipos}) e, no campo mensagem, o resumo em linhas curtas, exatamente assim:`,
      '     Assunto: o assunto, em poucas palavras (ex.: "Vaga: atendente de balcão")',
      '     Quem: o nome (e a empresa, o perfil ou o veículo)',
      `     Contato: ${contatoLinha}`,
      '     Já fiz: o que você já disse a ela',
      '     Uma linha para cada. Não use urgente: isso não é cliente chateado.',
      '  4. A resposta de chamar_atendente traz paraOResponsavel = true e paraOCliente: mande à pessoa o texto de paraOCliente exatamente como veio. NÃO diga "em instantes", não diga posição na fila e não diga que alguém da equipe vai responder agora. Depois, continue a conversa normalmente (você segue respondendo) e não chame de novo pelo mesmo assunto.',
    );
  }
  return linhas.join('\n');
}

// ───────────────────────── o recado para o responsável (no caso) ─────────────────────────

/** A marca do recado em `atendimento_chamado.detalhe.responsavel`: o assunto e quando o robô deixou. */
export type RecadoParaOResponsavel = { assunto: AssuntoDoAtendente; em: string };

/** O recado para o responsável gravado no caso (mesmo depois de alguém pegar), ou null. */
export function lerResponsavel(detalhe: unknown): RecadoParaOResponsavel | null {
  const r = (detalhe as any)?.responsavel;
  if (!ehObjeto(r) || !ehAssunto(r.assunto) || typeof r.em !== 'string' || Number.isNaN(new Date(r.em).getTime())) return null;
  return { assunto: r.assunto, em: r.em };
}

/** O recado para o responsável esperando alguém (aberto, sem ninguém com ele, sem aguardar o cliente). */
export function responsavelNaEspera(c: { status?: string | null; responsavelId?: string | null; aguardandoDesde?: unknown; detalhe?: unknown }): boolean {
  return (c.status ?? 'aberto') === 'aberto' && !c.responsavelId && !c.aguardandoDesde && !!lerResponsavel(c.detalhe);
}

const ALIAS = /^[a-z_][a-z0-9_]*$/i;
const alias = (a: string) => {
  if (!ALIAS.test(a)) throw new Error(`apelido de tabela inválido: ${a}`);
  return a;
};

/** SQL: o caso `a` (de `atendimento_chamado`) é um recado para o responsável (tem a marca, com ou sem alguém com ele). */
export const paraOResponsavelSql = (a: string): SQL => sql.raw(`((${alias(a)}.detalhe -> 'responsavel') is not null)`);

/**
 * SQL: o recado para o responsável ESPERANDO (sem ninguém com ele, sem aguardar o cliente) — a situação 'responsavel' da
 * fila. É ele que não entra na fila da equipe, não conta, não toca, não avisa e não cala o robô. Quem pegou o caso o tem
 * como um caso comum "com alguém".
 */
export const responsavelNaEsperaSql = (a: string): SQL =>
  sql.raw(`((${alias(a)}.detalhe -> 'responsavel') is not null and ${alias(a)}.responsavel_id is null and ${alias(a)}.aguardando_desde is null)`);

/**
 * SQL (para quem NÃO é gerente nem presidente): o caso que só a gestão vê — um recado para o responsável que não está com
 * esta pessoa. `eu` = o colaborador de quem pediu (o caso que passaram para ele continua dele).
 */
export const soDaGestaoSql = (a: string, eu: string | null | undefined): SQL =>
  sql`(${paraOResponsavelSql(a)} and ${sql.raw(`${alias(a)}.responsavel_id`)} is distinct from ${eu ?? null}::uuid)`;

/** O que o resumo do recado traz além do resumo comum (as linhas "Assunto / Quem / Contato / Já fiz"). */
export type ResumoDoRecado = { assunto?: string; quem?: string; contato?: string; jaFez?: string };

const LIMITE_DO_RESUMO = 300;
const textoDoResumo = (v: string): string | null => {
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, LIMITE_DO_RESUMO) : null;
};
const chaveDoRotulo = (r: string): keyof ResumoDoRecado => {
  const x = r.toLowerCase();
  if (x.startsWith('assunto')) return 'assunto';
  if (x.startsWith('quem')) return 'quem';
  if (x.startsWith('contato')) return 'contato';
  return 'jaFez';
};

/**
 * As linhas "Assunto: … / Quem: … / Contato: … / Já fiz: …" de dentro da mensagem do recado — uma por linha ou todas numa
 * linha só. O valor vai até o próximo rótulo; repetido, vale o primeiro. (O Direct troca a `mensagem` do caso pela última
 * fala do cliente: o resumo precisa morar no `detalhe`.)
 */
export function resumoDoRecado(mensagem: unknown): ResumoDoRecado {
  const s = String(mensagem ?? '');
  const re = /(^|[\s;.|/•*-])(assunto|quem|contato|o rob[oô] j[aá] fez|j[aá] fiz|j[aá] fez)\s*:/gi;
  const achados: Array<{ chave: keyof ResumoDoRecado; inicio: number; valor: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) achados.push({ chave: chaveDoRotulo(m[2]), inicio: m.index + m[1].length, valor: re.lastIndex });
  const r: ResumoDoRecado = {};
  achados.forEach((x, i) => {
    const fim = i + 1 < achados.length ? achados[i + 1].inicio : s.length;
    const v = textoDoResumo(s.slice(x.valor, fim).replace(/[\s;.|/•*-]+$/, ''));
    if (v && !r[x.chave]) r[x.chave] = v;
  });
  return r;
}

/**
 * O resumo do robô (`detalhe.robo`) de um recado para o responsável: o resumo comum (motivo, quer, já fiz, humor) com as
 * linhas do recado por cima (assunto, quem, contato e o "já fiz" delas). Sem nada em nenhum dos dois: null.
 */
export function resumoComORecado(
  resumo: ResumoDoRobo | null | undefined,
  mensagem: unknown,
): (ResumoDoRobo & Omit<ResumoDoRecado, 'jaFez'>) | null {
  const doRecado = resumoDoRecado(mensagem);
  if (!resumo && !Object.keys(doRecado).length) return null;
  const base: ResumoDoRobo = resumo ?? { motivo: null, quer: null, jaFez: null, humor: null };
  return { ...base, ...doRecado, jaFez: doRecado.jaFez ?? base.jaFez ?? null };
}

/** O que a resposta do "chamar atendente" leva quando o caso é um recado para o responsável (o robô manda `paraOCliente`). */
export type RespostaParaOResponsavel = {
  ok: true;
  id: string;
  prioridade: 'normal';
  paraOResponsavel: true;
  assunto: AssuntoDoAtendente;
  paraOCliente: string;
  posicao: null;
  comAlguem: false;
  jaAberto?: true;
};

export function respostaParaOResponsavel(id: string, aceito: RecadoAceito, jaAberto = false): RespostaParaOResponsavel {
  return {
    ok: true,
    id,
    prioridade: 'normal',
    paraOResponsavel: true,
    assunto: aceito.assunto,
    paraOCliente: aceito.paraOCliente,
    posicao: null,
    comAlguem: false,
    ...(jaAberto ? { jaAberto: true as const } : {}),
  };
}

// ───────────────────────── o banco ─────────────────────────

const linhasDe = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

/**
 * Os assuntos da empresa (`robo_config.atendente_assuntos`, só na nuvem). Lido pelo `to_jsonb` da linha, nunca pelo nome
 * da coluna: num banco sem a 381 (ou sem a `robo_config`) a leitura não falha — e não derruba a TRANSAÇÃO de quem chama.
 * Sem tabela, sem linha ou no servidor da loja (V1): os padrões ("Como hoje").
 */
export async function assuntosDaEmpresa(db: any, tenantId: string): Promise<AssuntosDoAtendente> {
  if (ehServidorLocal() || !tenantId) return assuntosPadrao();
  const [tem] = linhasDe(await db.execute(sql`select to_regclass(current_schema() || '.robo_config') is not null as tem`));
  if (!tem?.tem) return assuntosPadrao();
  const [l] = linhasDe(
    await db.execute(sql`select to_jsonb(rc) -> 'atendente_assuntos' as assuntos from robo_config rc where rc.tenant_id = ${tenantId}::uuid`),
  );
  return assuntosDaLinha(l?.assuntos);
}

/** O recado que o "chamar atendente" pode deixar: o assunto (em "recado" na empresa) e o que o robô diz ao cliente. */
export type RecadoAceito = { assunto: AssuntoDoAtendente; paraOCliente: string };

/**
 * O `tipo` do "chamar atendente" vira RECADO PARA O RESPONSÁVEL? Só quando é um dos assuntos e ele está em "recado" na
 * empresa; senão null (vale o tipo de hoje — o caso comum). Só lê o banco quando o tipo é um dos assuntos. Nunca rejeita:
 * falha de leitura = null (o caso comum, como hoje), com o motivo no log.
 */
export async function recadoParaOResponsavel(db: any, tenantId: string, tipo: unknown): Promise<RecadoAceito | null> {
  if (!ehAssunto(tipo)) return null;
  try {
    const assuntos = await assuntosDaEmpresa(db, tenantId);
    const assunto = assuntoEmRecado(assuntos, tipo);
    return assunto ? { assunto, paraOCliente: textoDoAssunto(assuntos, assunto) as string } : null;
  } catch (e: any) {
    logger.warn(`assuntos do atendente não lidos (empresa ${tenantId}; vale o caso comum): ${e?.message ?? e}`);
    return null;
  }
}

/** Quem salva (para a gravação e a auditoria). */
export type QuemSalvaAssuntos = { tenantId: string; colaboradorId: string; categoria?: string | null };
/** Uma linha de auditoria — o `AuditoriaService.registrar` (opcional: os testes montam sem ele). */
export type RegistrarAuditoria = (e: Record<string, unknown>) => Promise<unknown> | unknown;

/**
 * Salva o que veio de "Assuntos que não são pedido" (V16: ausente mantém; cada escolha só entre as opções). Grava SÓ os
 * campos que MUDARAM de cada assunto, mesclando dentro do jsonb no banco (`atendente_assuntos || …` e, dentro do assunto,
 * `assunto || {campos}`): dois salvamentos ao mesmo tempo — de assuntos ou de campos diferentes — não desfazem um ao outro,
 * e as outras colunas da `robo_config` (de outros donos) não são tocadas (V82). Cada mudança fica na auditoria
 * (`atendente_assunto_alterado` com assunto, campo, de e para). Devolve os assuntos como ficaram.
 */
export async function salvarAssuntosDoAtendente(
  db: any,
  quem: QuemSalvaAssuntos,
  dto: unknown,
  registrar?: RegistrarAuditoria,
): Promise<AssuntosDoAtendente> {
  const parcial = lerAssuntosDoAtendente(dto);
  const antes = await assuntosDaEmpresa(db, quem.tenantId);
  const campos = ['modo', 'texto'] as const;
  const mudancas: Array<{ assunto: AssuntoDoAtendente; campo: (typeof campos)[number]; de: unknown; para: unknown }> = [];
  const porAssunto = new Map<AssuntoDoAtendente, Partial<AjusteDoAssunto>>();
  for (const assunto of ASSUNTOS_DO_ATENDENTE) {
    const p = parcial[assunto];
    if (!p) continue;
    for (const campo of campos) {
      if (p[campo] === undefined || p[campo] === antes[assunto][campo]) continue;
      mudancas.push({ assunto, campo, de: antes[assunto][campo], para: p[campo] });
      porAssunto.set(assunto, { ...porAssunto.get(assunto), [campo]: p[campo] });
    }
  }
  if (!mudancas.length) return antes;
  // Linha nova: o assunto inteiro (os padrões + o que mudou). Linha que existe: só os campos que mudaram, dentro do
  // assunto — assunto com lixo no jsonb (não objeto) recomeça do objeto vazio. Cada valor vai como jsonb tipado (ERR-392).
  const novo: Record<string, AjusteDoAssunto> = {};
  for (const [assunto, p] of porAssunto) novo[assunto] = { ...antes[assunto], ...p };
  const mescla = sql.join(
    [...porAssunto].map(
      ([assunto, p]) => sql`jsonb_build_object(${assunto}::text,
        case when jsonb_typeof(robo_config.atendente_assuntos -> ${assunto}::text) = 'object'
             then robo_config.atendente_assuntos -> ${assunto}::text else '{}'::jsonb end || ${JSON.stringify(p)}::jsonb)`,
    ),
    sql` || `,
  );
  await db.execute(sql`
    insert into robo_config (tenant_id, atendente_assuntos, atualizado_por)
    values (${quem.tenantId}::uuid, ${JSON.stringify(novo)}::jsonb, ${quem.colaboradorId}::uuid)
    on conflict (tenant_id) do update
       set atendente_assuntos = robo_config.atendente_assuntos || ${mescla},
           atualizado_por = excluded.atualizado_por, atualizado_em = now()`);
  for (const m of mudancas)
    await registrar?.({
      tenantId: quem.tenantId,
      atorId: quem.colaboradorId,
      atorPerfil: quem.categoria,
      tipo: 'config',
      acao: 'atendente_assunto_alterado',
      entidadeTipo: 'robo_config',
      entidadeId: quem.tenantId,
      detalhe: { assunto: m.assunto, campo: m.campo, de: m.de, para: m.para },
    });
  return assuntosDaEmpresa(db, quem.tenantId);
}
