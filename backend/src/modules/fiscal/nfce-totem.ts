// O RESULTADO FISCAL DA VENDA DO TOTEM — o contrato que o GoGeM lê.
//
// No totem a regra do dono é outra da do caixa: **a compra só termina com o cupom fiscal na mão
// do cliente**. O caixa segue vendendo quando a nota falha (a venda nunca trava por causa do
// fiscal — é o `emitirSeAtivo`); o totem, não: o pagamento já foi aprovado na maquininha, e se o
// Regem não emitir, o totem mostra a mensagem, registra o motivo e ESTORNA. Para isso ele
// precisa saber o que aconteceu — antes, nota recusada chegava a ele igual a "a loja não emite
// nota" (`null`), e o cliente levava um cupom sem valor fiscal sem ninguém saber.
//
// Os quatro casos (os nomes são os que o GoGeM implementa — mudar um é quebrar o outro lado):
//
//   | situação                                  | `nfce`                                              |
//   |-------------------------------------------|-----------------------------------------------------|
//   | loja sem fiscal, ou ESTE totem não emite  | `null`                                              |
//   | autorizada (100/120/150)                  | resumo, `status:'autorizada'`, `danfe`, via = false |
//   | contingência                              | resumo, `status:'contingencia'`, `protocolo:null`,  |
//   |                                           | `danfe`, via = config da 2ª via (mig 287)           |
//   | não emitida                               | `{status:'nao_emitida', danfe:null, erro}`          |
//
// "Este totem não emite" (mig 288, presidente/gerência decide) vale como "loja sem fiscal": nos
// dois casos não se espera nota nenhuma daquele aparelho, e o cupom sai sem valor fiscal.
//
// `nao_emitida` só se diz com CERTEZA de que não existe nota válida para a venda. Nota que foi à
// SEFAZ e ficou sem resposta segue o caminho da contingência — e, se nem a contingência sai, a
// pendente fica marcada para ser CANCELADA se um dia aparecer autorizada (a venda foi desfeita).
import { BadRequestException } from '@nestjs/common';
import { ContingenciaIndisponivel } from './contingencia';
import { ResumoNfce, resumoNfce } from './resumo-nfce';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Quanto o caminho do totem espera a AUTORIZAÇÃO — do DNS ao último byte, prazo TOTAL (não de
 * ociosidade). O totem espera a liberação por até 45 s e o nominal combinado é responder em 15 s:
 * 10 s de SEFAZ + a contingência (local, sem rede) cabem com folga. Passou disso, é SILÊNCIO — e
 * entra a contingência que já existe. Os outros caminhos (PDV, delivery) seguem com os 30 s.
 */
export const PRAZO_AUTORIZACAO_TOTEM_MS = 10_000;

/** Justificativa do cancelamento quando o DANFE não sai no papel do totem (15 a 255 caracteres). */
export const JUSTIFICATIVA_CUPOM_NAO_IMPRESSO = 'Cupom fiscal nao impresso no totem; venda desfeita';

/**
 * Justificativa do cancelamento da nota que foi à SEFAZ sem resposta numa venda que acabou
 * desfeita — se ela aparecer autorizada depois, não pode continuar valendo.
 */
export const JUSTIFICATIVA_VENDA_DESFEITA = 'Venda desfeita: NFC-e sem resposta da SEFAZ na autorizacao';

export type EtapaNfceNaoEmitida =
  /** pré-voo: NCM, campos, certificado, limite sem CPF, cadastro fiscal, taxa de serviço. */
  | 'configuracao'
  | 'rejeitada'
  | 'denegada'
  /** a SEFAZ calou e a contingência não saiu (sem certificado, UF só com QR v2...). */
  | 'sem_contingencia'
  | 'interno';

export type ErroNfceTotem = {
  etapa: EtapaNfceNaoEmitida;
  /** O cStat da SEFAZ, quando houve resposta com código. */
  codigo: string | null;
  /** O texto que o Regem já produz — é o que vai para o relatório do GoGeM. */
  motivo: string;
  /** A PRÓXIMA venda vai falhar igual? O totem alerta o gestor em vez de estornar em série. */
  repete: boolean;
};

export type NfceEmitidaTotem = ResumoNfce & { viaEstabelecimento: boolean };
export type NfceNaoEmitidaTotem = { status: 'nao_emitida'; danfe: null; erro: ErroNfceTotem };
export type NfceDoTotem = NfceEmitidaTotem | NfceNaoEmitidaTotem | null;

/**
 * Rejeições que dizem respeito ao EMITENTE, não à venda: com elas a próxima nota é recusada do
 * mesmo jeito. Texto conferido no MOC consolidado on-line (SEFAZ-PR) em 24/09/2026.
 *
 * Ficam de fora, de propósito, a 286 e a 296 ("erro no acesso a LCR"): é a SEFAZ que não
 * conseguiu consultar a lista de revogação — passageiro, e a próxima venda pode passar.
 */
