import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/drizzle.module';
import { autorizarPorSenhaDeGestor } from '../../common/autorizacao-gestor';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  FimDaTrava,
  TravaDoPedido,
  ateDaTrava,
  motivoDoLiberar,
  recusaDaTrava,
  travaVale,
} from './pedido-trava';

/* eslint-disable @typescript-eslint/no-explicit-any */

const linhasDe = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

/**
 * "O pedido não está travado" em SQL, para as listas que escolhem pedidos prontos (app do entregador: procurar, a fila,
 * a próxima saída). A MESMA régua do `travaAtiva` (V74): ativa, no prazo e com a mudança ainda não decidida pela loja.
 * `tabela` é o nome (ou apelido) da tabela de pedidos na consulta — constante do código, nunca do usuário.
 */
export function pedidoSemTravaSql(tabela = 'pedido_externo') {
  const pe = sql.raw(tabela);
  return sql`not exists (select 1 from pedido_trava t
                           where t.tenant_id = ${pe}.tenant_id and t.pedido_id = ${pe}.id
                             and t.situacao = 'ativa' and t.ate > clock_timestamp()
                             and not exists (select 1 from pedido_alteracao a
                                              where a.tenant_id = t.tenant_id and a.id = t.id
                                                and a.situacao in ('aplicada', 'recusada')))`;
}

/** O evento que as telas da loja (KDS, despacho, painel) ouvem para reler o pedido quando a trava começa ou acaba. */
export const EVENTO_TRAVA_DO_PEDIDO = 'pedido.trava';

const daLinha = (r: any): TravaDoPedido => ({
  id: String(r.id),
  pedidoId: String(r.pedido_id),
  quer: String(r.quer ?? ''),
  ate: new Date(r.ate).toISOString(),
  situacao: r.situacao,
});

/**
 * A TRAVA DO PEDIDO ENQUANTO O CLIENTE ALTERA (mig 517; regras em `pedido-trava.ts`). Roda nos dois lados: a nuvem trava
 * e encerra (o robô mora lá); o servidor da loja recusa o "Pronto"/"Despachar" daqui pela cópia que desceu e pode
 * LIBERAR (sobe). Uma linha por mudança, id = o da mudança do robô.
 */
