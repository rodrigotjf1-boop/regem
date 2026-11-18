import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { exigirBooleano } from '../../common/exigir';
import { linkDeAvaliacaoValido } from '../whatsapp/pedir-avaliacao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A NOTA DO PEDIDO PELO CLIENTE (fase A1 do protótipo `mockups/regem-avaliacao-pedido.html`, aprovado em 18/11/2026 com a
// correção do dono: "enviar pedido de avaliação do google só quando receber avaliação 5 estrelas" — mig 453). As regras sem
// banco: o que o cliente pode mandar, quem abre caso no Atendimento, o link do Google só na nota 5, quais pedidos recebem
// e os ajustes da loja (em `robo_config.nota_*`, nascendo desligado).

/** "O que mais pesou?" — as opções da página (e do formulário do WhatsApp na fase A2), na ordem da tela. */
export const OPCOES_DO_PESO = ['Sabor', 'Temperatura', 'Tempo de entrega', 'Embalagem', 'Pedido completo', 'Preço'] as const;
export const COMENTARIO_MAX = 300;
export const NOMES_DA_NOTA = ['', 'Péssimo', 'Ruim', 'Regular', 'Bom', 'Excelente'] as const;
/** "Nota que abre caso no Atendimento": só a 1 · 1 ou 2 (o padrão) · 1, 2 ou 3. */
export const OPCOES_CASO_ATE = [1, 2, 3] as const;
/** "Prazo para avaliar" depois da entrega, em dias (o padrão é 7). */
export const OPCOES_PRAZO_DIAS = [2, 7, 30] as const;
/** A nota que leva o link do Google no obrigado (decisão do dono, 18/11/2026: só a nota 5). */
export const NOTA_DO_GOOGLE = 5;

/**
 * Os canais cujo cliente NÃO é do Regem: o totem (venda presencial), os marketplaces (iFood, 99, Keeta — a plataforma
 * pede a avaliação no app dela) e os integrados (Anota Aí, Cardápio Web, Delivery Direto, Rappi — o contato com o
 * cliente é deles). A MESMA regra de `DeliveryService.podeAvisarPeloWhatsapp` (o teste confere os dois — V74).
 */
export const CANAIS_FORA_DO_REGEM = ['totem', 'gogem', 'ifood', '99food', 'keeta', 'anotaai', 'cardapio_web', 'delivery_direto', 'rappi'] as const;

/** O pedido é do Regem (o cardápio próprio, o manual, o do robô)? */
export function ehPedidoDoRegem(canal: unknown): boolean {
  return !(CANAIS_FORA_DO_REGEM as readonly string[]).includes(String(canal ?? '').trim().toLowerCase());
}

/** A condição SQL "o pedido é do Regem" sobre a coluna `canal` (a mesma lista, minúscula como a regra acima). */
export const sqlPedidoDoRegem = (coluna: string) =>
  sql`lower(coalesce(${sql.raw(coluna)}, '')) not in (${sql.join(CANAIS_FORA_DO_REGEM.map((c) => sql`${c}`), sql`, `)})`;

export type NotaConferida = { nota: number; pesou: string[]; comentario: string | null };

/**
 * O que a página manda, conferido: a nota inteira de 1 a 5 (obrigatória); "o que pesou" só das opções, sem repetir; o
 * comentário sem os caracteres de controle, até 300 letras (vazio = sem comentário).
 */
export function conferirNota(dto: any): NotaConferida {
  if (!dto || typeof dto !== 'object') throw new BadRequestException('Escolha uma nota de 1 a 5.');
  const nota = dto.nota;
  if (typeof nota !== 'number' || !Number.isInteger(nota) || nota < 1 || nota > 5) throw new BadRequestException('Escolha uma nota de 1 a 5.');
  let pesou: string[] = [];
  if (dto.pesou !== undefined && dto.pesou !== null) {
    if (!Array.isArray(dto.pesou)) throw new BadRequestException('"O que mais pesou" veio num formato que não dá para ler.');
    for (const p of dto.pesou) {
      if (typeof p !== 'string' || !(OPCOES_DO_PESO as readonly string[]).includes(p))
        throw new BadRequestException(`"O que mais pesou": escolha entre ${OPCOES_DO_PESO.join(', ')}.`);
      if (!pesou.includes(p)) pesou.push(p);
    }
    // Na ordem da tela, para a lista mostrar sempre igual.
    pesou = OPCOES_DO_PESO.filter((o) => pesou.includes(o));
  }
  let comentario: string | null = null;
  if (dto.comentario !== undefined && dto.comentario !== null) {
    if (typeof dto.comentario !== 'string') throw new BadRequestException('O comentário veio num formato que não dá para ler.');
    // Sem os caracteres de controle (a quebra de linha fica); espaço nas pontas sai.
    const limpo = dto.comentario.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim();
    if ([...limpo].length > COMENTARIO_MAX) throw new BadRequestException(`O comentário passa de ${COMENTARIO_MAX} letras.`);
    comentario = limpo || null;
  }
  return { nota, pesou, comentario };
}

