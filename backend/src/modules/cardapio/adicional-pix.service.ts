/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConflictException, HttpException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { DeliveryService } from '../delivery/delivery.service';
import { VALIDADE_DA_PEDIDA_MIN } from '../pedido-alterado/pedido-alterado';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import { CardapioService } from './cardapio.service';
import { lerMudanca, linhasDaMudanca, type MudancaDoRobo, r2 } from './robo-mudanca';
// (o `robo-mudanca.ts` importa os textos do `adicional-pix.ts`; este serviço importa dos dois)
import {
  CONFERIR_DEPOIS_DE_VENCIDO_MIN,
  TENTATIVAS_DO_ESTORNO_DO_ADICIONAL,
  VALIDADE_DO_PIX_DO_ADICIONAL_MIN,
  descricaoDoQueEntra,
  textoDaLojaConfirmou,
  textoDoCasoDoEstorno,
  textoDoNaoEntrou,
  textoDoPagoAplicado,
  textoDoPagoPedido,
  textoDoVencido,
} from './adicional-pix';

const linhasDe = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
/** Margem sobre a validade da "pedida" ao servidor da loja: o "aplicada" ainda pode estar subindo pelo sincronismo. */
const MARGEM_DA_DECISAO_MIN = 3;
/** O pago que não conseguiu entrar por falha de infraestrutura (banco, rede) tenta de novo por este tempo; depois, devolve. */
const TENTAR_APLICAR_MIN = 10;
const POR_VOLTA = 30;

/**
 * O PIX DO ADICIONAL (mig 373; pedido do dono de 06/11/2026): o robô põe um item no pedido do cardápio já pago no Pix e
 * cobra só a diferença. Este serviço gera o Pix (pelo gateway que recebeu o pedido), acompanha o pagamento (o aviso do
 * gateway e a conferência de 30 em 30 s), aplica a mudança paga pela MESMA alteração da equipe (`DeliveryService.alterar`,
 * com `pagoNaHora` — a via "PEDIDO ALTERADO", o KDS, o total da venda e o lançamento do caixa), avisa o cliente e devolve
 * o Pix que não conseguiu entrar (o pedido saiu, a loja recusou ou não respondeu, o pedido foi cancelado). Só NUVEM: os
 * gateways, os avisos deles e o robô moram lá. Toda troca de situação é condicional (duas réplicas da API nunca fazem a
 * mesma coisa duas vezes — V24/V42).
 */