@Injectable()
export class PedidoTravaService {
  private readonly logger = new Logger(PedidoTravaService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    @Optional() private readonly auditoria?: AuditoriaService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /**
   * TR-1: trava o pedido para a mudança `id` (a conferência foi mandada). Repetir com a MESMA mudança (o troco perguntado
   * e a conferência de novo) só renova o prazo e o "quer" enquanto ela está ativa; a encerrada não reabre. Devolve a trava
   * gravada (ou null, se a mudança já tinha acabado).
   */
  async travar(a: { id: string; tenantId: string; unidadeId: string | null; pedidoId: string; quer: string; ate?: Date }): Promise<TravaDoPedido | null> {
    const ate = a.ate ?? ateDaTrava();
    const { r, antigas } = await this.db.transaction(async (tx: any) => {
      // Outra mudança do mesmo pedido tomou o lugar (o robô guarda uma por conversa): a trava dela acaba aqui.
      const antigas = linhasDe(
        await tx.execute(sql`
          update pedido_trava set situacao = 'descartada', encerrada_em = clock_timestamp()
           where tenant_id = ${a.tenantId}::uuid and pedido_id = ${a.pedidoId}::uuid and situacao = 'ativa' and id <> ${a.id}::uuid
          returning *`),
      );
      const [r] = linhasDe(
        await tx.execute(sql`
          insert into pedido_trava (id, tenant_id, unidade_id, pedido_id, quer, ate)
          values (${a.id}::uuid, ${a.tenantId}::uuid, ${a.unidadeId}::uuid, ${a.pedidoId}::uuid, ${a.quer.slice(0, 500)},
                  ${ate.toISOString()}::timestamptz)
          on conflict (id) do update set quer = excluded.quer, ate = excluded.ate
           where pedido_trava.tenant_id = excluded.tenant_id and pedido_trava.situacao = 'ativa'
          returning *`),
      );
      return { r, antigas };
    });
    for (const x of antigas) this.avisarTelas(a.tenantId, x);
    if (!r) return null;
    this.avisarTelas(a.tenantId, r);
    return daLinha(r);
  }

  /** TR-3: o Pix do item novo saiu — a trava acompanha o Pix (até ele vencer). Só estende; nunca encurta. */
  async estender(tenantId: string, id: string, ate: Date): Promise<void> {
    const [r] = linhasDe(
      await this.db.execute(sql`
        update pedido_trava set ate = greatest(ate, ${ate.toISOString()}::timestamptz)
         where tenant_id = ${tenantId}::uuid and id = ${id}::uuid and situacao = 'ativa'
        returning *`),
    );
    if (r) this.avisarTelas(tenantId, r);
  }

  /**
   * O fim da trava pela nuvem (confirmou, desistiu, venceu). Gravação condicional: só a ativa acaba — repetir não muda
   * nada e a liberada pela loja continua liberada. Devolve a trava encerrada agora (ou null).
   */
  async encerrar(tenantId: string, id: string, situacao: Exclude<FimDaTrava, 'liberada'>): Promise<TravaDoPedido | null> {
    const [r] = linhasDe(
      await this.db.execute(sql`
        update pedido_trava set situacao = ${situacao}, encerrada_em = clock_timestamp()
         where tenant_id = ${tenantId}::uuid and id = ${id}::uuid and situacao = 'ativa'
        returning *`),
    );
    if (!r) return null;
    this.avisarTelas(tenantId, r);
    return daLinha(r);
  }

  /**
   * A trava que segura o pedido AGORA (ou null): ativa, no prazo, e cuja mudança a loja ainda não decidiu — na loja com
   * servidor, o "Pode alterar" vira a alteração "pedida" e o servidor aplica (ou recusa) em segundos: decidida, o pedido
   * segue, mesmo antes de a nuvem gravar o fim da trava.
   */
  async travaAtiva(tenantId: string, pedidoId: string, executor: any = this.db): Promise<TravaDoPedido | null> {
    const [r] = linhasDe(
      await executor.execute(sql`
        select t.* from pedido_trava t
         where t.tenant_id = ${tenantId}::uuid and t.pedido_id = ${pedidoId}::uuid
           and t.situacao = 'ativa' and t.ate > clock_timestamp()
           and not exists (select 1 from pedido_alteracao a
                            where a.tenant_id = t.tenant_id and a.id = t.id and a.situacao in ('aplicada', 'recusada'))
         order by t.created_at desc, t.id
         limit 1`),
    );
    return r ? daLinha(r) : null;
  }

  /**
   * TR-2: "Pronto", "Despachar" e "Saiu para entrega" passam por aqui — com a trava valendo, 409 com o código
   * `PEDIDO_EM_ALTERACAO`, a hora e o que o cliente quer (a tela abre o diálogo "Esperar | Liberar o pedido").
   */
  async exigirSemTrava(tenantId: string, pedidoId: string | null | undefined, executor: any = this.db): Promise<void> {
    if (!pedidoId) return;
    const t = await this.travaAtiva(tenantId, pedidoId, executor);
    if (t) throw new ConflictException(recusaDaTrava(t));
  }

  /** As travas que seguram os pedidos da lista (KDS, despacho, painel) — UMA consulta para a lista inteira. */
  async travasAtivas(tenantId: string, pedidoIds: string[]): Promise<Map<string, TravaDoPedido>> {
    const ids = [...new Set(pedidoIds.filter(Boolean))];
    const mapa = new Map<string, TravaDoPedido>();
    if (!ids.length) return mapa;
    const rows = linhasDe(
      await this.db.execute(sql`
        select distinct on (t.pedido_id) t.* from pedido_trava t
         where t.tenant_id = ${tenantId}::uuid
           and t.pedido_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
           and t.situacao = 'ativa' and t.ate > clock_timestamp()
           and not exists (select 1 from pedido_alteracao a
                            where a.tenant_id = t.tenant_id and a.id = t.id and a.situacao in ('aplicada', 'recusada'))
         order by t.pedido_id, t.created_at desc, t.id`),
    );
    for (const r of rows) mapa.set(String(r.pedido_id), daLinha(r));
    return mapa;
  }

  /**
   * TR-4: "Liberar o pedido" — a senha do gerente (a regra única do `autorizarPorSenhaDeGestor`) e o motivo. Encerra as
   * travas ativas do pedido como "liberada" (com quem e por quê) e registra na auditoria. A nuvem descarta a mudança,
   * cancela o Pix aberto e avisa o cliente (`RoboPedidoService.avisarFimDasTravas`) — daqui ou depois de subir.
   */
  async liberar(user: { tenantId: string; colaboradorId?: string | null; categoria?: string | null }, pedidoId: string, dto: { senha?: string; motivo?: string }) {
    const motivo = motivoDoLiberar(dto?.motivo);
    if (!motivo) throw new BadRequestException({ statusCode: 400, code: 'MOTIVO_OBRIGATORIO', message: 'Diga o motivo de liberar o pedido.' });
    const autorizou = await autorizarPorSenhaDeGestor(this.db, user.tenantId, dto?.senha);
    const [ped] = linhasDe(
      await this.db.execute(sql`select id, numero from pedido_externo where tenant_id = ${user.tenantId}::uuid and id = ${pedidoId}::uuid`),
    );
    if (!ped) throw new NotFoundException('Pedido não encontrado.');
    const rows = linhasDe(
      await this.db.execute(sql`
        update pedido_trava
           set situacao = 'liberada', motivo = ${motivo}, por_id = ${autorizou.id}::uuid, por_nome = ${autorizou.nome},
               encerrada_em = clock_timestamp()
         where tenant_id = ${user.tenantId}::uuid and pedido_id = ${pedidoId}::uuid and situacao = 'ativa'
        returning *`),
    );
    if (!rows.length) return { ok: true, liberadas: 0, mensagem: 'O pedido já não estava travado.' };
    for (const r of rows) this.avisarTelas(user.tenantId, r);
    await this.auditoria
      ?.registrar({
        tenantId: user.tenantId,
        atorId: user.colaboradorId ?? null,
        atorPerfil: user.categoria ?? null,
        tipo: 'delivery',
        acao: 'pedido.trava.liberar',
        entidadeTipo: 'pedido_externo',
        entidadeId: pedidoId,
        detalhe: { numero: ped.numero ?? null, motivo, liberadoPor: autorizou.nome, liberadoPorId: autorizou.id, travas: rows.map((r: any) => r.id) },
        origem: 'web',
      })
      .catch((e: any) => this.logger.warn(`auditoria do "Liberar o pedido" ${pedidoId}: ${e?.message ?? e}`));
    return { ok: true, liberadas: rows.length, liberadoPor: autorizou.nome };
  }

  /** As telas da loja relêem o pedido (KDS, despacho, painel). Nunca lança (V3). */
  private avisarTelas(tenantId: string, r: any) {
    try {
      this.events?.emit(EVENTO_TRAVA_DO_PEDIDO, {
        tenantId,
        unidadeId: r.unidade_id ?? null,
        pedidoId: String(r.pedido_id),
        trava: travaVale({ situacao: r.situacao, ate: new Date(r.ate).toISOString() }) ? daLinha(r) : null,
      });
    } catch (e: any) {
      this.logger.warn(`aviso da trava do pedido ${r?.pedido_id}: ${e?.message ?? e}`);
    }
  }
}
