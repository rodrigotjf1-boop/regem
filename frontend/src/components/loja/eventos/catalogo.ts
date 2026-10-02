// CATÁLOGO DOS EVENTOS SAZONAIS — só apresentação: nome, cor, textos padrão, partículas e as peças
// de arte de cada evento. QUAL evento está no ar (e o período) quem decide é o servidor
// (`backend/.../cardapio/eventos-cardapio.ts`); aqui não há data nenhuma.
//
// Textos: os padrões servem para qualquer loja e para entrega, retirada e mesa (nada de "chega já
// já" nem do nome de uma loja). O presidente troca título e texto em Delivery → Configurações →
// Eventos; o que ele escreveu vem em `evento.titulo` / `evento.texto`.

export type EventoChave =
  | 'reveillon' | 'carnaval' | 'pascoa' | 'maes' | 'hamburguer' | 'namorados' | 'junina' | 'pais'
  | 'criancas' | 'halloween' | 'blackfriday' | 'natal' | 'jogo';

/** O que o servidor manda em `menu.evento`. */
export interface EventoDoMenu {
  chave: EventoChave;
  /** Período (`AAAA-MM-DD`, dia de Brasília) e o dia do evento em si. */
  inicio: string;
  fim: string;
  dia: string;
  titulo: string | null;
  texto: string | null;
  colecao: string[];
  cores: boolean;
  animacoes: boolean;
  /** Dia de jogo: horário do jogo, quando o tema sai do ar e a chamada da loja. */
  partida: { inicio: string; fim: string; chamada: string | null } | null;
  /** Código do cupom que o mini-jogo libera (Páscoa e Halloween), quando a loja escolheu um. */
  cupomJogo: string | null;
  previa: boolean;
}

export type Particula =
  | 'snow' | 'confete' | 'serp' | 'heart' | 'petal' | 'bat' | 'leaf' | 'pop' | 'balloon' | 'star'
  | 'tag' | 'egg' | 'candy' | 'spark' | 'seed' | 'burger';

export interface DefEvento {
  nome: string;
  /** Cor de ação do evento (botões), e a versão para o tema escuro quando a de cima some no fundo. */
  acc: string;
  accEscuro?: string;
  /** Título e texto padrão da faixa. `comJogo` vale quando a loja escolheu o cupom do mini-jogo. */
  faixa: { t: string; s: string };
  faixaComJogo?: { t: string; s: string };
  /** Nome da coleção de produtos do evento. */
  colecao: string;
  /** Aviso ao pôr um item na sacola. */
  naSacola: (item: string) => string;
  /** Confirmação: chamada curta e frase de apoio (só depois de o pedido estar pago/aceito). */
  ok: [string, string];
  /** Contagem da faixa; `n` = dias até o dia do evento. Sem isto, "Faltam n dias". */
  contagem?: (n: number, ano: number) => string;
  particulas: [Particula, number][];
  estouro: Particula[];
  paleta: string[];
  fogos?: boolean;
  /** Peças de arte (`arte.ts`): acessório da foto e onde ele fica, quem corre na trilha, enfeite do topo. */
  acessorio: string;
  posicao: 'canto' | 'topo' | 'bigode';
  corredor: string;
  topo: 'luzes' | 'bandeirinhas' | 'bandeirolas' | 'coracoes' | 'ovos' | 'flores' | 'estrelas' | 'serpentinas' | 'teia' | 'burgers' | 'gramado' | 'xadrez' | 'fita';
  /** Animação da trilha das etapas. */
  trilha: '' | 'corre' | 'brilho' | 'pula';
  jogo?: 'ovos' | 'abobora';
}

/** "Faltam 5 dias" / "Falta 1 dia". */
const faltam = (n: number) => (n === 1 ? 'Falta 1 dia' : `Faltam ${n} dias`);

