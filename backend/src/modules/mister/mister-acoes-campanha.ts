// AS CAMPANHAS DE MARKETING PELA CONVERSA (versão 9, etapa 8 do pedido do dono de 24/11). Pelo MESMO serviço de Delivery ›
// Marketing (`CampanhaService`):
//  • pausar e retomar a campanha que está mandando (botão);
//  • repetir uma campanha que já foi montada na tela, para o mesmo público, AGORA — com quantos vão receber e o custo antes, e o
//    PIN (é mensagem para muitos clientes e, na API oficial, dinheiro).
// Escrever mensagem nova para os clientes fica na tela (o texto vai a muita gente; na API oficial, o modelo precisa estar aprovado
// pela Meta). A campanha do Clube (prêmio para todos), a da hora habitual, a agendada, a do perfil e a "não pede há N dias" também
// só se repetem na tela: cada uma tem uma conferência própria lá. Aqui só a conferência e os textos; sem banco.
import { ehSegmentoDoPerfil } from '../../common/segmentos-do-perfil';

export type ParametrosDaCampanha =
  | { acao: 'pausar_campanha'; campanha: string; retomar: boolean }
  | { acao: 'repetir_campanha'; campanha: string };

const texto = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function conferirCampanha(acao: ParametrosDaCampanha['acao'], en: Record<string, unknown>): { parametros: ParametrosDaCampanha; resumo: string } | { erro: string } {
  const campanha = texto(en.campanhaDaConversa).slice(0, 120);
  if (campanha.length < 2) return { erro: 'Diga qual campanha (um pedaço da mensagem, o tipo ou "a última").' };
  if (acao === 'pausar_campanha') {
    const retomar = en.retomarCampanha === true;
    return { parametros: { acao, campanha, retomar }, resumo: `${retomar ? 'Retomar' : 'Pausar'} a campanha "${campanha}".` };
  }
  return { parametros: { acao, campanha }, resumo: `Repetir a campanha "${campanha}" para o mesmo público.` };
}

/** Uma linha de `CampanhaService.listar` (o que a escolha e os textos usam). */
export type LinhaDaCampanha = {
  id: string;
  segmento: string;
  tipo: string;
  mensagem: string | null;
  status: string;
  estado?: string;
  criado_em: string | Date;
  total?: number;
  enviados?: number;
  agendada?: boolean;
  clube_premio_id?: string | null;
  envio_habitual?: boolean;
  template_nome?: string | null;
};

const TIPOS: Record<string, string> = {
  avulsa: 'avulsa',
  frete_gratis: 'frete grátis',
  cupom: 'cupom',
  recuperacao: 'recuperação',
  campeoes: 'campeões',
  aniversario: 'aniversário',
  peca_de_novo: 'peça de novo',
  vip: 'VIP',
  fim_de_semana: 'fim de semana',
};
export const nomeDoTipo = (t: string) => TIPOS[t] ?? t.replace(/_/g, ' ');

/** "a de cupom de 24/11 18:00 ("Hoje tem 20% no smash…")" — como a pessoa reconhece a campanha. */
export function nomeDaCampanha(c: LinhaDaCampanha, quando: string): string {
  const trecho = texto(c.mensagem).slice(0, 50);
  return `a campanha ${nomeDoTipo(c.tipo)} de ${quando}${trecho ? ` ("${trecho}${texto(c.mensagem).length > 50 ? '…' : ''}")` : ''}`;
}

