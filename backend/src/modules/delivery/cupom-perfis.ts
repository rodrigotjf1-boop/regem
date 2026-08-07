// Perfis de cupom (construtor de cupons). Cada perfil é uma lista ORDENADA de campos;
// cada campo pode ser mostrado/ocultado, ficar em negrito e ter alinhamento
// (esquerda/centro/direita). O cabeçalho e o rodapé continuam de preenchimento livre
// (não são campos daqui). O editor mexe nesses campos; o render respeita
// ordem/alinhamento/negrito (ver renderCupomPerfil).
//
// A config da loja vive em **delivery_config.cupom_perfis** (jsonb) e guarda:
//   - por perfil PADRÃO: só as DIFERENÇAS (override por campo); `perfilEfetivo` funde.
//   - `_custom`: lista de perfis PERSONALIZADOS (definição completa, criados pelo lojista).
//
// Fase 3a — expansão para o conjunto completo de perfis + custom. O WIRING de cada
// perfil ao seu render/gatilho (produção balcão/delivery, cliente totem, sangria/
// suprimento/fechamento) é a Fase 3b; aqui ficam só as DEFINIÇÕES + edição.

export type AlinhamentoCupom = 'esquerda' | 'centro' | 'direita';

export interface CampoCupom {
  key: string; // identificador estável do campo (ou pseudo: _espaco | _tracejado — Fase 4)
  label: string; // rótulo no editor
  visivel: boolean;
  negrito: boolean;
  alinhamento: AlinhamentoCupom;
  fixo?: boolean; // não pode ser ocultado (ex.: itens do corpo)
  tamanho?: 'normal' | 'grande'; // legado (Fase 4) — 'grande' == escala 2; lido como fallback
  escala?: number; // magnificação da fonte 1..4 (1 = normal); térmica só faz múltiplos inteiros
  mini?: boolean; // fonte pequena embutida (Font B) — régua "Pequena"/"Média"
  // Estilo próprio das sublinhas do campo "itens" (destacar na cozinha). Ausente = herda o do campo.
  comp?: { negrito?: boolean; escala?: number; mini?: boolean }; // complementos
  obs?: { negrito?: boolean; escala?: number; mini?: boolean }; // observação
  agrupado?: boolean; // Fase 4 — junta com o campo ANTERIOR na mesma linha (esq | dir)
}

// Pseudo-campos de LAYOUT (Fase 4): não são dados, são elementos de espaçamento.
export const PSEUDO_CAMPOS: Record<string, string> = {
  _espaco: 'Linha em branco',
  _tracejado: 'Linha divisória',
};

// Grupo do perfil (organiza as abas do editor e ajuda a escolher a base do custom).
export type GrupoPerfil = 'cliente' | 'producao' | 'caixa';

export interface PerfilCupom {
  id: string; // 'caixa' | 'entregador' | ... | 'custom_<n>'
  nome: string;
  descricao: string;
  grupo: GrupoPerfil;
  custom?: boolean; // true = perfil criado pelo lojista
  campos: CampoCupom[];
}

// Normaliza a fonte para uma escala inteira 1..4 (source of truth), aceitando o
// legado `tamanho: 'grande'` (== 2). Devolve undefined quando é a fonte normal.
export function escalaFonte(o: { escala?: any; tamanho?: any }): number | undefined {
  const n = Number(o?.escala);
  if (Number.isFinite(n) && n >= 2) return Math.min(4, Math.floor(n));
  if (o?.tamanho === 'grande') return 2;
  return undefined;
}

// Sanea um subestilo (complementos/observação): negrito + escala 2..4 + mini.
export function subEstilo(x: any): { negrito?: boolean; escala?: number; mini?: boolean } | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const out: { negrito?: boolean; escala?: number; mini?: boolean } = {};
  if (x.negrito) out.negrito = true;
  const e = Number(x.escala);
  if (Number.isFinite(e) && e >= 2) out.escala = Math.min(4, Math.floor(e));
  if (x.mini) out.mini = true;
  return Object.keys(out).length ? out : undefined;
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
  ...(escalaFonte(o) ? { escala: escalaFonte(o)! } : {}),
  ...(o.mini ? { mini: true } : {}),
  ...(subEstilo(o.comp) ? { comp: subEstilo(o.comp) } : {}),
  ...(subEstilo(o.obs) ? { obs: subEstilo(o.obs) } : {}),
  ...(o.agrupado ? { agrupado: true } : {}),
});

