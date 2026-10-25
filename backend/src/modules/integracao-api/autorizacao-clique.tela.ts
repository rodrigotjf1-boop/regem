import { createHash } from 'crypto';
import type { EscopoIntegracao } from './escopos';
import {
  CUSTO_TRAVADO,
  PERMISSAO_NA_TELA,
  VERSAO_DO_TEXTO,
  VERSAO_DO_TEXTO_PARCEIRO,
  cnpjComMascara,
  ehOutraEmpresa,
  fraseDe,
  naOrdemDoCatalogo,
  noAssuntoDe,
  type AplicativoDoClique,
  type ContaQuePede,
} from './autorizacao-clique.regras';
import { cnpjDoParceiroComMascara } from './parceiros.regras';

/** O custo travado na tela do aplicativo de parceiro: o mesmo aviso, sem o nome do Liame. */
export const CUSTO_TRAVADO_PARCEIRO =
  'Seu perfil não tem “Ver valores em R$”. Para liberar o custo, um presidente com essa permissão autoriza. Sem o custo, ' +
  'o aplicativo não recebe o custo dos itens.';

// A TELA da autorização por clique, montada no servidor (Hub DMS, F3, parte C): os textos aprovados pelo dono em
// 21/10/2026 (C-5, `prototipos/autorizacao-no-regem.html` do hub). O mesmo objeto vira a prova: o texto guardado é esta
// tela com a decisão de quem autorizou. A página só desenha — e a tela nunca leva o que a regra do servidor não cumpre.

export type PermissaoNaTela = {
  id: EscopoIntegracao;
  rotulo: string;
  frase: string;
  /** Por que o aplicativo pede. */
  motivo: string;
  /** Como ela entra numa frase ("Pronto: o Liame passa a receber o telefone do cliente"). */
  naFrase: string;
  /** Opcional: a pessoa liga ou desliga (nasce desligada). Necessária: vem sem chave. */
  opcional: boolean;
  dadoPessoal: boolean;
  /** O que acontece com a opcional desligada (nulo nas necessárias). */
  semEla: string | null;
  /** Falso: a chave fica travada desligada (o custo, sem "Ver valores em R$"). */
  disponivel: boolean;
  /** O texto no lugar da frase, com a chave travada. */
  trava: string | null;
};

export type LojaNaTela = {
  id: string;
  nome: string;
  tipo: 'Matriz' | 'Filial';
  /** Desde quando ela já tem acesso deste aplicativo (ISO), ou nulo. */
  conectadaDesde: string | null;
  /** O que ela já liberou para este aplicativo (continua valendo: autorizar soma). */
  jaLiberado: EscopoIntegracao[];
  /** C-2: com uma loja só, ela já vem marcada; com mais de uma, nenhuma. */
  marcada: boolean;
  nota: string | null;
};

export type TelaDaAutorizacao = {
  versao: number;
  /** "mais": todas as lojas já estão conectadas e o pedido traz permissão nova. */
  modo: 'nova' | 'mais';
  aplicativo: { cliente: string; nome: string; selo: string; empresa: string; cnpj: string | null; detalhes: string; inicio: string };
  titulo: string;
  abertura: string;
  contaQuePede: { nome: string; cnpj: string | null; email: string; marca: string | null; outraEmpresa: boolean };
  empresa: { nome: string; cnpj: string | null };
  ajudaLojas: string | null;
  lojas: LojaNaTela[];
  necessarias: PermissaoNaTela[];
  opcionais: PermissaoNaTela[];
  dadosDosClientes: PermissaoNaTela[];
  /** No modo "mais": as permissões novas (todas liberadas no clique) e o que já foi liberado. */
  novas: PermissaoNaTela[];
  jaLiberado: { desde: string; permissoes: { id: EscopoIntegracao; rotulo: string }[] } | null;
  naoPode: { rotulo: string; frase: string }[];
  confirmacao: { titulo: string; texto: string; rotulo: string } | null;
  nota: string;
  rodape: string;
  botoes: { autorizar: string; cancelar: string };
  /** Só o aplicativo de parceiro (F4, parte F, R1b): a classe do texto, para a prova e a página. */
  classe?: 'parceiro';
  /**
   * Só o parceiro na etapa de teste: até quantas lojas ele pode ler (somando as empresas) e quantas a sua empresa ainda
   * pode marcar (as que ele lê em outras empresas e as autorizações de lá em andamento já contam).
   */
  lojasDoTeste?: { maximo: number; vagas: number } | null;
  /** Só o parceiro: o resumo do texto que o presidente leu; a página o devolve ao autorizar (a lista do hub pode mudar). */
  resumo?: string;
};

