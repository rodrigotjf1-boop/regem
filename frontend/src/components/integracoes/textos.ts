// Textos da autorização pela loja e de "Aplicativos conectados" (trilha C, C1b — mockup
// `mockups/regem-autorizar-liame.html`, aprovado em 01/10/2026). O servidor manda as chaves dos
// escopos; o que a pessoa lê sai daqui. Escopo sem texto próprio cai no rótulo do servidor.
//
// A página é a mesma para todo aplicativo; o que muda de um para outro está em `TEXTO_APP`. Os
// textos do Farol (o que ele recebe e o que não vai) foram aprovados pelo dono em 10/10/2026. Os do GoGeM
// (14/10/2026, mig 323) descrevem a credencial própria do totem: ele LANÇA as vendas do totem, não as lê.

export const TEXTO_ESCOPO: Record<string, { rotulo: string; texto: string }> = {
  'pedidos.ler': {
    rotulo: 'Pedidos',
    texto: 'Pedidos confirmados e cancelados, com itens, canal, cupom usado e de qual anúncio ou link o cliente veio.',
  },
  'clientes.anonimizacao.ler': {
    rotulo: 'Aviso de cliente anonimizado',
    texto: 'Quando um cliente pede para ser esquecido no Regem, o Liame é avisado para apagar o que tiver dele.',
  },
  'cupons.ler': { rotulo: 'Cupons', texto: 'Os cupons da loja, com regra e validade.' },
  'cupons.uso.ler': { rotulo: 'Usos dos cupons', texto: 'Em qual pedido cada cupom foi usado, quando e com que valor.' },
  'custos.ler': {
    rotulo: 'Custo dos itens',
    texto: 'O custo de cada item, para o Liame calcular a margem. Sem ele, a margem fica desconhecida, nunca zero.',
  },
  'cupons.criar': {
    rotulo: 'Criar cupom de campanha',
    texto: 'O Liame cria e desativa cupons de campanha na loja. Cada cupom passa pela aprovação de alguém da sua empresa antes de existir.',
  },
  // Farol (mig 315) — nenhum dos três leva preço, custo ou cliente.
  'catalogo.ler': {
    rotulo: 'Produtos e adicionais',
    texto: 'Os produtos da loja, com categoria, variações, setor de produção, tempo de preparo e os adicionais de cada um. Sem preço.',
  },
  'fichas.ler': { rotulo: 'Fichas técnicas', texto: 'Os ingredientes de cada ficha, com quantidade e unidade. Sem custo.' },
  'producao.ler': {
    rotulo: 'Pedidos em produção',
    texto: 'O que está na fila da cozinha: produto, quantidade, adicionais, observação e horários. Sem o cliente e sem valores.',
  },
  // GoGeM (mig 323) — o totem de autoatendimento da loja.
  'totem.catalogo.ler': {
    rotulo: 'Cardápio do totem',
    texto: 'Os produtos, preços, categorias e adicionais que o totem mostra ao cliente.',
  },
  'totem.produtos.pausar': {
    rotulo: 'Pausar item no totem',
    texto: 'Pausar e despausar um item só no totem. Os outros canais de venda não mudam.',
  },
  'totem.vendas.lancar': {
    rotulo: 'Lançar as vendas do totem',
    texto: 'As vendas feitas no totem entram no Regem: as pagas, as em dinheiro (pagas no balcão) e as que falharam no pagamento.',
  },
};

/** O que a página diz quando a chave do custo está travada (presidente sem "Ver valores em R$"). */
export const CUSTO_SEM_PERMISSAO =
  'Seu perfil não tem “Ver valores em R$”. Para liberar o custo, um presidente com essa permissão autoriza. Sem o custo, o Liame mostra a receita, mas a margem fica desconhecida.';

export const NAO_VAI: { titulo: string; texto: string }[] = [
  { titulo: 'Quem é o cliente', texto: 'Nome, telefone, e-mail e endereço ficam no Regem.' },
  { titulo: 'O resto da operação', texto: 'Equipe, escala, ponto, estoque e caixa não fazem parte.' },
  { titulo: 'A sua conta', texto: 'O Liame não recebe senha nem entra no seu Regem.' },
];

