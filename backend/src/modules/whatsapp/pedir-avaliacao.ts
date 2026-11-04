import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { exigirBooleano } from '../../common/exigir';
import { hojeISO } from '../../common/data';
import { instanteDe } from '../../common/fuso-sql';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PEDIR AVALIAÇÃO NO GOOGLE DEPOIS DA ENTREGA (pedido do dono, 04/11/2026; desenho aprovado no mesmo dia — mig 365). A loja
// liga (nasce desligado), cola o link "Pedir avaliações" do Perfil da Empresa no Google e ajusta a mensagem; o Regem
// manda UMA mensagem por pedido, pela API oficial e só dentro da janela de 24 h da conversa (como o "Chegou tudo certo?"):
//  • só pedidos de ENTREGA dos canais da própria loja — pedido do iFood e da 99: a avaliação é pedida pela própria
//    plataforma, no app dela (o adicional do dono);
//  • "só pedidos sem problema" (o padrão do dono): entregue até a hora prometida (a MESMA conta do aviso de atraso — o
//    tempo de entrega da loja mais a tolerância), sem aviso de atraso, sem caso de problema ou cancelamento ligado ao
//    pedido e sem "Tive um problema"/"Não chegou" no "Chegou tudo certo?". A tela avisa: o Google proíbe pedir só a quem
//    teve pedido bom;
//  • a partir do Nº pedido do cliente (o cliente recorrente);
//  • de novo só a quem ainda não tocou no link, depois de N dias ("ainda não avaliou" = ainda não tocou: o Google não
//    conta ao Regem quem avaliou). O link da mensagem passa pelo Regem (`/publico/avaliacao/:id`), que anota o toque.
// O que saiu, o que não saiu (com o motivo) e o toque ficam em `avaliacao_pedida` — uma linha por pedido, que não se apaga
// (o registro dos envios do pedido se apaga com 90 dias, e a regra lembra mais que isso).

/** Canais de marketplace: a avaliação é pedida pela própria plataforma (o adicional do dono). */
export const CANAIS_DA_PLATAFORMA = ['ifood', '99food'];
/** Até quantas horas depois da entrega ainda vale mandar (a conversa ainda precisa estar na janela de 24 h). */
export const ATE_HORAS = 12;
export const OPCOES_DEPOIS_MIN = [20, 40, 60, 120] as const;
export const OPCOES_A_PARTIR_DO = [1, 2, 3, 4, 5] as const;
export const OPCOES_DE_NOVO_DIAS = [30, 60, 90, 180] as const;
export const TEXTO_PADRAO = 'Obrigado pelo pedido, {nome}! 😊 Se puder, deixe sua avaliação no Google — ajuda muito a gente: {link}';
export const LIMITE_DO_TEXTO = 500;

export type AjustesDaAvaliacao = {
  ativa: boolean;
  link: string | null;
  texto: string;
  depoisMin: number;
  soSemProblema: boolean;
  aPartirDo: number;
  deNovoDias: number;
};

/** Os ajustes como a linha de `robo_config` guarda (sem linha: os padrões — desligado). */
export function ajustesDaLinha(l: any): AjustesDaAvaliacao {
  const opcao = (v: unknown, opcoes: readonly number[], padrao: number) => (opcoes.includes(Number(v)) ? Number(v) : padrao);
  return {
    ativa: l?.avaliacao_ativa === true,
    link: typeof l?.avaliacao_link === 'string' && l.avaliacao_link.trim() ? l.avaliacao_link.trim() : null,
    texto: typeof l?.avaliacao_texto === 'string' && l.avaliacao_texto.trim() ? l.avaliacao_texto : TEXTO_PADRAO,
    depoisMin: opcao(l?.avaliacao_depois_min, OPCOES_DEPOIS_MIN, 40),
    soSemProblema: l?.avaliacao_so_sem_problema !== false,
    aPartirDo: opcao(l?.avaliacao_a_partir_do, OPCOES_A_PARTIR_DO, 2),
    deNovoDias: opcao(l?.avaliacao_de_novo_dias, OPCOES_DE_NOVO_DIAS, 60),
  };
}

/**
 * O link de avaliação da loja: só HTTPS e só do Google (o "Pedir avaliações" do Perfil da Empresa — g.page, google.com,
 * maps.app.goo.gl). Outro endereço: null — o cliente nunca é levado a um site que a loja não controla pelo Google.
 */
export function linkDeAvaliacaoValido(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s || s.length > 500) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const doGoogle =
    host === 'g.page' ||
    host === 'goo.gl' ||
    host === 'maps.app.goo.gl' ||
    host === 'google.com' ||
    host.endsWith('.google.com') ||
    host === 'google.com.br' ||
    host.endsWith('.google.com.br');
  return doGoogle ? u.toString() : null;
}

/** "Obrigado pelo pedido, Ana! …" — o primeiro nome no {nome} (sem nome, a frase fica sem ele) e o link no {link}. */
export function textoDaAvaliacao(modelo: string, nome: unknown, link: string): string {
  const primeiro = String(nome ?? '').trim().split(/\s+/)[0] ?? '';
  // Substituto por FUNÇÃO: o nome vem do cliente, e "$&"/"$'" num texto de substituição viram pedaços do modelo.
  // Sem nome: sai o {nome} com a vírgula de antes ("pedido, {nome}!") ou a de depois ("{nome}, avalie").
  const comNome = primeiro
    ? modelo.replace(/\{nome\}/g, () => primeiro)
    : modelo.replace(/,\s*\{nome\}|\{nome\}\s*,?\s*/g, '').replace(/\s+([!?.,])/g, '$1');
  return comNome.replace(/\{link\}/g, () => link).trim();
}