@Injectable()
export class AdicionalPixService {
  private readonly logger = new Logger('AdicionalPix');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly cardapio: CardapioService,
    private readonly delivery: DeliveryService,
    private readonly evolution: WhatsappService,
    private readonly cloud: WhatsappCloudService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /**
   * Gera o Pix do adicional da mudança `m` (o "Mandar o Pix" do cliente). Idempotente pelo id da mudança: repetir devolve
   * o MESMO Pix enquanto ele vale. Um Pix aberto por pedido (`ADICIONAL_ABERTO`). Falhou no gateway: a linha fecha
   * (`expirado`, com o motivo) e o erro sobe — o robô passa para a equipe.
   */
  async gerar(a: {
    tenantId: string;
    unidadeId: string | null;
    pedidoId: string;
    telefone: string;
    via: 'cloud' | 'evolution' | null;
    nome: string | null;
    mudanca: MudancaDoRobo;
    valor: number;
    gatewayDoPedido: string | null;
  }): Promise<{ copiaECola: string; expiraEm: string; valor: number; descricao: string; repetido: boolean }> {
    const valor = r2(a.valor);
    const descricao = descricaoDoQueEntra(a.mudanca.op);
    const expira = new Date(Date.now() + VALIDADE_DO_PIX_DO_ADICIONAL_MIN * 60_000);
    let nova: any;
    try {
      [nova] = linhasDe(
        await this.db.execute(sql`
          insert into pedido_adicional_pix (id, tenant_id, unidade_id, pedido_id, telefone, via, descricao, mudanca, valor, expira_em)
          values (${a.mudanca.id}::uuid, ${a.tenantId}::uuid, ${a.unidadeId}::uuid, ${a.pedidoId}::uuid, ${a.telefone}, ${a.via},
                  ${descricao}, ${JSON.stringify(a.mudanca)}::jsonb, ${valor}, ${expira.toISOString()}::timestamptz)
          on conflict (id) do nothing
          returning id`),
      );
    } catch (e: any) {
      if (e?.code === '23505')
        throw new ConflictException({ statusCode: 409, code: 'ADICIONAL_ABERTO', message: 'Já há um Pix de item novo esperando pagamento neste pedido.' });
      throw e;
    }
    if (!nova) {
      // A mesma mudança de novo (o "Mandar o Pix" repetido): o mesmo Pix, se ainda vale.
      const [j] = linhasDe(await this.db.execute(sql`select * from pedido_adicional_pix where id = ${a.mudanca.id}::uuid`));
      if (j?.situacao === 'aguardando' && j.copia_cola && new Date(j.expira_em).getTime() > Date.now())
        return { copiaECola: j.copia_cola, expiraEm: new Date(j.expira_em).toISOString(), valor: Number(j.valor), descricao: j.descricao, repetido: true };
      throw new ConflictException({ statusCode: 409, code: 'ADICIONAL_DECIDIDO', message: 'O Pix desta mudança já foi decidido.' });
    }
    try {
      const pix = await this.cardapio.cobrarPixAvulso(a.tenantId, {
        valor,
        descricao: `Pedido #${a.mudanca.numero ?? ''} · item novo`,
        nome: a.nome,
        telefone: a.telefone,
        referencia: `adic-${a.mudanca.id}`,
        idempotencia: `adicional-${a.mudanca.id}`,
        expiraEm: expira,
        preferido: a.gatewayDoPedido,
      });
      await this.db.execute(sql`
        update pedido_adicional_pix
           set gateway_provider = ${pix.provider}, gateway_payment_id = ${pix.id}, copia_cola = ${pix.copiaECola},
               atualizado_em = clock_timestamp()
         where id = ${a.mudanca.id}::uuid`);
      this.avisarAEquipe(a.tenantId, a.mudanca.id);
      return { copiaECola: pix.copiaECola, expiraEm: expira.toISOString(), valor, descricao, repetido: false };
    } catch (e: any) {
      const motivo = String(e?.message ?? e).slice(0, 300);
      await this.db.execute(sql`
        update pedido_adicional_pix set situacao = 'expirado', erro = ${motivo}, atualizado_em = clock_timestamp()
         where id = ${a.mudanca.id}::uuid and situacao = 'aguardando'`);
      throw e;
    }
  }

  /** O aviso do gateway (Mercado Pago, PagBank) de um pagamento que não é de pedido: se for de um Pix de adicional, confere. */
  async confirmarPeloAviso(paymentId: string): Promise<{ ok: true; adicional?: boolean }> {
    if (!paymentId) return { ok: true };
    const [row] = linhasDe(
      await this.db.execute(sql`
        select * from pedido_adicional_pix
         where gateway_payment_id = ${String(paymentId)} and situacao in ('aguardando', 'expirado')
         limit 1`),
    );
    if (!row) return { ok: true };
    // Não confia no corpo do aviso: a consulta ao gateway (com o token da loja) é quem diz que pagou.
    await this.conferir(row).catch((e: any) => this.logger.warn(`aviso do gateway (adicional ${row.id}): ${e?.message ?? e}`));
    return { ok: true, adicional: true };
  }

