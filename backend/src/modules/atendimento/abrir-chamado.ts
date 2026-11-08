import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { atendimentoChamado } from '../../db/schema';
import { chaveTelefone, sqlChaveTelefone } from '../../common/telefone-chave';
import { canalValido } from './fila';
import type { ResumoDoRobo } from './resumo-do-robo';
import type { EnderecoDoCaso } from './endereco-depois-que-saiu';
import {
  type ForaDoHorario,
  type Recado,
  type SituacaoDaEquipe,
  inicioDoCasoSql,
  lerRecado,
  pedidoEmAndamento,
  recadoAtivo,
  recadoAtivoSql,
  recadoDaSituacao,
  recadoDoCasoNovo,
  respostaDoRecado,
  situacaoDaEquipe,
  situacaoForaDoHorario,
} from './horario-da-equipe';
import {
  type AssuntoDoAtendente,
  type RecadoAceito,
  type RecadoParaOResponsavel,
  paraOResponsavelSql,
  recadoParaOResponsavel,
  respostaParaOResponsavel,
  resumoComORecado,
} from '../cardapio/assuntos-do-atendente';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ABRIR UM CHAMADO (o robô → a equipe), fora do serviço do atendimento: o WhatsApp também abre chamado sozinho — o robô
// do outro lado (Bloco 4, 31/10/2026) — e o módulo do WhatsApp não pode depender do de atendimento (que depende do
// delivery, que depende do WhatsApp). O `AtendimentoService` chama estas mesmas funções: uma regra só. O HORÁRIO DA
// EQUIPE (mig 379, `horario-da-equipe.ts`) entra aqui: todo caminho do WhatsApp que abre caso passa por estas funções.
// Os ASSUNTOS QUE NÃO SÃO PEDIDO (mig 381, `cardapio/assuntos-do-atendente.ts`) também: o `tipo` fornecedor, vaga ou
// parceria em "recado" na empresa vira RECADO PARA O RESPONSÁVEL — fora da fila, sem tocar, sem calar o robô.

export type Prioridade = 'normal' | 'urgente';

export type DadosDoChamado = {
  tipo?: string;
  cliente?: string;
  telefone?: string;
  pedidoNumero?: string;
  pedidoId?: string;
  mensagem?: string;
  prioridade?: Prioridade;
  /** De onde veio (mig 350): whatsapp | cardapio | anotaai | ifood | 99food. O do robô é 'whatsapp'. */
  canal?: string;
  /** O resumo do robô (Onda 1, PR 4) — vai para `detalhe.robo`. */
  resumo?: ResumoDoRobo | null;
  /** O endereço novo do pedido que já saiu (PR 3b-2) — vai para `detalhe.endereco` (a gaveta mostra e a equipe muda). */
  endereco?: EnderecoDoCaso | null;
  /**
   * O cardápio da conversa (o do robô que chamou) — só para o HORÁRIO DA EQUIPE (mig 379): o horário dele vale antes do
   * da loja. Não é gravado no caso.
   */
  cardapioId?: string | null;
};

/**
 * O que o chamado guarda em `detalhe` do que chegou: o resumo do robô, o endereço do pedido que já saiu e o recado. No
 * RECADO PARA O RESPONSÁVEL (mig 381), o resumo leva também as linhas "Assunto / Quem / Contato / Já fiz" da mensagem e a
 * marca `responsavel` (só no caso novo — somar não muda quando o robô deixou o recado).
 */
function detalheDoChamado(
  dto: DadosDoChamado,
  recado?: Recado | null,
  doRecado?: { assunto: AssuntoDoAtendente; marca?: RecadoParaOResponsavel } | null,
): Record<string, unknown> | null {
  const d: Record<string, unknown> = {};
  const robo = doRecado ? resumoComORecado(dto.resumo, dto.mensagem) : dto.resumo;
  if (robo) d.robo = { ...robo, em: new Date().toISOString() };
  if (dto.endereco) d.endereco = dto.endereco;
  if (recado) d.recado = recado;
  if (doRecado?.marca) d.responsavel = doRecado.marca;
  return Object.keys(d).length ? d : null;
}