export const EVENTOS: Record<EventoChave, DefEvento> = {
  reveillon: {
    nome: 'Réveillon', acc: '#B8860B', accEscuro: '#E7B53C',
    faixa: { t: 'A virada é com a gente', s: 'Monte o pedido da festa e comece o ano de mesa cheia.' },
    colecao: 'Pra virada', naSacola: (n) => `${n} garantido pra virada`, ok: ['Feliz Ano Novo!', 'Seu pedido já entrou na festa.'],
    contagem: (n, ano) => (n > 0 ? `${faltam(n)} para ${ano}` : `Feliz ${ano}!`),
    particulas: [['star', 22]], fogos: true, estouro: ['spark', 'star'], paleta: ['#E7B53C', '#F8E7A6', '#FFFFFF', '#F472B6'],
    acessorio: 'reveillon', posicao: 'canto', corredor: 'foguete', topo: 'estrelas', trilha: 'brilho',
  },
  carnaval: {
    nome: 'Carnaval', acc: '#7C3AED', accEscuro: '#A78BFA',
    faixa: { t: 'O bloco passa aqui', s: 'Peça pra recarregar entre um bloco e outro.' },
    colecao: 'Pra curtir o bloco', naSacola: (n) => `${n} entrou no bloco`, ok: ['Ê, folia!', 'Seu pedido já entrou no bloco.'],
    contagem: (n) => (n > 0 ? `${faltam(n)} pro Carnaval` : 'É Carnaval!'),
    particulas: [['confete', 34], ['serp', 7]], estouro: ['confete'], paleta: ['#7C3AED', '#EC4899', '#10B981', '#FACC15', '#3B82F6', '#F97316'],
    acessorio: 'carnaval', posicao: 'canto', corredor: 'mascara', topo: 'serpentinas', trilha: 'corre',
  },
  pascoa: {
    nome: 'Páscoa', acc: '#7B4A2E', accEscuro: '#C99570',
    faixa: { t: 'Páscoa na mesa', s: 'Escolha os favoritos pra dividir com a família.' },
    faixaComJogo: { t: 'Caça aos ovos', s: 'Ache os 3 ovinhos escondidos no cardápio e ganhe um cupom de desconto.' },
    colecao: 'Para a Páscoa', naSacola: (n) => `${n} foi pra cesta`, ok: ['Pedido na cesta!', 'O coelho já está preparando tudo.'],
    contagem: (n) => (n > 0 ? `${faltam(n)} para a Páscoa` : 'Feliz Páscoa!'),
    particulas: [['petal', 16], ['egg', 6]], estouro: ['egg', 'petal'], paleta: ['#C4B5FD', '#F9A8D4', '#6EE7B7', '#FDE68A', '#93C5FD'],
    acessorio: 'pascoa', posicao: 'topo', corredor: 'coelho', topo: 'ovos', trilha: 'pula', jogo: 'ovos',
  },
  maes: {
    nome: 'Dia das Mães', acc: '#D6455D',
    faixa: { t: 'Pra mãe, o melhor', s: 'É presente? Conte na observação e a gente capricha.' },
    colecao: 'Pra mãe', naSacola: (n) => `${n} na sacola, com carinho`, ok: ['Com carinho!', 'Feito com o mesmo cuidado de mãe.'],
    particulas: [['petal', 20]], estouro: ['petal'], paleta: ['#F27B8C', '#FBA6B5', '#E8505B', '#FFD1DC'],
    acessorio: 'maes', posicao: 'canto', corredor: 'flor', topo: 'flores', trilha: '',
  },
  namorados: {
    nome: 'Dia dos Namorados', acc: '#E11D48',
    faixa: { t: 'Amor à primeira mordida', s: 'Pra dividir a dois. Ou não, a gente não julga.' },
    colecao: 'Pra dividir a dois', naSacola: (n) => `${n} conquistou seu coração`, ok: ['Match perfeito!', 'Seu pedido está sendo preparado com carinho.'],
    particulas: [['heart', 16]], estouro: ['heart'], paleta: ['#E11D48', '#FB7185', '#BE123C', '#FDA4AF'],
    acessorio: 'namorados', posicao: 'canto', corredor: 'coracao', topo: 'coracoes', trilha: '',
  },
  junina: {
    nome: 'Festa Junina', acc: '#C2410C', accEscuro: '#F97316',
    faixa: { t: 'É festa no arraiá', s: 'Anarriê! Escolha os quitutes pra sua quadrilha.' },
    colecao: 'Do arraiá', naSacola: (n) => `Anarriê! ${n} tá na sacola`, ok: ['Anarriê!', 'Seu pedido já tá no arraiá, sô!'],
    particulas: [['pop', 14]], estouro: ['pop'], paleta: ['#FFF7E0'],
    acessorio: 'junina', posicao: 'canto', corredor: 'fogueira', topo: 'bandeirinhas', trilha: '',
  },
  pais: {
    nome: 'Dia dos Pais', acc: '#1E3A5F', accEscuro: '#6FA3DC',
    faixa: { t: 'Paizão merece', s: 'O pedido completo, do jeito que ele gosta.' },
    colecao: 'Pro paizão', naSacola: (n) => `${n} na sacola do paizão`, ok: ['Paizão aprovou!', 'Pedido confirmado, sem enrolação.'],
    particulas: [['confete', 14]], estouro: ['confete'], paleta: ['#1E3A5F', '#D4A373', '#F5EBDD', '#8B5E34'],
    acessorio: 'pais', posicao: 'bigode', corredor: 'gravata', topo: 'xadrez', trilha: '',
  },
  criancas: {
    nome: 'Dia das Crianças', acc: '#2563EB', accEscuro: '#60A5FA',
    faixa: { t: 'Hoje a criançada manda', s: 'Peça o favorito da turma e comemore com a gente.' },
    colecao: 'Pra criançada', naSacola: (n) => `Oba! ${n} na sacola`, ok: ['Oba!', 'Pedido confirmado, criançada!'],
    particulas: [['balloon', 7], ['confete', 14]], estouro: ['confete', 'star'], paleta: ['#EF4444', '#FACC15', '#3B82F6', '#22C55E', '#A855F7', '#F97316'],
    acessorio: 'criancas', posicao: 'canto', corredor: 'aviao', topo: 'bandeirolas', trilha: 'corre',
  },
  halloween: {
    nome: 'Halloween', acc: '#EA580C',
    faixa: { t: 'Gostosuras ou travessuras?', s: 'As gostosuras da casa estão te esperando.' },
    faixaComJogo: { t: 'Gostosuras ou travessuras?', s: 'Toque na abóbora e descubra o que te espera.' },
    colecao: 'Gostosuras', naSacola: (n) => `${n} caiu no caldeirão`, ok: ['Gostosura garantida!', 'Seu pedido já está no caldeirão.'],
    particulas: [['bat', 5], ['leaf', 10]], estouro: ['candy'], paleta: ['#EA580C', '#B45309', '#F59E0B', '#7C2D12'],
    acessorio: 'halloween', posicao: 'canto', corredor: 'fantasma', topo: 'teia', trilha: '', jogo: 'abobora',
  },
  blackfriday: {
    nome: 'Black Friday', acc: '#0A0A0A', accEscuro: '#FACC15',
    faixa: { t: 'Preço Black', s: 'As ofertas da semana estão aqui.' },
    colecao: 'Ofertas Black', naSacola: (n) => `${n} garantido no preço Black`, ok: ['Oferta garantida!', 'Você pegou o preço Black.'],
    particulas: [['tag', 12]], estouro: ['tag', 'star'], paleta: ['#FACC15', '#0A0A0A'],
    acessorio: 'blackfriday', posicao: 'canto', corredor: 'carrinho', topo: 'fita', trilha: 'corre',
  },
  hamburguer: {
    nome: 'Dia do Hambúrguer', acc: '#C1121F', accEscuro: '#F0616C',
    faixa: { t: 'O dia mais gostoso do ano', s: '28/05 é o nosso feriado: monte o seu e comemore com a gente.' },
    colecao: 'Os campeões da casa', naSacola: (n) => `${n} foi pra chapa`, ok: ['Na chapa!', 'Seu pedido já foi pra chapa.'],
    contagem: (n) => (n > 0 ? `${faltam(n)} pro Dia do Hambúrguer` : 'Hoje é Dia do Hambúrguer!'),
    particulas: [['seed', 26], ['burger', 6]], estouro: ['burger', 'seed'], paleta: ['#FFF3D6'],
    acessorio: 'hamburguer', posicao: 'canto', corredor: 'burguer', topo: 'burgers', trilha: 'corre',
  },
  jogo: {
    nome: 'Dia de jogo', acc: '#15803D', accEscuro: '#22C55E',
    faixa: { t: 'Hoje tem jogo na TV', s: 'Monte o pedido da torcida e garanta antes da bola rolar.' },
    colecao: 'Pra torcida', naSacola: (n) => `${n} escalado pro jogo`, ok: ['Golaço!', 'Seu pedido já entrou em campo.'],
    particulas: [['confete', 18]], estouro: ['confete'], paleta: ['#FFFFFF', '#16A34A', '#111827', '#E5E7EB'],
    acessorio: 'jogo', posicao: 'canto', corredor: 'bola', topo: 'gramado', trilha: 'corre',
  },
  natal: {
    nome: 'Natal', acc: '#C8102E', accEscuro: '#F0465F',
    faixa: { t: 'Natal é aqui', s: 'Ceia sem trabalho: a gente prepara e você aproveita.' },
    colecao: 'Ceia de Natal', naSacola: (n) => `${n} foi pro saco do Papai Noel`, ok: ['Ho ho ho!', 'Seu pedido já está no trenó.'],
    contagem: (n) => (n > 0 ? `${faltam(n)} para o Natal` : 'Feliz Natal!'),
    particulas: [['snow', 50]], estouro: ['snow', 'star'], paleta: ['#FFFFFF', '#E7B53C'],
    acessorio: 'natal', posicao: 'canto', corredor: 'treno', topo: 'luzes', trilha: 'corre',
  },
};