  /**
   * Uma volta da rotina (de 30 em 30 s): os pedidos cancelados devolvem o adicional; os Pix aguardando são conferidos (e
   * os vencidos fecham); os vencidos há pouco são conferidos de novo (pagou tarde: devolve); os pagos entram; os que
   * foram ao servidor da loja recebem a decisão; os que esperam o estorno, o pedem. Devolve as contagens (o teste confere).
   */
  async volta(): Promise<{ aplicados: number; vencidos: number; estornados: number; falhas: number }> {
    const conta = { aplicados: 0, vencidos: 0, estornados: 0, falhas: 0 };
    // O pedido cancelado devolve o Pix do adicional que entrou (o do pedido, a mig 372 devolve).
    await this.db.execute(sql`
      update pedido_adicional_pix a
         set situacao = 'estornar', erro = 'o pedido foi cancelado', atualizado_em = clock_timestamp()
        from pedido_externo pe
       where pe.id = a.pedido_id and pe.status = 'cancelado' and a.situacao in ('aplicado', 'pago', 'pedido_a_loja')`);

    for (const row of linhasDe(
      await this.db.execute(sql`
        select a.* from pedido_adicional_pix a
         where a.situacao = 'aguardando' and a.gateway_payment_id is not null
            or (a.situacao = 'expirado' and a.gateway_payment_id is not null
                and a.expira_em > now() - make_interval(mins => ${CONFERIR_DEPOIS_DE_VENCIDO_MIN}))
         order by a.atualizado_em
         limit ${POR_VOLTA}`),
    )) {
      try {
        const r = await this.conferir(row);
        if (r === 'vencido') conta.vencidos++;
        if (r === 'aplicado') conta.aplicados++;
      } catch (e: any) {
        conta.falhas++;
        this.logger.warn(`adicional ${row.id}: a conferência falhou (${e?.message ?? e})`);
      }
    }
    // O Pix que nem chegou a sair do gateway e passou da validade (sem id): fecha.
    await this.db.execute(sql`
      update pedido_adicional_pix set situacao = 'expirado', erro = coalesce(erro, 'o Pix não saiu do gateway'),
             atualizado_em = clock_timestamp()
       where situacao = 'aguardando' and gateway_payment_id is null and expira_em < now() - interval '1 minute'`);

    for (const row of linhasDe(
      await this.db.execute(sql`
        select * from pedido_adicional_pix where situacao = 'pago' order by atualizado_em limit ${POR_VOLTA}`),
    )) {
      if ((await this.aplicar(row).catch(() => 'falhou')) === 'aplicado') conta.aplicados++;
    }
    for (const row of linhasDe(
      await this.db.execute(sql`
        select a.*, pa.situacao as decisao, pa.depois, pa.created_at as pedida_em
          from pedido_adicional_pix a
          left join pedido_alteracao pa on pa.id = a.id and pa.tenant_id = a.tenant_id
         where a.situacao = 'pedido_a_loja'
         order by a.atualizado_em
         limit ${POR_VOLTA}`),
    )) {
      await this.decisaoDaLoja(row).catch((e: any) => this.logger.warn(`adicional ${row.id}: decisão da loja (${e?.message ?? e})`));
    }
    conta.estornados += await this.estornar();
    return conta;
  }

  /** Confere um Pix no gateway: pago → entra (ou, vencido, devolve); aguardando e vencido → cancela e fecha. */
  private async conferir(row: any): Promise<'aplicado' | 'vencido' | 'aguardando' | 'devolvendo' | 'nada'> {
    const st = await this.cardapio.situacaoDoPixAvulso(String(row.tenant_id), String(row.gateway_provider), String(row.gateway_payment_id));
    if (st === 'pago') {
      // Pagou tarde (já tinha vencido — a Rede não cancela o QR; o cancelamento do Mercado Pago falhou): devolve.
      const [tarde] = linhasDe(
        await this.db.execute(sql`
          update pedido_adicional_pix
             set situacao = 'estornar', pago_em = clock_timestamp(), erro = 'pago depois de vencido', atualizado_em = clock_timestamp()
           where id = ${row.id}::uuid and situacao = 'expirado'
          returning *`),
      );
      if (tarde) {
        await this.enviar(tarde, textoDoNaoEntrou(this.numero(tarde), tarde.descricao, Number(tarde.valor)));
        return 'devolvendo';
      }
      const [pago] = linhasDe(
        await this.db.execute(sql`
          update pedido_adicional_pix set situacao = 'pago', pago_em = clock_timestamp(), atualizado_em = clock_timestamp()
           where id = ${row.id}::uuid and situacao = 'aguardando'
          returning *`),
      );
      if (!pago) return 'nada'; // outra volta (ou o aviso do gateway) já pegou
      this.avisarAEquipe(String(pago.tenant_id), String(pago.id));
      return (await this.aplicar(pago)) === 'aplicado' ? 'aplicado' : 'nada';
    }
    if (row.situacao !== 'aguardando' || new Date(row.expira_em).getTime() > Date.now()) {
      await this.paraOFim(row.id, String(row.situacao));
      return 'aguardando';
    }
    await this.cardapio.cancelarPixAvulso(String(row.tenant_id), String(row.gateway_provider), String(row.gateway_payment_id));
    const [vencido] = linhasDe(
      await this.db.execute(sql`
        update pedido_adicional_pix set situacao = 'expirado', atualizado_em = clock_timestamp()
         where id = ${row.id}::uuid and situacao = 'aguardando'
        returning *, (select status from pedido_externo where id = pedido_id) as status_do_pedido`),
    );
    if (!vencido) return 'nada';
    this.avisarAEquipe(String(vencido.tenant_id), String(vencido.id));
    if (vencido.status_do_pedido !== 'cancelado') await this.enviar(vencido, textoDoVencido(this.numero(vencido), vencido.descricao));
    return 'vencido';
  }