/** Avisa a tela em tempo real (o `EventEmitter2.emit`). */
export type Emitir = (evento: string, dados: any) => unknown;

/** Por quanto tempo um chamado ABERTO do mesmo telefone conta como o mesmo pedido de ajuda. */
export const JANELA_DO_MESMO_CHAMADO_H = 12;

/** Junta a mensagem nova à do chamado que já estava aberto, sem repetir a mesma frase e sem crescer sem fim. */
export function juntarMensagem(antes: string | null | undefined, nova: string | null | undefined): string | null {
  const a = String(antes ?? '').trim();
  const n = String(nova ?? '').trim();
  if (!n || a.includes(n)) return a || null;
  if (!a) return n.slice(0, 1000);
  return `${a}\n${n}`.slice(-1000);
}

/**
 * A resposta de quem abre ou soma um chamado: a posição na fila e, fora do horário da equipe, o que dizer ao cliente. No
 * RECADO PARA O RESPONSÁVEL (mig 381): `paraOResponsavel`, o `assunto` e `paraOCliente` (o texto do assunto), sem posição.
 */
export type RespostaDoChamado = {
  ok: true;
  id: string;
  prioridade: Prioridade;
  posicao: number | null;
  comAlguem: boolean;
  jaAberto?: true;
  paraOResponsavel?: true;
  assunto?: AssuntoDoAtendente;
} & Partial<Omit<ForaDoHorario, 'posicao'>>;

/** Os tipos de hoje do chamado do robô; o que vier fora (e não for um recado aceito) vira `humano` — como sempre foi. */
const TIPOS_DO_CHAMADO = ['mudanca', 'erro', 'humano', 'outro', 'cancelamento'];

/**
 * Abre um chamado (handoff do robô → humano) e avisa a tela em tempo real.
 * HORÁRIO DA EQUIPE (mig 379): fora do horário, e sem pedido em andamento, o caso nasce como RECADO PARA A ABERTURA
 * (`detalhe.recado`) — não toca, não conta na fila, não cala o robô — e a resposta diz ao robô o que mandar ao cliente
 * (`foraDoHorario`, `equipeVolta`, `paraOCliente`; a posição não vale). O aviso à tela sai igual: ela decide pelo dado.
 * ASSUNTOS QUE NÃO SÃO PEDIDO (mig 381): `tipo` fornecedor, vaga ou parceria com o assunto em "recado" na empresa → o caso
 * nasce com esse tipo e `detalhe.responsavel = { assunto, em }`, prioridade normal, a qualquer hora (não é o recado da
 * abertura). A tela recebe só "mudou" (sem o caso no aviso: não toca, e quem não é da gestão nem recebe o dado — a fila
 * filtra pelo perfil). Em "Como hoje" (ou "não é por aqui"), o tipo vira `humano`, como antes. `aceito` = o que quem
 * chama já leu (undefined = ler aqui).
 */
export async function abrirChamado(
  db: any,
  emitir: Emitir,
  tenantId: string,
  unidadeId: string | null,
  dto: DadosDoChamado,
  aceito?: RecadoAceito | null,
): Promise<RespostaDoChamado> {
  const recadoAceito = aceito !== undefined ? aceito : await recadoParaOResponsavel(db, tenantId, dto.tipo);
  if (recadoAceito) return abrirRecadoParaOResponsavel(db, emitir, tenantId, unidadeId, dto, recadoAceito);
  const tipo = TIPOS_DO_CHAMADO.includes(dto.tipo ?? '') ? dto.tipo : 'humano';
  const fora = await recadoDoCasoNovo(db, tenantId, { unidadeId, cardapioId: dto.cardapioId }, dto.pedidoId);
  const detalhe = detalheDoChamado(dto, fora?.recado);
  const [row] = await db
    .insert(atendimentoChamado)
    .values({
      tenantId,
      unidadeId: unidadeId ?? null,
      tipo,
      cliente: dto.cliente?.trim() || null,
      telefone: dto.telefone?.trim() || null,
      pedidoNumero: dto.pedidoNumero != null ? String(dto.pedidoNumero) : null,
      pedidoId: dto.pedidoId ?? null,
      mensagem: dto.mensagem?.trim() || null,
      prioridade: dto.prioridade === 'urgente' ? 'urgente' : 'normal',
      canal: canalValido(dto.canal),
      ...(detalhe ? { detalhe } : {}),
    })
    .returning();
  emitir('atendimento.novo', { tenantId, chamado: row });
  if (fora) return { ok: true, id: row.id, prioridade: row.prioridade, comAlguem: false, ...respostaDoRecado(fora.recado, fora.situacao.textoFora) };
  return { ok: true, id: row.id, prioridade: row.prioridade, ...(await posicaoNaFila(db, tenantId, row.id)) };
}