// ---------- contagem da faixa ----------

const FORMATO_DIA_SP = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }) : null;
/** O dia de Brasília (`AAAA-MM-DD`): o mesmo que o servidor usou para decidir o evento. */
export const hojeEmBrasilia = (agora: Date): string => (FORMATO_DIA_SP ? FORMATO_DIA_SP.format(agora) : agora.toISOString().slice(0, 10));
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const dois = (v: number) => String(v).padStart(2, '0');
const horaSP = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

/** Dia de jogo: antes, durante e depois da bola rolar. Nunca cita time nem campeonato. */
export function contagemDoJogo(partida: NonNullable<EventoDoMenu['partida']>, agora: Date): string {
  const falta = Date.parse(partida.inicio) - agora.getTime();
  if (falta > 0) {
    const m = Math.ceil(falta / 60_000);
    return `Bola rola às ${horaSP(partida.inicio)} · faltam ${m >= 60 ? `${Math.floor(m / 60)}h${dois(m % 60)}` : `${m} min`}`;
  }
  return -falta < 2 * 3_600_000 ? 'Bola rolando: peça sem sair do sofá' : 'Fim de jogo: pede a saideira';
}

/** O texto do selo de contagem da faixa. */
export function contagemDoEvento(ev: EventoDoMenu, agora: Date): string {
  if (ev.chave === 'jogo') return ev.partida ? contagemDoJogo(ev.partida, agora) : 'Hoje tem jogo';
  const hoje = hojeEmBrasilia(agora);
  if (ev.chave === 'blackfriday') {
    if (hoje < ev.inicio) return `Começa ${ddmm(ev.inicio)}`;
    // Contagem ao vivo até o fim do último dia (23:59:59 de Brasília).
    let s = Math.max(0, Math.floor((Date.parse(`${ev.fim}T23:59:59-03:00`) - agora.getTime()) / 1000));
    const d = Math.floor(s / 86_400);
    s %= 86_400;
    return `Termina em ${d ? `${d}d ` : ''}${dois(Math.floor(s / 3600))}:${dois(Math.floor((s % 3600) / 60))}:${dois(s % 60)}`;
  }
  const n = diasEntre(hoje, ev.dia);
  const def = EVENTOS[ev.chave];
  if (ev.chave === 'junina') return `Arraiá até ${ddmm(ev.fim)}`;
  if (def.contagem) return def.contagem(n, Number(ev.dia.slice(0, 4)));
  return n > 1 ? `Faltam ${n} dias` : n === 1 ? 'É amanhã!' : n === 0 ? 'É hoje!' : `Até ${ddmm(ev.fim)}`;
}