/** A nota abre (ou soma a) um caso "Avaliação" no Atendimento? Até a nota que a loja escolheu (1, 2 ou 3). */
export function abreCaso(nota: number, casoAte: number): boolean {
  return nota <= casoAte;
}

/** O link do Google no obrigado: SÓ na nota 5 (decisão do dono, 18/11/2026) e só o link do Google que a loja colou. */
export function googleDaNota(nota: number | null | undefined, link: unknown): string | null {
  if (nota !== NOTA_DO_GOOGLE) return null;
  return linkDeAvaliacaoValido(link);
}

/** O texto do caso no Atendimento: a nota, por onde, o pedido, o que pesou e o comentário (a gaveta do caso mostra). */
export function mensagemDoCaso(n: NotaConferida, o: { origem: 'pagina' | 'whatsapp'; pedidoNumero: string | null }): string {
  const por = o.origem === 'whatsapp' ? 'pelo WhatsApp' : 'pela página do pedido';
  const linhas = [`Nota ${n.nota} de 5 (${NOMES_DA_NOTA[n.nota]}) ${por}${o.pedidoNumero ? ` · pedido #${o.pedidoNumero}` : ''}.`];
  if (n.pesou.length) linhas.push(`O que mais pesou: ${n.pesou.join(', ')}.`);
  linhas.push(n.comentario ? `Comentário: "${n.comentario}"` : 'Sem comentário.');
  return linhas.join('\n');
}

/** Até quando dá para avaliar: a entrega mais o prazo da loja. */
export function prazoAte(entregueEm: Date, prazoDias: number): Date {
  return new Date(entregueEm.getTime() + prazoDias * 86_400_000);
}

export type AjustesDaNota = { ativa: boolean; casoAte: number; prazoDias: number };

/** Os ajustes como a linha de `robo_config` guarda (sem linha: os padrões — desligado, nota até 2, 7 dias). */
export function ajustesDaNotaDaLinha(l: any): AjustesDaNota {
  const opcao = (v: unknown, opcoes: readonly number[], padrao: number) => (opcoes.includes(Number(v)) ? Number(v) : padrao);
  return {
    ativa: l?.nota_ativa === true,
    casoAte: opcao(l?.nota_caso_ate, OPCOES_CASO_ATE, 2),
    prazoDias: opcao(l?.nota_prazo_dias, OPCOES_PRAZO_DIAS, 7),
  };
}

/**
 * Os ajustes que a tela manda, conferidos: o ausente MANTÉM o que estava (V16); liga/desliga só verdadeiro/falso (V15);
 * os números só das opções.
 */
export function ajustesDaNotaNovos(dto: any, antes: AjustesDaNota): AjustesDaNota {
  if (!dto || typeof dto !== 'object') throw new BadRequestException('Nada para salvar na nota do pedido.');
  const novo: AjustesDaNota = { ...antes };
  let algum = false;
  if (dto.ativa !== undefined) {
    novo.ativa = exigirBooleano(dto.ativa, 'ativa');
    algum = true;
  }
  const opcao = (campo: 'casoAte' | 'prazoDias', opcoes: readonly number[], nome: string) => {
    if (dto[campo] === undefined) return;
    const v = dto[campo];
    if (typeof v !== 'number' || !opcoes.includes(v)) throw new BadRequestException(`${nome}: escolha uma das opções (${opcoes.join(', ')}).`);
    novo[campo] = v;
    algum = true;
  };
  opcao('casoAte', OPCOES_CASO_ATE, 'Nota que abre caso no Atendimento');
  opcao('prazoDias', OPCOES_PRAZO_DIAS, 'Prazo para avaliar');
  if (!algum) throw new BadRequestException('Nada para salvar na nota do pedido.');
  return novo;
}

/** Os ajustes da nota desta empresa. Nunca lança por coluna ausente (banco sem a mig 453: desligado, como nasce). */
export async function lerNota(db: any, tenantId: string): Promise<AjustesDaNota> {
  try {
    const r: any = await db.execute(sql`select nota_ativa, nota_caso_ate, nota_prazo_dias from robo_config where tenant_id = ${tenantId}::uuid`);
    return ajustesDaNotaDaLinha((r?.rows ?? r ?? [])[0]);
  } catch (e: any) {
    if (e?.code !== '42703' && e?.code !== '42P01') throw e;
    return ajustesDaNotaDaLinha(null);
  }
}

/** "1× Smash duplo · 1× Batata média" — os itens do pedido em uma linha (o que o `itens` do pedido guardar). */
export function itensEmUmaLinha(itens: unknown): string {
  if (!Array.isArray(itens)) return '';
  return itens
    .map((i: any) => {
      const nome = String(i?.nome ?? i?.name ?? i?.descricao ?? '').trim();
      if (!nome) return '';
      const q = Number(i?.quantidade ?? i?.qtd ?? i?.quantity ?? 1) || 1;
      return `${Number.isInteger(q) ? q : q.toLocaleString('pt-BR')}× ${nome}`;
    })
    .filter(Boolean)
    .join(' · ');
}