/** O RECADO PARA O RESPONSÁVEL novo (mig 381): o caso com o tipo do assunto, a marca e o resumo; a tela só relê a fila. */
async function abrirRecadoParaOResponsavel(
  db: any,
  emitir: Emitir,
  tenantId: string,
  unidadeId: string | null,
  dto: DadosDoChamado,
  aceito: RecadoAceito,
): Promise<RespostaDoChamado> {
  const marca: RecadoParaOResponsavel = { assunto: aceito.assunto, em: new Date().toISOString() };
  const detalhe = detalheDoChamado(dto, null, { assunto: aceito.assunto, marca });
  const [row] = await db
    .insert(atendimentoChamado)
    .values({
      tenantId,
      unidadeId: unidadeId ?? null,
      tipo: aceito.assunto,
      cliente: dto.cliente?.trim() || null,
      telefone: dto.telefone?.trim() || null,
      pedidoNumero: dto.pedidoNumero != null ? String(dto.pedidoNumero) : null,
      pedidoId: dto.pedidoId ?? null,
      mensagem: dto.mensagem?.trim() || null,
      prioridade: 'normal',
      canal: canalValido(dto.canal),
      detalhe,
    })
    .returning();
  emitir('atendimento.mudou', { tenantId, id: row.id, motivo: 'recado_para_o_responsavel' });
  return respostaParaOResponsavel(row.id, aceito);
}

/**
 * A POSIÇÃO do caso na fila (Onda 1, PR 4): quantos casos esperam uma pessoa antes dele, na ordem da fila (urgente
 * primeiro, depois o mais antigo — `compararNaFila`), entre os que a loja dele vê (a loja e os sem loja; caso sem loja =
 * a empresa toda). Só conta quem está NA FILA: sem responsável, sem aguardar o cliente, sem prazo de plataforma e sem
 * recado esperando a equipe (mig 379 — o recado não está na fila de agora: nem tem posição, nem passa na frente) e sem
 * recado para o responsável (mig 381 — nunca está na fila da equipe).
 * `comAlguem` = já tem uma pessoa no caso (o robô diz isso no lugar da posição). Nunca rejeita: sem posição, null.
 */
export async function posicaoNaFila(db: any, tenantId: string, id: string): Promise<{ posicao: number | null; comAlguem: boolean }> {
  try {
    const r: any = await db.execute(sql`
      with c as (
        select id, unidade_id, prioridade, criado_em, responsavel_id, aguardando_desde, prazo_em, status, detalhe
          from atendimento_chamado where tenant_id = ${tenantId} and id = ${id}
      )
      select c.responsavel_id is not null as "comAlguem",
             case when ${naFilaDaEquipeSql('c')} then
               (select count(*)::int + 1 from atendimento_chamado o
                 where o.tenant_id = ${tenantId} and o.id <> c.id and ${naFilaDaEquipeSql('o')}
                   and (c.unidade_id is null or o.unidade_id = c.unidade_id or o.unidade_id is null)
                   and ((o.prioridade = 'urgente' and c.prioridade <> 'urgente')
                        or (o.prioridade = c.prioridade and (o.criado_em, o.id) < (c.criado_em, c.id))))
             end as posicao
        from c`);
    const row = (r?.rows ?? r ?? [])[0];
    return { posicao: row?.posicao ?? null, comAlguem: !!row?.comAlguem };
  } catch {
    return { posicao: null, comAlguem: false };
  }
}

