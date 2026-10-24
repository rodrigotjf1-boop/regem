import { createHash } from 'node:crypto';
import type { AplicativoAprovado, ListaDeAprovados } from '../../dms/integracao-dms';
import { CLIENTES_INTEGRACAO, ESCOPOS_DO_PARCEIRO, ESCOPOS_INTEGRACAO, ESCOPOS_SENSIVEIS, type EscopoIntegracao } from './escopos';

// O APLICATIVO DE PARCEIRO no Regem (Hub DMS, F4, parte F): regras puras, sem banco nem rede.
//
// Um parceiro é um aplicativo de outra empresa que a DMS aprovou no portal de parceiros (F4, partes B e C). O hub publica
// a lista dos aprovados (pacote 0.9.0: o nome, a empresa conferida, a etapa, as permissões aprovadas com o motivo e se
// cada uma é necessária); o Regem lê a lista e decide sozinho o que vale, pelo TETO da classe no código
// (`ESCOPOS_DO_PARCEIRO`): a lista do hub só diz o que a DMS aprovou, nunca passa do teto (Padrão §1).
//
// Nasce DESLIGADO (`PARCEIROS_LIGADOS`). E um client_id que a distribuição cadastrou para um produto da DMS
// (`DMS_ID_APLICATIVOS`) é sempre da DMS, mesmo se aparecer na lista do hub: quem decide "é DMS" é o código, antes de
// tudo.

/** O teto de chamadas por minuto de UM aplicativo de parceiro numa empresa (todas as lojas dele nela), além dos 60 por ligação. */
export const LIMITE_PARCEIRO_EMPRESA_POR_MINUTO = 300;

/** Na etapa de teste, as lojas por aplicativo (somando todas as empresas) quando a lista não diz o número (F4-6, F4-12). */
export const LOJAS_NA_ETAPA_DE_TESTE = 3;

/** A frase do 403 da ligação de parceiro parada há 90 dias (Padrão §3): volta com um clique novo da loja. */
export const LIGACAO_SUSPENSA =
  'Esta ligação está suspensa: ficou 90 dias sem uso. A loja precisa autorizar o aplicativo de novo, pela tela de autorização do Regem.';

/** A chave própria do aceite de parceiros (a distribuição liga no EasyPanel). Ausente ou outra coisa = desligado. */
export function lerParceirosLigados(env: Record<string, string | undefined> = process.env): boolean {
  return env.PARCEIROS_LIGADOS === 'true';
}

const PREFIXO_DO_PARCEIRO = 'parceiro_';
const CLIENTE_DE_PARCEIRO = /^parceiro_[0-9a-f]{24}$/;

/**
 * O `cliente` do parceiro no Regem (a coluna das tabelas da integração): `parceiro_` + 24 dígitos hex do SHA-256 do
 * client_id. Não leva o client_id (que é da distribuição e nunca vai para a tela da loja) e não depende da forma do id do
 * DMS ID; 33 caracteres cabem na trava das tabelas (até 40). O prefixo impede a colisão com os nomes da DMS.
 */
export function clienteDoParceiro(clientId: string): string {
  return `${PREFIXO_DO_PARCEIRO}${createHash('sha256').update(clientId, 'utf8').digest('hex').slice(0, 24)}`;
}

export function ehClienteDeParceiro(v: unknown): v is string {
  return typeof v === 'string' && CLIENTE_DE_PARCEIRO.test(v);
}

/**
 * O nome do aplicativo no hub: para o parceiro, o client_id (é por ele que o hub o registra e o PARA — a suspensão
 * automática da F4-7 e a parada de nível `aplicativo`); para o produto da DMS, o `cliente` de sempre (`liame`, `farol`…).
 */
export function aplicativoNoHub(cliente: string, clientId?: string | null): string {
  return ehClienteDeParceiro(cliente) && clientId ? clientId : cliente;
}

/**
 * As permissões que um aplicativo de parceiro aprovado PODE ter no Regem: as do catálogo, dentro do teto da classe, que o
 * hub aprovou. As sensíveis (dado pessoal ou financeiro) só na produção com dado pessoal aprovado (F4-6: na etapa de
 * teste, nunca — mesmo que a lista diga outra coisa). Na ordem do catálogo.
 */
export function permissoesDoParceiro(a: AplicativoAprovado): EscopoIntegracao[] {
  const aprovadas = new Set(a.permissoes.map((p) => p.nome));
  const comSensivel = a.etapa === 'producao' && a.dado_pessoal === true;
  return ESCOPOS_INTEGRACAO.filter(
    (e) => ESCOPOS_DO_PARCEIRO.includes(e) && aprovadas.has(e) && (comSensivel || !ESCOPOS_SENSIVEIS.includes(e)),
  );
}

/** As lojas que o aplicativo pode ter (somando todas as empresas): na etapa de teste, o número da lista ou 3; na produção, sem teto. */
export function lojasDoParceiro(a: AplicativoAprovado): number | null {
  if (a.etapa !== 'teste') return null;
  return a.lojas_max && a.lojas_max > 0 ? Math.min(a.lojas_max, LOJAS_NA_ETAPA_DE_TESTE) : LOJAS_NA_ETAPA_DE_TESTE;
}

/** Nome sem acento, sem espaço e sem sinal, em minúsculas: "Regem Cast" e "regemcast" são o mesmo nome. */
const nomeComparavel = (nome: string) =>
  nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Os nomes dos produtos da DMS: um parceiro não se chama assim (o hub já recusa; o Regem confere de novo). */
const NOMES_DA_DMS = new Set(
  [...Object.values(CLIENTES_INTEGRACAO).map((c) => c.rotulo), 'Regem', 'DMS', 'DMS ID', 'Hub DMS'].map(nomeComparavel),
);

/** Por que este aplicativo da lista não vale no Regem (nulo = vale). Vai só para o log. */
export function motivoParaNaoValer(a: AplicativoAprovado): string | null {
  if (NOMES_DA_DMS.has(nomeComparavel(a.nome))) return 'o nome é o de um produto da DMS';
  const podem = new Set(permissoesDoParceiro(a));
  if (!a.permissoes.some((p) => p.necessaria && podem.has(p.nome as EscopoIntegracao))) {
    return 'nenhuma permissão necessária cabe no teto da classe e na etapa';
  }
  return null;
}

/**
 * Os aplicativos da lista do hub que valem no Regem, pelo client_id. Fica de fora (com o motivo, para o log): o client_id
 * repetido (os dois: não há como saber qual é o certo), o nome de produto da DMS e o aplicativo sem nenhuma permissão
 * necessária dentro do teto e da etapa.
 */
export function parceirosQueValem(lista: ListaDeAprovados): { validos: Map<string, AplicativoAprovado>; fora: { aplicativo: string; motivo: string }[] } {
  const vezes = new Map<string, number>();
  for (const a of lista.itens) vezes.set(a.aplicativo, (vezes.get(a.aplicativo) ?? 0) + 1);
  const validos = new Map<string, AplicativoAprovado>();
  const fora: { aplicativo: string; motivo: string }[] = [];
  for (const a of lista.itens) {
    if ((vezes.get(a.aplicativo) ?? 0) > 1) {
      if (!fora.some((f) => f.aplicativo === a.aplicativo)) fora.push({ aplicativo: a.aplicativo, motivo: 'o client_id aparece mais de uma vez na lista' });
      continue;
    }
    const motivo = motivoParaNaoValer(a);
    if (motivo) fora.push({ aplicativo: a.aplicativo, motivo });
    else validos.set(a.aplicativo, a);
  }
  return { validos, fora };
}
