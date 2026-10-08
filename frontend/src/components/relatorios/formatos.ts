import { brl } from '@/components/ui/lista';
import type { Acompanhar } from '@/components/relatorios/leitura';

// Formatos e o contrato comum das abas de "Relatórios de vendas".

/** Valor em R$ que o servidor ANULA para quem não tem "Ver valores em R$": mostra "—". */
export const rs = (v: unknown) => (v == null ? '—' : brl(v));
export const dataHora = (iso: unknown) =>
  iso ? new Date(String(iso)).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
export const plural = (n: number, um: string, varios: string) => `${Number(n || 0).toLocaleString('pt-BR')} ${Number(n) === 1 ? um : varios}`;
/** "2026-10-07" → "07/10". */
export const diaCurto = (iso: unknown) => `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}`;
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
/** "2026-01" → "Jan/26". */
export const mesCurto = (ym: unknown) => {
  const [a, m] = String(ym).split('-').map(Number);
  return m >= 1 && m <= 12 ? `${MESES[m - 1]}/${String(a).slice(2)}` : String(ym);
};

export type PropsDaAba = {
  /** Começo e fim do período, com hora ("2026-10-01 00:00:00"), como o servidor recebe. */
  inicio: string;
  fim: string;
  /** Identifica o período: muda → as leituras refazem. '' = período inválido, não lê. */
  chave: string;
  /** Sobe a cada "Atualizar". */
  versao: number;
  /** O perfil tem "Ver valores em R$". A trava é do servidor, que manda os valores anulados. */
  verFin: boolean;
  acompanhar: Acompanhar;
};