const APELIDO = /^[a-z_][a-z0-9_]*$/i;

/**
 * SQL: o caso `a` (de `atendimento_chamado`) espera uma pessoa NA FILA da equipe — aberto, sem responsável, sem aguardar o
 * cliente, sem prazo de plataforma, sem recado esperando a equipe (mig 379) e sem ser recado para o responsável (mig 381).
 * Uma regra só para a posição do caso de verdade (`posicaoNaFila`) e a do caso que o teste do atendente simula.
 */
export function naFilaDaEquipeSql(a: string): SQL {
  if (!APELIDO.test(a)) throw new Error(`apelido de tabela inválido: ${a}`);
  return sql`(${sql.raw(`${a}.status = 'aberto' and ${a}.responsavel_id is null and ${a}.aguardando_desde is null and ${a}.prazo_em is null`)}
          and not ${recadoAtivoSql(a)} and not ${paraOResponsavelSql(a)})`;
}

/**
 * A POSIÇÃO que um caso NA FILA teria (o teste do atendente, F4 — mig 382 —, sem gravar caso nenhum): a conta de
 * `posicaoNaFila` para um caso da loja `unidadeId` (null = a empresa toda), com a `prioridade` e criado em `criadoEm` —
 * quantos casos da fila vêm antes dele (urgente primeiro, depois o mais antigo), +1. `criadoEm` null = um caso NOVO, mais
 * novo que todos (sem comparar o relógio do servidor com o do banco). Nunca rejeita: sem posição, null.
 */
export async function posicaoDeUmCaso(
  db: any,
  tenantId: string,
  unidadeId: string | null,
  prioridade: Prioridade,
  criadoEm: Date | null,
): Promise<{ posicao: number | null; comAlguem: false }> {
  try {
    const antes = criadoEm ? sql`o.criado_em <= ${criadoEm.toISOString()}::timestamptz` : sql`true`;
    const r: any = await db.execute(sql`
      select count(*)::int + 1 as posicao from atendimento_chamado o
       where o.tenant_id = ${tenantId} and ${naFilaDaEquipeSql('o')}
         and (${unidadeId}::uuid is null or o.unidade_id = ${unidadeId}::uuid or o.unidade_id is null)
         and ((o.prioridade = 'urgente' and ${prioridade}::text <> 'urgente')
              or (o.prioridade = ${prioridade}::text and ${antes}))`);
    const row = (r?.rows ?? r ?? [])[0];
    return { posicao: row?.posicao ?? null, comAlguem: false };
  } catch {
    return { posicao: null, comAlguem: false };
  }
}

// ───────────────────────── o "chamar atendente" do TESTE DO ATENDENTE (F4, mig 382) ─────────────────────────
// Na conversa de teste (`teste:<id>`) o "chamar atendente" NÃO abre caso, não pausa o robô e não avisa ninguém: calcula, com
// as MESMAS funções do caminho de verdade, o que aconteceria — o recado para o responsável (F3), o recado para a abertura
// (F1) ou a equipe chamada, com a posição na fila — e devolve ao robô a MESMA forma de resposta. Somar a um caso que o teste
// já "abriu" segue a regra de `abrirChamadoPeloRobo` (o recado só com o do mesmo assunto; o comum só com o comum; 12 h no
// WhatsApp — no Direct, o caso aberto da conversa, sem janela).

/** O caso que o teste já simulou nesta conversa (a linha 'sistema' guarda), para somar como o caminho real soma. */
export type CasoSimulado = {
  id: string;
  /** 'equipe' = o caso comum (na fila ou recado da abertura); 'responsavel' = o recado para o responsável. */
  fila: 'equipe' | 'responsavel';
  assunto?: AssuntoDoAtendente | null;
  prioridade: Prioridade;
  recado?: Recado | null;
  /** ISO. */
  criadoEm: string;
};