/** O que muda de um aplicativo para outro nas frases da autorização e de "Aplicativos conectados". */
export type TextoApp = {
  /** O nome do aplicativo, para a tela que ainda não tem a resposta do servidor (o pedido que não vale). */
  nome: string;
  /** O que o aplicativo lê, como a frase diz: "O Liame quer <ler as vendas> da sua loja". */
  le: string;
  /** O que ele faz com o que lê, e o limite: a frase depois de "O <aplicativo> ". */
  faz: string;
  /** Onde, no aplicativo, a pessoa recomeça a conexão. `null` = a tela diz só "comece por lá". */
  ondeConectar: string | null;
  /** O que o aplicativo deixa de ler quando é revogado ("os pedidos"). */
  leitura: string;
  /** A frase do diálogo de revogar, quando revogar faz mais do que parar uma leitura (o GoGeM). */
  aoRevogar?: string;
  naoVai: { titulo: string; texto: string }[];
};

const TEXTO_LIAME: TextoApp = {
  nome: 'Liame',
  le: 'ler as vendas',
  faz: 'mede quais anúncios viraram pedido no caixa. Ele só lê o que estiver marcado aqui; não muda pedido, preço nem cardápio.',
  ondeConectar: 'Contas conectadas → Conectar o Regem',
  leitura: 'os pedidos',
  naoVai: NAO_VAI,
};

export const TEXTO_APP: Record<string, TextoApp> = {
  liame: TEXTO_LIAME,
  farol: {
    nome: 'Farol',
    le: 'ler o cardápio, as fichas e a fila da cozinha',
    faz: 'confere pela câmera se o pedido foi montado como a ficha manda. Ele só lê o que está listado aqui; não muda pedido, preço nem cardápio.',
    ondeConectar: null,
    leitura: 'o cardápio, as fichas e a fila da cozinha',
    naoVai: [
      { titulo: 'Preços e custos', texto: 'Preço de venda, custo, margem e CMV ficam no Regem.' },
      { titulo: 'Quem é o cliente', texto: 'Nome, telefone e endereço não fazem parte.' },
      { titulo: 'O resto da operação', texto: 'Vendas, caixa, estoque, equipe e ponto não fazem parte.' },
      { titulo: 'A sua conta', texto: 'O Farol não recebe senha nem entra no seu Regem.' },
    ],
  },
  gogem: {
    nome: 'GoGeM',
    le: 'receber o cardápio e lançar as vendas do totem',
    faz: 'mostra o cardápio no totem de autoatendimento e lança no Regem as vendas feitas nele. Ele não lê as vendas do balcão, da mesa nem do delivery.',
    ondeConectar: null,
    leitura: 'o cardápio do totem',
    aoRevogar: 'O GoGeM deixa de receber o cardápio e as vendas feitas no totem deixam de chegar ao Regem, a partir de agora. Para voltar, a distribuição Regem emite um token novo.',
    naoVai: [
      { titulo: 'As outras vendas', texto: 'Balcão, mesa, delivery e caixa não fazem parte.' },
      { titulo: 'Quem é o cliente', texto: 'Nome, telefone e endereço dos clientes ficam no Regem.' },
      { titulo: 'O resto da operação', texto: 'Estoque, equipe, escala e ponto não fazem parte.' },
      { titulo: 'A sua conta', texto: 'O GoGeM não recebe senha nem entra no seu Regem.' },
    ],
  },
};

/** Os textos do aplicativo. O que ainda não tem os seus usa os do primeiro que a página teve (o Liame). */
export const textoDoApp = (cliente: string | null | undefined): TextoApp => (cliente && TEXTO_APP[cliente]) || TEXTO_LIAME;

export const NIVEL: Record<string, string> = {
  presidente: 'presidente',
  gerente: 'gerente',
  supervisao: 'supervisão',
  execucao: 'execução',
  suporte: 'suporte técnico',
};