  /**
   * O Pix PAGO entra no pedido pela MESMA alteração da equipe, com a diferença paga (`pagoNaHora`) e o preço que o cliente
   * conferiu. Loja sem servidor ligado: aplica na hora. Com servidor: vai "pedida" e o servidor decide. Recusa da regra
   * (o pedido saiu, ficou pronto, tem nota) → devolve. Falha de infraestrutura → tenta de novo por 10 min, depois devolve.
   */
  private async aplicar(row: any): Promise<'aplicado' | 'pedido' | 'devolvendo' | 'depois'> {
    const m = lerMudanca(row.mudanca);
    if (!m || m.op.tipo !== 'por') return this.paraDevolver(row, 'a mudança guardada não é de pôr item');
    const op = m.op;
    const dto = {
      idAlteracao: String(row.id),
      adicionar: [
        {
          produtoId: op.entra.produtoId,
          variacaoId: op.entra.variacaoId,
          complementos: op.entra.complementos,
          quantidade: op.entra.quantidade,
          observacao: op.entra.observacao ?? undefined,
          precoUnitario: op.entra.precoUnitario,
        },
      ],
      remover: [],
      origem: 'robo' as const,
      pedidoDoCliente: linhasDaMudanca(op).join(' / '),
    };
    let r: any;
    try {
      r = await this.delivery.alterar(
        { tenantId: String(row.tenant_id), colaboradorId: null as any, nome: 'Robô do WhatsApp' },
        String(row.pedido_id),
        dto,
        { precoInformado: true, pagoNaHora: Number(row.valor) },
      );
    } catch (e: any) {
      if (e instanceof HttpException) {
        const resp: any = e.getResponse();
        const motivo = typeof resp === 'string' ? resp : resp?.message ?? e.message;
        return this.paraDevolver(row, String(motivo));
      }
      if (new Date(row.pago_em ?? row.atualizado_em).getTime() < Date.now() - TENTAR_APLICAR_MIN * 60_000)
        return this.paraDevolver(row, `não entrou em ${TENTAR_APLICAR_MIN} min: ${String(e?.message ?? e).slice(0, 200)}`);
      this.logger.warn(`adicional ${row.id}: a mudança paga não entrou agora, tento na próxima volta (${e?.message ?? e})`);
      return 'depois';
    }
    const pedida = r?.pedida === true || r?.alteracao?.situacao === 'pedida';
    const [mudou] = linhasDe(
      await this.db.execute(sql`
        update pedido_adicional_pix
           set situacao = ${pedida ? 'pedido_a_loja' : 'aplicado'}, aplicado_em = ${pedida ? null : new Date().toISOString()}::timestamptz,
               erro = null, atualizado_em = clock_timestamp()
         where id = ${row.id}::uuid and situacao = 'pago'
        returning *`),
    );
    if (!mudou) return pedida ? 'pedido' : 'aplicado';
    await this.marcarNaConversa(mudou, pedida ? 'pedida' : 'aplicada');
    this.avisarAEquipe(String(mudou.tenant_id), String(mudou.id));
    await this.enviar(
      mudou,
      pedida ? textoDoPagoPedido(this.numero(mudou), mudou.descricao) : textoDoPagoAplicado(this.numero(mudou), mudou.descricao, Number(r?.total ?? 0)),
    );
    return pedida ? 'pedido' : 'aplicado';
  }