// ── Catálogo MESTRE de campos (rótulo por chave) — usado pelo builder de perfil
// custom ("puxar qualquer campo") e como fonte de labels. Toda chave usada nos
// perfis abaixo existe aqui. ────────────────────────────────────────────────────
export const CAMPOS_CATALOGO: { key: string; label: string; grupo: GrupoPerfil }[] = [
  // Cabeçalho / identificação
  { key: 'nomeLoja', label: 'Nome da loja', grupo: 'cliente' },
  { key: 'tipoFiscal', label: 'Fiscal ou informativo', grupo: 'cliente' },
  { key: 'dataHora', label: 'Data e hora', grupo: 'cliente' },
  { key: 'ticket', label: 'Nº do ticket (controle)', grupo: 'cliente' },
  { key: 'senha', label: 'Senha', grupo: 'cliente' },
  { key: 'operador', label: 'Operador', grupo: 'cliente' },
  { key: 'vendaBalcao', label: 'Venda balcão', grupo: 'cliente' },
  { key: 'origemPedido', label: 'Origem (balcão/mesa/totem)', grupo: 'cliente' },
  { key: 'mesa', label: 'Mesa / balcão', grupo: 'producao' },
  { key: 'emitidoDe', label: 'Emitido de (sub-PDV salão)', grupo: 'producao' },
  { key: 'plataforma', label: 'Plataforma (nº do pedido na plataforma)', grupo: 'cliente' },
  { key: 'pedidoRegem', label: 'Nº do pedido no Regem', grupo: 'cliente' },
  // Cliente / entrega
  { key: 'cliente', label: 'Nome do cliente', grupo: 'cliente' },
  { key: 'endereco', label: 'Endereço + complemento/referência', grupo: 'cliente' },
  { key: 'telefone', label: 'Telefone', grupo: 'cliente' },
  // Corpo
  { key: 'itens', label: 'Itens (qtd + produto + complementos + obs.)', grupo: 'cliente' },
  // Financeiro
  { key: 'subtotal', label: 'Subtotal', grupo: 'cliente' },
  { key: 'taxaEntrega', label: 'Taxa de entrega', grupo: 'cliente' },
  { key: 'desconto', label: 'Desconto', grupo: 'cliente' },
  { key: 'totalGeral', label: 'Total geral', grupo: 'cliente' },
  { key: 'cobrarCliente', label: 'COBRAR DO CLIENTE', grupo: 'cliente' },
  { key: 'pagamento', label: 'Forma de pagamento (troco se dinheiro)', grupo: 'cliente' },
  { key: 'bandeiras', label: 'Bandeiras', grupo: 'cliente' },
  { key: 'avisoFiscal', label: 'Aviso fiscal / dados fiscais', grupo: 'cliente' },
  { key: 'qrcode', label: 'QR code (entregador/pesquisa/link)', grupo: 'cliente' },
  // Movimentos de caixa (sangria/suprimento/fechamento)
  { key: 'tipoMovimento', label: 'Tipo do movimento (SANGRIA/SUPRIMENTO)', grupo: 'caixa' },
  { key: 'valorMovimento', label: 'Valor do movimento', grupo: 'caixa' },
  { key: 'motivo', label: 'Motivo / observação', grupo: 'caixa' },
  { key: 'autorizadoPor', label: 'Autorizado por', grupo: 'caixa' },
  { key: 'turno', label: 'Turno', grupo: 'caixa' },
  { key: 'terminal', label: 'Terminal / PDV', grupo: 'caixa' },
  { key: 'aberturaValor', label: 'Valor de abertura', grupo: 'caixa' },
  { key: 'totalPorForma', label: 'Totais por forma de pagamento', grupo: 'caixa' },
  { key: 'sangriasTotal', label: 'Total de sangrias', grupo: 'caixa' },
  { key: 'suprimentosTotal', label: 'Total de suprimentos', grupo: 'caixa' },
  { key: 'esperado', label: 'Valor esperado', grupo: 'caixa' },
  { key: 'informado', label: 'Valor informado (conferência)', grupo: 'caixa' },
  { key: 'diferenca', label: 'Diferença', grupo: 'caixa' },
  { key: 'assinatura', label: 'Linha de assinatura', grupo: 'caixa' },
];

