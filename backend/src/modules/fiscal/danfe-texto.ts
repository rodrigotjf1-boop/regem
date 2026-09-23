// K6 — TEXTO do DANFE NFC-e, num lugar só.
//
// Este texto nasceu dentro de `imprimirDanfe`, que só sabia enfileirar para a impressora da
// loja. Com o totem, o MESMO documento precisa ir para um aparelho de sala que imprime sozinho
// (venda no cartão: o cliente paga e leva o cupom sem passar pelo balcão). Se cada caminho
// montasse o seu, uma correção de norma teria de ser feita duas vezes — e a segunda seria
// esquecida. Então o texto sai daqui e os dois caminhos consomem o mesmo.
//
// Convenção de marcadores (a mesma que o `edge/escpos.mjs` já lê):
//   `@QR:<dados>` → QR Code DESENHADO, centralizado. Nunca o endereço como texto: sem o QR
//   o cliente não tem como consultar a nota, e o Manual do DANFE NFC-e exige o código.
import { formatarDocumento } from './destinatario';

export type DanfeItem = {
  descricao: string;
  quantidade: number;
  precoUnitario: number;
};

export type DanfeExtras = {
  frete?: number;
  desconto?: number;
  consumidor?: string | null;
};

const money = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Monta o texto do DANFE NFC-e a partir da nota já gravada.
 *
 * Duas tarjas existem para PROTEGER quem recebe o papel, e nenhuma é enfeite:
 *  • **SEM VALOR FISCAL** — ambiente de homologação OU nota simulada. Sai por `simulada`
 *    também porque nota simulada em ambiente de produção saía com cara de cupom válido
 *    (ERR-088);
 *  • **EMITIDA EM CONTINGÊNCIA** — off-line. O Manual do DANFE NFC-e (Anexo IV do MOC) obriga
 *    a mensagem, porque nessa hora a nota ainda NÃO tem protocolo: quem confere precisa saber
 *    que a autorização vem depois.
 */
export function montarDanfeTexto(
  nota: {
    serie: number | string;
    numero: number | string;
    ambiente?: string | null;
    simulada?: boolean | null;
    status?: string | null;
    valorTotal: number | string;
    chave?: string | null;
    protocolo?: string | null;
    qrcode?: string | null;
  },
  itens: DanfeItem[],
  extras?: DanfeExtras,
): string {
  const l: string[] = ['DANFE NFC-e', `Serie ${nota.serie} No ${nota.numero}`];
  if (nota.ambiente === '2' || nota.simulada) l.push('*** SEM VALOR FISCAL ***');
  if (nota.status === 'contingencia') l.push('*** EMITIDA EM CONTINGENCIA ***');
  l.push('--------------------------------');
  for (const it of itens) {
    l.push(`${it.quantidade}x ${it.descricao}`);
    l.push(`   ${money(it.quantidade * it.precoUnitario)}`);
  }
  l.push('--------------------------------');
  // Desconto e entrega aparecem no cupom porque agora estão na nota — sem isso o
  // cliente vê um total que não bate com a soma dos itens impressos.
  if (extras?.desconto) l.push(`DESCONTO: -${money(extras.desconto)}`);
  if (extras?.frete) l.push(`ENTREGA: ${money(extras.frete)}`);
  l.push(`TOTAL: ${money(Number(nota.valorTotal))}`);
  // O DANFE NFC-e tem de dizer quem é o consumidor — identificado ou não. É também como o
  // cliente confere, no papel, que o CPF que ele informou entrou mesmo na nota.
  l.push(
    extras?.consumidor
      ? `CONSUMIDOR: ${formatarDocumento(extras.consumidor)}`
      : 'CONSUMIDOR NAO IDENTIFICADO',
  );
  l.push(`Chave: ${nota.chave}`);
  l.push(`Protocolo: ${nota.protocolo ?? '-'}`);
  l.push('Consulte pela chave ou pelo QR Code:');
  if (nota.qrcode) l.push(`@QR:${nota.qrcode}`);
  return l.join('\n');
}