export type Simulacao = {
  /** A resposta que o robô recebe — a forma do caminho de verdade. */
  resposta: RespostaDoChamado;
  /** O que aconteceria: a equipe chamada (na fila), o recado para a abertura (F1) ou o recado para o responsável (F3). */
  resultado: 'equipe' | 'recado' | 'responsavel';
  /** O caso simulado como ficou (novo, ou o que somou). */
  caso: CasoSimulado;
  somou: boolean;
  /** O tipo que o caso teria (o da lista — ou `humano` — ou o assunto do recado). */
  tipoDoChamado: string;
  /** A situação da equipe usada (null quando não precisou ler). */
  situacao: SituacaoDaEquipe | null;
};

export type OpcoesDaSimulacao = {
  canal: 'whatsapp' | 'direct';
  /** "Simular fora do horário": a equipe como se não estivesse agora (`situacaoForaDoHorario`). */
  foraDoHorario?: boolean;
  /** Os casos que o teste já simulou (do mais novo ao mais velho). */
  anteriores?: CasoSimulado[];
  agora?: Date;
  /** O id do caso simulado novo (o teste passa um fixo). */
  novoId?: () => string;
};

/**
 * O "chamar atendente" SIMULADO (o teste do atendente): o que `abrirChamadoPeloRobo` (WhatsApp) ou o caso do Direct fariam,
 * sem gravar nada. `dados.prioridade` já vem decidida por quem chama (`prioridadeDe`, como no caminho real); `unidadeId` =
 * a loja do cardápio no WhatsApp (null no Direct, como o caso do Direct). Não há pedido no teste: nunca "pedido em
 * andamento" e ninguém pega o caso (`comAlguem` false). A posição sai crua — quem chama aplica o "dizer a posição".
 */
export async function simularChamadoPeloRobo(
  db: any,
  tenantId: string,
  unidadeId: string | null,
  dados: DadosDoChamado,
  opcoes: OpcoesDaSimulacao,
): Promise<Simulacao> {
  const agora = opcoes.agora ?? new Date();
  const novoId = opcoes.novoId ?? (() => randomUUID());
  const onde = { unidadeId, cardapioId: dados.cardapioId };
  const situacaoAgora = () => (opcoes.foraDoHorario ? situacaoForaDoHorario(db, tenantId, onde, agora) : situacaoDaEquipe(db, tenantId, onde, agora));
  const aceito = await recadoParaOResponsavel(db, tenantId, dados.tipo);
  // O caso aberto que o caminho real somaria: no WhatsApp, até 12 h (do começo do caso: a volta da equipe, no recado).
  const janela = agora.getTime() - JANELA_DO_MESMO_CHAMADO_H * 3_600_000;
  const vivo = (c: CasoSimulado) => opcoes.canal === 'direct' || new Date(c.recado?.ate ?? c.criadoEm).getTime() >= janela;
  const anterior =
    (opcoes.anteriores ?? []).find((c) => vivo(c) && (aceito ? c.fila === 'responsavel' && c.assunto === aceito.assunto : c.fila === 'equipe')) ?? null;

  if (aceito) {
    const caso: CasoSimulado = anterior ?? { id: novoId(), fila: 'responsavel', assunto: aceito.assunto, prioridade: 'normal', recado: null, criadoEm: agora.toISOString() };
    return { resposta: respostaParaOResponsavel(caso.id, aceito, !!anterior), resultado: 'responsavel', caso, somou: !!anterior, tipoDoChamado: aceito.assunto, situacao: null };
  }
  const tipoDoChamado = TIPOS_DO_CHAMADO.includes(dados.tipo ?? '') ? (dados.tipo as string) : 'humano';
  const urgente = dados.prioridade === 'urgente';

  if (anterior) {
    const caso: CasoSimulado = { ...anterior, prioridade: urgente ? 'urgente' : anterior.prioridade };
    // O WhatsApp diz `jaAberto`; o Direct responde sem ele (como o caminho de cada um).
    const base = { ok: true as const, id: caso.id, prioridade: caso.prioridade, ...(opcoes.canal === 'whatsapp' ? { jaAberto: true as const } : {}) };
    const recado = caso.recado && new Date(caso.recado.ate).getTime() > agora.getTime() ? caso.recado : null;
    if (recado) {
      const situacao = await situacaoAgora();
      return {
        resposta: { ...base, comAlguem: false, ...respostaDoRecado(recado, situacao.textoFora, agora) },
        resultado: 'recado',
        caso,
        somou: true,
        tipoDoChamado,
        situacao,
      };
    }
    const pos = await posicaoDeUmCaso(db, tenantId, unidadeId, caso.prioridade, new Date(caso.criadoEm));
    return { resposta: { ...base, ...pos }, resultado: 'equipe', caso, somou: true, tipoDoChamado, situacao: null };
  }

  const situacao = await situacaoAgora();
  const recado = recadoDaSituacao(situacao, agora);
  const caso: CasoSimulado = { id: novoId(), fila: 'equipe', assunto: null, prioridade: urgente ? 'urgente' : 'normal', recado, criadoEm: agora.toISOString() };
  if (recado)
    return {
      resposta: { ok: true, id: caso.id, prioridade: caso.prioridade, comAlguem: false, ...respostaDoRecado(recado, situacao.textoFora, agora) },
      resultado: 'recado',
      caso,
      somou: false,
      tipoDoChamado,
      situacao,
    };
  const pos = await posicaoDeUmCaso(db, tenantId, unidadeId, caso.prioridade, null);
  return { resposta: { ok: true, id: caso.id, prioridade: caso.prioridade, ...pos }, resultado: 'equipe', caso, somou: false, tipoDoChamado, situacao };
}

