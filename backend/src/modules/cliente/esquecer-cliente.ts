import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * "ESQUECER" (LGPD) — o que sai do banco quando o cliente do cardápio pede para excluir a conta.
 *
 * Antes: o cadastro era apagado e o pedido só perdia o vínculo — nome, telefone(s) e endereço
 * continuavam gravados em cada pedido desse cliente (e no payload cru do canal, `raw`).
 * Agora, na MESMA transação:
 *   1. os pedidos do cliente perdem o vínculo e os dados pessoais: nome, telefones, endereço
 *      (texto e campos) e o `raw` (o payload do canal repete tudo isso, em formatos que mudam
 *      de canal para canal — só apagando inteiro não sobra nada);
 *   2. o cadastro é apagado (endereços salvos e link mágico vão em cascata; a exclusão desce
 *      para o servidor da loja pelo `sync_exclusao`, mig 262).
 *
 * FICA, porque a lei manda guardar ou porque não é dado pessoal:
 *   - a NFC-e (`nota_fiscal`: XML autorizado com CPF, nome e endereço do destinatário, chave e
 *     protocolo) — é o documento fiscal, de guarda obrigatória (LGPD art. 16, I). Não é tocada;
 *   - o CPF/CNPJ que o cliente pediu NA NOTA (`documento_cliente`): é a identificação do
 *     consumidor que a emissão exige acima do limite da UF — sem ele, a nota daquela venda não
 *     poderia ser emitida de novo (rejeição, contingência). Sem nome e endereço a nota ainda sai
 *     (identificada só pelo documento, presencial);
 *   - valores, itens, canal, status e datas do pedido — são o registro da venda (faturamento).
 *
 * PEDIDO EM ANDAMENTO segura a exclusão: a loja precisa do nome, do telefone e do endereço para
 * entregar (execução do contrato). "Em andamento" = ainda não concluído nem cancelado E recente:
 * criado (ou agendado, na encomenda) há menos de `HORAS_PEDIDO_EM_ANDAMENTO`. Pedido que ficou
 * aberto além disso é pendência esquecida no quadro da loja e não prende o pedido do titular.
 * Quem garante isto é a própria chave estrangeira `pedido_externo.cliente_id → cliente`: o pedido
 * em andamento não é anonimizado, continua ligado, e o `delete` do cadastro falha (23503) — sem
 * corrida possível com um pedido que chega no mesmo instante (ver o teste).
 *
 * SERVIDOR DA LOJA: a limpeza é da nuvem e chega à loja pelo sincronismo de sempre. A janela de
 * espelho do `pedido_externo` corre pelo `updated_at` (a tabela não tem `created_at`), e o
 * `update` daqui carimba o `updated_at` (gatilho da mig 095) — então até o pedido antigo desce
 * de novo, já limpo, e vence a cópia da loja pela "mais nova vence". Um envio atrasado da loja
 * com a cópia antiga NÃO desfaz a limpeza: essa cópia ainda aponta para o cadastro apagado, e a
 * nuvem recusa a linha pela chave estrangeira (e recusa o cadastro de volta: "exclusão vence").
 */

/** Horas em que um pedido aberto ainda conta como "em andamento" para segurar a exclusão. */
export const HORAS_PEDIDO_EM_ANDAMENTO = 24;

/** O cliente tem pedido em andamento — a exclusão fica para depois da entrega. */
export class PedidoEmAndamentoError extends Error {
  constructor() {
    super('pedido em andamento');
  }
}

/**
 * Anonimiza os pedidos e apaga o cadastro do cliente, numa transação. Idempotente: cliente que
 * já não existe devolve zero. Lança `PedidoEmAndamentoError` (e não muda nada) se houver pedido
 * em andamento ligado a ele.
 */
export async function esquecerCliente(
  db: any,
  tenantId: string,
  clienteId: string,
): Promise<{ pedidosAnonimizados: number; clienteApagado: boolean }> {
  return db.transaction(async (tx: any) => {
    // Trava o cadastro: o vínculo de um pedido que chegue agora (CRM do ingest) espera esta
    // transação terminar — e, depois dela, não acha mais o cliente.
    const trava: any = await tx.execute(sql`
      select id from cliente where id = ${clienteId} and tenant_id = ${tenantId} for update`);
    if (!(trava.rows ?? trava).length) return { pedidosAnonimizados: 0, clienteApagado: false };

    const r: any = await tx.execute(sql`
      update pedido_externo set
        cliente_id = null,
        cliente_nome = null,
        cliente_telefone = null,
        cliente_telefone2 = null,
        endereco = null,
        endereco_rua = null,
        endereco_numero = null,
        endereco_referencia = null,
        endereco_bairro = null,
        endereco_cidade = null,
        endereco_municipio_ibge = null,
        endereco_uf = null,
        endereco_cep = null,
        raw = null,
        updated_at = now()
      where tenant_id = ${tenantId} and cliente_id = ${clienteId}
        and not (status not in ('concluido', 'cancelado')
                 and coalesce(agendamento, criado_em)
                     >= now() - make_interval(hours => ${HORAS_PEDIDO_EM_ANDAMENTO}))`);

    try {
      // Savepoint: o 23503 esperado não pode deixar a transação num estado que confunda o erro.
      await tx.transaction((sp: any) =>
        sp.execute(sql`delete from cliente where id = ${clienteId} and tenant_id = ${tenantId}`),
      );
    } catch (e: any) {
      // Sobrou pedido ligado = pedido em andamento (os outros acabaram de perder o vínculo).
      // Lançar aqui desfaz a anonimização acima junto: nada muda.
      if (e?.code === '23503' || e?.cause?.code === '23503') throw new PedidoEmAndamentoError();
      throw e;
    }
    // Os eventos de consentimento de marketing do cadastro (mig 300, só nuvem) guardam o telefone
    // e o texto aceito: saem junto. A lista de exclusão fica (C3c) — é ela que garante que a
    // pessoa não recebe mais. Sem a tabela (servidor da loja, ou antes da 300): nada a apagar.
    const tem: any = await tx.execute(sql`select to_regclass('marketing_consentimento') is not null as tem`);
    if ((tem.rows ?? tem)[0]?.tem) {
      await tx.execute(sql`
        delete from marketing_consentimento where tenant_id = ${tenantId} and cliente_id = ${clienteId}`);
    }
    return { pedidosAnonimizados: Number(r?.rowCount ?? 0), clienteApagado: true };
  });
}