// ── CLIENTE — via do cliente (venda de balcão) ────────────────────────────────
const CAIXA: PerfilCupom = {
  id: 'caixa',
  nome: 'Cliente — balcão',
  descricao: 'Cupom da venda de balcão entregue ao cliente.',
  grupo: 'cliente',
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

// ── CLIENTE — totem (autoatendimento) ─────────────────────────────────────────
const CLIENTE_TOTEM: PerfilCupom = {
  id: 'cliente_totem',
  nome: 'Cliente — totem',
  descricao: 'Cupom do autoatendimento (totem) entregue ao cliente.',
  grupo: 'cliente',
  campos: [
    C('senha', 'Senha', { negrito: true, alinhamento: 'centro' }),
    C('nomeLoja', 'Nome da loja', { negrito: true, alinhamento: 'centro' }),
    C('dataHora', 'Data e hora'),
    C('ticket', 'Nº do ticket (controle)'),
    C('origemPedido', 'Origem (totem)', { alinhamento: 'centro' }),
    C('itens', 'Itens (qtd + produto + complementos + obs.)', { fixo: true }),
    C('subtotal', 'Subtotal'),
    C('desconto', 'Desconto'),
    C('totalGeral', 'Total geral', { negrito: true }),
    C('pagamento', 'Forma de pagamento'),
    C('avisoFiscal', 'Aviso fiscal / dados fiscais', { alinhamento: 'centro' }),
  ],
};

// ── DELIVERY — cupom do entregador (via do cliente na entrega) ─────────────────
const ENTREGADOR: PerfilCupom = {
  id: 'entregador',
  nome: 'Cliente — delivery (entregador)',
  descricao: 'Vai com o entregador: dados do cliente, endereço, valor a cobrar e QR.',
  grupo: 'cliente',
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

// Campos comuns da via de produção (cozinha) — sem valores/endereço/pagamento.
const CAMPOS_PRODUCAO = (): CampoCupom[] => [
  C('senha', 'Senha', { negrito: true, alinhamento: 'centro' }),
  C('mesa', 'Mesa / balcão', { negrito: true }),
  C('nomeLoja', 'Nome da loja', { visivel: false, alinhamento: 'centro' }),
  C('dataHora', 'Data e hora do pedido'),
  C('ticket', 'Nº do ticket (controle)'),
  C('emitidoDe', 'Emitido de (sub-PDV salão)'),
  C('cliente', 'Nome do cliente', { visivel: false }),
  C('itens', 'Itens (qtd + descrição + complementos + obs.)', { fixo: true }),
];

// ── PRODUÇÃO — balcão (cozinha, pedidos de balcão/mesa) ────────────────────────
const PRODUCAO_BALCAO: PerfilCupom = {
  id: 'producao_balcao',
  nome: 'Produção — balcão',
  descricao: 'Para a cozinha nos pedidos de balcão/mesa: sem valores.',
  grupo: 'producao',
  campos: CAMPOS_PRODUCAO(),
};

// ── PRODUÇÃO — delivery (cozinha, pedidos de entrega/plataformas) ──────────────
const PRODUCAO_DELIVERY: PerfilCupom = {
  id: 'producao_delivery',
  nome: 'Produção — delivery',
  descricao: 'Para a cozinha nos pedidos de delivery/plataformas: sem valores, com plataforma.',
  grupo: 'producao',
  campos: [
    C('senha', 'Senha', { negrito: true, alinhamento: 'centro' }),
    C('nomeLoja', 'Nome da loja', { visivel: false, alinhamento: 'centro' }),
    C('dataHora', 'Data e hora do pedido'),
    C('ticket', 'Nº do ticket (controle)'),
    C('plataforma', 'Plataforma (nº do pedido na plataforma)'),
    C('pedidoRegem', 'Nº do pedido no Regem'),
    C('cliente', 'Nome do cliente', { negrito: true }),
    C('itens', 'Itens (qtd + descrição + complementos + obs.)', { fixo: true }),
  ],
};

// ── PRODUÇÃO (legado — mantido p/ compat do editor/override antigo) ────────────
const PRODUCAO: PerfilCupom = {
  id: 'producao',
  nome: 'Produção (geral)',
  descricao: 'Perfil de produção genérico (compatibilidade).',
  grupo: 'producao',
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

// ── CAIXA — sangria (retirada de dinheiro) ────────────────────────────────────
const SANGRIA: PerfilCupom = {
  id: 'sangria',
  nome: 'Caixa — sangria',
  descricao: 'Comprovante de retirada de dinheiro do caixa.',
  grupo: 'caixa',
  campos: [
    C('nomeLoja', 'Nome da loja', { negrito: true, alinhamento: 'centro' }),
    C('tipoMovimento', 'SANGRIA', { negrito: true, alinhamento: 'centro' }),
    C('dataHora', 'Data e hora'),
    C('terminal', 'Terminal / PDV'),
    C('turno', 'Turno'),
    C('operador', 'Operador'),
    C('valorMovimento', 'Valor retirado', { negrito: true }),
    C('motivo', 'Motivo'),
    C('autorizadoPor', 'Autorizado por'),
    C('assinatura', 'Linha de assinatura', { alinhamento: 'centro' }),
  ],
};

// ── CAIXA — suprimento (entrada de dinheiro) ──────────────────────────────────
const SUPRIMENTO: PerfilCupom = {
  id: 'suprimento',
  nome: 'Caixa — suprimento',
  descricao: 'Comprovante de entrada de dinheiro no caixa.',
  grupo: 'caixa',
  campos: [
    C('nomeLoja', 'Nome da loja', { negrito: true, alinhamento: 'centro' }),
    C('tipoMovimento', 'SUPRIMENTO', { negrito: true, alinhamento: 'centro' }),
    C('dataHora', 'Data e hora'),
    C('terminal', 'Terminal / PDV'),
    C('turno', 'Turno'),
    C('operador', 'Operador'),
    C('valorMovimento', 'Valor adicionado', { negrito: true }),
    C('motivo', 'Motivo'),
    C('autorizadoPor', 'Autorizado por'),
    C('assinatura', 'Linha de assinatura', { alinhamento: 'centro' }),
  ],
};

// ── CAIXA — fechamento (conferência da sessão) ────────────────────────────────
const FECHAMENTO: PerfilCupom = {
  id: 'fechamento',
  nome: 'Caixa — fechamento',
  descricao: 'Resumo do fechamento do caixa: esperado × informado por forma.',
  grupo: 'caixa',
  campos: [
    C('nomeLoja', 'Nome da loja', { negrito: true, alinhamento: 'centro' }),
    C('tipoMovimento', 'FECHAMENTO DE CAIXA', { negrito: true, alinhamento: 'centro' }),
    C('dataHora', 'Data e hora'),
    C('terminal', 'Terminal / PDV'),
    C('turno', 'Turno'),
    C('operador', 'Operador'),
    C('aberturaValor', 'Valor de abertura'),
    C('totalPorForma', 'Totais por forma de pagamento', { fixo: true }),
    C('sangriasTotal', 'Total de sangrias'),
    C('suprimentosTotal', 'Total de suprimentos'),
    C('esperado', 'Valor esperado', { negrito: true }),
    C('informado', 'Valor informado'),
    C('diferenca', 'Diferença', { negrito: true }),
    C('assinatura', 'Linha de assinatura', { alinhamento: 'centro' }),
  ],
};

export const CUPOM_PERFIS_PADRAO: Record<string, PerfilCupom> = {
  caixa: CAIXA,
  cliente_totem: CLIENTE_TOTEM,
  entregador: ENTREGADOR,
  producao_balcao: PRODUCAO_BALCAO,
  producao_delivery: PRODUCAO_DELIVERY,
  producao: PRODUCAO,
  sangria: SANGRIA,
  suprimento: SUPRIMENTO,
  fechamento: FECHAMENTO,
};

const KEYS_VALIDAS = new Set(CAMPOS_CATALOGO.map((c) => c.key));

// Funde o perfil PADRÃO com o override salvo da loja (por campo: visivel/negrito/
// alinhamento; a ORDEM segue o override quando presente). Campos desconhecidos no
// override são ignorados; campos novos do padrão entram no fim.
export function perfilEfetivo(
  id: string,
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
    // Pseudo-campo de layout inserido pelo usuário (Fase 4): linha branca/tracejada.
    if (o.key && PSEUDO_CAMPOS[o.key]) {
      campos.push(
        C(o.key, PSEUDO_CAMPOS[o.key], {
          alinhamento: o.alinhamento,
          negrito: o.negrito,
          escala: escalaFonte(o),
          mini: o.mini as any,
          agrupado: o.agrupado as any,
        }),
      );
      continue;
    }
    const b = o.key ? porKey.get(o.key) : undefined;
    if (!b) continue; // override de campo inexistente — ignora
    vistos.add(b.key);
    const escM = escalaFonte(o) ?? escalaFonte(b); // override vence; senão base
    const miniM = o.mini != null ? !!o.mini : !!b.mini; // override vence; senão base
    const compM = subEstilo(o.comp) ?? subEstilo(b.comp); // override vence; senão base
    const obsM = subEstilo(o.obs) ?? subEstilo(b.obs);
    campos.push({
      ...b,
      visivel: b.fixo ? true : o.visivel ?? b.visivel, // itens não somem
      negrito: o.negrito ?? b.negrito,
      alinhamento: o.alinhamento ?? b.alinhamento,
      tamanho: undefined, // normaliza p/ escala (source of truth)
      ...(escM ? { escala: escM } : {}),
      ...(miniM ? { mini: true } : {}),
      ...(compM ? { comp: compM } : {}),
      ...(obsM ? { obs: obsM } : {}),
      ...(o.agrupado != null ? { agrupado: !!o.agrupado } : b.agrupado ? { agrupado: true } : {}),
    });
  }
  for (const b of base.campos) if (!vistos.has(b.key)) campos.push(b);
  return { ...base, campos };
}

// Normaliza a definição de um perfil CUSTOM salvo (saneia campos/labels/ids).
export function perfilCustom(def: any): PerfilCupom | null {
  if (!def || typeof def !== 'object') return null;
  const id = String(def.id ?? '').trim();
  if (!id.startsWith('custom_')) return null;
  const campos: CampoCupom[] = Array.isArray(def.campos)
    ? def.campos
        .filter((c: any) => c && (KEYS_VALIDAS.has(c.key) || PSEUDO_CAMPOS[c.key]))
        .map((c: any) =>
          C(c.key, CAMPOS_CATALOGO.find((x) => x.key === c.key)?.label ?? PSEUDO_CAMPOS[c.key] ?? c.key, {
            visivel: c.visivel !== false,
            negrito: !!c.negrito,
            alinhamento: (['esquerda', 'centro', 'direita'].includes(c.alinhamento) ? c.alinhamento : 'esquerda') as AlinhamentoCupom,
            escala: escalaFonte(c),
            mini: !!c.mini,
            comp: subEstilo(c.comp),
            obs: subEstilo(c.obs),
            agrupado: !!c.agrupado,
          }),
        )
    : [];
  return {
    id,
    nome: String(def.nome ?? 'Personalizado').slice(0, 40),
    descricao: String(def.descricao ?? 'Cupom personalizado').slice(0, 120),
    grupo: (['cliente', 'producao', 'caixa'].includes(def.grupo) ? def.grupo : 'cliente') as GrupoPerfil,
    custom: true,
    campos,
  };
}

// Lista TODOS os perfis efetivos: padrão (com override) + custom da loja.
export function listarPerfis(override?: Record<string, any> | null): PerfilCupom[] {
  const ov = (override ?? {}) as Record<string, any>;
  const padrao = Object.keys(CUPOM_PERFIS_PADRAO).map((id) => perfilEfetivo(id, ov[id]));
  const custom = Array.isArray(ov._custom)
    ? ov._custom.map(perfilCustom).filter((p): p is PerfilCupom => !!p)
    : [];
  return [...padrao, ...custom];
}