/**
 * O CLIENTE RESPONDEU (mensagem nova no WhatsApp): o caso que estava "aguardando o cliente" volta para a fila — com o
 * mesmo responsável, que é avisado pela tela. Pela chave do telefone (com/sem 55 e nono dígito), só nos casos abertos.
 * Nunca rejeita (é chamada no caminho de entrada da mensagem, que não pode cair por isto — V3); devolve quantos voltaram.
 */
export async function clienteRespondeu(db: any, emitir: Emitir, tenantId: string, telefone: string | null | undefined): Promise<number> {
  try {
    const k = chaveTelefone(telefone);
    if (!k || !tenantId) return 0;
    const voltaram: Array<{ id: string }> = await db
      .update(atendimentoChamado)
      .set({ aguardandoDesde: null })
      .where(
        and(
          eq(atendimentoChamado.tenantId, tenantId),
          eq(atendimentoChamado.status, 'aberto'),
          isNotNull(atendimentoChamado.aguardandoDesde),
          sql`${sqlChaveTelefone(sql`${atendimentoChamado.telefone}`)} = ${k}`,
        ),
      )
      .returning({ id: atendimentoChamado.id });
    for (const v of voltaram) emitir('atendimento.mudou', { tenantId, id: v.id, motivo: 'cliente_respondeu' });
    return voltaram.length;
  } catch {
    return 0;
  }
}

