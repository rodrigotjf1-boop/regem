// Perfis de cupom (Fase 1 do construtor de cupons). Cada perfil é uma lista ORDENADA
// de campos; cada campo pode ser mostrado/ocultado, ficar em negrito e ter alinhamento
// (esquerda/centro/direita). O cabeçalho e o rodapé continuam de preenchimento livre do
// cliente (não são campos daqui). O editor (Fase 2) mexe nesses campos; o render (Fase 3)
// respeita ordem/alinhamento/negrito.
//
// A config da loja (cardapio_config.cupom_perfis) guarda só as DIFERENÇAS do padrão
// (por perfil, por campo). `perfilEfetivo` funde padrão + override.

export type AlinhamentoCupom = 'esquerda' | 'centro' | 'direita';

export interface CampoCupom {
  key: string; // identificador estável do campo
  label: string; // rótulo no editor
  visivel: boolean;
  negrito: boolean;
  alinhamento: AlinhamentoCupom;
  fixo?: boolean; // não pode ser ocultado (ex.: itens do corpo)
}

export interface PerfilCupom {
  id: 'caixa' | 'entregador' | 'producao';
  nome: string;
  descricao: string;
  campos: CampoCupom[];
}

const C = (
  key: string,
  label: string,
  o: Partial<Omit<CampoCupom, 'key' | 'label'>> = {},
): CampoCupom => ({
  key,
  label,
  visivel: o.visivel ?? true,
  negrito: o.negrito ?? false,
  alinhamento: o.alinhamento ?? 'esquerda',
  ...(o.fixo ? { fixo: true } : {}),
});

// ── CAIXA — via do cliente (venda de balcão) ──────────────────────────────────
const CAIXA: PerfilCupom = {
  id: 'caixa',
  nome: 'Caixa — via do cliente',
  descricao: 'Cupom da venda de balcão entregue ao cliente.',
  campos: [
    C('senha', 'Senha', { negrito: true, alinhamento: 'centro' }),
    C('tipoFiscal', 'Fiscal ou informativo', { alinhamento: 'centro' }),
    C('nomeLoja', 'Nome da loja', { negrito: true, alinhamento: 'centro' }),
    C('dataHora', 'Data e hora da compra'),
    C('ticket', 'Nº do ticket (controle)'),
    C('vendaBalcao', 'Venda balcão'),
    C('operador', 'Operador'),
    C('itens', 'Itens (qtd + produto + complementos + obs.)', { fixo: true }),
    C('subtotal', 'Subtotal'),
    C('desconto', 'Desconto'),
    C('totalGeral', 'Total geral', { negrito: true }),
    C('pagamento', 'Forma de pagamento (troco se dinheiro)'),
    C('avisoFiscal', 'Aviso fiscal / dados fiscais', { alinhamento: 'centro' }),
  ],
};

// ── DELIVERY — cupom do entregador ────────────────────────────────────────────
const ENTREGADOR: PerfilCupom = {
  id: 'entregador',
  nome: 'Delivery — cupom do entregador',
  descricao: 'Vai com o entregador: dados do cliente, endereço, valor a cobrar e QR.',
  campos: [
    C('nomeLoja', 'Nome da loja', { negrito: true, alinhamento: 'centro' }),
    C('dataHora', 'Data e hora do pedido'),
    C('ticket', 'Nº do ticket (controle)'),
    C('plataforma', 'Plataforma (nº do pedido na plataforma)'),
    C('pedidoRegem', 'Nº do pedido no Regem'),
    C('cliente', 'Nome do cliente', { negrito: true }),
    C('endereco', 'Endereço completo + complemento/referência'),
    C('telefone', 'Telefone', { negrito: true }),
    C('itens', 'Itens (qtd + descrição)', { fixo: true }),
    C('subtotal', 'Subtotal'),
    C('taxaEntrega', 'Taxa de entrega'),
    C('desconto', 'Descontos'),
    C('totalGeral', 'Total geral', { negrito: true }),
    C('cobrarCliente', 'COBRAR DO CLIENTE', { negrito: true, alinhamento: 'centro' }),
    C('pagamento', 'Forma de pagamento'),
    C('bandeiras', 'Bandeiras'),
    C('qrcode', 'QR do entregador (avança p/ em rota)', { alinhamento: 'centro' }),
  ],
};

// ── PRODUÇÃO — repete o entregador SEM endereço/telefone/valores/pagamento ─────
const PRODUCAO: PerfilCupom = {
  id: 'producao',
  nome: 'Produção',
  descricao: 'Para a cozinha: sem endereço, telefone, valores ou pagamento.',
  campos: [
    C('nomeLoja', 'Nome da loja', { negrito: true, alinhamento: 'centro' }),
    C('dataHora', 'Data e hora do pedido'),
    C('ticket', 'Nº do ticket (controle)'),
    C('plataforma', 'Plataforma (nº do pedido na plataforma)'),
    C('pedidoRegem', 'Nº do pedido no Regem'),
    C('cliente', 'Nome do cliente', { negrito: true }),
    C('itens', 'Itens (qtd + descrição + complementos + obs.)', { fixo: true }),
  ],
};

export const CUPOM_PERFIS_PADRAO: Record<PerfilCupom['id'], PerfilCupom> = {
  caixa: CAIXA,
  entregador: ENTREGADOR,
  producao: PRODUCAO,
};

// Funde o perfil padrão com o override salvo da loja (por campo: visivel/negrito/
// alinhamento; a ORDEM segue o override quando presente). Campos desconhecidos no
// override são ignorados; campos novos do padrão entram no fim.
export function perfilEfetivo(
  id: PerfilCupom['id'],
  override?: { campos?: Partial<CampoCupom>[] } | null,
): PerfilCupom {
  const base = CUPOM_PERFIS_PADRAO[id];
  if (!base) throw new Error(`Perfil de cupom desconhecido: ${id}`);
  const ov = Array.isArray(override?.campos) ? override!.campos! : null;
  if (!ov) return base;
  const porKey = new Map(base.campos.map((c) => [c.key, c]));
  const vistos = new Set<string>();
  const campos: CampoCupom[] = [];
  for (const o of ov) {
    const b = o.key ? porKey.get(o.key) : undefined;
    if (!b) continue; // override de campo inexistente — ignora
    vistos.add(b.key);
    campos.push({
      ...b,
      visivel: b.fixo ? true : o.visivel ?? b.visivel, // itens não somem
      negrito: o.negrito ?? b.negrito,
      alinhamento: o.alinhamento ?? b.alinhamento,
    });
  }
  // Campos do padrão que o override não citou entram no fim (novos numa atualização).
  for (const b of base.campos) if (!vistos.has(b.key)) campos.push(b);
  return { ...base, campos };
}