export const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** O que um acesso recebe, em poucas palavras (coluna "Recebe" de Aplicativos conectados). */
export function resumoDoAcesso(escopos: string[], cliente: string): { recebe: string; nota: string | null } {
  const tem = (e: string) => escopos.includes(e);
  const partes: string[] = [];
  if (tem('pedidos.ler')) partes.push('pedidos');
  if (tem('clientes.ler')) partes.push('clientes');
  if (tem('cupons.ler') || tem('cupons.uso.ler')) partes.push('cupons e usos');
  if (tem('custos.ler')) partes.push('custo');
  if (tem('clientes.telefone.ler')) partes.push('telefone do cliente');
  if (tem('vendas.99food.ler')) partes.push('vendas da 99Food');
  if (tem('catalogo.ler')) partes.push('produtos e adicionais');
  if (tem('fichas.ler')) partes.push('fichas técnicas');
  if (tem('producao.ler')) partes.push('pedidos em produção');
  if (tem('totem.catalogo.ler')) partes.push('cardápio do totem');
  if (tem('totem.produtos.pausar')) partes.push('pausa de item no totem');
  const texto = partes.join(', ');
  const recebe = texto ? texto[0].toUpperCase() + texto.slice(1) : '—';
  if (cliente === 'gogem') return { recebe, nota: tem('totem.vendas.lancar') ? 'Lança as vendas do totem' : null };
  if (cliente !== 'liame') return { recebe, nota: null };
  return { recebe, nota: tem('cupons.criar') ? 'Cria cupom, com aprovação' : 'Sem criar cupom' };
}

const dataCurta = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const horaCurta = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

export const dia = (iso: string) => dataCurta.format(new Date(iso));
export const diaEHora = (iso: string) => `${dataCurta.format(new Date(iso))} às ${horaCurta.format(new Date(iso))}`;

/** "há 4 minutos", "há 3 horas", "ontem", ou a data — para o último acesso do aplicativo. */
export function haQuanto(iso: string | null, agora: Date = new Date()): string {
  if (!iso) return 'Ainda não acessou';
  const min = Math.floor((agora.getTime() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${plural(min, 'minuto', 'minutos')}`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `há ${plural(horas, 'hora', 'horas')}`;
  if (horas < 48) return 'ontem';
  return `em ${dia(iso)}`;
}

export type Acesso = {
  id: string;
  ativo: boolean;
  lojaId: string | null;
  lojaNome: string | null;
  escopos: string[];
  autorizadoPor: string;
  via: 'loja' | 'distribuicao';
  criadoEm: string;
  ultimoUsoEm: string | null;
  revogadoEm: string | null;
  revogadoPor: { tipo: 'loja' | 'troca' | 'aplicativo' | 'distribuicao'; nome: string | null } | null;
};

export type Aplicativo = {
  cliente: string;
  rotulo: string;
  descricao: string | null;
  abrangencia: 'loja' | 'empresa';
  ativos: number;
  acessos: Acesso[];
};

/** O recado de "Aplicativos conectados": como incluir outra loja ou religar o aplicativo. */
export function comoMudar(a: Pick<Aplicativo, 'cliente' | 'rotulo' | 'abrangencia'>): string {
  if (a.abrangencia === 'empresa') {
    return 'este acesso é emitido pela distribuição DMS a pedido do presidente. Para ligar de novo depois de revogar, fale com o suporte.';
  }
  // O Farol recebe sempre as mesmas três leituras: só há loja para incluir.
  if (a.cliente === 'farol') return `para incluir outra loja, comece pelo ${a.rotulo}.`;
  return `para incluir outra loja ou mudar o que o ${a.rotulo} recebe, comece pelo ${a.rotulo}, em Contas conectadas.`;
}

/** Quem autorizou e quando; o que veio pelo console aparece como da distribuição. */
export function autorizadoPor(a: Acesso): string {
  return a.via === 'distribuicao' ? `Distribuição DMS, em ${dia(a.criadoEm)}` : `${a.autorizadoPor}, em ${diaEHora(a.criadoEm)}`;
}

/** A coluna "Último acesso" de uma linha revogada: o que aconteceu com ela. */
export function comoSaiu(a: Acesso, rotuloDoApp: string): string {
  const quando = a.revogadoEm ? dia(a.revogadoEm) : '';
  switch (a.revogadoPor?.tipo) {
    case 'troca':
      return `Trocado pela autorização de ${quando}`;
    case 'loja':
      return `Revogado por ${a.revogadoPor.nome ?? 'um presidente'}, em ${quando}`;
    case 'aplicativo':
      return `Desconectado pelo ${rotuloDoApp}, em ${quando}`;
    default:
      return `Revogado pela distribuição DMS, em ${quando}`;
  }
}