/**
 * Chamado aberto PELO ROBÔ. Se o mesmo cliente (pela chave do telefone: com/sem 55 e nono dígito) já tem um chamado
 * aberto nas últimas 12 h, é o mesmo pedido de ajuda: não abre outro (a IA às vezes chama duas vezes na mesma
 * resposta). O que chega é somado ao aberto: a mensagem nova vai junto, e `urgente` SOBE a prioridade (nunca desce) —
 * aí a tela é avisada de novo, porque mudou o que a equipe precisa ver.
 * Exceção: um pedido de CANCELAMENTO ou MUDANÇA ligado a um pedido, quando o aberto é de outro tipo, abre o seu
 * próprio chamado — o botão "Aceitar cancelamento" depende do tipo e do pedido do chamado.
 * Sem telefone, abre sempre (não há como saber se é o mesmo cliente). Duas chamadas no mesmo instante ainda podem abrir
 * dois — nenhum índice impede; o pior caso é um chamado a mais no painel.
 * HORÁRIO DA EQUIPE (mig 379): o RECADO que ainda espera a equipe também é "o aberto" (mesmo passadas as 12 h: o da meia-
 * noite espera até a abertura) — somar mantém a marca e a resposta repete ao robô o que dizer ao cliente; as 12 h de um
 * recado contam da volta da equipe. Somar a um caso comum não vira recado. Pedido em andamento conta como horário: o
 * recado que passa a ter um pedido em andamento entra na fila na hora (a tela é avisada como caso novo).
 * ASSUNTOS QUE NÃO SÃO PEDIDO (mig 381): o RECADO PARA O RESPONSÁVEL só soma ao recado aberto do MESMO assunto (12 h, como
 * os outros) — a mensagem e o resumo novos vão juntos, a prioridade não sobe e a resposta repete o texto do assunto. Um
 * recado nunca soma num caso comum, nem um caso comum num recado: são filas diferentes.
 */
export async function abrirChamadoPeloRobo(
  db: any,
  emitir: Emitir,
  tenantId: string,
  unidadeId: string | null,
  dados: DadosDoChamado,
): Promise<RespostaDoChamado> {
  // O robô é o do WhatsApp: o caso nasce desse canal, salvo quando quem chama diz outro.
  const dto: DadosDoChamado = { ...dados, canal: dados.canal ?? 'whatsapp' };
  const aceito = await recadoParaOResponsavel(db, tenantId, dto.tipo);
  const k = chaveTelefone(dto.telefone);
  if (!k) return abrirChamado(db, emitir, tenantId, unidadeId, dto, aceito);
  const [aberto] = await db
    .select()
    .from(atendimentoChamado)
    .where(
      and(
        eq(atendimentoChamado.tenantId, tenantId),
        eq(atendimentoChamado.status, 'aberto'),
        sql`${inicioDoCasoSql('atendimento_chamado')} >= now() - make_interval(hours => ${Number(JANELA_DO_MESMO_CHAMADO_H)}::int)`,
        sql`${sqlChaveTelefone(sql`${atendimentoChamado.telefone}`)} = ${k}`,
        // O recado para o responsável só com o recado do mesmo assunto; o caso comum só com outro caso comum.
        aceito
          ? sql`${atendimentoChamado.detalhe} #>> '{responsavel,assunto}' = ${aceito.assunto}::text`
          : sql`not ${paraOResponsavelSql('atendimento_chamado')}`,
      ),
    )
    .orderBy(desc(atendimentoChamado.criadoEm))
    .limit(1);
  if (aceito) {
    if (!aberto) return abrirChamado(db, emitir, tenantId, unidadeId, dto, aceito);
    return somarAoRecadoParaOResponsavel(db, emitir, tenantId, aberto, dto, aceito);
  }
  const tipoNovo = String(dto.tipo ?? '');
  const precisaDoProprio = (tipoNovo === 'cancelamento' || tipoNovo === 'mudanca') && !!dto.pedidoId && aberto?.tipo !== tipoNovo;
  if (!aberto || precisaDoProprio) return abrirChamado(db, emitir, tenantId, unidadeId, dto, null);

  const subiu = dto.prioridade === 'urgente' && aberto.prioridade !== 'urgente';
  const mensagem = juntarMensagem(aberto.mensagem, dto.mensagem);
  const patch: Record<string, unknown> = {};
  if (subiu) patch.prioridade = 'urgente';
  if (mensagem !== (aberto.mensagem ?? null)) patch.mensagem = mensagem;
  if (!aberto.pedidoId && dto.pedidoId) {
    patch.pedidoId = dto.pedidoId;
    if (!aberto.pedidoNumero && dto.pedidoNumero != null) patch.pedidoNumero = String(dto.pedidoNumero);
  }
  // O recado que ainda espera a equipe: fica recado — salvo se o caso passa a ter (ou já tinha) um pedido em andamento.
  const recado = recadoAtivo(aberto.detalhe) ? lerRecado(aberto.detalhe) : null;
  const entraNaFila = !!recado && (await pedidoEmAndamento(db, tenantId, aberto.pedidoId ?? dto.pedidoId ?? null));
  // O resumo novo substitui o do robô (e o endereço do pedido que já saiu, o de antes), mesclado no banco: o resto do
  // `detalhe` (o que outra rotina gravou) fica (V82). O recado que entra na fila acaba AGORA (pela hora do banco): o selo
  // "Recado das 02:14" continua, e o tempo de espera conta daqui.
  const novoDetalhe = detalheDoChamado(dto);
  if (novoDetalhe || entraNaFila)
    patch.detalhe = sql`coalesce(${atendimentoChamado.detalhe}, '{}'::jsonb) || ${JSON.stringify(novoDetalhe ?? {})}::jsonb ${
      entraNaFila
        ? sql`|| jsonb_build_object('recado', coalesce(${atendimentoChamado.detalhe} -> 'recado', '{}'::jsonb)
                 || jsonb_build_object('ate', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))`
        : sql``
    }`;
  let row: any = aberto;
  if (Object.keys(patch).length) {
    [row] = await db
      .update(atendimentoChamado)
      .set(patch as any)
      .where(and(eq(atendimentoChamado.tenantId, tenantId), eq(atendimentoChamado.id, aberto.id)))
      .returning();
  }
  if (subiu || entraNaFila) emitir('atendimento.novo', { tenantId, chamado: row });
  else if (Object.keys(patch).length) emitir('atendimento.mudou', { tenantId, id: aberto.id, motivo: 'robo_somou' });
  const base = { ok: true as const, id: aberto.id as string, prioridade: (row?.prioridade ?? aberto.prioridade) as Prioridade, jaAberto: true as const };
  if (recado && !entraNaFila) {
    // Fora do horário: o robô repete ao cliente quando a equipe volta (a frase da loja, pela volta gravada no recado).
    const equipe = await situacaoDaEquipe(db, tenantId, { unidadeId, cardapioId: dto.cardapioId });
    return { ...base, comAlguem: !!aberto.responsavelId, ...respostaDoRecado(recado, equipe.textoFora) };
  }
  return { ...base, ...(await posicaoNaFila(db, tenantId, aberto.id)) };
}

