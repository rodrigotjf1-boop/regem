import { createHash } from 'node:crypto';
import type { AplicativoAprovado, ListaDeAprovados } from '../../dms/integracao-dms';
import type { AplicativoDoClique } from './autorizacao-clique.regras';
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

/** Os tamanhos que a tela do clique comporta (o hub confere os seus; o Regem confere de novo o que mostra ao dono). */
const TETOS_DO_TEXTO = { nome: 80, para_que_serve: 400, razao_social: 200, motivo: 400 } as const;

/**
 * Letra de outra escrita (cirílico, grego…) no meio de um nome latino imita o nome de outro ("Lіame" com um "і"
 * cirílico): o Regem só mostra nome em letras latinas, números, espaço e sinais comuns.
 */
const SO_LATIM = /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]+$/u;

/** Por que este aplicativo da lista não vale no Regem (nulo = vale). Vai só para o log. */
export function motivoParaNaoValer(a: AplicativoAprovado): string | null {
  const nome = a.nome.trim();
  if (!nome || nome.length > TETOS_DO_TEXTO.nome) return `o nome precisa ter de 1 a ${TETOS_DO_TEXTO.nome} caracteres`;
  if (!SO_LATIM.test(nome)) return 'o nome tem letra de outra escrita (pode imitar outro nome)';
  if (!a.para_que_serve.trim() || a.para_que_serve.length > TETOS_DO_TEXTO.para_que_serve) return 'o "para que serve" está vazio ou longo demais';
  if (!a.empresa.razao_social.trim() || a.empresa.razao_social.length > TETOS_DO_TEXTO.razao_social) return 'a razão social está vazia ou longa demais';
  if (a.permissoes.some((p) => p.motivo.length > TETOS_DO_TEXTO.motivo)) return 'o motivo de uma permissão está longo demais';
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

// ───────────────────────────── a autorização por clique do parceiro (R1b) ─────────────────────────────

/** Como uma permissão aparece para o dono da loja (a tela, o e-mail, Aplicativos conectados). */
export type FraseDaPermissao = { rotulo: string; frase: string; naFrase: string; curta: string; noAssunto?: string };

/**
 * As frases que o aplicativo de PARCEIRO recebe no lugar das do catálogo do clique (`PERMISSAO_NA_TELA`, que é o texto que
 * o presidente do Liame lê e o manifesto publica): os pedidos SEM a origem do anúncio (só do Liame, F4-13) e as três
 * leituras na hora, com os textos do Farol aprovados pelo dono em 10/10/2026. As outras são as do catálogo (já sem nome
 * de aplicativo).
 */
export const FRASES_DO_PARCEIRO: Partial<Record<EscopoIntegracao, FraseDaPermissao>> = {
  'pedidos.ler': {
    rotulo: 'Pedidos',
    frase: 'Pedidos confirmados e cancelados, com itens, canal e cupom usado. Sem o anúncio ou o link de onde o cliente veio.',
    naFrase: 'os pedidos',
    curta: 'os pedidos',
  },
  'catalogo.ler': {
    rotulo: 'Produtos e adicionais',
    frase: 'Os produtos da loja, com categoria, variações, setor de produção, tempo de preparo e os adicionais de cada um. Sem preço.',
    naFrase: 'os produtos e adicionais',
    curta: 'os produtos',
  },
  'fichas.ler': { rotulo: 'Fichas técnicas', frase: 'Os ingredientes de cada ficha, com quantidade e unidade. Sem custo.', naFrase: 'as fichas técnicas', curta: 'as fichas' },
  'producao.ler': {
    rotulo: 'Pedidos em produção',
    frase: 'O que está na fila da cozinha: produto, quantidade, adicionais, observação e horários. Sem o cliente e sem valores.',
    naFrase: 'os pedidos em produção',
    curta: 'a fila da cozinha',
  },
};

/** "O que o aplicativo não pode" do parceiro: só o que o servidor do Regem garante (a janela de leitura entra na tela). */
export const NAO_PODE_DO_PARCEIRO: readonly { rotulo: string; frase: string }[] = [
  { rotulo: 'Mudar pedido, preço ou cardápio', frase: 'Ele só lê: a integração não deixa o aplicativo mudar nada no Regem.' },
  { rotulo: 'Ver quem é o cliente', frase: 'Nome, e-mail e endereço ficam no Regem.' },
  { rotulo: 'Ver de onde o cliente veio', frase: 'O anúncio ou o link que trouxe o cliente fica no Regem.' },
  { rotulo: 'Ver o resto da operação', frase: 'Equipe, escala, ponto, estoque e caixa não fazem parte.' },
  { rotulo: 'Entrar no seu Regem', frase: 'O aplicativo não recebe a sua senha nem a sua sessão.' },
];

/** O mesmo, numa frase, no e-mail aos presidentes. */
export const NAO_PODE_NO_EMAIL_DO_PARCEIRO =
  'Ele só lê: não pode mudar pedido, preço nem cardápio, nem ver nome, e-mail e endereço dos clientes, nem as vendas de antes da autorização.';

/** O que acontece com a opcional desligada, para o parceiro (ele não declara: a frase é a mesma para todas). */
const SEM_ELA_DO_PARCEIRO = 'Desligado: o aplicativo não recebe isto. O resto funciona.';

/**
 * Endereço de volta do parceiro: https, com nome (não `localhost`), sem usuário e senha nem fragmento, até 500
 * caracteres. Mais estreito que o dos produtos da DMS (que aceita `http://localhost` para desenvolvimento).
 */
export function enderecoDeVoltaDoParceiro(u: unknown): u is string {
  if (typeof u !== 'string' || !u || u.length > 500) return false;
  try {
    const url = new URL(u);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && host !== 'localhost' && !host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/** O aplicativo de parceiro na autorização por clique: o que a tela mostra e o que o pedido pode trazer. */
export type ParceiroNoClique = {
  /** O nome, as permissões (necessárias e opcionais, já cortadas pelo teto e pela etapa), os motivos e o "não pode". */
  nome: string;
  inicio: string;
  necessarias: EscopoIntegracao[];
  opcionais: EscopoIntegracao[];
  dadoPessoal: EscopoIntegracao[];
  financeiras: EscopoIntegracao[];
  motivos: Partial<Record<EscopoIntegracao, string>>;
  semElas: Partial<Record<EscopoIntegracao, string>>;
  naoPode: readonly { rotulo: string; frase: string }[];
  naoPodeNoEmail: string;
  /** A empresa conferida pela DMS (a razão social e o CNPJ da lista do hub) e o "para que serve" nas palavras dele. */
  empresa: { razaoSocial: string; cnpj: string };
  paraQueServe: string;
  /** Os endereços de volta que passam na regra do parceiro. */
  enderecos: string[];
  /** As lojas que ele pode ter (somando as empresas): na etapa de teste, até 3; na produção, nulo. */
  lojas: number | null;
};

/**
 * O aplicativo de parceiro aprovado, montado para a autorização por clique (puro). Nulo quando ele não serve: nenhum
 * endereço de volta válido ou nenhuma permissão necessária dentro do teto e da etapa. As opcionais nascem desligadas na
 * tela (F4-14); o telefone (dado pessoal) e o custo (financeiro) só aparecem na produção, que é quando o teto os deixa.
 */
export function parceiroNoClique(a: AplicativoAprovado): ParceiroNoClique | null {
  const enderecos = a.enderecos_de_volta.filter(enderecoDeVoltaDoParceiro);
  if (!enderecos.length) return null;
  const podem = permissoesDoParceiro(a);
  const marca = new Map(a.permissoes.map((p) => [p.nome, p]));
  const necessarias = podem.filter((e) => marca.get(e)?.necessaria === true);
  if (!necessarias.length) return null;
  const opcionais = podem.filter((e) => marca.get(e)?.necessaria === false);
  return {
    nome: a.nome.trim(),
    inicio: new URL(enderecos[0]).origin,
    necessarias,
    opcionais,
    dadoPessoal: podem.filter((e) => e === 'clientes.telefone.ler'),
    financeiras: podem.filter((e) => e === 'custos.ler'),
    motivos: Object.fromEntries(podem.map((e) => [e, (marca.get(e)?.motivo ?? '').trim()])),
    semElas: Object.fromEntries(opcionais.map((e) => [e, SEM_ELA_DO_PARCEIRO])),
    naoPode: NAO_PODE_DO_PARCEIRO,
    naoPodeNoEmail: NAO_PODE_NO_EMAIL_DO_PARCEIRO,
    empresa: { razaoSocial: a.empresa.razao_social.trim(), cnpj: a.empresa.cnpj },
    paraQueServe: a.para_que_serve.trim(),
    enderecos,
    lojas: lojasDoParceiro(a),
  };
}

/** O parceiro no formato do aplicativo do clique (o mesmo tipo do Liame, com a parte `parceiro`). */
export function aplicativoDoClique(p: ParceiroNoClique): AplicativoDoClique {
  return {
    nome: p.nome,
    // A abertura do parceiro tem molde próprio (o "para que serve" entre aspas): `faz` não é usado.
    faz: '',
    inicio: p.inicio,
    necessarias: p.necessarias,
    opcionais: p.opcionais,
    dadoPessoal: p.dadoPessoal,
    financeiras: p.financeiras,
    motivos: p.motivos,
    semElas: p.semElas,
    naoPode: p.naoPode,
    naoPodeNoEmail: p.naoPodeNoEmail,
    parceiro: { empresa: p.empresa, paraQueServe: p.paraQueServe, frases: FRASES_DO_PARCEIRO, lojas: p.lojas },
  };
}

/** "12.ABC.345/01DE-35": o CNPJ (numérico ou alfanumérico, IN RFB 2.229/2024) com a máscara; o que não tem a forma sai como veio. */
export function cnpjDoParceiroComMascara(cnpj: string): string {
  const c = cnpj.trim().toUpperCase();
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c)) return cnpj.trim();
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}