/**
 * Os ajustes que a tela manda, conferidos: o ausente MANTÉM o que estava (V16); liga/desliga só verdadeiro/falso (V15);
 * os números só das opções; o link só do Google; a mensagem com o {link}. Ligar exige o link.
 */
export function ajustesNovos(dto: any, antes: AjustesDaAvaliacao): AjustesDaAvaliacao {
  if (!dto || typeof dto !== 'object') throw new BadRequestException('Nada para salvar na avaliação.');
  const novo: AjustesDaAvaliacao = { ...antes };
  let algum = false;
  if (dto.ativa !== undefined) {
    novo.ativa = exigirBooleano(dto.ativa, 'ativa');
    algum = true;
  }
  if (dto.link !== undefined) {
    if (dto.link === null || String(dto.link).trim() === '') novo.link = null;
    else {
      const l = linkDeAvaliacaoValido(dto.link);
      if (!l) throw new BadRequestException('Cole o link de avaliação do Google (começa com https:// — o "Pedir avaliações" do Perfil da Empresa no Google).');
      novo.link = l;
    }
    algum = true;
  }
  if (dto.texto !== undefined) {
    const t = String(dto.texto ?? '').trim();
    if (!t) novo.texto = TEXTO_PADRAO;
    else {
      if (!t.includes('{link}')) throw new BadRequestException('A mensagem precisa ter {link} — é onde o link de avaliação entra.');
      if (t.length > LIMITE_DO_TEXTO) throw new BadRequestException(`A mensagem passa de ${LIMITE_DO_TEXTO} letras.`);
      novo.texto = t;
    }
    algum = true;
  }
  const opcao = (campo: string, opcoes: readonly number[], nome: string) => {
    if (dto[campo] === undefined) return undefined;
    const v = dto[campo];
    if (typeof v !== 'number' || !opcoes.includes(v)) throw new BadRequestException(`${nome}: escolha uma das opções (${opcoes.join(', ')}).`);
    algum = true;
    return v;
  };
  novo.depoisMin = opcao('depoisMin', OPCOES_DEPOIS_MIN, 'Minutos depois da entrega') ?? novo.depoisMin;
  novo.aPartirDo = opcao('aPartirDo', OPCOES_A_PARTIR_DO, 'A partir de qual pedido') ?? novo.aPartirDo;
  novo.deNovoDias = opcao('deNovoDias', OPCOES_DE_NOVO_DIAS, 'Pedir de novo depois de') ?? novo.deNovoDias;
  if (dto.soSemProblema !== undefined) {
    novo.soSemProblema = exigirBooleano(dto.soSemProblema, 'soSemProblema');
    algum = true;
  }
  if (!algum) throw new BadRequestException('Nada para salvar na avaliação.');
  if (novo.ativa && !novo.link)
    throw new BadRequestException('Cole o link de avaliação da loja no Google — sem ele, o pedido de avaliação não pode ficar ligado.');
  return novo;
}

/** Os ajustes da avaliação desta empresa e o que saiu no mês (o fuso da operação — V48). Nunca lança por coluna ausente. */
export async function lerAvaliacao(db: any, tenantId: string): Promise<AjustesDaAvaliacao & { doMes: { enviados: number; tocaram: number } }> {
  let ajustes = ajustesDaLinha(null);
  try {
    const r: any = await db.execute(sql`
      select avaliacao_ativa, avaliacao_link, avaliacao_texto, avaliacao_depois_min, avaliacao_so_sem_problema,
             avaliacao_a_partir_do, avaliacao_de_novo_dias
        from robo_config where tenant_id = ${tenantId}::uuid`);
    ajustes = ajustesDaLinha((r?.rows ?? r ?? [])[0]);
  } catch (e: any) {
    if (e?.code !== '42703' && e?.code !== '42P01') throw e; // banco sem a mig 365: desligado, como nasce
  }
  let doMes = { enviados: 0, tocaram: 0 };
  try {
    // O mês da operação (o fuso escrito na consulta — V48, ERR-120): do dia 1º, 00:00 de Brasília. "Tocaram" conta o toque
    // feito no mês, mesmo de uma mensagem do mês anterior.
    const inicio = instanteDe(`${hojeISO().slice(0, 7)}-01`);
    const r: any = await db.execute(sql`
      select count(*) filter (where resultado = 'enviado' and criado_em >= ${inicio})::int as enviados,
             count(*) filter (where tocou_em >= ${inicio})::int as tocaram
        from avaliacao_pedida
       where tenant_id = ${tenantId}::uuid and (criado_em >= ${inicio} or tocou_em >= ${inicio})`);
    const l = (r?.rows ?? r ?? [])[0];
    doMes = { enviados: Number(l?.enviados ?? 0), tocaram: Number(l?.tocaram ?? 0) };
  } catch {
    /* sem o registro: zero */
  }
  return { ...ajustes, doMes };
}