export const REJEICOES_DO_EMITENTE: Readonly<Record<string, string>> = {
  '213': 'CNPJ-Base do Emitente difere do CNPJ-Base do Certificado Digital',
  '230': 'IE do emitente não cadastrada',
  '231': 'IE do emitente não vinculada ao CNPJ',
  '245': 'CNPJ Emitente não cadastrado',
  '280': 'Certificado Transmissor inválido',
  '281': 'Certificado Transmissor Data Validade',
  '282': 'Certificado Transmissor sem CNPJ/CPF',
  '283': 'Certificado Transmissor - erro Cadeia de Certificação',
  '284': 'Certificado Transmissor revogado',
  '285': 'Certificado Transmissor difere ICP-Brasil',
  '290': 'Certificado Assinatura inválido',
  '291': 'Certificado Assinatura Data Validade',
  '292': 'Certificado de Assinatura sem CNPJ/CPF',
  '293': 'Certificado Assinatura - erro Cadeia de Certificação',
  '294': 'Certificado Assinatura revogado',
  '295': 'Certificado Assinatura difere ICP-Brasil',
  '297': 'Assinatura difere do calculado',
  '298': 'Assinatura difere do padrão do Sistema',
  '462': 'Código Identificador do CSC no QR-Code não cadastrado na SEFAZ',
  '463': 'Código Identificador do CSC no QR-Code foi revogado pela empresa',
  '464': 'Código de Hash no QR-Code difere do calculado',
  // Emitente irregular: a mesma irregularidade vem como REJEIÇÃO 781 numa UF (1C17-38) e como
  // DENEGAÇÃO 301 em outra (1C17-40) — a denegação cai na etapa 'denegada', que sempre repete.
  '781': 'Emissor não habilitado para emissão da NFC-e',
};

/** `repete` é função só da etapa e do código — por isso dá para reconstruir na repetição. */
export function repeteNaProxima(etapa: EtapaNfceNaoEmitida, codigo: string | null): boolean {
  if (etapa === 'rejeitada') return !!codigo && codigo in REJEICOES_DO_EMITENTE;
  return etapa !== 'interno';
}

function textoDoErro(e: unknown): string {
  const m = (e as any)?.message;
  const texto = typeof m === 'string' && m.trim() ? m.trim() : String(e ?? 'falha desconhecida');
  return texto.slice(0, 400);
}

function erro(etapa: EtapaNfceNaoEmitida, codigo: string | null, motivo: string): ErroNfceTotem {
  const cod = codigo ? String(codigo).trim() || null : null;
  return { etapa, codigo: cod, motivo, repete: repeteNaProxima(etapa, cod) };
}

/**
 * Traduz a falha da emissão para a etapa do contrato. Quem lança já deixa a pista:
 *  • a nota gravada vem pendurada no erro (`e.nota`) quando a falha aconteceu DEPOIS de o número
 *    ser reservado — o status dela diz se a SEFAZ rejeitou, denegou ou calou;
 *  • sem nota, foi o pré-voo (recusa previsível, antes de gastar número) → 'configuracao';
 *  • `ContingenciaIndisponivel` → a SEFAZ calou e não havia como emitir off-line.
 * O que não é nenhum desses (banco, bug) é 'interno' — e não repete por definição.
 */
export function classificarFalhaNfce(e: unknown): ErroNfceTotem {
  const motivo = textoDoErro(e);
  if (e instanceof ContingenciaIndisponivel) return erro('sem_contingencia', null, motivo);
  const nota = (e as any)?.nota;
  if (nota?.status === 'pendente') return erro('sem_contingencia', null, motivo);
  if (nota?.status === 'denegada') return erro('denegada', nota.cstat ?? null, motivo);
  if (nota?.status === 'rejeitada') return erro('rejeitada', nota.cstat ?? null, motivo);
  if (e instanceof BadRequestException) return erro('configuracao', null, motivo);
  return erro('interno', null, motivo);
}

/** Nota autorizada ou em contingência, no formato que o totem imprime. */
export function nfceEmitidaParaTotem(nota: any, viaEstabelecimentoNaConfig: boolean): NfceEmitidaTotem {
  const r = resumoNfce(nota)!;
  const contingencia = r.status === 'contingencia';
  return {
    ...r,
    // Na contingência a nota ainda não tem protocolo: é a autorização que vem depois.
    protocolo: contingencia ? null : r.protocolo,
    // A 2ª via (do estabelecimento) só existe na contingência, e só se a loja ligou (mig 287).
    viaEstabelecimento: contingencia && viaEstabelecimentoNaConfig === true,
  };
}

export function nfceNaoEmitida(e: ErroNfceTotem): NfceNaoEmitidaTotem {
  return { status: 'nao_emitida', danfe: null, erro: e };
}

// ── A venda desfeita guarda o motivo — e a repetição da liberação devolve o MESMO resultado ──
//
// O motivo vai para `comanda.motivo_cancelamento` e `pedido_externo.motivo_cancelamento`, que a
// loja lê nos relatórios. O formato é fixo para que a repetição reconstrua o `erro` sem coluna
// nova: `repete` sai de novo da etapa e do código (é função só deles).

const ETAPAS: EtapaNfceNaoEmitida[] = ['configuracao', 'rejeitada', 'denegada', 'sem_contingencia', 'interno'];
const PREFIXO_VENDA_DESFEITA = 'NFC-e não emitida';

export function motivoVendaDesfeita(e: ErroNfceTotem): string {
  return `${PREFIXO_VENDA_DESFEITA} (${e.etapa}${e.codigo ? ` ${e.codigo}` : ''}): ${e.motivo}`;
}

export function erroDaVendaDesfeita(texto: string | null | undefined): ErroNfceTotem | null {
  const m = /^NFC-e não emitida \(([a-z_]+)(?: (\d{3,4}))?\): ([\s\S]*)$/.exec(String(texto ?? ''));
  if (!m || !ETAPAS.includes(m[1] as EtapaNfceNaoEmitida)) return null;
  return erro(m[1] as EtapaNfceNaoEmitida, m[2] ?? null, m[3]);
}