  /** A decisão do servidor da loja sobre a mudança paga: aplicada → avisa; recusada ou sem resposta no prazo → devolve. */
  private async decisaoDaLoja(row: any): Promise<void> {
    if (row.decisao === 'aplicada') {
      const [ok] = linhasDe(
        await this.db.execute(sql`
          update pedido_adicional_pix set situacao = 'aplicado', aplicado_em = clock_timestamp(), atualizado_em = clock_timestamp()
           where id = ${row.id}::uuid and situacao = 'pedido_a_loja'
          returning *`),
      );
      if (!ok) return;
      await this.marcarNaConversa(ok, 'aplicada');
      this.avisarAEquipe(String(ok.tenant_id), String(ok.id));
      const total = row.depois?.total != null ? Number(row.depois.total) : null;
      await this.enviar(ok, textoDaLojaConfirmou(this.numero(ok), ok.descricao, total));
      return;
    }
    const prazo = (VALIDADE_DA_PEDIDA_MIN + MARGEM_DA_DECISAO_MIN) * 60_000;
    const venceu = !row.pedida_em || new Date(row.pedida_em).getTime() < Date.now() - prazo;
    if (row.decisao === 'recusada' || venceu)
      await this.paraDevolver(row, row.decisao === 'recusada' ? 'o servidor da loja recusou a mudança' : 'o servidor da loja não respondeu à mudança', 'pedido_a_loja');
    else await this.paraOFim(row.id, 'pedido_a_loja');
  }

  /**
   * A linha conferida sem novidade vai para o FIM da vez (V84): a volta pega as 30 de `atualizado_em` mais antigo — sem
   * isto, 30 Pix esperando trancariam a conferência dos mais novos. Só se a situação ainda é a lida.
   */
  private async paraOFim(id: string, situacao: string): Promise<void> {
    await this.db.execute(sql`
      update pedido_adicional_pix set atualizado_em = clock_timestamp() where id = ${id}::uuid and situacao = ${situacao}`);
  }

  /** O Pix pago que não entrou vai para o estorno, e o cliente sabe na hora que o valor volta. */
  private async paraDevolver(row: any, motivo: string, de: 'pago' | 'pedido_a_loja' = 'pago'): Promise<'devolvendo'> {
    const [x] = linhasDe(
      await this.db.execute(sql`
        update pedido_adicional_pix set situacao = 'estornar', erro = ${motivo.slice(0, 300)}, atualizado_em = clock_timestamp()
         where id = ${row.id}::uuid and situacao = ${de}
        returning *`),
    );
    if (x) {
      this.logger.warn(`adicional ${x.id} do pedido ${x.pedido_id}: não entrou, vai ser devolvido (${motivo})`);
      this.avisarAEquipe(String(x.tenant_id), String(x.id));
      await this.marcarNaConversa(x, 'recusada');
      await this.enviar(x, textoDoNaoEntrou(this.numero(x), x.descricao, Number(x.valor)));
    }
    return 'devolvendo';
  }

  /**
   * Pede ao gateway o estorno TOTAL dos Pix de adicional que não entraram (ou cujo pedido foi cancelado). A vez é de uma
   * réplica só (`estornando`, `skip locked`); a que caiu no meio devolve a vez em 5 min. Na 3ª falha: caso URGENTE.
   */
  private async estornar(): Promise<number> {
    const vez = linhasDe(
      await this.db.execute(sql`
        with alvo as (
          select id from pedido_adicional_pix
           where situacao = 'estornar' or (situacao = 'estornando' and atualizado_em < now() - interval '5 minutes')
           order by atualizado_em
           limit ${POR_VOLTA}
           for update skip locked
        )
        update pedido_adicional_pix a set situacao = 'estornando', atualizado_em = clock_timestamp()
          from alvo where a.id = alvo.id
        returning a.*`),
    );
    let feitos = 0;
    for (const x of vez) {
      try {
        const r = await this.cardapio.reembolsarPagamentoTotal(String(x.tenant_id), String(x.gateway_provider), String(x.gateway_payment_id));
        await this.db.execute(sql`
          update pedido_adicional_pix
             set situacao = 'estornado', estorno_id = ${r?.id ? String(r.id) : null}, tentativas = tentativas + 1,
                 atualizado_em = clock_timestamp()
           where id = ${x.id}::uuid and situacao = 'estornando'`);
        feitos++;
        this.logger.log(`adicional ${x.id}: estorno feito (${x.gateway_provider}, R$ ${Number(x.valor).toFixed(2)})`);
      } catch (e: any) {
        const motivo = String(e?.message ?? e).slice(0, 300);
        const ultima = Number(x.tentativas) + 1 >= TENTATIVAS_DO_ESTORNO_DO_ADICIONAL;
        await this.db.execute(sql`
          update pedido_adicional_pix
             set situacao = ${ultima ? 'falhou' : 'estornar'}, erro = ${motivo}, tentativas = tentativas + 1, atualizado_em = clock_timestamp()
           where id = ${x.id}::uuid and situacao = 'estornando'`);
        this.logger.warn(`adicional ${x.id}: o estorno falhou (tentativa ${Number(x.tentativas) + 1}/${TENTATIVAS_DO_ESTORNO_DO_ADICIONAL}): ${motivo}`);
        if (ultima) await this.casoDoEstorno(x, motivo);
      }
    }
    return feitos;
  }