/** Eventos cuja contagem muda a cada segundo (os outros mudam no máximo uma vez por dia). */
export const contagemAoVivo = (chave: EventoChave) => chave === 'blackfriday' || chave === 'jogo';

/**
 * Título e texto da faixa: o que o presidente escreveu ou o padrão do evento. Na Black Friday o
 * padrão cita o maior desconto REAL do cardápio (produto com preço "de/por") e o último dia.
 */
export function textosDaFaixa(ev: EventoDoMenu, maiorDesconto: number): { rotulo: string; titulo: string; texto: string } {
  const def = EVENTOS[ev.chave];
  const base = ev.cupomJogo && def.faixaComJogo ? def.faixaComJogo : def.faixa;
  let texto = base.s;
  if (ev.chave === 'blackfriday') {
    const fimDomingo = new Date(`${ev.fim}T12:00:00Z`).getUTCDay() === 0;
    const ate = fimDomingo ? 'Só até domingo.' : `Só até ${ddmm(ev.fim)}.`;
    texto = maiorDesconto >= 5 ? `Ofertas com até ${maiorDesconto}% off. ${ate}` : `As ofertas da semana estão aqui. ${ate}`;
  }
  return {
    rotulo: ev.chave === 'jogo' && ev.partida?.chamada ? ev.partida.chamada : def.nome,
    titulo: ev.titulo || base.t,
    texto: ev.texto || texto,
  };
}
