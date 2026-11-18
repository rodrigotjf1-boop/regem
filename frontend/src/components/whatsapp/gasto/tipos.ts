// O GASTO DO WHATSAPP OFICIAL (G1 do protótipo `mockups/regem-whatsapp-gasto.html`, aprovado em 18/11/2026): o que a
// rota `GET /whatsapp/gasto` devolve e as formas de escrever na tela.

export type Grupo = 'marketing' | 'utilidade' | 'atendimento' | 'autenticacao' | 'outros';
export type TipoDePeriodo = 'mes' | 'passado' | 'tres' | 'outro';

export type ResumoDoGasto =
  | { oficial: false }
  | {
      oficial: true;
      periodo: { tipo: TipoDePeriodo; de: string; ate: string; mesCorrente: boolean };
      leitura: {
        lidoEm: string | null;
        algumaLida: boolean;
        tentouEm: string | null;
        erro: { motivo: string; conta: { papel: string; final: string } | null } | null;
        moeda: string | null;
        minutos: number;
        /** 'tabela': a Meta não mostra o custo da conta (cobrada por meio de um parceiro) — o valor é estimado (mig 448). */
        fonteDoCusto?: 'meta' | 'tabela' | null;
        /** O gasto por modelo que a Meta não deixou ler, com o motivo (mig 451). */
        modelosErro?: { motivo: string; conta: { papel: string; final: string } | null } | null;
      };
      total: { custo: number; mensagens: number; cobradas: number };
      projecao: number | null;
      tipos: { grupo: Grupo; mensagens: number; cobradas: number; gratis: number; custo: number }[];
      dias: { dia: string; custo: number; marketing: number }[];
      franquia: { numero: string; usadas: number; limite: number; papel: string | null; final: string }[];
      numeros: { numero: string; papel: string; final: string }[];
      filtroNumero: string | null;
      meses: { mes: string; custo: number; cobradas: number; mensagens: number }[];
      deOndeVeio: { nome: string; apoio: string; grupo: string; mensagens: number; custo: number }[];
      /** Os alertas de gasto do mês corrente, pelo Mister (G2). Banco sem as tabelas do Mister: null. */
      alertas?: AlertasDoMes | null;
    };

export type AlertasDoMes = {
  mes: string;
  custoDoMes: number;
  gasto: { ligado: boolean; destinos: string[]; valores: { valor: number; passouEm: string | null }[] };
  franquia: { ligado: boolean; destinos: string[]; numeros: { final: string; passouEm: string | null }[] };
};

/** O nome de cada destino dos avisos do Mister (o mesmo do servidor). */
export const DESTINO: Record<string, string> = {
  presidente: 'WhatsApp do presidente',
  gerente: 'WhatsApp do gerente da loja',
  tela: 'Tela do Regem na loja',
  kds: 'KDS da cozinha',
  atendimento: 'Caso no Atendimento',
  dms: 'Suporte da DMS',
};

export type GastoOficial = Extract<ResumoDoGasto, { oficial: true }>;

/** O nome e a explicação de cada tipo de mensagem (o texto do protótipo). */
export const TIPO: Record<Grupo, { nome: string; explica: string }> = {
  marketing: { nome: 'Marketing', explica: 'Campanhas e mensagens automáticas de promoção (cashback vencendo, aniversário).' },
  utilidade: { nome: 'Utilidade', explica: 'Avisos do pedido (confirmado, saiu para entrega) a quem não estava com a conversa aberta.' },
  atendimento: {
    nome: 'Atendimento',
    explica: 'Respostas do robô e da equipe dentro das 24 horas da conversa. As primeiras 1.000 do mês, em cada número, são grátis.',
  },
  autenticacao: { nome: 'Autenticação', explica: 'Códigos de acesso.' },
  outros: { nome: 'Outros', explica: 'Outros tipos que a Meta cobra.' },
};

export const PAPEL: Record<string, string> = { principal: 'Principal', marketing: 'Marketing' };

/** O valor na moeda da conta (a Meta cobra na moeda dela; sem moeda informada, real). */
export function dinheiro(n: unknown, moeda?: string | null): string {
  const v = Number(n) || 0;
  try {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: moeda || 'BRL' });
  } catch {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
}

export const inteiro = (n: unknown) => (Number(n) || 0).toLocaleString('pt-BR');

/** "2026-11-14" → "14/11". */
export const diaCurto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** "2026-10" → "Outubro de 2026". */
export function nomeDoMes(aaaaMm: string): string {
  const [a, m] = aaaaMm.split('-').map(Number);
  const nome = new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });
  return `${nome[0].toUpperCase()}${nome.slice(1)} de ${a}`;
}

/** A hora de um instante no fuso da loja ("21:30"), com o dia quando não é hoje ("17/11 21:30"). */
export function horaDaLeitura(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const fuso = { timeZone: 'America/Sao_Paulo' } as const;
  const hora = d.toLocaleTimeString('pt-BR', { ...fuso, hour: '2-digit', minute: '2-digit' });
  const dia = d.toLocaleDateString('en-CA', fuso);
  const hoje = new Date().toLocaleDateString('en-CA', fuso);
  return dia === hoje ? `hoje, ${hora}` : `${diaCurto(dia)} ${hora}`;
}