/**
 * Soma ao RECADO PARA O RESPONSÁVEL do mesmo assunto (mig 381): a mensagem nova junto da de antes e o resumo novo (com as
 * linhas do recado) mesclado no `detalhe` — a marca `responsavel` e o resto ficam (V82). A prioridade não sobe (recado não
 * é urgência) e a tela só relê a fila. A resposta repete ao robô o texto do assunto.
 */
async function somarAoRecadoParaOResponsavel(
  db: any,
  emitir: Emitir,
  tenantId: string,
  aberto: any,
  dto: DadosDoChamado,
  aceito: RecadoAceito,
): Promise<RespostaDoChamado> {
  const patch: Record<string, unknown> = {};
  const mensagem = juntarMensagem(aberto.mensagem, dto.mensagem);
  if (mensagem !== (aberto.mensagem ?? null)) patch.mensagem = mensagem;
  const novoDetalhe = detalheDoChamado(dto, null, { assunto: aceito.assunto });
  if (novoDetalhe) patch.detalhe = sql`coalesce(${atendimentoChamado.detalhe}, '{}'::jsonb) || ${JSON.stringify(novoDetalhe)}::jsonb`;
  if (Object.keys(patch).length) {
    await db
      .update(atendimentoChamado)
      .set(patch as any)
      .where(and(eq(atendimentoChamado.tenantId, tenantId), eq(atendimentoChamado.id, aberto.id)));
    emitir('atendimento.mudou', { tenantId, id: aberto.id, motivo: 'robo_somou' });
  }
  return respostaParaOResponsavel(aberto.id, aceito, true);
}