  /** A 3ª falha do estorno: um caso URGENTE na fila do Atendimento — a loja devolve à mão. */
  private async casoDoEstorno(x: any, motivo: string): Promise<void> {
    const mensagem = textoDoCasoDoEstorno({
      numero: this.numero(x),
      descricao: x.descricao,
      valor: Number(x.valor),
      gateway: String(x.gateway_provider),
      motivo,
    });
    const [caso] = linhasDe(
      await this.db.execute(sql`
        insert into atendimento_chamado (tenant_id, unidade_id, tipo, cliente, telefone, pedido_numero, pedido_id, mensagem, prioridade)
        select ${x.tenant_id}::uuid, ${x.unidade_id}::uuid, 'atendimento', pe.cliente_nome, ${x.telefone}, ${this.numero(x)},
               ${x.pedido_id}::uuid, ${mensagem}, 'urgente'
          from pedido_externo pe where pe.id = ${x.pedido_id}::uuid
        returning *`),
    );
    if (caso) this.events?.emit('atendimento.novo', { tenantId: String(x.tenant_id), chamado: caso });
  }

  /** A mudança da conversa (o carrinho do robô) passa a dizer o que aconteceu: o robô responde certo se o cliente perguntar. */
  private async marcarNaConversa(x: any, situacao: 'aplicada' | 'pedida' | 'recusada'): Promise<void> {
    await this.db
      .execute(sql`
        update robo_carrinho set mudanca = mudanca || ${JSON.stringify({ situacao, avisada: true })}::jsonb
         where tenant_id = ${x.tenant_id}::uuid and mudanca->>'id' = ${String(x.id)}`)
      .catch((e: any) => this.logger.warn(`adicional ${x.id}: a conversa não foi marcada (${e?.message ?? e})`));
  }

  /** O alerta da Central muda (abriu, pagou, entrou, venceu): as telas da fila relêem (`atendimento:mudou`). */
  private avisarAEquipe(tenantId: string, id: string) {
    this.events?.emit('atendimento.mudou', { tenantId, id, motivo: 'adicional_pix' });
  }

  private numero(x: any): string | null {
    const n = x?.mudanca?.numero;
    return n != null && String(n).trim() ? String(n) : null;
  }

  /** A mensagem ao cliente pela MESMA via da conversa (oficial ou Evolution). Falhou: fica no log (não desfaz nada). */
  private async enviar(x: any, texto: string): Promise<void> {
    try {
      const tenantId = String(x.tenant_id);
      const telefone = String(x.telefone);
      let via: string | null = x.via ?? null;
      if (!via) {
        const [c] = linhasDe(
          await this.db.execute(sql`select provedor from cardapio_config where tenant_id = ${tenantId}::uuid and unidade_id is null limit 1`),
        );
        via = c?.provedor ?? 'evolution';
      }
      if (via === 'cloud') await this.cloud.enviarTexto(tenantId, telefone, texto);
      else await this.evolution.enviar(tenantId, telefone, texto);
    } catch (e: any) {
      this.logger.warn(`adicional ${x?.id}: a mensagem ao cliente não saiu (${e?.message ?? e})`);
    }
  }

  /** O código copia-e-cola sozinho na mensagem (para copiar com um toque). Lança se não saiu: o robô manda pelo texto. */
  async enviarCodigo(tenantId: string, telefone: string, via: 'cloud' | 'evolution' | null, texto: string, codigo: string): Promise<void> {
    if ((via ?? 'evolution') === 'cloud') {
      await this.cloud.enviarTexto(tenantId, telefone, texto);
      await this.cloud.enviarTexto(tenantId, telefone, codigo);
    } else {
      await this.evolution.enviar(tenantId, telefone, texto);
      await this.evolution.enviar(tenantId, telefone, codigo);
    }
  }
}