/** A campanha pelo que a pessoa disse: "a última", um pedaço da mensagem ou o tipo. Duas ou nenhuma: a pergunta. */
export function acharCampanhaDaLista(
  linhas: LinhaDaCampanha[],
  dito: string,
  quando: (c: LinhaDaCampanha) => string,
): { linha: LinhaDaCampanha } | { erro: string } {
  if (!linhas.length) return { erro: 'Não há campanha em Delivery › Marketing.' };
  const d = semAcento(texto(dito));
  if (/^(a )?ultima\b|^(a )?mais recente/.test(d)) return { linha: linhas[0] };
  const achadas = linhas.filter((c) => semAcento(texto(c.mensagem)).includes(d) || semAcento(nomeDoTipo(c.tipo)) === d || semAcento(c.tipo) === d);
  if (!achadas.length) return { erro: `Não achei a campanha "${texto(dito)}" em Delivery › Marketing. Diga um pedaço da mensagem dela, o tipo ou "a última".` };
  if (achadas.length > 1)
    return { erro: `Há mais de uma campanha assim: ${achadas.slice(0, 5).map((c) => nomeDaCampanha(c, quando(c))).join('; ')}. Diga um pedaço da mensagem que só uma tem.` };
  return { linha: achadas[0] };
}

/** Por que a campanha não se repete pela conversa (as que têm conferência própria na tela), ou null. */
export function recusaDaRepeticao(c: LinhaDaCampanha & { cupom_codigo?: string | null }): string | null {
  if (c.clube_premio_id) return 'Essa campanha dá um prêmio do Clube a todos: repetir só pela tela (Delivery › Marketing).';
  if (c.envio_habitual) return 'Essa campanha vai na hora habitual de cada cliente: repetir só pela tela (Delivery › Marketing).';
  if (c.agendada) return 'Essa campanha é agendada: repetir só pela tela (Delivery › Marketing).';
  if (c.cupom_codigo) return 'Essa campanha leva um cupom (que pode ter vencido): repetir só pela tela (Delivery › Marketing).';
  if (ehSegmentoDoPerfil(c.segmento)) return 'Essa campanha usa o público pelo perfil dos clientes: repetir só pela tela (Delivery › Marketing).';
  if (c.segmento === 'recuperacao') return 'Essa campanha usa "não pede há N dias": repetir só pela tela (Delivery › Marketing).';
  if (!texto(c.mensagem) && !c.template_nome) return 'Essa campanha não tem mensagem guardada: repetir só pela tela.';
  return null;
}

const reais = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** O custo antes: na API oficial, a estimativa pela conta (ou pela tabela da Meta); na conexão por QR Code, sem custo da Meta. */
export function textoDoCusto(oficial: boolean, est: { estimativa: number; preco: number; fonte: 'conta' | 'tabela' } | null): string {
  if (!oficial) return 'Pela conexão por QR Code a Meta não cobra, mas mandar para muita gente tem risco de bloqueio do número.';
  if (!est) return 'O custo não pôde ser estimado agora.';
  return `Custo estimado: ${reais(est.estimativa)} (${reais(est.preco)} por mensagem, pelo ${est.fonte === 'conta' ? 'que a sua conta pagou nos últimos 60 dias' : 'preço publicado da Meta'}).`;
}

export function resumoDaRepeticao(nome: string, publico: { total: number; foraPorOferta?: number }, custo: string): string {
  const fora = publico.foraPorOferta ? ` (${publico.foraPorOferta} ficam de fora por terem recebido oferta há pouco)` : '';
  return `Repetir ${nome} AGORA, para o mesmo público: ${publico.total === 1 ? '1 cliente' : `${publico.total} clientes`}${fora}. ${custo} Quem pediu para sair não recebe.`;
}

/** A página do PIN da repetição. */
export function apresentacaoDaCampanha(p: Record<string, any>): { titulo: string; itens: string[]; detalhe: string | null; valor: number | null; botao: string } {
  return {
    titulo: 'Repetir a campanha',
    itens: [`Campanha: ${p.nomeDaCampanha}`, `Clientes: ${p.publico}`, String(p.textoDoCusto)],
    detalhe: 'Começa a mandar logo depois do PIN. Para parar, peça para pausar a campanha.',
    valor: typeof p.estimativa === 'number' ? p.estimativa : null,
    botao: 'Repetir a campanha',
  };
}
