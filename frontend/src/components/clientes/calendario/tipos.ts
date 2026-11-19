// Calendário de eventos (F2 do perfil do cliente): os tipos que a tela recebe do servidor (`calendario-da-loja.service.ts`).

export type ItemDoCalendario = {
  chave: string;
  dia: string;
  grupo: 'feriado' | 'comemorativa' | 'dinheiro' | 'loja';
  tipo: string;
  nome: string;
  detalhe: string;
  origem: 'regra' | 'loja' | 'escala';
  confianca?: 'lei' | 'costume';
  id?: string;
  hora?: string | null;
  repete?: string;
  diaDoCadastro?: string;
  unidadeId?: string | null;
  unidadeNome?: string | null;
  podeEditar?: boolean;
};

export type RespostaDoCalendario = { de: string; ate: string; eventos: ItemDoCalendario[] };

/** Os tipos que a loja cadastra (os mesmos do servidor — `calendario-regra.ts`). */
export const TIPOS_DA_LOJA = [
  { v: 'show', rotulo: 'Show ou festa na cidade' },
  { v: 'promocao', rotulo: 'Promoção da casa' },
  { v: 'feriado_municipal', rotulo: 'Feriado municipal' },
  { v: 'jogo_time', rotulo: 'Jogo do time da região' },
  { v: 'outro', rotulo: 'Outro' },
] as const;

export const REPETE = [
  { v: 'nao', rotulo: 'Não repete' },
  { v: 'semana', rotulo: 'Toda semana' },
  { v: 'ano', rotulo: 'Todo ano' },
] as const;

export const NOME_DO_GRUPO: Record<ItemDoCalendario['grupo'], string> = {
  feriado: 'Feriado',
  comemorativa: 'Data comemorativa',
  dinheiro: 'Dinheiro no bolso',
  loja: 'Da loja',
};

/** "qui., 20/11" — o dia civil, sem fuso (o texto do servidor é o dia de Brasília). */
export function diaCurto(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}

/** Hoje em Brasília e o dia N depois ('AAAA-MM-DD'). Só fora do primeiro desenho da tela (V35). */
export function periodoDe(dias: number): { de: string; ate: string } {
  const de = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const [a, m, d] = de.split('-').map(Number);
  const ate = new Date(Date.UTC(a, m - 1, d + dias - 1)).toISOString().slice(0, 10);
  return { de, ate };
}
