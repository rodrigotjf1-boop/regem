import type { EscopoIntegracao } from './escopos';
import {
  CUSTO_TRAVADO,
  PERMISSAO_NA_TELA,
  VERSAO_DO_TEXTO,
  cnpjComMascara,
  ehOutraEmpresa,
  naOrdemDoCatalogo,
  noAssuntoDe,
  type AplicativoDoClique,
  type ContaQuePede,
} from './autorizacao-clique.regras';

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
};

export type EntradaDaTela = {
  cliente: string;
  app: AplicativoDoClique;
  dms: { empresa: string; cnpj: string };
  pedido: { redirectUri: string; necessarias: readonly EscopoIntegracao[]; opcionais: readonly EscopoIntegracao[]; contaQuePede: ContaQuePede };
  empresa: { nome: string; cnpj: string | null };
  lojas: { id: string; nome: string; tipo: string | null; fuso: string; conectadaDesde: Date | null; jaLiberado: readonly string[] }[];
  verFinanceiro: boolean;
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
  const c = PERMISSAO_NA_TELA[id];
  const travada = o.opcional && app.financeiras.includes(id) && !o.verFinanceiro;
  return {
    id,
    rotulo: c?.rotulo ?? id,
    frase: c?.frase ?? id,
    motivo: app.motivos[id] ?? '',
    naFrase: noAssuntoDe(id),
    opcional: o.opcional,
    dadoPessoal: app.dadoPessoal.includes(id),
    semEla: o.opcional ? (app.semElas[id] ?? null) : null,
    disponivel: !travada,
    trava: travada && id === 'custos.ler' ? CUSTO_TRAVADO : null,
  };
}

/** A tela, para quem pode autorizar (o presidente). */
export function montarTela(e: EntradaDaTela): TelaDaAutorizacao {
  const { app } = e;
  const nome = app.nome;
  const pedidas = new Set<string>([...e.pedido.necessarias, ...e.pedido.opcionais]);
  const uma = e.lojas.length === 1;

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
    marcada: uma,
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
  if (modo === 'mais') {
    titulo = novasIds.length === 1 ? `O ${nome} pede mais uma permissão` : `O ${nome} pede mais ${novasIds.length} permissões`;
    const desde = e.lojas.reduce((a, l) => (l.conectadaDesde && l.conectadaDesde < a ? l.conectadaDesde : a), e.lojas[0].conectadaDesde as Date);
    const fuso = e.lojas[0].fuso;
    const onde = uma ? `a ${e.lojas[0].nome}` : 'as suas lojas';
    const novasNaFrase = listaNaFrase(novasIds.map((id) => PERMISSAO_NA_TELA[id]?.naFrase ?? id));
    abertura = `O ${nome} já lê ${onde} desde ${dataNoFuso(desde, fuso)} e agora pede também ${novasNaFrase}. Se você disser não, ele continua com o que já tinha.`;
    const comuns = naOrdemDoCatalogo(e.lojas.reduce<string[]>((a, l) => a.filter((x) => l.jaLiberado.includes(x)), [...e.lojas[0].jaLiberado]));
    jaLiberado = { desde: desde.toISOString(), permissoes: comuns.map((id) => ({ id, rotulo: PERMISSAO_NA_TELA[id]?.rotulo ?? id })) };
    autorizar = novasIds.length === 1 ? `Liberar ${PERMISSAO_NA_TELA[novasIds[0]]?.curta ?? novasIds[0]}` : `Liberar ${novasIds.length} permissões`;
    cancelar = 'Agora não';
  } else {
    titulo = `O ${nome} quer ler as vendas ${uma ? 'da sua loja' : 'das suas lojas'}`;
    abertura =
      `O ${nome} ${app.faz}. Ele só lê o que estiver listado aqui; não muda pedido, preço nem cardápio. ` +
      `Você veio de ${hostDe(app.inicio)} e volta para lá ao terminar.`;
  }

  const outra = ehOutraEmpresa(e.pedido.contaQuePede.cnpj, e.empresa.cnpj);
  const contaCnpj = cnpjComMascara(e.pedido.contaQuePede.cnpj);
  const conta = e.pedido.contaQuePede.nome;
  const confirmacao = outra
    ? {
        titulo: 'A conta que pede é de outra empresa',
        texto: `A ${conta} (${contaCnpj ? `CNPJ ${contaCnpj}` : 'sem CNPJ informado'}) vai ver, pelo ${nome}, os dados das lojas marcadas listados aqui. Continue só se você contratou essa empresa.`,
        rotulo: `Contratei a ${conta} e quero ligar a conta dela às lojas marcadas`,
      }
    : null;

  return {
    versao: VERSAO_DO_TEXTO,
    modo,
    aplicativo: {
      cliente: e.cliente,
      nome,
      selo: 'Produto da DMS',
      empresa: e.dms.empresa,
      cnpj: cnpjComMascara(e.dms.cnpj),
      detalhes: `A DMS conferiu a empresa, o CNPJ e o endereço de volta (${hostDe(e.pedido.redirectUri)}). O nome e o logotipo sozinhos não provam quem é: confira a empresa e o CNPJ.`,
      inicio: app.inicio,
    },
    titulo,
    abertura,
    contaQuePede: { nome: conta, cnpj: contaCnpj, email: e.pedido.contaQuePede.email, marca: e.pedido.contaQuePede.marca, outraEmpresa: outra },
    empresa: { nome: e.empresa.nome, cnpj: cnpjComMascara(e.empresa.cnpj) },
    ajudaLojas: uma ? null : `Marque as lojas que o ${nome} vai ler. Cada uma ganha a própria ligação.`,
    lojas,
    necessarias: modo === 'mais' ? [] : e.pedido.necessarias.map((id) => p(id, false)),
    opcionais: modo === 'mais' ? [] : opcionais.map((id) => p(id, true)),
    dadosDosClientes: modo === 'mais' ? [] : pessoais.map((id) => p(id, true)),
    novas: novasIds.map((id) => p(id, ehOpcional(id))),
    jaLiberado,
    naoPode: app.naoPode.map((n) => ({ ...n })),
    confirmacao,
    nota:
      `Cada loja marcada ganha a própria ligação, que vai direto do Regem para o ${nome}: ninguém vê nem copia código ou ` +
      `senha. Vale até você revogar, em Configurações › Aplicativos conectados, ou no próprio ${nome}.`,
    rodape: `Fica registrado: quem autorizou, quando, este texto (versão ${VERSAO_DO_TEXTO}), as lojas e o que foi liberado. Os presidentes da empresa recebem um e-mail.`,
    botoes: { autorizar, cancelar },
  };
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
    confirmouOutraEmpresa: tela.contaQuePede.outraEmpresa ? d.confirmouOutraEmpresa : null,
  };
}