export type EntradaDaTela = {
  cliente: string;
  app: AplicativoDoClique;
  dms: { empresa: string; cnpj: string };
  pedido: { redirectUri: string; necessarias: readonly EscopoIntegracao[]; opcionais: readonly EscopoIntegracao[]; contaQuePede: ContaQuePede };
  empresa: { nome: string; cnpj: string | null };
  /** `conectadaDesde`: para o parceiro, o início da janela de leitura da loja (a autorização contínua). */
  lojas: { id: string; nome: string; tipo: string | null; fuso: string; conectadaDesde: Date | null; jaLiberado: readonly string[] }[];
  verFinanceiro: boolean;
  /** Só o parceiro na etapa de teste: as lojas que ele pode ter e as que já usa em OUTRAS empresas (ativas e pendentes). */
  lojasDoTeste?: { maximo: number; emOutras: number } | null;
};

/** "30/09/2026", no fuso da loja. */
export function dataNoFuso(d: Date, fuso: string): string {
  try {
    return d.toLocaleDateString('pt-BR', { timeZone: fuso });
  } catch {
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }
}

/** "o custo dos itens e o telefone do cliente no pedido". */
export function listaNaFrase(itens: readonly string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

const hostDe = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function permissao(app: AplicativoDoClique, id: EscopoIntegracao, o: { opcional: boolean; verFinanceiro: boolean }): PermissaoNaTela {
  const c = fraseDe(app, id);
  const travada = o.opcional && app.financeiras.includes(id) && !o.verFinanceiro;
  return {
    id,
    rotulo: c?.rotulo ?? id,
    frase: c?.frase ?? id,
    motivo: app.motivos[id] ?? '',
    naFrase: app.parceiro ? (c?.noAssunto ?? c?.naFrase ?? id) : noAssuntoDe(id),
    opcional: o.opcional,
    dadoPessoal: app.dadoPessoal.includes(id),
    semEla: o.opcional ? (app.semElas[id] ?? null) : null,
    disponivel: !travada,
    trava: travada && id === 'custos.ler' ? (app.parceiro ? CUSTO_TRAVADO_PARCEIRO : CUSTO_TRAVADO) : null,
  };
}

/** O resumo do que o presidente lê (sem o que muda sozinho, como as vagas): a página devolve, o servidor confere. */
export function resumoDaTela(t: Omit<TelaDaAutorizacao, 'resumo'>): string {
  const lido = {
    aplicativo: t.aplicativo,
    titulo: t.titulo,
    abertura: t.abertura,
    necessarias: t.necessarias,
    opcionais: t.opcionais,
    dadosDosClientes: t.dadosDosClientes,
    novas: t.novas,
    naoPode: t.naoPode,
    confirmacao: t.confirmacao,
    // o que a tela diz que ele já tem (o modo "mais" e cada loja): se o teto de hoje cortar algo, o texto mudou
    jaLiberado: t.jaLiberado,
    lojas: t.lojas.map((l) => [l.id, l.jaLiberado]),
  };
  return createHash('sha256').update(JSON.stringify(lido), 'utf8').digest('base64url');
}

const lojasNoPlural = (n: number) => (n === 1 ? '1 loja' : `${n} lojas`);

/** A tela, para quem pode autorizar (o presidente). */
export function montarTela(e: EntradaDaTela): TelaDaAutorizacao {
  const { app } = e;
  const nome = app.nome;
  const parceiro = app.parceiro ?? null;
  const pedidas = new Set<string>([...e.pedido.necessarias, ...e.pedido.opcionais]);
  const uma = e.lojas.length === 1;
  // As vagas do parceiro na etapa de teste, para LOJA NOVA: o teto menos o que ele já usa em OUTRAS empresas e menos as
  // lojas desta que ele já lê (essas contam no teto; marcadas de novo, são trocadas e não somam).
  const vivasAqui = e.lojas.filter((l) => l.conectadaDesde).length;
  const lojasDoTeste =
    parceiro && e.lojasDoTeste
      ? { maximo: e.lojasDoTeste.maximo, vagas: Math.max(0, e.lojasDoTeste.maximo - e.lojasDoTeste.emOutras - vivasAqui) }
      : null;
  const frase = (id: EscopoIntegracao) => fraseDe(app, id);

  // O modo "mais": todas as lojas já estão conectadas e há permissão pedida que alguma ainda não tem.
  const todasConectadas = e.lojas.length > 0 && e.lojas.every((l) => l.conectadaDesde);
  const novasIds = todasConectadas
    ? naOrdemDoCatalogo([...pedidas].filter((p) => e.lojas.some((l) => !l.jaLiberado.includes(p))))
    : [];
  const modo: TelaDaAutorizacao['modo'] = todasConectadas && novasIds.length ? 'mais' : 'nova';

  const lojas: LojaNaTela[] = e.lojas.map((l) => ({
    id: l.id,
    nome: l.nome,
    tipo: l.tipo === 'matriz' ? 'Matriz' : 'Filial',
    conectadaDesde: l.conectadaDesde ? l.conectadaDesde.toISOString() : null,
    jaLiberado: naOrdemDoCatalogo(l.jaLiberado),
    // C-2: com uma loja só, ela já vem marcada — menos a do parceiro sem vaga (a que ele já lê sempre pode).
    marcada: uma && (!lojasDoTeste || lojasDoTeste.vagas > 0 || Boolean(l.conectadaDesde)),
    nota: l.conectadaDesde
      ? modo === 'mais'
        ? 'O que já foi liberado continua valendo. Autorizar soma o que está em “O que muda”.'
        : 'O que já foi liberado continua valendo.'
      : null,
  }));

  const opcionais = e.pedido.opcionais.filter((o) => !app.dadoPessoal.includes(o));
  const pessoais = e.pedido.opcionais.filter((o) => app.dadoPessoal.includes(o));
  const p = (id: EscopoIntegracao, opcional: boolean) => permissao(app, id, { opcional, verFinanceiro: e.verFinanceiro });
  const ehOpcional = (id: EscopoIntegracao) => e.pedido.opcionais.includes(id);

  let titulo: string;
  let abertura: string;
  let jaLiberado: TelaDaAutorizacao['jaLiberado'] = null;
  let autorizar = 'Autorizar';
  let cancelar = 'Cancelar';
  // A data mais antiga de leitura entre as lojas que já têm o aplicativo (para o parceiro, o início da janela).
  const conectadas = e.lojas.filter((l) => l.conectadaDesde);
  const maisAntiga = conectadas.length
    ? conectadas.reduce((a, l) => ((l.conectadaDesde as Date) < (a.conectadaDesde as Date) ? l : a), conectadas[0])
    : null;
  const desdeMaisAntigo = maisAntiga ? (maisAntiga.conectadaDesde as Date) : null;
  if (modo === 'mais') {
    titulo = novasIds.length === 1 ? `O ${nome} pede mais uma permissão` : `O ${nome} pede mais ${novasIds.length} permissões`;
    const desde = desdeMaisAntigo as Date;
    const fuso = e.lojas[0].fuso;
    const onde = uma ? `a ${e.lojas[0].nome}` : 'as suas lojas';
    const novasNaFrase = listaNaFrase(novasIds.map((id) => frase(id)?.naFrase ?? id));
    abertura = `O ${nome} já lê ${onde} desde ${dataNoFuso(desde, fuso)} e agora pede também ${novasNaFrase}. Se você disser não, ele continua com o que já tinha.`;
    const comuns = naOrdemDoCatalogo(e.lojas.reduce<string[]>((a, l) => a.filter((x) => l.jaLiberado.includes(x)), [...e.lojas[0].jaLiberado]));
    jaLiberado = { desde: desde.toISOString(), permissoes: comuns.map((id) => ({ id, rotulo: frase(id)?.rotulo ?? id })) };
    autorizar = novasIds.length === 1 ? `Liberar ${frase(novasIds[0])?.curta ?? novasIds[0]}` : `Liberar ${novasIds.length} permissões`;
    cancelar = 'Agora não';
  } else if (parceiro) {
    // O "para que serve" é do parceiro (texto livre): vai entre aspas, nas palavras dele, sem a gramática do Regem.
    titulo = `O ${nome} pede acesso ${uma ? 'à sua loja' : 'às suas lojas'}`;
    abertura =
      `O ${nome}, da ${parceiro.empresa.razaoSocial}, pede para ler o que estiver listado aqui. Para que serve, nas palavras ` +
      `dele: “${parceiro.paraQueServe}”. Ele só lê; não muda pedido, preço nem cardápio. ` +
      // o endereço de volta DESTE pedido (o parceiro pode ter mais de um), não o primeiro da lista
      `Você veio de ${hostDe(e.pedido.redirectUri)} e volta para lá ao terminar.`;
  } else {
    titulo = `O ${nome} quer ler as vendas ${uma ? 'da sua loja' : 'das suas lojas'}`;
    abertura =
      `O ${nome} ${app.faz}. Ele só lê o que estiver listado aqui; não muda pedido, preço nem cardápio. ` +
      `Você veio de ${hostDe(app.inicio)} e volta para lá ao terminar.`;
  }

  const outra = ehOutraEmpresa(e.pedido.contaQuePede.cnpj, e.empresa.cnpj);
  const contaCnpj = cnpjComMascara(e.pedido.contaQuePede.cnpj);
  const conta = e.pedido.contaQuePede.nome;
  const cnpjDoApp = parceiro ? cnpjDoParceiroComMascara(parceiro.empresa.cnpj) : cnpjComMascara(e.dms.cnpj);
  // O parceiro: a confirmação SEMPRE (os dados vão para a empresa dele, conferida pela DMS; a conta que pede é só o que
  // o aplicativo informou — o presidente não confirma a conta, confirma a empresa).
  const confirmacao = parceiro
    ? {
        titulo: 'Os dados vão para outra empresa',
        texto:
          `Os dados das lojas marcadas listados aqui vão para a ${parceiro.empresa.razaoSocial} (CNPJ ${cnpjDoApp}), dona do ${nome}, ` +
          `conferida pela DMS. A conta “${conta}” (${contaCnpj ? `CNPJ ${contaCnpj}` : 'sem CNPJ informado'}) foi informada pelo ` +
          `próprio aplicativo. Continue só se você contratou essa empresa.`,
        rotulo: `Contratei a ${parceiro.empresa.razaoSocial} e quero ligar o ${nome} às lojas marcadas`,
      }
    : outra
      ? {
          titulo: 'A conta que pede é de outra empresa',
          texto: `A ${conta} (${contaCnpj ? `CNPJ ${contaCnpj}` : 'sem CNPJ informado'}) vai ver, pelo ${nome}, os dados das lojas marcadas listados aqui. Continue só se você contratou essa empresa.`,
          rotulo: `Contratei a ${conta} e quero ligar a conta dela às lojas marcadas`,
        }
      : null;

  // A janela de leitura do parceiro, no "não pode": a data que vale de verdade (a da autorização contínua, nas lojas que
  // já têm o aplicativo; nas novas, esta autorização).
  const janela = (): { rotulo: string; frase: string } => {
    // a data no fuso da loja que tem essa data (a mais antiga), não da primeira da lista
    const data = maisAntiga ? dataNoFuso(maisAntiga.conectadaDesde as Date, maisAntiga.fuso) : null;
    const todasConectadasJa = conectadas.length === e.lojas.length;
    const fraseDaJanela = !data
      ? 'Ele não lê as vendas de antes desta autorização.'
      : todasConectadasJa
        ? `Ele não lê as vendas de antes de ${data}, quando a autorização dele começou.`
        : `Nas lojas novas, ele não lê as vendas de antes desta autorização; nas que já têm o ${nome}, as de antes de ${data}.`;
    return { rotulo: 'Ver vendas antigas', frase: fraseDaJanela };
  };

  const versao = parceiro ? VERSAO_DO_TEXTO_PARCEIRO : VERSAO_DO_TEXTO;
  const ajudaLojas = uma
    ? lojasDoTeste
      ? `Este aplicativo está em teste na DMS: ele pode ler até ${lojasNoPlural(lojasDoTeste.maximo)} no total, somando as empresas.`
      : null
    : lojasDoTeste
      ? `Marque as lojas que o ${nome} vai ler. Cada uma ganha a própria ligação. Ele está em teste na DMS e pode ler até ` +
        `${lojasNoPlural(lojasDoTeste.maximo)} no total, somando as empresas: aqui, ` +
        `${lojasDoTeste.vagas === 0 ? 'nenhuma loja nova' : `mais ${lojasNoPlural(lojasDoTeste.vagas)}`}` +
        `${vivasAqui ? ' (as que ele já lê podem ser marcadas de novo)' : ''}.`
      : `Marque as lojas que o ${nome} vai ler. Cada uma ganha a própria ligação.`;

  const tela: TelaDaAutorizacao = {
    versao,
    modo,
    aplicativo: {
      cliente: e.cliente,
      nome,
      selo: parceiro ? 'Verificado pela DMS' : 'Produto da DMS',
      empresa: parceiro ? parceiro.empresa.razaoSocial : e.dms.empresa,
      cnpj: cnpjDoApp,
      detalhes: parceiro
        ? `A DMS conferiu a empresa ${parceiro.empresa.razaoSocial}, o CNPJ e o endereço de volta (${hostDe(e.pedido.redirectUri)}). O nome e o logotipo sozinhos não provam quem é: confira a empresa e o CNPJ.`
        : `A DMS conferiu a empresa, o CNPJ e o endereço de volta (${hostDe(e.pedido.redirectUri)}). O nome e o logotipo sozinhos não provam quem é: confira a empresa e o CNPJ.`,
      inicio: app.inicio,
    },
    titulo,
    abertura,
    contaQuePede: { nome: conta, cnpj: contaCnpj, email: e.pedido.contaQuePede.email, marca: e.pedido.contaQuePede.marca, outraEmpresa: outra },
    empresa: { nome: e.empresa.nome, cnpj: cnpjComMascara(e.empresa.cnpj) },
    ajudaLojas,
    lojas,
    necessarias: modo === 'mais' ? [] : e.pedido.necessarias.map((id) => p(id, false)),
    opcionais: modo === 'mais' ? [] : opcionais.map((id) => p(id, true)),
    dadosDosClientes: modo === 'mais' ? [] : pessoais.map((id) => p(id, true)),
    novas: novasIds.map((id) => p(id, ehOpcional(id))),
    jaLiberado,
    naoPode: parceiro ? [...app.naoPode.map((n) => ({ ...n })), janela()] : app.naoPode.map((n) => ({ ...n })),
    confirmacao,
    nota:
      `Cada loja marcada ganha a própria ligação, que vai direto do Regem para o ${nome}: ninguém vê nem copia código ou ` +
      `senha. Vale até você revogar, em Configurações › Aplicativos conectados, ou no próprio ${nome}.`,
    rodape: `Fica registrado: quem autorizou, quando, este texto (versão ${versao}), as lojas e o que foi liberado. Os presidentes da empresa recebem um e-mail.`,
    botoes: { autorizar, cancelar },
  };
  if (!parceiro) return tela;
  const comClasse: TelaDaAutorizacao = { ...tela, classe: 'parceiro', lojasDoTeste };
  return { ...comClasse, resumo: resumoDaTela(comClasse) };
}

/** A prova: a tela que o presidente viu, com a decisão dele. */
export function textoGuardado(
  tela: TelaDaAutorizacao,
  d: { lojas: readonly string[]; ligadas: readonly string[]; confirmouOutraEmpresa: boolean },
) {
  const marcar = (lista: PermissaoNaTela[]) => lista.map((x) => ({ ...x, ligada: d.ligadas.includes(x.id) }));
  return {
    ...tela,
    lojas: tela.lojas.map((l) => ({ ...l, marcada: d.lojas.includes(l.id) })),
    opcionais: marcar(tela.opcionais),
    dadosDosClientes: marcar(tela.dadosDosClientes),
    novas: tela.novas.map((x) => ({ ...x, ligada: !x.opcional || d.ligadas.includes(x.id) })),
    // A confirmação vale pela TELA (o parceiro a tem sempre; o produto da DMS, quando a conta é de outra empresa).
    confirmouOutraEmpresa: tela.confirmacao ? d.confirmouOutraEmpresa : null,
  };
}
