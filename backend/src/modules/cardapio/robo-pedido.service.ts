import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cliente, clienteEndereco, pedidoExterno, roboCarrinho } from '../../db/schema';
import { Conversa, lerConversa } from '../../common/conversa-do-robo';
import { textoDaObservacao } from '../../common/observacao-do-pedido';
import { ratearCentavos } from '../../common/rateio';
import { paraCentavos, paraReais } from '../../util/dinheiro';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import { menuNumerado } from '../whatsapp/robo-resposta.service';
import { estadoDaPausa } from '../whatsapp/robo-pausa';
import { CardapioService } from './cardapio.service';
import { normalizar, reais } from './robo-consultas';
import { GRUPOS, nucleoDoNome, palavrasDe, papelDaCategoria } from './robo-busca';
import {
  EntregaDoCarrinho,
  EstadoDaConducao,
  Falta,
  Linha,
  MAX_LINHAS,
  Meio,
  PagamentoDoCarrinho,
  acharBairro,
  acharForma,
  acharProduto,
  acharVariacao,
  adicionaisDoItem,
  alterarEscolhas,
  beneficiosDe,
  comBeneficios,
  conducaoDoPedido,
  escolhasQueFaltam,
  formasDoRobo,
  formasSoPeloLink,
  itensDoPedido,
  montarEscolhas,
  nomeDoCliente,
  opcaoComDetalhe,
  opcoesDePagamento,
  pedeExtras,
  precisaDeTroco,
  quantidadeDoPedido,
  referenciaDoPedido,
  referenciaParaOPedido,
  semTrocoNoTexto,
  temAdicionalOpcional,
  temOpcao,
  textoDoEndereco,
  valorDoTroco,
} from './robo-pedido';
import { OPCOES_DA_CONFERENCIA, resumoDoPedido, textoParaConferir } from './robo-resumo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PEDIDO PELO WHATSAPP (Fase 5, F3 e F4 — pedido do dono de 30/10/2026). O robô monta o pedido na conversa e o Regem
// guarda o carrinho (`robo_carrinho`, mig 344), confere cada passo e, quando o cliente confirma o resumo, registra pelo
// MESMO caminho do cardápio online (`receberPedido`): preço, taxa, horário, estoque e a entrada na loja são os de sempre.
// Quem é o cliente vem da FICHA DA CONVERSA (`x-regem-conversa`, assinada pelo Regem a cada mensagem): a loja e o
// telefone saem dela, nunca de um parâmetro que a IA preencha (V79).
//
// F5 (teste do dono no celular, 31/10/2026 — ERR-333): o Regem CONDUZ. Toda resposta traz `pedido.proximo` — a próxima
// pergunta, as opções para o cliente tocar e como mandar a resposta (robo-pedido.ts, `conducaoDoPedido`). Nada que o
// Regem precise depende de a IA LEMBRAR entre mensagens (a memória do n8n guarda só o texto da conversa, não o que as
// ferramentas devolveram): com o pedido completo, o PRÓPRIO Regem manda o resumo para conferir, com os botões, e marca a
// versão que o cliente viu (`resumo_versao`, mig 345) — registrar não pede mais a versão à IA (era o ciclo do "Pode
// registrar"). A escolha que completa um item vai para o item que esperava por ela (não abre um segundo trio), e "sem
// troco" só vale como resposta à pergunta do troco.

type Contexto = { token: string; cfg: any; conversa: Conversa };
type Carrinho = typeof roboCarrinho.$inferSelect;
type ClienteDaConversa = { id: string; nome: string | null; telefone: string | null; enderecos: any[]; ultimo: number | null } | null;
type Recusa = { ok: false; motivo: string; mensagem: string; [k: string]: unknown };
type Mudanca = Partial<Pick<Carrinho, 'itens' | 'entrega' | 'pagamento' | 'clienteNome' | 'itensFechados' | 'observacao'>>;
type Mudou = { carrinho: Carrinho; recusa: Recusa | null; mudou: boolean };

const linhasDe = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
const VALIDADE_DO_CARRINHO = sql`interval '12 hours'`;

/** As formas do número no cadastro: com/sem o 55 e com/sem o nono dígito (a chave sempre tem o 9 — ERR-134). */
export function formasDaChave(chave: string): string[] {
  const f = new Set([chave, `55${chave}`]);
  if (/^[1-9][0-9]9[6-9][0-9]{7}$/.test(chave)) {
    const sem9 = `${chave.slice(0, 2)}${chave.slice(3)}`;
    f.add(sem9);
    f.add(`55${sem9}`);
  }
  return [...f];
}

