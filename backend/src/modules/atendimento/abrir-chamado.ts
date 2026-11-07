import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { atendimentoChamado } from '../../db/schema';
import { chaveTelefone, sqlChaveTelefone } from '../../common/telefone-chave';
import { canalValido } from './fila';
import type { ResumoDoRobo } from './resumo-do-robo';
import type { EnderecoDoCaso } from './endereco-depois-que-saiu';
import {
  type ForaDoHorario,
  type Recado,
  inicioDoCasoSql,
  lerRecado,
  pedidoEmAndamento,
  recadoAtivo,
  recadoAtivoSql,
  recadoDoCasoNovo,
  respostaDoRecado,
  situacaoDaEquipe,
} from './horario-da-equipe';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ABRIR UM CHAMADO (o robô → a equipe), fora do serviço do atendimento: o WhatsApp também abre chamado sozinho — o robô
// do outro lado (Bloco 4, 31/10/2026) — e o módulo do WhatsApp não pode depender do de atendimento (que depende do
// delivery, que depende do WhatsApp). O `AtendimentoService` chama estas mesmas funções: uma regra só. O HORÁRIO DA
// EQUIPE (mig 379, `horario-da-equipe.ts`) entra aqui: todo caminho do WhatsApp que abre caso passa por estas funções.

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

/** O que o chamado guarda em `detalhe` do que chegou: o resumo do robô, o endereço do pedido que já saiu e o recado. */
function detalheDoChamado(dto: DadosDoChamado, recado?: Recado | null): Record<string, unknown> | null {
  const d: Record<string, unknown> = {};
  if (dto.resumo) d.robo = { ...dto.resumo, em: new Date().toISOString() };
  if (dto.endereco) d.endereco = dto.endereco;
  if (recado) d.recado = recado;
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

/** A resposta de quem abre ou soma um chamado: a posição na fila e, fora do horário da equipe, o que dizer ao cliente. */
export type RespostaDoChamado = {
  ok: true;
  id: string;
  prioridade: Prioridade;
  posicao: number | null;
  comAlguem: boolean;
  jaAberto?: true;
} & Partial<Omit<ForaDoHorario, 'posicao'>>;

/**
 * Abre um chamado (handoff do robô → humano) e avisa a tela em tempo real.
 * HORÁRIO DA EQUIPE (mig 379): fora do horário, e sem pedido em andamento, o caso nasce como RECADO PARA A ABERTURA
 * (`detalhe.recado`) — não toca, não conta na fila, não cala o robô — e a resposta diz ao robô o que mandar ao cliente
 * (`foraDoHorario`, `equipeVolta`, `paraOCliente`; a posição não vale). O aviso à tela sai igual: ela decide pelo dado.
 */
export async function abrirChamado(db: any, emitir: Emitir, tenantId: string, unidadeId: string | null, dto: DadosDoChamado): Promise<RespostaDoChamado> {
  const tipo = ['mudanca', 'erro', 'humano', 'outro', 'cancelamento'].includes(dto.tipo ?? '') ? dto.tipo : 'humano';
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

/**
 * A POSIÇÃO do caso na fila (Onda 1, PR 4): quantos casos esperam uma pessoa antes dele, na ordem da fila (urgente
 * primeiro, depois o mais antigo — `compararNaFila`), entre os que a loja dele vê (a loja e os sem loja; caso sem loja =
 * a empresa toda). Só conta quem está NA FILA: sem responsável, sem aguardar o cliente, sem prazo de plataforma e sem
 * recado esperando a equipe (mig 379 — o recado não está na fila de agora: nem tem posição, nem passa na frente).
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
             case when c.status = 'aberto' and c.responsavel_id is null and c.aguardando_desde is null and c.prazo_em is null
                       and not ${recadoAtivoSql('c')} then
               (select count(*)::int + 1 from atendimento_chamado o
                 where o.tenant_id = ${tenantId} and o.id <> c.id and o.status = 'aberto' and o.responsavel_id is null
                   and o.aguardando_desde is null and o.prazo_em is null and not ${recadoAtivoSql('o')}
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
  const k = chaveTelefone(dto.telefone);
  if (!k) return abrirChamado(db, emitir, tenantId, unidadeId, dto);
  const [aberto] = await db
    .select()
    .from(atendimentoChamado)
    .where(
      and(
        eq(atendimentoChamado.tenantId, tenantId),
        eq(atendimentoChamado.status, 'aberto'),
        sql`${inicioDoCasoSql('atendimento_chamado')} >= now() - make_interval(hours => ${Number(JANELA_DO_MESMO_CHAMADO_H)}::int)`,
        sql`${sqlChaveTelefone(sql`${atendimentoChamado.telefone}`)} = ${k}`,
      ),
    )
    .orderBy(desc(atendimentoChamado.criadoEm))
    .limit(1);
  const tipoNovo = String(dto.tipo ?? '');
  const precisaDoProprio = (tipoNovo === 'cancelamento' || tipoNovo === 'mudanca') && !!dto.pedidoId && aberto?.tipo !== tipoNovo;
  if (!aberto || precisaDoProprio) return abrirChamado(db, emitir, tenantId, unidadeId, dto);

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
