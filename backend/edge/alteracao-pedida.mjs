// A ALTERAÇÃO DO PEDIDO PEDIDA NA NUVEM, gravada no servidor da loja (mig 362; comando `alterar_pedido` do sync-daemon).
//
// A tela da nuvem (ou o robô, que roda na nuvem) de uma loja com servidor ligado não mexe na cozinha nem nas impressoras
// da loja: grava a alteração como "pedida" e manda este comando. Aqui grava-se a MESMA linha (o id vem da nuvem); quem
// aplica é o `EdgeAlteracoesProcessor` do servidor, pelo mesmo `alterar` da equipe. A linha também desce pelo
// sincronismo: o que chegar primeiro vale e o outro não grava de novo (`on conflict do nothing`).
//
// Sem import: o arquivo é avaliado como texto pelos testes (como o `impressao-fila.mjs`).

export const SQL_ALTERACAO_PEDIDA = `
  insert into pedido_alteracao (id, tenant_id, unidade_id, pedido_id, comanda_id, origem, situacao, por_id, por_nome,
                                pedido, pedido_do_cliente, created_at)
  values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, 'pedida', $7::uuid, $8, $9::jsonb, $10,
          coalesce($11::timestamptz, now()))
  on conflict (id) do nothing
  returning id`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOuNulo = (v) => (UUID.test(String(v ?? '')) ? String(v) : null);

/** Os parâmetros do `SQL_ALTERACAO_PEDIDA` a partir dos dados do comando; null quando falta o essencial. */
export function paramsDaAlteracaoPedida(d) {
  if (!d || !uuidOuNulo(d.id) || !uuidOuNulo(d.tenantId) || !uuidOuNulo(d.pedidoId)) return null;
  const criadaEm = d.createdAt && !Number.isNaN(new Date(d.createdAt).getTime()) ? new Date(d.createdAt).toISOString() : null;
  return [
    d.id,
    d.tenantId,
    uuidOuNulo(d.unidadeId),
    d.pedidoId,
    uuidOuNulo(d.comandaId),
    d.origem === 'robo' ? 'robo' : 'equipe',
    uuidOuNulo(d.porId),
    d.porNome == null ? null : String(d.porNome).slice(0, 200),
    JSON.stringify(d.pedido && typeof d.pedido === 'object' ? d.pedido : {}),
    d.pedidoDoCliente == null ? null : String(d.pedidoDoCliente).slice(0, 500),
    criadaEm,
  ];
}