/** JSON com as chaves em ordem: o jsonb do banco devolve as chaves em outra ordem, e "igual" tem de dar igual. */
export function estavel(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${estavel(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const recusa = (motivo: string, mensagem: string, extra: Record<string, unknown> = {}): Recusa => ({ ok: false, motivo, mensagem, ...extra });
const acaoDe = (v: unknown) => normalizar(v).replace(/ /g, '_');
/**
 * "Não, obrigado", "nada", "só isso" — a resposta NEGATIVA à pergunta dos extras do item. A ferramenta do n8n descreve só
 * adicionar/alterar/remover/limpar: a IA pode mandar isso como observação ou como adicional; o Regem entende "concluir".
 */
export const respostaNegativa = (v: unknown): boolean =>
  /^(nao( obrigad[oa])?|nada|nenhum[a]?|sem (observacao|adicional|extras?)|nao precisa|nao quero|ta (bom|otimo)|so isso|pode seguir|esta otimo)$/.test(
    normalizar(v),
  );
const ACOES = {
  adicionar: ['adicionar', 'incluir', 'add'],
  escolher: ['escolher', 'escolha', 'completar', 'responder'],
  concluir: ['concluir', 'pronto', 'nao', 'nao_obrigado', 'sem_extras', 'seguir', 'nenhum', 'nada', 'pular', 'nao_quero'],
  fechar: ['fechar', 'so_isso', 'finalizar', 'fechar_itens'],
  obsDoPedido: ['observacao_do_pedido', 'observacao_geral', 'observacao_pedido', 'obs_pedido', 'obs_do_pedido'],
  limpar: ['limpar', 'esvaziar'],
  mexer: ['remover', 'tirar', 'alterar', 'mudar', 'observacao'],
  // Bloco 1 do plano de 31/10/2026: repetir o último pedido do cliente; trocar o lanche pelo trio dele.
  repetir: ['repetir', 'repetir_pedido', 'repetir_ultimo', 'repetir_o_ultimo_pedido', 'pedir_de_novo', 'mesmo_pedido'],
  trocarPeloTrio: ['trocar_pelo_trio', 'virar_trio', 'trocar_por_trio', 'no_trio', 'fazer_trio'],
  // Bloco 1b: os benefícios — o cashback e o prêmio perguntados antes do pagamento; o cupom, só quando o cliente diz.
  usarCashback: ['usar_cashback', 'usar_meu_cashback', 'usar_saldo', 'usar_o_cashback'],
  guardarCashback: ['guardar_cashback', 'guardar_para_depois', 'nao_usar_cashback', 'guardar_o_cashback'],
  usarCupom: ['usar_cupom', 'cupom', 'aplicar_cupom'],
  tirarCupom: ['tirar_cupom', 'remover_cupom', 'sem_cupom'],
  usarPremio: ['usar_premio', 'usar_o_premio', 'resgatar_premio'],
  guardarPremio: ['guardar_premio', 'deixar_para_depois', 'nao_usar_premio'],
};

/** O trio (ou combo) do lanche — "TRIO 08" do "Numero 08", "Trio X-Bacon" do "X-Bacon" —, à venda; da cópia com mais etapas. */
export function trioDoLanche(menu: any, lanche: any): any | null {
  if (!lanche || /^(trio|combo)\b/.test(normalizar(lanche.nome))) return null;
  const nucleo = nucleoDoNome(lanche.nome);
  if (!nucleo) return null;
  const etapas = (p: any) => (Array.isArray(p?.grupos) ? p.grupos.length : 0);
  return (
    (menu?.produtos ?? [])
      .filter((p: any) => !p.esgotado && p.id !== lanche.id && /^(trio|combo)\b/.test(normalizar(p.nome)) && nucleoDoNome(p.nome) === nucleo)
      .sort((a: any, b: any) => etapas(b) - etapas(a))[0] ?? null
  );
}

@Injectable()
export class RoboPedidoService {
  private readonly logger = new Logger('RoboPedido');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly cardapio: CardapioService,
    private readonly evolution: WhatsappService,
    private readonly cloud: WhatsappCloudService,
  ) {}

  /** A loja (pela chave do número, com a senha do robô) e o cliente (pela ficha da conversa, da mesma loja). */
  async contexto(segredo: string, ficha: unknown, instancia?: string, phoneNumberId?: string): Promise<Contexto> {
    const token = await this.cardapio.tokenDaLojaDoRobo(segredo, instancia, phoneNumberId);
    const conversa = lerConversa(ficha);
    const cfg = await this.cardapio.resolver(token);
    if (!conversa || conversa.tenantId !== cfg.tenantId)
      throw new UnauthorizedException('Conversa não reconhecida: use a ficha que veio com a mensagem do cliente.');
    return { token, cfg, conversa };
  }

  // ───────────────────────── leitura ─────────────────────────

  /**
   * O cliente da conversa no cadastro da loja (pelo telefone, em qualquer das formas), os endereços dele (até 5) e qual
   * deles foi o ÚLTIMO usado (o do pedido de entrega mais recente) — é o que o robô oferece primeiro (pedido do dono).
   */
  private async clienteDaConversa(ctx: Contexto): Promise<ClienteDaConversa> {
    const [c] = await this.db
      .select({ id: cliente.id, nome: cliente.nome, telefone: cliente.telefone })
      .from(cliente)
      .where(and(eq(cliente.tenantId, ctx.cfg.tenantId), inArray(cliente.telefone, formasDaChave(ctx.conversa.chave))))
      .orderBy(desc(cliente.totalPedidos), cliente.criadoEm)
      .limit(1);
    if (!c) return null;
    const enderecos = await this.db
      .select()
      .from(clienteEndereco)
      .where(and(eq(clienteEndereco.tenantId, ctx.cfg.tenantId), eq(clienteEndereco.clienteId, c.id)))
      .orderBy(desc(clienteEndereco.principal), desc(clienteEndereco.criadoEm))
      .limit(5);
    let ultimo: number | null = enderecos.length ? 1 : null;
    if (enderecos.length > 1) {
      const [ped] = await this.db
        .select({ rua: pedidoExterno.enderecoRua, numero: pedidoExterno.enderecoNumero })
        .from(pedidoExterno)
        .where(and(eq(pedidoExterno.tenantId, ctx.cfg.tenantId), eq(pedidoExterno.clienteId, c.id), eq(pedidoExterno.tipo, 'entrega')))
        .orderBy(desc(pedidoExterno.criadoEm))
        .limit(1);
      const chave = (r: unknown, n: unknown) => `${normalizar(r)}|${normalizar(n)}`;
      const i = ped ? enderecos.findIndex((e) => chave(e.logradouro, e.numero) === chave(ped.rua, ped.numero)) : -1;
      if (i >= 0) ultimo = i + 1;
    }
    return { ...c, enderecos, ultimo };
  }

  /** O carrinho aberto da conversa (o que passou de 12 h sem mudar é cancelado antes). */
  private async carrinhoAberto(ctx: Contexto): Promise<Carrinho | null> {
    await this.vencer(this.db, ctx);
    const [c] = await this.db
      .select()
      .from(roboCarrinho)
      .where(
        and(
          eq(roboCarrinho.tenantId, ctx.cfg.tenantId),
          eq(roboCarrinho.telefoneChave, ctx.conversa.chave),
          eq(roboCarrinho.status, 'aberto'),
        ),
      );
    return c ?? null;
  }

  private async vencer(db: any, ctx: Contexto) {
    await db.execute(sql`
      update robo_carrinho set status = 'cancelado', atualizado_em = now()
       where tenant_id = ${ctx.cfg.tenantId}::uuid and telefone_chave = ${ctx.conversa.chave}
         and status = 'aberto' and atualizado_em < now() - ${VALIDADE_DO_CARRINHO}`);
  }

  /**
   * Quem é o cliente, os endereços salvos (numerados para o robô escolher), o último usado e o pedido em montagem. Bloco 1
   * do plano de 31/10/2026: `emCurso` (há pedido em montagem — continuar, sem mandar o link) e `ultimoPedido` (o cliente
   * conhecido pode repetir: os itens que ainda estão à venda).
   */
  async ver(ctx: Contexto) {
    const [menu, cli, c] = await Promise.all([this.cardapio.menu(ctx.token), this.clienteDaConversa(ctx), this.carrinhoAberto(ctx)]);
    const produtos = new Map<string, any>((menu?.produtos ?? []).map((p: any) => [p.id, p]));
    const visao = (await this.calcular(ctx, menu, c, cli)).visao;
    const emCurso = Array.isArray(c?.itens) && (c!.itens as Linha[]).length > 0;
    const ultimo = emCurso ? null : await this.ultimoPedidoDoCliente(ctx, cli, produtos);
    const beneficios = await this.beneficiosParaVer(ctx, cli);
    return {
      cliente: cli
        ? { conhecido: true, nome: cli.nome ?? null }
        : { conhecido: false, nome: null, dica: 'Cliente novo: pergunte o nome para o pedido.' },
      enderecosSalvos: (cli?.enderecos ?? []).map((e, i) => ({ n: i + 1, endereco: this.textoDoSalvo(e) })),
      ultimoEndereco: cli?.ultimo ?? null,
      emCurso,
      ...(emCurso ? { dicaEmCurso: 'Há um pedido em montagem: pergunte se quer continuar ou acrescentar algo — não mande o link do cardápio.' } : {}),
      ...(ultimo
        ? {
            ultimoPedido: {
              numero: ultimo.numero,
              quando: ultimo.quando,
              itens: ultimo.itens,
              ...(ultimo.foraDoCardapio.length ? { foraDoCardapio: ultimo.foraDoCardapio } : {}),
              comoRepetir: 'mexer_no_pedido com acao = repetir',
            },
          }
        : {}),
      ...(beneficios ? { beneficios } : {}),
      pedido: visao,
    };
  }

  /**
   * O que o cliente tem de benefício (Bloco 1b): o saldo de cashback e os vales, os pontos da fidelidade (quanto falta
   * para o prêmio) e os prêmios para usar — para responder "quanto tenho de cashback?". O robô não abre a conversa com
   * isso: o Regem pergunta do cashback e do prêmio antes do pagamento. Nada = não vem.
   */
  private async beneficiosParaVer(ctx: Contexto, cli: ClienteDaConversa) {
    try {
      const tel = this.telefoneDosBeneficios(ctx, cli);
      const b = await this.cardapio.beneficiosDoCliente(ctx.cfg, tel, 0, { saldo: true });
      const fid = b.fidelidade ?? [];
      const saldo = Number(b.saldoCashback) || 0;
      const pontos = Number(b.pontosCashback) || 0;
      const r: Record<string, unknown> = {};
      if (saldo > 0) r.saldoCashback = reais(saldo);
      if (pontos > 0) r.pontosCashback = pontos;
      if (b.vales.length) r.vales = b.vales.map((v: any) => `${v.descricao ?? 'Vale'} — ${reais(Number(v.valor) || 0)}`);
      if (fid.length) r.fidelidade = fid;
      if (b.premios.length) r.premiosParaUsar = b.premios.map((p: any) => p.nome);
      if (!Object.keys(r).length) return null;
      return { ...r, dica: 'Só fale disto se o cliente perguntar; o Regem pergunta do cashback e do prêmio antes do pagamento.' };
    } catch (e: any) {
      // Benefício que não se leu não derruba a conversa: o robô só não sabe o saldo agora.
      this.logger.warn(`benefícios do cliente não lidos: ${e?.message ?? e}`);
      return null;
    }
  }

  private textoDoSalvo(e: any): string {
    const ref = e?.referencia || e?.complemento;
    return [[e?.logradouro, e?.numero].filter(Boolean).join(', '), e?.bairro, ref ? `ref: ${ref}` : ''].filter((s) => s && String(s).trim()).join(' · ');
  }

  // ───────────────────────── gravação ─────────────────────────

  /**
   * Muda o carrinho aberto (cria se não houver) numa transação curta: trava a linha, aplica a mudança e sobe a versão.
   * A mudança recebe o carrinho como está AGORA (duas mensagens ao mesmo tempo não se atropelam) e pode recusar. Mudança
   * que não muda nada (a IA repetiu a chamada) não sobe a versão: o resumo que o cliente viu continua valendo.
   */
  private async mudar(ctx: Contexto, mudanca: (c: Carrinho) => Mudanca | Recusa): Promise<Mudou> {
    return this.db.transaction(async (tx: any) => {
      await this.vencer(tx, ctx);
      // Um aberto por cliente (índice único parcial): a corrida de duas mensagens cai no "do nothing".
      await tx.execute(sql`
        insert into robo_carrinho (tenant_id, telefone, telefone_chave)
        values (${ctx.cfg.tenantId}::uuid, ${ctx.conversa.telefone}, ${ctx.conversa.chave})
        on conflict (tenant_id, telefone_chave) where status = 'aberto' do nothing`);
      const [c] = linhasDe(
        await tx.execute(sql`
          select * from robo_carrinho
           where tenant_id = ${ctx.cfg.tenantId}::uuid and telefone_chave = ${ctx.conversa.chave} and status = 'aberto'
           for update`),
      );
      const atual = this.carrinhoDaLinha(c);
      const r = mudanca(atual);
      if ((r as Recusa).ok === false) return { carrinho: atual, recusa: r as Recusa, mudou: false };
      const igual = Object.entries(r as Mudanca).every(([k, v]) => estavel(v) === estavel((atual as any)[k]));
      if (igual) return { carrinho: atual, recusa: null, mudou: false };
      const [novo] = await tx
        .update(roboCarrinho)
        .set({ ...(r as any), versao: sql`${roboCarrinho.versao} + 1`, atualizadoEm: new Date() })
        .where(eq(roboCarrinho.id, atual.id))
        .returning();
      return { carrinho: novo as Carrinho, recusa: null, mudou: true };
    });
  }

  /** A linha crua (snake_case, do `execute`) no formato do Drizzle. */
  private carrinhoDaLinha(r: any): Carrinho {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      telefone: r.telefone,
      telefoneChave: r.telefone_chave,
      clienteNome: r.cliente_nome,
      itens: r.itens ?? [],
      entrega: r.entrega ?? null,
      pagamento: r.pagamento ?? null,
      versao: Number(r.versao) || 0,
      status: r.status,
      pedidoId: r.pedido_id,
      resumoVersao: r.resumo_versao != null ? Number(r.resumo_versao) : null,
      itensFechados: !!r.itens_fechados,
      observacao: r.observacao ?? null,
      criadoEm: r.criado_em,
      atualizadoEm: r.atualizado_em,
    } as Carrinho;
  }

  /** A resposta de toda ferramenta que muda: o pedido como ficou e, se ficou completo, o resumo para conferir enviado. */
  private async responder(ctx: Contexto, menu: any, r: Mudou, feito?: string, aviso?: string | null) {
    const calc = await this.calcular(ctx, menu, r.carrinho, await this.clienteDaConversa(ctx));
    let pedido = calc.visao;
    if (!r.recusa && r.mudou && calc.podeRegistrar) pedido = (await this.mandarParaConferir(ctx, r.carrinho, calc)).visao;
    return r.recusa ? { ...r.recusa, pedido } : { ok: true, feito: feito ?? null, ...(aviso ? { aviso } : {}), pedido };
  }

  /**
   * O adicional que o cliente pediu mais de uma vez numa etapa que não repete (caminho A, 31/10/2026): entrou uma vez — o
   * robô avisa, em vez de dizer "2 ovos" com o pedido indo com 1.
   */
  private avisoDoQueNaoRepete(produto: any, naoRepete: string[]): string | null {
    if (!naoRepete?.length) return null;
    const nomes = naoRepete.join(', ');
    return `Avise o cliente: no ${produto?.nome ?? 'item'}, ${nomes} ${naoRepete.length > 1 ? 'vão' : 'vai'} uma vez só (a loja não deixa repetir ${naoRepete.length > 1 ? 'esses adicionais' : 'esse adicional'}). Entrou uma vez.`;
  }

  private async semMudar(ctx: Contexto, menu: any, r: Recusa) {
    return { ...r, pedido: (await this.calcular(ctx, menu, await this.carrinhoAberto(ctx), await this.clienteDaConversa(ctx))).visao };
  }

  // ───────────────────────── itens ─────────────────────────

  async mexerNosItens(
    ctx: Contexto,
    dto: { acao?: string; produto?: string; versao?: string; adicionais?: unknown; tirarAdicionais?: unknown; quantidade?: unknown; observacao?: string; linha?: unknown },
  ) {
    const menu = await this.cardapio.menu(ctx.token);
    const acao = acaoDe(dto?.acao);
    const obs = String(dto?.observacao ?? '').trim().slice(0, 140) || null;
    const produtos = new Map<string, any>((menu?.produtos ?? []).map((p: any) => [p.id, p]));
    const temLinha = Number(dto?.linha) > 0;

    if (ACOES.adicionar.includes(acao)) return this.adicionar(ctx, menu, dto, obs, produtos);
    if (ACOES.escolher.includes(acao)) return this.escolher(ctx, menu, dto, produtos);
    if (ACOES.repetir.includes(acao)) return this.repetirUltimo(ctx, menu, produtos);
    if (ACOES.trocarPeloTrio.includes(acao)) return this.trocarPeloTrio(ctx, menu, dto, produtos);
    if (ACOES.usarCashback.includes(acao) || ACOES.guardarCashback.includes(acao))
      return this.decidirCashback(ctx, menu, ACOES.usarCashback.includes(acao));
    if (ACOES.usarCupom.includes(acao)) return this.usarCupom(ctx, menu, dto?.observacao ?? dto?.produto);
    if (ACOES.tirarCupom.includes(acao)) {
      const r = await this.mudar(ctx, (c) => ({ pagamento: comBeneficios(c.pagamento, { cupom: null }) }));
      return this.responder(ctx, menu, r, 'cupom tirado');
    }
    if (ACOES.usarPremio.includes(acao)) return this.usarPremio(ctx, menu, dto);
    if (ACOES.guardarPremio.includes(acao)) {
      const r = await this.mudar(ctx, (c) => ({ pagamento: comBeneficios(c.pagamento, { premioDecidido: true, resgateId: null }) }));
      return this.responder(ctx, menu, r, 'prêmio guardado para depois');
    }
    if (ACOES.concluir.includes(acao)) {
      const r = await this.mudar(ctx, (c) => {
        const linhas = this.linhasDe(c);
        const alvo = temLinha ? linhas.find((l) => Number(l.linha) === Number(dto.linha)) : this.linhaNosExtras(linhas, produtos, menu);
        if (!alvo) return recusa('linha', 'Não há item esperando adicional ou observação.');
        return { itens: linhas.map((l) => (l === alvo ? { ...l, extras: true } : l)) };
      });
      return this.responder(ctx, menu, r, r.recusa ? undefined : 'item concluído');
    }
    if (ACOES.fechar.includes(acao)) {
      const r = await this.mudar(ctx, (c) => {
        const linhas = this.linhasDe(c);
        if (!linhas.length) return recusa('itens', 'O pedido ainda não tem itens.');
        return { itensFechados: true, itens: linhas.map((l) => (l.extras ? l : { ...l, extras: true })) };
      });
      return this.responder(ctx, menu, r, r.recusa ? undefined : 'itens fechados: siga para a entrega');
    }
    if (ACOES.obsDoPedido.includes(acao) || (acao === 'observacao' && !temLinha))
      return this.observacaoDoPedido(ctx, menu, dto?.observacao);
    if (ACOES.limpar.includes(acao)) {
      const r = await this.mudar(ctx, () => ({ itens: [], itensFechados: false }));
      return this.responder(ctx, menu, r, 'itens apagados');
    }
    if (ACOES.mexer.includes(acao)) {
      const remover = acao === 'remover' || acao === 'tirar';
      let n = Number(dto?.linha);
      let aviso: string | null = null;
      const r = await this.mudar(ctx, (c) => {
        const linhas = this.linhasDe(c);
        // Sem o número do item: o que está na pergunta dos extras, ou o único.
        const l = temLinha
          ? linhas.find((x) => Number(x.linha) === n)
          : !remover
            ? (this.linhaNosExtras(linhas, produtos, menu) ?? (linhas.length === 1 ? linhas[0] : undefined))
            : undefined;
        if (!l) return recusa('linha', `Diga em qual item (o número da linha no pedido)${dto?.linha ? `: não há o item ${dto.linha}` : ''}.`);
        n = Number(l.linha);
        if (remover) return { itens: linhas.filter((x) => x !== l) };
        const p = produtos.get(l.produtoId);
        if (!p) return recusa('produto_fora', 'Esse item saiu do cardápio: tire do pedido.');
        let mudou: Linha = { ...l };
        // Vazio ou 0 = não muda a quantidade (a ferramenta manda todos os campos); para tirar o item, acao = remover.
        if (dto?.quantidade != null && dto?.quantidade !== '' && Number(dto.quantidade) !== 0) {
          const qtd = quantidadeDoPedido(dto.quantidade);
          if (qtd == null) return recusa('quantidade', 'A quantidade vai de 1 a 50.');
          mudou.quantidade = qtd;
        }
        if (dto?.versao) {
          const v = acharVariacao(p, dto.versao);
          if (!v.ok) return recusa('versao', `${p.nome} não tem a versão "${dto.versao}".`, { opcoes: v.opcoes });
          mudou.variacaoId = v.variacao?.id ?? null;
        }
        if (dto?.adicionais != null || dto?.tirarAdicionais != null) {
          const esc = alterarEscolhas(p, l.complementos ?? [], dto?.adicionais, dto?.tirarAdicionais);
          if (esc.naoAchei.length)
            return recusa('adicional', `Não achei em ${p.nome}: ${esc.naoAchei.join(', ')}.`, { opcoesDoProduto: this.opcoesDoProduto(p) });
          if (esc.passouDoLimite.length)
            return recusa('limite', esc.passouDoLimite.map((g) => `${g.grupo}: no máximo ${g.maximo} (tire um antes)`).join('; '));
          mudou.complementos = esc.complementos;
          aviso = this.avisoDoQueNaoRepete(p, esc.naoRepete);
        }
        // Observação vazia não apaga a que havia; "nenhuma"/"sem observação" apaga. "Não, obrigado" (a resposta à pergunta
        // dos extras que veio como observação) não vira observação: só conclui o item. Observação dada também conclui.
        if (obs) {
          if (/^(nenhuma|sem observa)/i.test(obs)) mudou = { ...mudou, observacao: null, extras: true };
          else if (respostaNegativa(obs)) mudou = { ...mudou, extras: true };
          else mudou = { ...mudou, observacao: obs, extras: true };
        }
        return { itens: linhas.map((x) => (x === l ? mudou : x)) };
      });
      return this.responder(ctx, menu, r, r.recusa ? undefined : `item ${n} ${remover ? 'removido' : 'alterado'}`, aviso);
    }
    // Ação que o Regem não conhece: recusa explicada (200), para a IA corrigir — um erro 400 ela não sabe ler.
    return this.semMudar(
      ctx,
      menu,
      recusa(
        'acao',
        'Ação desconhecida: use adicionar, escolher, concluir, fechar, alterar, remover, observacao_do_pedido, repetir, trocar_pelo_trio, usar_cashback, guardar_cashback, usar_cupom, tirar_cupom, usar_premio, guardar_premio ou limpar (veja proximo.comoResponder).',
      ),
    );
  }

  // ───────────────────────── benefícios (Bloco 1b) ─────────────────────────

  /** O telefone dos benefícios: o do cadastro achado (como o pedido grava), senão a chave da conversa — o do `registrar`. */
  private telefoneDosBeneficios(ctx: Contexto, cli: ClienteDaConversa): string {
    return cli?.telefone ?? ctx.conversa.chave;
  }

  /** "Usar meu cashback" / "Guardar para depois": a decisão fica no carrinho e o total muda (ou não). */
  private async decidirCashback(ctx: Contexto, menu: any, usar: boolean) {
    const r = await this.mudar(ctx, (c) => {
      if (!this.linhasDe(c).length) return recusa('itens', 'O pedido ainda não tem itens.');
      return { pagamento: comBeneficios(c.pagamento, { usarCashback: usar }) };
    });
    return this.responder(ctx, menu, r, r.recusa ? undefined : usar ? 'cashback usado no pedido' : 'cashback guardado para depois');
  }

  /**
   * O cupom que o CLIENTE disse (o robô não oferece cupom): confere agora, pelas regras do cardápio (validade, mínimo,
   * primeiro pedido, uso por cliente), e explica a recusa. O desconto e as regras de empilhamento entram no total pela
   * mesma conta do pedido (`descontosDoPedido`).
   */
  private async usarCupom(ctx: Contexto, menu: any, codigoDito: unknown) {
    const codigo = String(codigoDito ?? '')
      .trim()
      .replace(/^cupom\s+/i, '')
      .replace(/\s+/g, '')
      .slice(0, 40);
    if (!codigo) return this.semMudar(ctx, menu, recusa('cupom', 'Peça o código do cupom e mande em observacao.'));
    const cli = await this.clienteDaConversa(ctx);
    const c = await this.carrinhoAberto(ctx);
    if (!c || !this.linhasDe(c).length) return this.semMudar(ctx, menu, recusa('itens', 'Monte o pedido antes: o cupom vale sobre os itens.'));
    const { subtotal } = await this.calcular(ctx, menu, c, cli);
    const v: any = await this.cardapio.validarCupomPublico(ctx.token, codigo, subtotal, this.telefoneDosBeneficios(ctx, cli));
    if (!v?.valido)
      return this.semMudar(ctx, menu, recusa('cupom', `O cupom ${codigo.toUpperCase()} não vale neste pedido${v?.motivo ? `: ${v.motivo}` : '.'}`));
    const r = await this.mudar(ctx, (atual) => ({ pagamento: comBeneficios(atual.pagamento, { cupom: String(v.codigo ?? codigo) }) }));
    return this.responder(ctx, menu, r, `cupom ${String(v.codigo ?? codigo).toUpperCase()} aplicado`);
  }

  /** "Usar o prêmio": o prêmio da fidelidade (o número dele na pergunta, ou o nome; o único, sem dizer) entra no pedido. */
  private async usarPremio(ctx: Contexto, menu: any, dto: { linha?: unknown; produto?: string; observacao?: string }) {
    const cli = await this.clienteDaConversa(ctx);
    const tel = this.telefoneDosBeneficios(ctx, cli);
    const { premios } = await this.cardapio.beneficiosDoCliente(ctx.cfg, tel, 0);
    if (!premios.length) return this.semMudar(ctx, menu, recusa('premio', 'O cliente não tem prêmio da fidelidade para usar agora.'));
    const n = Number(dto?.linha);
    const dito = normalizar(dto?.produto ?? dto?.observacao ?? '');
    const p =
      n > 0 && n <= premios.length
        ? premios[n - 1]
        : dito
          ? premios.find((x: any) => normalizar(x.nome).includes(dito) || dito.includes(normalizar(x.nome)))
          : premios.length === 1
            ? premios[0]
            : undefined;
    if (!p)
      return this.semMudar(
        ctx,
        menu,
        recusa('premio', 'Diga qual prêmio (o número dele na pergunta).', { premios: premios.map((x: any, i: number) => `${i + 1}. ${x.nome}`) }),
      );
    try {
      await this.cardapio.prepararPremioDoRobo(ctx.cfg, p.id, tel);
    } catch (e: any) {
      return this.semMudar(ctx, menu, recusa('premio', e?.message ?? 'Esse prêmio não está disponível.'));
    }
    const r = await this.mudar(ctx, (c) => ({ pagamento: comBeneficios(c.pagamento, { resgateId: p.id, premioDecidido: true }) }));
    return this.responder(ctx, menu, r, `prêmio "${p.nome}" no pedido`);
  }

  /**
   * A conversa já passou para a entrega ou o pagamento e o único passo dos itens que faltava era o "mais alguma coisa?":
   * conta como respondido ("só isso"). A ferramenta do n8n descreve só adicionar/alterar/remover/limpar — a IA que não
   * chama `fechar` faria a pergunta voltar em ciclo. As escolhas e os extras de cada item continuam exigidos.
   */
  private fechaSeSoFaltaOMaisAlgo(c: Carrinho, menu: any): Pick<Mudanca, 'itensFechados'> | Record<string, never> {
    if (c.itensFechados) return {};
    const linhas = this.linhasDe(c);
    if (!linhas.length) return {};
    const produtos = new Map<string, any>((menu?.produtos ?? []).map((p: any) => [p.id, p]));
    const prontas = linhas.every((l) => {
      const p = produtos.get(l.produtoId);
      return !!p && !escolhasQueFaltam(p, l).length && (!!l.extras || !pedeExtras(p, this.nomeDaCategoria(menu, p)));
    });
    return prontas ? { itensFechados: true } : {};
  }

  private linhasDe(c: Carrinho): Linha[] {
    return Array.isArray(c.itens) ? (c.itens as Linha[]) : [];
  }

  private nomeDaCategoria(menu: any, p: any): string | null {
    return (menu?.categorias ?? []).find((c: any) => c.id === p?.categoriaId)?.nome ?? null;
  }

  /** O item na pergunta dos extras: o primeiro com as escolhas obrigatórias feitas e os extras ainda por perguntar. */
  private linhaNosExtras(linhas: Linha[], produtos: Map<string, any>, menu: any): Linha | undefined {
    return linhas.find((l) => {
      const p = produtos.get(l.produtoId);
      return !!p && !l.extras && !escolhasQueFaltam(p, l).length && pedeExtras(p, this.nomeDaCategoria(menu, p));
    });
  }

  private async adicionar(ctx: Contexto, menu: any, dto: any, obs: string | null, produtos: Map<string, any>) {
    const achado = acharProduto(menu, dto?.produto);
    if (!achado.ok) {
      const r =
        achado.motivo === 'varios'
          ? recusa('varios_produtos', 'Mais de um produto com esse nome: pergunte qual o cliente quer.', { opcoes: achado.opcoes })
          : achado.motivo === 'esgotado'
            ? recusa('esgotado', `${achado.produto.nome} está esgotado agora. Ofereça outra opção.`)
            : recusa('produto_nao_encontrado', 'Não achei esse produto no cardápio: use a busca do cardápio e confira o nome.');
      return this.semMudar(ctx, menu, r);
    }
    const p = achado.produto;
    // A escolha que COMPLETA um item que esperava por ela vai para ele: no teste, "Batata Frita - Media" chegou como um
    // novo "adicionar Trio X-Bacon" e o pedido ganhou um segundo trio que o cliente não pediu.
    const temEscolha = (dto?.adicionais != null && String(dto.adicionais).trim() !== '') || !!dto?.versao;
    if (temEscolha) {
      const r0 = await this.carrinhoAberto(ctx);
      const esperando = r0
        ? this.linhasDe(r0).find((l) => l.produtoId === p.id && escolhasQueFaltam(p, l).length > 0)
        : undefined;
      if (esperando) return this.escolher(ctx, menu, { ...dto, linha: esperando.linha }, produtos);
    }
    const qtd = quantidadeDoPedido(dto?.quantidade);
    if (qtd == null) return this.semMudar(ctx, menu, recusa('quantidade', 'A quantidade vai de 1 a 50.'));
    const v = acharVariacao(p, dto?.versao);
    if (!v.ok && v.motivo === 'nenhuma')
      return this.semMudar(ctx, menu, recusa('versao', `${p.nome} não tem a versão "${dto?.versao}". As versões são estas.`, { opcoes: v.opcoes }));
    const esc = montarEscolhas(p, dto?.adicionais);
    if (esc.naoAchei.length)
      return this.semMudar(
        ctx,
        menu,
        recusa('adicional', `Não achei em ${p.nome}: ${esc.naoAchei.join(', ')}. Estas são as opções dele.`, { opcoesDoProduto: this.opcoesDoProduto(p) }),
      );
    if (esc.passouDoLimite.length)
      return this.semMudar(ctx, menu, recusa('limite', esc.passouDoLimite.map((g) => `${g.grupo}: no máximo ${g.maximo}`).join('; ')));
    const variacaoId = v.ok ? (v.variacao?.id ?? null) : null;
    // Os extras (adicional e observação) só se perguntam no lanche — e não quando o cliente já pediu com eles.
    const extras = !pedeExtras(p, this.nomeDaCategoria(menu, p)) || !!obs || temAdicionalOpcional(p, dto?.adicionais);
    const r = await this.mudar(ctx, (c) => {
      const linhas = this.linhasDe(c);
      const chave = (l: Pick<Linha, 'produtoId' | 'variacaoId' | 'complementos' | 'observacao'>) =>
        `${l.produtoId}|${l.variacaoId ?? ''}|${[...(l.complementos ?? [])].sort().join(',')}|${l.observacao ?? ''}`;
      const nova = { produtoId: p.id, variacaoId, complementos: esc.complementos, observacao: obs };
      const igual = linhas.find((l) => chave(l) === chave(nova));
      if (igual) {
        if (igual.quantidade + qtd > 50) return recusa('quantidade', 'A quantidade de um item vai até 50.');
        return { itens: linhas.map((l) => (l === igual ? { ...l, quantidade: l.quantidade + qtd } : l)) };
      }
      if (linhas.length >= MAX_LINHAS) return recusa('itens', `O pedido pelo WhatsApp vai até ${MAX_LINHAS} itens.`);
      const n = linhas.reduce((m, l) => Math.max(m, Number(l.linha) || 0), 0) + 1;
      return { itens: [...linhas, { linha: n, ...nova, quantidade: qtd, extras }] };
    });
    return this.responder(ctx, menu, r, `adicionado: ${qtd}x ${p.nome}`, this.avisoDoQueNaoRepete(p, esc.naoRepete));
  }

  /**
   * A resposta do cliente a uma pergunta do item: a opção de uma etapa obrigatória ("Batata Frita - Media"), a versão,
   * ou um adicional na pergunta dos extras ("Bacon"). Sem o número do item, vai para o item que espera por ela.
   */
  private async escolher(ctx: Contexto, menu: any, dto: any, produtos: Map<string, any>) {
    const nomes = dto?.adicionais;
    // "Não, obrigado" tocado na pergunta dos extras e mandado como adicional: conclui o item (não é opção do produto).
    if (!dto?.versao && respostaNegativa(nomes)) return this.mexerNosItens(ctx, { ...dto, acao: 'concluir', adicionais: undefined });
    const temLinha = Number(dto?.linha) > 0;
    let alvoN = 0;
    let aviso: string | null = null;
    const r = await this.mudar(ctx, (c) => {
      const linhas = this.linhasDe(c);
      const prod = (l: Linha) => produtos.get(l.produtoId);
      const primeiroNome = String(Array.isArray(nomes) ? (nomes[0] ?? '') : (nomes ?? '')).split(/[,;]/)[0];
      const aceita = (l: Linha) => !!prod(l) && (dto?.versao ? (prod(l).variacoes ?? []).length > 0 : temOpcao(prod(l), primeiroNome));
      const l = temLinha
        ? linhas.find((x) => Number(x.linha) === Number(dto.linha))
        : (linhas.find((x) => !!prod(x) && escolhasQueFaltam(prod(x), x).length > 0 && aceita(x)) ??
          linhas.find((x) => x === this.linhaNosExtras(linhas, produtos, menu) && aceita(x)) ??
          [...linhas].reverse().find(aceita));
      if (!l) return recusa('linha', 'Não achei o item dessa escolha: diga o número do item (linha) ou confira a opção.');
      alvoN = Number(l.linha);
      const p = prod(l);
      if (!p) return recusa('produto_fora', 'Esse item saiu do cardápio: tire do pedido.');
      let mudou: Linha = { ...l };
      if (dto?.versao) {
        const v = acharVariacao(p, dto.versao);
        if (!v.ok) return recusa('versao', `${p.nome} não tem a versão "${dto.versao}".`, { opcoes: v.opcoes });
        mudou.variacaoId = v.variacao?.id ?? null;
      }
      if (nomes != null && String(nomes).trim() !== '') {
        const esc = alterarEscolhas(p, l.complementos ?? [], nomes, []);
        if (esc.naoAchei.length)
          return recusa('adicional', `Não achei em ${p.nome}: ${esc.naoAchei.join(', ')}.`, { opcoesDoProduto: this.opcoesDoProduto(p) });
        if (esc.passouDoLimite.length)
          return recusa('limite', esc.passouDoLimite.map((g) => `${g.grupo}: no máximo ${g.maximo} (tire um antes)`).join('; '));
        mudou = { ...mudou, complementos: esc.complementos };
        aviso = this.avisoDoQueNaoRepete(p, esc.naoRepete);
      }
      return { itens: linhas.map((x) => (x === l ? mudou : x)) };
    });
    return this.responder(ctx, menu, r, r.recusa ? undefined : `item ${alvoN}: escolha anotada`, aviso);
  }

  /**
   * O ÚLTIMO pedido do cliente, pronto para repetir (pedido do dono, 31/10/2026: "no primeiro contato, verificar se o
   * cliente já está no sistema e os últimos pedidos para indicar repetir"): o mais recente não cancelado. Só entra o que
   * ainda está à venda, com as opções que o produto ainda tem; o que saiu fica em `foraDoCardapio`. Sem nada: null.
   */
  private async ultimoPedidoDoCliente(
    ctx: Contexto,
    cli: ClienteDaConversa,
    produtos: Map<string, any>,
  ): Promise<{ numero: string; quando: string; itens: string[]; foraDoCardapio: string[]; linhas: Omit<Linha, 'linha'>[] } | null> {
    if (!cli?.id) return null;
    const [p] = await this.db
      .select({ displayId: pedidoExterno.displayId, numero: pedidoExterno.numero, itens: pedidoExterno.itens, criadoEm: pedidoExterno.criadoEm })
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.tenantId, ctx.cfg.tenantId), eq(pedidoExterno.clienteId, cli.id), ne(pedidoExterno.status, 'cancelado')))
      .orderBy(desc(pedidoExterno.criadoEm))
      .limit(1);
    const itens: any[] = Array.isArray(p?.itens) ? (p!.itens as any[]) : [];
    if (!itens.length) return null;
    const linhas: Omit<Linha, 'linha'>[] = [];
    const textos: string[] = [];
    const fora: string[] = [];
    for (const it of itens) {
      const prod = produtos.get(String(it?.produtoId ?? ''));
      if (!prod || prod.esgotado) {
        if (it?.descricao) fora.push(String(it.descricao).slice(0, 60));
        continue;
      }
      const qtd = quantidadeDoPedido(it?.quantidade) ?? 1;
      const daOpcao = new Set<string>(
        (Array.isArray(prod.grupos) ? prod.grupos : []).flatMap((g: any) => (Array.isArray(g?.opcoes) ? g.opcoes : []).map((o: any) => String(o.id))),
      );
      const variacao = (prod.variacoes ?? []).find((v: any) => v.id === it?.variacaoId) ?? null;
      linhas.push({
        produtoId: prod.id,
        variacaoId: variacao?.id ?? null,
        complementos: (Array.isArray(it?.opcaoIds) ? it.opcaoIds : []).map(String).filter((id: string) => daOpcao.has(id)),
        quantidade: qtd,
        observacao: it?.observacao ? String(it.observacao).slice(0, 140) : null,
        // Repetir é pedir igual: os adicionais e a observação já vêm dele (a etapa obrigatória que faltar, o Regem pergunta).
        extras: true,
      });
      textos.push(`${qtd}x ${prod.nome}${variacao ? ` ${variacao.nome}` : ''}`);
    }
    if (!linhas.length) return null;
    const d = p!.criadoEm ? new Date(p!.criadoEm as any) : null;
    const quando = d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';
    return { numero: String(p!.displayId ?? p!.numero ?? ''), quando, itens: textos, foraDoCardapio: fora, linhas };
  }

  /** "Repetir o último pedido": os itens dele entram no pedido em montagem (depois do que já houver). */
  private async repetirUltimo(ctx: Contexto, menu: any, produtos: Map<string, any>) {
    const ultimo = await this.ultimoPedidoDoCliente(ctx, await this.clienteDaConversa(ctx), produtos);
    if (!ultimo) return this.semMudar(ctx, menu, recusa('repetir', 'Este cliente não tem pedido anterior para repetir: siga com o pedido novo.'));
    const r = await this.mudar(ctx, (c) => {
      const linhas = this.linhasDe(c);
      if (linhas.length + ultimo.linhas.length > MAX_LINHAS) return recusa('itens', `O pedido pelo WhatsApp vai até ${MAX_LINHAS} itens.`);
      let n = linhas.reduce((m, l) => Math.max(m, Number(l.linha) || 0), 0);
      return { itens: [...linhas, ...ultimo.linhas.map((l) => ({ ...l, linha: ++n }))], itensFechados: false };
    });
    const fora = ultimo.foraDoCardapio.length ? ` (fora do cardápio agora: ${ultimo.foraDoCardapio.join(', ')})` : '';
    return this.responder(ctx, menu, r, r.recusa ? undefined : `último pedido repetido: ${ultimo.itens.join(', ')}${fora}`);
  }

  /**
   * "Trocar pelo trio" (a oferta do "mais alguma coisa?"): o lanche vira o trio dele, com a mesma quantidade e observação;
   * os adicionais que o trio também tem continuam. A batata e a bebida do trio, o Regem pergunta em seguida.
   */
  private async trocarPeloTrio(ctx: Contexto, menu: any, dto: any, produtos: Map<string, any>) {
    let trioNome = '';
    const r = await this.mudar(ctx, (c) => {
      const linhas = this.linhasDe(c);
      const l = Number(dto?.linha) > 0 ? linhas.find((x) => Number(x.linha) === Number(dto.linha)) : linhas.find((x) => !!trioDoLanche(menu, produtos.get(x.produtoId)));
      if (!l) return recusa('linha', 'Diga em qual item (linha) trocar pelo trio.');
      const lanche = produtos.get(l.produtoId);
      const trio = trioDoLanche(menu, lanche);
      if (!trio) return recusa('trio', `${lanche?.nome ?? 'Este item'} não tem trio à venda agora.`);
      trioNome = String(trio.nome);
      const nomes = (l.complementos ?? [])
        .map((id) => (lanche?.grupos ?? []).flatMap((g: any) => g?.opcoes ?? []).find((o: any) => o.id === id)?.nome)
        .filter(Boolean);
      const esc = montarEscolhas(trio, nomes);
      return { itens: linhas.map((x) => (x === l ? { ...l, produtoId: trio.id, variacaoId: null, complementos: esc.complementos, extras: true } : x)) };
    });
    return this.responder(ctx, menu, r, r.recusa ? undefined : `trocado pelo ${trioNome}`);
  }

  /** A observação GERAL do pedido ("interfone ruim, ligar ao chegar") — pedido do dono. "Nenhuma" apaga. */
  private async observacaoDoPedido(ctx: Contexto, menu: any, texto: unknown) {
    // Limpa como o pedido grava (uma linha, até 300 letras — mig 346): o resumo mostra o que vai ser gravado.
    const t = textoDaObservacao(texto);
    if (!t) return this.semMudar(ctx, menu, recusa('observacao', 'Qual é a observação? Mande o texto em observacao.'));
    const valor = /^(nenhuma|sem observa|nao|não)\.?$/i.test(t) ? null : t;
    const r = await this.mudar(ctx, () => ({ observacao: valor }));
    return this.responder(ctx, menu, r, valor ? 'observação do pedido anotada' : 'observação do pedido apagada');
  }

  /** As etapas do produto com as opções (para o robô dizer o que dá para escolher). */
  private opcoesDoProduto(p: any) {
    return (Array.isArray(p?.grupos) ? p.grupos : []).map((g: any) => ({
      etapa: g.nome,
      obrigatoria: g.obrigatorio === true || Number(g.min) > 0,
      maximo: g.max ?? null,
      opcoes: (g.opcoes ?? []).slice(0, 25).map((o: any) => (Number(o.precoDelta) > 0 ? `${o.nome} (+${reais(o.precoDelta)})` : o.nome)),
    }));
  }

  // ───────────────────────── nome ─────────────────────────

  async definirNome(ctx: Contexto, dto: { nome?: string }) {
    const menu = await this.cardapio.menu(ctx.token);
    const nome = nomeDoCliente(dto?.nome);
    const r = await this.mudar(ctx, () => (nome ? { clienteNome: nome } : recusa('nome', 'Nome inválido: pergunte de novo.')));
    return this.responder(ctx, menu, r, nome ? `nome: ${nome}` : undefined);
  }

  // ───────────────────────── entrega ─────────────────────────

  /** Os tipos que a loja faz pelo cardápio e os que estão abertos agora. */
  private tipos(menu: any) {
    const oferecidos: ('entrega' | 'retirada')[] = [];
    if (menu?.tipos?.delivery !== false) oferecidos.push('entrega');
    if (menu?.tipos?.retirada) oferecidos.push('retirada');
    const abertos = oferecidos.filter((t) => menu?.abertoPorTipo?.[t] !== false && menu?.loja?.aberto !== false);
    return { oferecidos, abertos };
  }

  async definirEntrega(
    ctx: Contexto,
    dto: { tipo?: string; endereco?: unknown; rua?: string; numero?: string; bairro?: string; referencia?: string; localizacao?: string; lat?: unknown; lng?: unknown },
  ) {
    const menu = await this.cardapio.menu(ctx.token);
    const { oferecidos, abertos } = this.tipos(menu);
    const t = normalizar(dto?.tipo);
    let tipo: 'entrega' | 'retirada' | null = /retir|buscar|balcao|pegar/.test(t) ? 'retirada' : /entreg|delivery|casa/.test(t) ? 'entrega' : null;
    if (!tipo && oferecidos.length === 1) tipo = oferecidos[0];
    if (!tipo && (Number(dto?.endereco) > 0 || dto?.rua || dto?.bairro || dto?.localizacao || dto?.referencia)) tipo = 'entrega';
    if (!tipo) {
      // Só a referência, num pedido que já é de entrega (o passo do complemento): vale para ele.
      const atual0 = await this.carrinhoAberto(ctx);
      if ((atual0?.entrega as any)?.tipo === 'entrega') tipo = 'entrega';
    }
    if (!tipo) return this.semMudar(ctx, menu, recusa('tipo', 'Diga se é entrega ou retirada.', { tipos: oferecidos }));
    if (!oferecidos.includes(tipo))
      return this.semMudar(ctx, menu, recusa('tipo', tipo === 'retirada' ? 'A loja não faz retirada pelo cardápio.' : 'A loja não faz entrega pelo cardápio.'));
    if (!abertos.includes(tipo)) {
      const volta = menu?.proximaAbertura?.[tipo];
      return this.semMudar(
        ctx,
        menu,
        recusa('fechado', `${tipo === 'entrega' ? 'A entrega' : 'A retirada'} está fechada agora${volta ? ` (volta ${String(volta).includes(' ') ? volta : `às ${volta}`})` : ''}.`),
      );
    }
    if (tipo === 'retirada') {
      const r = await this.mudar(ctx, (c) => ({ entrega: { tipo: 'retirada' }, ...this.fechaSeSoFaltaOMaisAlgo(c, menu) }));
      return this.responder(ctx, menu, r, 'retirada na loja');
    }

    // Entrega: o endereço salvo escolhido, ou o que já estava no pedido com o que veio agora por cima.
    const cli = await this.clienteDaConversa(ctx);
    const atual = await this.carrinhoAberto(ctx);
    const antes: any = atual?.entrega && (atual.entrega as any).tipo === 'entrega' ? atual.entrega : null;
    let e: Extract<EntregaDoCarrinho, { tipo: 'entrega' }>;
    if (Number(dto?.endereco) > 0) {
      const salvo = (cli?.enderecos ?? [])[Number(dto.endereco) - 1];
      if (!salvo) return this.semMudar(ctx, menu, recusa('endereco', 'Esse endereço salvo não existe: confira o número na lista.'));
      e = {
        tipo: 'entrega',
        rua: salvo.logradouro ?? '',
        numero: salvo.numero ?? '',
        bairro: salvo.bairro ?? null,
        bairroId: salvo.bairroId ?? null,
        referencia: salvo.referencia || salvo.complemento || null,
        lat: salvo.lat != null ? Number(salvo.lat) : null,
        lng: salvo.lng != null ? Number(salvo.lng) : null,
        enderecoId: salvo.id,
      };
    } else {
      const novoEndereco = !!(dto?.rua || dto?.numero);
      e = {
        tipo: 'entrega',
        rua: String(dto?.rua ?? (novoEndereco ? '' : (antes?.rua ?? ''))).trim().slice(0, 120),
        numero: String(dto?.numero ?? (novoEndereco ? '' : (antes?.numero ?? ''))).trim().slice(0, 20),
        bairro: dto?.bairro ? String(dto.bairro).trim().slice(0, 80) : novoEndereco ? null : (antes?.bairro ?? null),
        bairroId: dto?.bairro || novoEndereco ? null : (antes?.bairroId ?? null),
        referencia: novoEndereco ? null : (antes?.referencia ?? null),
        lat: novoEndereco ? null : (antes?.lat ?? null),
        lng: novoEndereco ? null : (antes?.lng ?? null),
        enderecoId: novoEndereco ? null : (antes?.enderecoId ?? null),
      };
    }
    if (dto?.referencia != null && String(dto.referencia).trim()) e.referencia = referenciaDoPedido(dto.referencia);
    const ponto = this.pontoDe(dto);
    if (ponto) {
      e.lat = ponto.lat;
      e.lng = ponto.lng;
    }
    if (!e.rua || !e.numero)
      return this.semMudar(ctx, menu, recusa('endereco', 'Falta a rua e o número do endereço de entrega.', { tem: { rua: e.rua || null, numero: e.numero || null } }));

    // A área: bairro da lista (modo bairro) ou a distância pelas faixas (modo distância) — a mesma conta do cardápio.
    if (menu?.loja?.areaModo === 'raio') {
      const taxa = await this.cardapio.taxaDeEntrega(ctx.cfg, { rua: e.rua, numero: e.numero, lat: e.lat ?? undefined, lng: e.lng ?? undefined }, 0);
      if (taxa.semLocalizacao)
        return this.semMudar(
          ctx,
          menu,
          recusa('localizacao', 'Não achei esse endereço no mapa. Peça ao cliente a localização pelo WhatsApp (clipe → Localização) ou confira a rua e o número.'),
        );
      if (taxa.alemDaUltimaFaixa) return this.semMudar(ctx, menu, this.foraDaArea(oferecidos, abertos, taxa.km));
      if (taxa.ponto) {
        e.lat = taxa.ponto.lat;
        e.lng = taxa.ponto.lng;
      }
    } else {
      const lista: any[] = Array.isArray(menu?.bairros) ? menu.bairros : [];
      const pelaLista = e.bairroId ? lista.find((b) => b.id === e.bairroId) : null;
      if (pelaLista) e.bairro = pelaLista.nome;
      else {
        if (!e.bairro) return this.semMudar(ctx, menu, recusa('bairro', 'Falta o bairro do endereço de entrega.'));
        const b = acharBairro(menu, e.bairro);
        if (!b.ok)
          return this.semMudar(
            ctx,
            menu,
            b.parecidos.length
              ? recusa('bairro', `Não achei o bairro "${e.bairro}" na lista de entrega. Pergunte se é um destes.`, { parecidos: b.parecidos })
              : this.foraDaArea(oferecidos, abertos, null),
          );
        e.bairro = b.bairro.nome;
        e.bairroId = b.bairro.id;
      }
    }
    const r = await this.mudar(ctx, (c) => ({ entrega: e, ...this.fechaSeSoFaltaOMaisAlgo(c, menu) }));
    return this.responder(ctx, menu, r, `entrega: ${textoDoEndereco(e)}`);
  }

  /** "Infelizmente nosso delivery não cobre a região" — e a retirada, quando a loja faz e está aberta. */
  private foraDaArea(oferecidos: string[], abertos: string[], km: number | null): Recusa {
    const retirada = oferecidos.includes('retirada') && abertos.includes('retirada');
    return recusa('fora_da_area', 'Infelizmente nosso delivery não cobre a região.', {
      ...(km != null ? { distanciaKm: Math.round(km * 10) / 10 } : {}),
      alternativa: retirada ? 'O cliente pode retirar na loja.' : null,
    });
  }

  /** A localização que o cliente mandou: "lat,lng" (o texto "[localização] -22.9,-43.2") ou os dois campos. */
  private pontoDe(dto: { localizacao?: string; lat?: unknown; lng?: unknown }): { lat: number; lng: number } | null {
    const m = String(dto?.localizacao ?? '').match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
    const lat = m ? Number(m[1]) : Number(dto?.lat);
    const lng = m ? Number(m[2]) : Number(dto?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
    return { lat, lng };
  }

  // ───────────────────────── pagamento ─────────────────────────

  /**
   * A forma de pagamento e o troco. "Dinheiro" e "Cartão na entrega" são o "pagar na entrega" do cardápio com o MEIO
   * dito (só o dinheiro pede troco). "Sem troco" só vale como resposta à pergunta do troco — no teste, a IA mandou
   * `semTroco = true` sozinha e o Regem aceitou sem perguntar. O troco em texto ("não preciso", "100") vale sempre.
   */
  async definirPagamento(ctx: Contexto, dto: { forma?: string; troco?: unknown; semTroco?: unknown }) {
    const menu = await this.cardapio.menu(ctx.token);
    const atual = await this.carrinhoAberto(ctx);
    const { oferecidos } = this.tipos(menu);
    const tipo = ((atual?.entrega as any)?.tipo as 'entrega' | 'retirada' | undefined) ?? (oferecidos.length === 1 ? oferecidos[0] : null);
    const antes = (atual?.pagamento as PagamentoDoCarrinho | null) ?? null;
    let forma: string;
    let meio: Meio | null;
    if (!String(dto?.forma ?? '').trim() && antes?.forma) {
      // Só o troco (a forma já estava escolhida).
      forma = antes.forma;
      meio = antes.meio ?? null;
    } else {
      const f = acharForma(menu, tipo, dto?.forma);
      if (!f.ok) {
        const link = this.cardapio.linkDoCardapio(ctx.token);
        return this.semMudar(
          ctx,
          menu,
          f.motivo === 'so_pelo_link'
            ? recusa('so_pelo_link', `Pix e cartão online só pelo link do cardápio (${link}). Pelo WhatsApp, as formas são as da lista.`, { formas: f.opcoes })
            : recusa('forma', 'Essa forma de pagamento não está no cardápio. Ofereça as da lista.', { formas: f.opcoes, soPeloLink: formasSoPeloLink(menu) }),
        );
      }
      forma = f.forma;
      // A forma de novo sem dizer o meio ("pagar na entrega") não apaga o "dinheiro" que o cliente já tinha dito.
      meio = f.meio ?? (antes && antes.forma === f.forma ? (antes.meio ?? null) : null);
    }
    const mesma = !!antes && antes.forma === forma && (antes.meio ?? null) === meio;
    const pg: PagamentoDoCarrinho = {
      forma,
      meio,
      trocoPara: mesma ? antes!.trocoPara : null,
      semTroco: mesma ? antes!.semTroco : false,
    };
    const trocoDito = dto?.troco != null && String(dto.troco).trim() !== '' && String(dto.troco).trim() !== '0';
    if (meio === 'cartao') {
      pg.trocoPara = null;
      pg.semTroco = false;
    } else if (trocoDito) {
      if (semTrocoNoTexto(dto.troco)) {
        pg.semTroco = true;
        pg.trocoPara = null;
      } else {
        const v = valorDoTroco(dto.troco);
        if (v == null) return this.semMudar(ctx, menu, recusa('troco', 'Não entendi o valor do troco: peça só o número (ex.: 100), ou "não preciso".'));
        pg.trocoPara = v;
        pg.semTroco = false;
        if (pg.forma === 'entrega' && !pg.meio) pg.meio = 'dinheiro'; // troco é de dinheiro
      }
    } else if (dto?.semTroco === true || String(dto?.semTroco ?? '').toLowerCase() === 'true') {
      if (mesma && precisaDeTroco(antes)) {
        pg.semTroco = true;
        pg.trocoPara = null;
      }
    }
    // As decisões dos benefícios valem as do carrinho travado (uma resposta do cashback ao mesmo tempo não se perde).
    const r = await this.mudar(ctx, (c) => {
      const ben = (c.pagamento as PagamentoDoCarrinho | null)?.beneficios;
      return { pagamento: ben ? { ...pg, beneficios: ben } : pg, ...this.fechaSeSoFaltaOMaisAlgo(c, menu) };
    });
    return this.responder(ctx, menu, r, `pagamento: ${this.nomeDaForma(menu, tipo, pg)}`);
  }

  /** O nome da forma para o cliente e para a loja: "Dinheiro (pago na entrega)", "Cartão na entrega (maquininha)". */
  private nomeDaForma(menu: any, tipo: 'entrega' | 'retirada' | null, pg: PagamentoDoCarrinho): string {
    const op = opcoesDePagamento(menu, tipo).find((o) => o.forma === pg.forma && (o.meio ?? null) === (pg.meio ?? null));
    if (op && pg.forma === 'entrega') return op.meio === 'dinheiro' ? `Dinheiro (${op.detalhe})` : `${op.titulo} (maquininha)`;
    if (op) return op.detalhe ? `${op.titulo} (${op.detalhe})` : op.titulo;
    return formasDoRobo(menu, tipo).find((f) => f.forma === pg.forma)?.nome ?? pg.forma;
  }

  // ───────────────────────── cancelar ─────────────────────────

  async cancelar(ctx: Contexto) {
    const c = await this.carrinhoAberto(ctx);
    if (c)
      await this.db
        .update(roboCarrinho)
        .set({ status: 'cancelado', atualizadoEm: new Date() })
        .where(and(eq(roboCarrinho.id, c.id), eq(roboCarrinho.status, 'aberto')));
    return { ok: true, feito: c ? 'pedido em montagem cancelado' : 'não havia pedido em montagem' };
  }

  // ───────────────────────── o estado ─────────────────────────

  /**
   * Os produtos que o cliente mais pede (os itens dos últimos 10 pedidos não cancelados, do mais pedido para o menos) —
   * a sugestão do "mais alguma coisa?" oferece primeiro o que ele costuma levar (Bloco 1 do plano de 31/10/2026).
   */
  private async preferidosDoCliente(ctx: Contexto, clienteId: string): Promise<string[]> {
    const rows = await this.db
      .select({ itens: pedidoExterno.itens })
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.tenantId, ctx.cfg.tenantId), eq(pedidoExterno.clienteId, clienteId), ne(pedidoExterno.status, 'cancelado')))
      .orderBy(desc(pedidoExterno.criadoEm))
      .limit(10);
    const conta = new Map<string, number>();
    for (const r of rows)
      for (const it of Array.isArray(r.itens) ? (r.itens as any[]) : [])
        if (it?.produtoId) conta.set(String(it.produtoId), (conta.get(String(it.produtoId)) ?? 0) + (Number(it.quantidade) || 1));
    return [...conta.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }

  /**
   * A sugestão do fim dos itens: bebida se o pedido não tem (o trio com refri tem); senão sobremesa; senão porção. Do papel
   * escolhido, primeiro o que o cliente costuma pedir (`preferidos`), depois os destaques da loja.
   */
  private sugestao(menu: any, linhas: Linha[], produtos: Map<string, any>, preferidos: string[] = []): EstadoDaConducao['sugestao'] {
    const lugar = (id: string) => {
      const i = preferidos.indexOf(id);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const cats = new Map<string, string>((menu?.categorias ?? []).map((c: any) => [c.id, c.nome]));
    const papelDo = (p: any) => papelDaCategoria(cats.get(p?.categoriaId));
    const tem = { bebida: false, sobremesa: false, porcao: false };
    for (const l of linhas) {
      const p = produtos.get(l.produtoId);
      if (!p) continue;
      const papel = papelDo(p);
      if (papel) tem[papel] = true;
      // O trio leva a bebida escolhida numa etapa de bebida ("Escolha a Bebida").
      for (const g of Array.isArray(p.grupos) ? p.grupos : []) {
        const ws = palavrasDe(g?.nome);
        if (GRUPOS.bebida.some((w) => ws.has(w)) && (g.opcoes ?? []).some((o: any) => (l.complementos ?? []).includes(o.id))) tem.bebida = true;
      }
    }
    for (const papel of ['bebida', 'sobremesa', 'porcao'] as const) {
      if (tem[papel]) continue;
      const ofertas = (menu?.produtos ?? [])
        .filter((p: any) => !p.esgotado && papelDo(p) === papel)
        .sort((a: any, b: any) => lugar(a.id) - lugar(b.id) || Number(!!b.destaque) - Number(!!a.destaque))
        .slice(0, 3)
        .map((p: any) => opcaoComDetalhe(String(p.nome), reais(p.precoVenda)));
      if (ofertas.length) return { papel, opcoes: ofertas };
    }
    return null;
  }

  /** O passo final: o resumo para conferir (com os botões) e o que fazer com cada resposta. */
  private passoDeConfirmar(enviado: boolean): Falta {
    return {
      campo: 'confirmar',
      pergunta: enviado
        ? 'O RESUMO PARA CONFERIR JÁ FOI ENVIADO ao cliente pelo Regem, com os botões "Pode registrar", "Pôr observação" e "Quero mudar algo". Não repita o resumo nem ponha OPCOES: responda só algo curto, como "Confere aí e me diz se está tudo certo 👆".'
        : 'O pedido está completo: o Regem manda o resumo para conferir com os botões.',
      opcoes: OPCOES_DA_CONFERENCIA,
      comoResponder:
        '"Pode registrar" (ou 1): registrar_pedido; "Pôr observação" (ou 2): pergunte a observação (ex.: interfone ruim, ligar ao chegar, não buzinar) e use mexer_no_pedido com acao = observacao_do_pedido e observacao = o texto; "Quero mudar algo" (ou 3): pergunte o que mudar.',
    };
  }

  /**
   * O pedido como está: cada item com o preço (as contas do cardápio), a entrega com a taxa, o pagamento com o troco, o
   * total, o que falta (na ordem) e a PRÓXIMA pergunta (`proximo`). Também devolve o resumo para conferir.
   */
  private async calcular(ctx: Contexto, menu: any, c: Carrinho | null, cli: ClienteDaConversa) {
    const linhas: Linha[] = Array.isArray(c?.itens) ? (c!.itens as Linha[]) : [];
    const produtos = new Map<string, any>((menu?.produtos ?? []).map((p: any) => [p.id, p]));
    const avisos: string[] = [];
    const conducao: EstadoDaConducao['linhas'] = [];
    const prontas: Linha[] = [];
    let bloqueado = false;
    for (const l of linhas) {
      const p = produtos.get(l.produtoId);
      if (!p) {
        avisos.push(`O item ${l.linha} saiu do cardápio: tire do pedido.`);
        bloqueado = true;
      } else if (p.esgotado) {
        avisos.push(`O item ${l.linha} (${p.nome}) esgotou agora: tire do pedido ou troque.`);
        bloqueado = true;
      } else {
        const faltam = escolhasQueFaltam(p, l);
        if (!faltam.length) prontas.push(l);
        conducao.push({
          linha: l.linha,
          produto: String(p.nome),
          faltaEscolher: faltam.map((x) => ({ grupo: x.grupo, opcoes: x.opcoes })),
          extrasPendentes: !l.extras && pedeExtras(p, this.nomeDaCategoria(menu, p)),
          adicionais: adicionaisDoItem(p, l.complementos),
        });
      }
    }
    // O preço das linhas prontas pelas contas do pedido do cardápio. Falhou todo junto: confere uma a uma para dizer qual.
    const precos = new Map<number, { descricao: string; unitario: number; quantidade: number }>();
    let subtotalCent = 0;
    // Os itens precificados (o formato do pedido do cardápio): o prêmio de produto da fidelidade confere por eles.
    let itensPrecificados: any[] = [];
    if (prontas.length) {
      const precificar = async (ls: Linha[]) => {
        const { porId, faixasAtacado } = await this.cardapio.conferirProdutosDoPedido(ctx.cfg, itensDoPedido(ls));
        return this.cardapio.precificarItensDoPedido(ctx.cfg, itensDoPedido(ls), porId, faixasAtacado);
      };
      try {
        const { itensOut, totalCent } = await precificar(prontas);
        subtotalCent = totalCent;
        itensPrecificados = itensOut;
        itensOut.forEach((it: any, i: number) => precos.set(prontas[i].linha, { descricao: it.descricao, unitario: it.precoUnitario, quantidade: it.quantidade }));
      } catch {
        bloqueado = true;
        for (const l of prontas) {
          try {
            const { itensOut, totalCent } = await precificar([l]);
            subtotalCent += totalCent;
            precos.set(l.linha, { descricao: itensOut[0].descricao, unitario: itensOut[0].precoUnitario, quantidade: itensOut[0].quantidade });
          } catch (e: any) {
            avisos.push(`Item ${l.linha}: ${e?.message ?? 'não deu para conferir'}`);
          }
        }
      }
    }
    const subtotal = paraReais(subtotalCent);

    // Entrega e taxa (a mesma conta do cardápio); fora da área de novo (a loja mudou a lista ou as faixas) → falta.
    const { oferecidos, abertos } = this.tipos(menu);
    const en: any = c?.entrega ?? null;
    let tipo: 'entrega' | 'retirada' | null = en?.tipo === 'entrega' || en?.tipo === 'retirada' ? en.tipo : null;
    if (!tipo && oferecidos.length === 1) tipo = oferecidos[0];
    if (tipo && !abertos.includes(tipo)) {
      avisos.push(`${tipo === 'entrega' ? 'A entrega' : 'A retirada'} está fechada agora.`);
      bloqueado = true;
    }
    let taxa = 0;
    let taxaCheia = 0;
    let foraDaArea = false;
    if (tipo === 'entrega' && en?.tipo === 'entrega' && en.rua && en.numero) {
      if (menu?.loja?.areaModo === 'raio' || (en.bairroId && (menu?.bairros ?? []).some((b: any) => b.id === en.bairroId))) {
        const t = await this.cardapio.taxaDeEntrega(
          ctx.cfg,
          { bairroId: en.bairroId ?? undefined, rua: en.rua, numero: en.numero, lat: en.lat ?? undefined, lng: en.lng ?? undefined },
          subtotal,
        );
        taxa = t.taxa;
        taxaCheia = t.taxaCheia;
        foraDaArea = t.alemDaUltimaFaixa || (menu?.loja?.areaModo === 'raio' && t.semLocalizacao);
      } else foraDaArea = true;
    }

    // Bloco 1b (pedido do dono, 31/10/2026): prêmio, cupom e cashback pela MESMA conta do pedido do cardápio
    // (`descontosDoPedido`), só o que o cliente escolheu — o total que ele confere é o que o pedido grava (V74). Com os
    // itens fechados, os benefícios que ele tem e ainda não decidiu viram a pergunta antes do pagamento.
    const ben = beneficiosDe(c?.pagamento);
    const telBen = this.telefoneDosBeneficios(ctx, cli);
    const itensFechadosEProntos = !!c?.itensFechados && linhas.length > 0 && !bloqueado && prontas.length === linhas.length;
    let descontoCent = 0;
    const descontos: { rotulo: string; valor: number }[] = [];
    if (itensFechadosEProntos && (ben.usarCashback === true || ben.cupom || ben.resgateId)) {
      const d = await this.cardapio
        .descontosDoPedido(ctx.cfg, {
          telefone: telBen,
          resgateId: ben.resgateId ?? undefined,
          cupom: ben.cupom ?? undefined,
          usarCashback: ben.usarCashback === true,
          tipo: tipo ?? 'retirada',
          itensOut: itensPrecificados,
          totalCent: subtotalCent,
        })
        .catch((e: any) => {
          // Sem a conta do desconto que o cliente escolheu, o total do resumo não seria o gravado: não registra agora.
          this.logger.warn(`descontos do pedido do robô não calculados: ${e?.message ?? e}`);
          return null;
        });
      if (!d) {
        bloqueado = true;
        avisos.push('Não deu para calcular o desconto agora: peça um instante ao cliente e tente de novo.');
      } else {
        descontoCent = d.descontoCent;
        if (d.freteGratis) taxa = 0; // cupom de frete grátis zera a entrega
        avisos.push(...d.avisos);
        if (ben.cupom && !d.cup.valido && !d.avisos.some((a) => /cupom/i.test(a)))
          avisos.push(`O cupom ${String(ben.cupom).toUpperCase()} não vale neste pedido${d.cup.motivo ? `: ${d.cup.motivo}` : '.'}`);
        if (ben.resgateId && !((d.premio.desconto || 0) > 0) && !d.avisos.some((a) => /fidelidade/i.test(a)))
          avisos.push('O prêmio da fidelidade não vale neste pedido (o produto do prêmio não está no pedido): diga ao cliente.');
        // O detalhe por benefício, rateado sobre o desconto final como o pedido grava (a soma fecha com o total).
        const partes = [
          { rotulo: `Cupom ${String(d.cup.codigo ?? ben.cupom ?? '').toUpperCase()}`.trim(), cent: d.cup.valido ? paraCentavos(d.cup.desconto || 0) : 0 },
          { rotulo: d.premio.plano ? `Prêmio · ${d.premio.plano}` : 'Prêmio da fidelidade', cent: paraCentavos(d.premio.desconto || 0) },
          { rotulo: 'Cashback', cent: paraCentavos(d.cb.desconto || 0) },
        ].filter((p) => p.cent > 0);
        const rateio = ratearCentavos(
          partes.map((p) => p.cent),
          descontoCent,
        );
        partes.forEach((p, i) => rateio[i] > 0 && descontos.push({ rotulo: p.rotulo, valor: paraReais(rateio[i]) }));
      }
    }
    // Os benefícios que o cliente tem e ainda não decidiu. Se a leitura falhar, a conversa segue sem a pergunta (o
    // cliente só não vê a oferta agora) e o motivo fica no log.
    let beneficiosPendentes: EstadoDaConducao['beneficios'] = null;
    const premioPendente = !ben.premioDecidido && !ben.resgateId;
    if (itensFechadosEProntos && !bloqueado && (ben.usarCashback === undefined || premioPendente)) {
      const restanteCent = Math.max(0, subtotalCent - descontoCent);
      const b = await this.cardapio.beneficiosDoCliente(ctx.cfg, telBen, paraReais(restanteCent)).catch((e: any) => {
        this.logger.warn(`benefícios do cliente não lidos (a pergunta do cashback e do prêmio fica para depois): ${e?.message ?? e}`);
        return null;
      });
      const premios = b && premioPendente ? b.premios : [];
      const cash = b && ben.usarCashback === undefined ? b.cashbackParaUsar : 0;
      if (premios.length || cash > 0)
        beneficiosPendentes = {
          premios: premios.map((p: any) => ({ nome: p.nome })),
          cashbackParaUsar: cash,
          totalComCashback: paraReais(Math.max(0, restanteCent - paraCentavos(cash)) + paraCentavos(taxa)),
        };
    }
    const totalCent = Math.max(0, subtotalCent - descontoCent) + paraCentavos(taxa);
    const total = paraReais(totalCent);
    // O cashback que o pedido vai dar (a mesma conta do crédito na confirmação): só com os itens fechados. Só informa: a
    // previsão que falha não aparece, e o crédito de verdade acontece na confirmação do pedido do mesmo jeito.
    const ganho = itensFechadosEProntos
      ? await this.cardapio.previsaoDoCashback(ctx.cfg.tenantId, total, taxa).catch((e: any) => {
          this.logger.warn(`previsão do cashback do pedido não calculada: ${e?.message ?? e}`);
          return { valor: 0, pontos: 0 };
        })
      : { valor: 0, pontos: 0 };

    // Pagamento: a forma ainda é do cardápio? O troco ainda cobre o total?
    const pg = (c?.pagamento as PagamentoDoCarrinho | null) ?? null;
    const formas = formasDoRobo(menu, tipo);
    const formaServe = !!pg && formas.some((f) => f.forma === pg.forma);
    let trocoRuim = false;
    if (pg && formaServe && pg.trocoPara != null && pg.trocoPara < total) {
      avisos.push(`O troco para ${reais(pg.trocoPara)} não cobre o total de ${reais(total)}: pergunte de novo.`);
      trocoRuim = true;
    }
    const nome = c?.clienteNome ?? cli?.nome ?? null;
    const ultimo = cli?.ultimo ? { n: cli.ultimo, texto: this.textoDoSalvo(cli.enderecos[cli.ultimo - 1]) } : null;
    // O "mais alguma coisa?" (Bloco 1 do plano de 31/10/2026): a troca do lanche pelo trio dele e a sugestão pelo que o
    // cliente costuma pedir — só se lê o histórico quando a pergunta ainda vai ser feita.
    const ofereceMais = linhas.length > 0 && !c?.itensFechados;
    const preferidos = ofereceMais && cli?.id ? await this.preferidosDoCliente(ctx, cli.id) : [];
    const ehTrio = (p: any) => /^(trio|combo)\b/.test(normalizar(p?.nome));
    let trocaPorTrio: EstadoDaConducao['trocaPorTrio'] = null;
    for (const l of ofereceMais ? linhas : []) {
      const lanche = produtos.get(l.produtoId);
      const trio = trioDoLanche(menu, lanche);
      if (!trio) continue;
      const jaTemOTrio = linhas.some((x) => {
        const p = produtos.get(x.produtoId);
        return ehTrio(p) && nucleoDoNome(p?.nome) === nucleoDoNome(trio.nome);
      });
      const dif = paraReais(paraCentavos(Number(trio.precoVenda) || 0) - paraCentavos(Number(lanche.precoVenda) || 0));
      if (jaTemOTrio || dif <= 0) continue;
      trocaPorTrio = { linha: Number(l.linha), opcao: opcaoComDetalhe(`Trocar pelo ${trio.nome}`, `+${reais(dif)}`) };
      break;
    }
    const falta: Falta[] = conducaoDoPedido({
      linhas: conducao,
      itensFechados: !!c?.itensFechados,
      sugestao: this.sugestao(menu, linhas, produtos, preferidos),
      trocaPorTrio,
      tipo,
      tiposAbertos: abertos,
      entrega: en,
      enderecoForaDaArea: foraDaArea,
      ultimoEndereco: ultimo,
      enderecosSalvos: cli?.enderecos.length ?? 0,
      subtotal,
      pedidoMinimo: menu?.loja?.pedidoMinimo != null ? Number(menu.loja.pedidoMinimo) : null,
      nome,
      pagamento: pg && !trocoRuim ? pg : pg ? { ...pg, trocoPara: null, semTroco: false } : null,
      pagamentoServe: formaServe,
      opcoesDePagamento: opcoesDePagamento(menu, tipo).map((o) => opcaoComDetalhe(o.titulo, o.detalhe)),
      total,
      beneficios: beneficiosPendentes,
    });
    const podeRegistrar = !falta.length && !bloqueado && linhas.length > 0;
    const formaNome = pg && formaServe ? this.nomeDaForma(menu, tipo, pg) : null;
    const proximo = podeRegistrar ? this.passoDeConfirmar(!!c && c.resumoVersao === c.versao) : (falta[0] ?? null);
    const outros =
      proximo?.campo === 'endereco' && (cli?.enderecos.length ?? 0) > 1
        ? [...cli!.enderecos.map((e, i) => opcaoComDetalhe(`Endereço ${i + 1}`, this.textoDoSalvo(e))), 'Cadastrar novo endereço']
        : null;

    const paraConferir = textoParaConferir({
      itens: linhas.map((l) => {
        const pr = precos.get(l.linha);
        return {
          quantidade: l.quantidade,
          descricao: pr?.descricao ?? produtos.get(l.produtoId)?.nome ?? '(fora do cardápio)',
          observacao: l.observacao ?? null,
          totalCent: pr ? paraCentavos(pr.unitario) * pr.quantidade : null,
        };
      }),
      subtotal,
      tipo,
      endereco: en?.tipo === 'entrega' ? { rua: en.rua, numero: en.numero, bairro: en.bairro ?? null, referencia: referenciaParaOPedido(en.referencia) ?? null } : null,
      taxa,
      descontos,
      total,
      cashbackGanho: ganho.valor,
      pontosGanhos: ganho.pontos,
      formaNome,
      trocoPara: pg?.trocoPara ?? null,
      semTroco: !!pg?.semTroco,
      observacao: c?.observacao ?? null,
    });

    const visao = {
      versao: c?.versao ?? 0,
      proximo,
      itens: linhas.map((l) => {
        const p = produtos.get(l.produtoId);
        const pr = precos.get(l.linha);
        return {
          linha: l.linha,
          quantidade: l.quantidade,
          item: pr?.descricao ?? p?.nome ?? '(fora do cardápio)',
          observacao: l.observacao ?? null,
          precoUnitario: pr ? reais(pr.unitario) : null,
          total: pr ? reais(paraReais(paraCentavos(pr.unitario) * pr.quantidade)) : null,
          faltaEscolher: conducao.find((x) => x.linha === l.linha)?.faltaEscolher.map((x) => x.grupo) ?? [],
        };
      }),
      subtotal: reais(subtotal),
      entrega:
        tipo === 'retirada'
          ? { tipo: 'retirada', texto: 'Retirada na loja' }
          : tipo === 'entrega'
            ? {
                tipo: 'entrega',
                endereco: textoDoEndereco(en),
                taxa: reais(taxa),
                freteGratis: taxaCheia > 0 && taxa === 0,
                foraDaArea,
              }
            : null,
      nome,
      pagamento: pg?.forma
        ? {
            forma: formaNome ?? pg.forma,
            troco: pg.trocoPara != null ? `troco para ${reais(pg.trocoPara)}` : pg.semTroco ? 'sem troco' : null,
          }
        : null,
      observacao: c?.observacao ?? null,
      ...(descontos.length ? { descontos: descontos.map((d) => ({ rotulo: d.rotulo, valor: `−${reais(d.valor)}` })) } : {}),
      ...(ben.cupom ? { cupom: String(ben.cupom).toUpperCase() } : {}),
      ...(ganho.valor > 0 ? { cashbackGanho: reais(ganho.valor) } : {}),
      ...(ganho.pontos > 0 ? { pontosGanhos: ganho.pontos } : {}),
      total: reais(total),
      falta: falta.map((f) => ({ campo: f.campo, pergunta: f.pergunta })),
      podeRegistrar,
      avisos,
      ...(outros ? { enderecosParaEscolher: outros } : {}),
      ...(falta.some((x) => x.campo === 'pagamento') ? { soPeloLink: formasSoPeloLink(menu) } : {}),
    };
    return { visao, total, subtotal, paraConferir, podeRegistrar, formaNome, ganho };
  }

  // ───────────────────────── o resumo para conferir ─────────────────────────

  /**
   * Manda ao cliente o RESUMO PARA CONFERIR, com os botões "Pode registrar / Pôr observação / Quero mudar algo", e marca
   * a versão que ele recebeu (`resumo_versao`). Conversa pausada (o atendente assumiu): não manda. O envio que falha
   * devolve o texto para o robô mandar (e a versão fica marcada do mesmo jeito: o robô é quem mostra).
   */
  private async mandarParaConferir(ctx: Contexto, c: Carrinho, calc: { visao: any; paraConferir: string }): Promise<{ visao: any; enviado: boolean }> {
    if (c.resumoVersao === c.versao) return { visao: calc.visao, enviado: true };
    const pausado = await estadoDaPausa(this.db, ctx.cfg.tenantId, ctx.conversa.telefone)
      .then((e) => e.pausado)
      .catch(() => false);
    if (pausado) return { visao: calc.visao, enviado: false };
    const enviado = await this.enviarComBotoes(ctx, calc.paraConferir, OPCOES_DA_CONFERENCIA);
    await this.db.execute(
      sql`update robo_carrinho set resumo_versao = ${c.versao} where id = ${c.id}::uuid and versao = ${c.versao} and status = 'aberto'`,
    );
    const visao = enviado
      ? { ...calc.visao, proximo: this.passoDeConfirmar(true), resumoEnviado: true }
      : {
          ...calc.visao,
          resumoEnviado: false,
          resumoParaConferir: calc.paraConferir,
          orientacao: `O resumo não saiu por aqui: mande o texto de resumoParaConferir exatamente como veio, terminando com OPCOES: ${OPCOES_DA_CONFERENCIA.join(' | ')}`,
        };
    return { visao, enviado };
  }

  /** Texto com botões pela via da loja (oficial: botões, e texto + botões quando passa do limite; QR: menu numerado). */
  private async enviarComBotoes(ctx: Contexto, texto: string, opcoes: string[]): Promise<boolean> {
    try {
      const ops = opcoes.map((titulo) => ({ titulo }));
      if ((ctx.cfg.provedor ?? 'evolution') === 'cloud') {
        if (texto.length <= 1000) await this.cloud.enviarOpcoes(ctx.cfg.tenantId, ctx.conversa.telefone, texto, ops);
        else {
          const corpo = texto.split('\n');
          const pergunta = corpo.pop() || 'Está tudo certo? 👇';
          await this.cloud.enviarTexto(ctx.cfg.tenantId, ctx.conversa.telefone, corpo.join('\n').trim());
          await this.cloud.enviarOpcoes(ctx.cfg.tenantId, ctx.conversa.telefone, pergunta, ops);
        }
      } else await this.evolution.enviar(ctx.cfg.tenantId, ctx.conversa.telefone, menuNumerado(texto, ops));
      return true;
    } catch (e: any) {
      this.logger.warn(`resumo para conferir não enviado (o robô manda o texto): ${e?.message ?? e}`);
      return false;
    }
  }

  // ───────────────────────── registrar (F4) ─────────────────────────

  /**
   * Registra o pedido que o cliente confirmou: pelo MESMO caminho do cardápio online (`receberPedido`, com o id do
   * carrinho de chave de idempotência — repetir não cria outro). Só registra a versão cujo resumo o cliente RECEBEU
   * (`resumo_versao`); a versão que a IA manda não conta mais (F5). Manda ao cliente o RESUMO por escrito (sempre
   * texto, mesmo na conversa por áudio) e devolve o número e a situação real do pedido.
   */
  async registrar(ctx: Contexto, _dto: { versao?: unknown }) {
    const menu = await this.cardapio.menu(ctx.token);
    const cli = await this.clienteDaConversa(ctx);
    const c = await this.carrinhoAberto(ctx);
    if (!c) return { ...recusa('sem_pedido', 'Não há pedido em montagem.'), pedido: (await this.calcular(ctx, menu, null, cli)).visao };
    const calc = await this.calcular(ctx, menu, c, cli);
    const est = calc.visao;
    if (!calc.podeRegistrar)
      return { ...recusa('falta', 'O pedido ainda não está completo: siga o proximo.', { proximo: est.proximo, avisos: est.avisos }), pedido: est };
    // O cliente ainda não recebeu o resumo DESTA versão: manda agora e espera ele tocar em "Pode registrar".
    if (c.resumoVersao !== c.versao) {
      const m = await this.mandarParaConferir(ctx, c, calc);
      return {
        ...recusa(
          'conferir',
          m.enviado
            ? 'O cliente ainda não tinha recebido o resumo deste pedido: o Regem mandou agora, com os botões. Diga só "Confere aí 👆" e espere ele tocar em "Pode registrar".'
            : 'O cliente ainda não recebeu o resumo deste pedido: mande o resumoParaConferir e espere a confirmação.',
        ),
        pedido: m.visao,
      };
    }

    // Trava o carrinho até o fim (outra mensagem do mesmo cliente espera) e confere a versão de novo, já travado.
    const falha: { msg: string | null } = { msg: null };
    const resultado = await this.db.transaction(async (tx: any) => {
      const [linha] = linhasDe(
        await tx.execute(sql`select * from robo_carrinho where id = ${c.id}::uuid and status = 'aberto' for update`),
      );
      if (!linha || Number(linha.versao) !== c.versao) return null;
      const en: any = c.entrega ?? {};
      const pg = c.pagamento as PagamentoDoCarrinho;
      const r: any = await this.cardapio.receberPedido(ctx.token, {
        clientRef: `robo-whatsapp-${c.id}`,
        cliente: est.nome ?? 'Cliente',
        // O telefone como o cadastro guarda (o do cadastro achado; senão a chave, com o nono dígito): sem isso o
        // número sem o 9 do WhatsApp criava um segundo cadastro (ERR-134/135).
        telefone: cli?.telefone ?? ctx.conversa.chave,
        // O tipo do resumo (a loja que só faz um tipo não pergunta: vem dele).
        tipo: en.tipo ?? est.entrega?.tipo,
        rua: en.tipo === 'entrega' ? en.rua : undefined,
        numero: en.tipo === 'entrega' ? en.numero : undefined,
        referencia: en.tipo === 'entrega' ? referenciaParaOPedido(en.referencia) : undefined,
        bairroId: en.tipo === 'entrega' && menu?.loja?.areaModo !== 'raio' ? (en.bairroId ?? undefined) : undefined,
        lat: en.tipo === 'entrega' && en.lat != null ? Number(en.lat) : undefined,
        lng: en.tipo === 'entrega' && en.lng != null ? Number(en.lng) : undefined,
        formaPagamento: pg.forma,
        trocoPara: pg.trocoPara ?? undefined,
        // Os benefícios que o cliente escolheu na conversa (Bloco 1b): o total gravado sai da mesma conta do resumo que
        // ele confirmou (`descontosDoPedido`). Sem "usar", o saldo fica guardado.
        usarCashback: beneficiosDe(pg).usarCashback === true,
        cupom: beneficiosDe(pg).cupom ?? undefined,
        resgateId: beneficiosDe(pg).resgateId ?? undefined,
        // A observação GERAL do pedido ("Pôr observação" no resumo) vai para o pedido (mig 346): painel, via, entregador.
        observacao: c.observacao ?? undefined,
        itens: itensDoPedido(c.itens as Linha[]),
      }).catch((e: any) => {
        // Recusa do pedido (loja fechou, item esgotou no meio): o carrinho fica aberto e o robô explica.
        if (e instanceof BadRequestException) {
          falha.msg = e.message;
          return null;
        }
        throw e;
      });
      if (!r) return null;
      await tx
        .update(roboCarrinho)
        .set({ status: 'registrado', pedidoId: r.pedidoId, atualizadoEm: new Date() })
        .where(eq(roboCarrinho.id, c.id));
      return r;
    });
    if (!resultado)
      return {
        ...(falha.msg ? recusa('nao_registrado', falha.msg) : recusa('versao', 'O pedido mudou agora: o Regem manda o resumo de novo.')),
        pedido: (await this.calcular(ctx, menu, await this.carrinhoAberto(ctx), cli)).visao,
      };

    const [ped] = await this.db.select().from(pedidoExterno).where(eq(pedidoExterno.id, resultado.pedidoId));
    if ((c.entrega as any)?.tipo === 'entrega' && !(c.entrega as any)?.enderecoId) await this.guardarEndereco(ctx, ped, c.entrega as any);
    const resumo = resumoDoPedido(ped, {
      formaNome: calc.formaNome,
      tempoMin: (c.entrega as any)?.tipo === 'entrega' ? menu?.loja?.tempoEntregaMin : menu?.loja?.tempoRetiradaMin,
      observacao: c.observacao ?? null,
      // O cashback do pedido pela conta do crédito, sobre o total GRAVADO (o que a confirmação credita).
      ganho: await this.cardapio.previsaoDoCashback(ctx.cfg.tenantId, Number(ped?.total ?? 0), Number(ped?.taxaEntrega ?? 0)).catch(() => calc.ganho),
    });
    // As contas são as mesmas: um total diferente do que o cliente viu é defeito a investigar (o gravado vale).
    if (paraCentavos(Number(ped?.total ?? 0)) !== paraCentavos(calc.total))
      this.logger.warn(`pedido do robô ${ped?.id}: total gravado ${ped?.total} diferente do resumo ${calc.total}`);
    const enviado = await this.enviarResumo(ctx, resumo.texto);
    return {
      ok: true,
      numero: ped?.displayId ?? resultado.displayId ?? null,
      situacao: resumo.situacao,
      aceito: resumo.aceito,
      resumoEnviado: enviado,
      // Se o resumo não saiu, o robô manda este texto como está.
      resumo: enviado ? null : resumo.texto,
      orientacao: enviado
        ? 'O resumo JÁ FOI ENVIADO ao cliente por escrito. Não repita o resumo: responda curto, agradecendo.'
        : 'Envie o resumo exatamente como veio.',
    };
  }

  /** O endereço novo da entrega vai para o cadastro do cliente (sem repetir rua e número que ele já tem). */
  private async guardarEndereco(ctx: Contexto, ped: any, e: any) {
    try {
      if (!ped?.clienteId) return;
      const ja = await this.db
        .select({ logradouro: clienteEndereco.logradouro, numero: clienteEndereco.numero })
        .from(clienteEndereco)
        .where(and(eq(clienteEndereco.tenantId, ctx.cfg.tenantId), eq(clienteEndereco.clienteId, ped.clienteId)));
      const chave = (r: unknown, n: unknown) => `${normalizar(r)}|${normalizar(n)}`;
      if (ja.some((x) => chave(x.logradouro, x.numero) === chave(e.rua, e.numero))) return;
      await this.db.insert(clienteEndereco).values({
        tenantId: ctx.cfg.tenantId,
        clienteId: ped.clienteId,
        logradouro: e.rua || null,
        numero: e.numero || null,
        bairro: e.bairro || null,
        bairroId: e.bairroId || null,
        referencia: referenciaParaOPedido(e.referencia) ?? null,
        lat: e.lat != null ? String(e.lat) : null,
        lng: e.lng != null ? String(e.lng) : null,
        principal: ja.length === 0,
      });
    } catch (err: any) {
      // O pedido já está gravado: o endereço que não entrou no cadastro só não aparece na próxima vez.
      this.logger.warn(`endereço do pedido ${ped?.id} não guardado no cadastro: ${err?.message ?? err}`);
    }
  }

  /** O resumo por escrito, pela via da loja (API oficial ou Evolution). Falhou: o robô manda o texto (devolvido). */
  private async enviarResumo(ctx: Contexto, texto: string): Promise<boolean> {
    try {
      if ((ctx.cfg.provedor ?? 'evolution') === 'cloud') await this.cloud.enviarTexto(ctx.cfg.tenantId, ctx.conversa.telefone, texto);
      else await this.evolution.enviar(ctx.cfg.tenantId, ctx.conversa.telefone, texto);
      return true;
    } catch (e: any) {
      this.logger.warn(`resumo do pedido não enviado ao cliente (o robô manda): ${e?.message ?? e}`);
      return false;
    }
  }
}
