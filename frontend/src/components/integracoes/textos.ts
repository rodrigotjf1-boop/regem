// Textos da autorização pela loja e de "Aplicativos conectados" (trilha C, C1b — mockup
// `mockups/regem-autorizar-liame.html`, aprovado em 01/10/2026). O servidor manda as chaves dos
// escopos; o que a pessoa lê sai daqui. Escopo sem texto próprio cai no rótulo do servidor.

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
};

/** O que a página diz quando a chave do custo está travada (presidente sem "Ver valores em R$"). */
export const CUSTO_SEM_PERMISSAO =
  'Seu perfil não tem “Ver valores em R$”. Para liberar o custo, um presidente com essa permissão autoriza. Sem o custo, o Liame mostra a receita, mas a margem fica desconhecida.';

export const NAO_VAI: { titulo: string; texto: string }[] = [
  { titulo: 'Quem é o cliente', texto: 'Nome, telefone, e-mail e endereço ficam no Regem.' },
  { titulo: 'O resto da operação', texto: 'Equipe, escala, ponto, estoque e caixa não fazem parte.' },
  { titulo: 'A sua conta', texto: 'O Liame não recebe senha nem entra no seu Regem.' },
];

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
  const texto = partes.join(', ');
  const recebe = texto ? texto[0].toUpperCase() + texto.slice(1) : '—';
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
