// Delivery › Avaliações (mig 453): o que `GET /delivery/avaliacoes` devolve (`NotaDoPedidoService.listaNaNuvem`).

export type Avaliacao = {
  id: string;
  nota: number;
  pesou: string[];
  comentario: string | null;
  origem: 'pagina' | 'whatsapp' | string;
  em: string;
  pedido: { id: string; numero: string | null; cliente: string | null; itens: string; total: number; minutos: number | null };
  caso: { id: string; status: string | null } | null;
};

export type RespostaAvaliacoes = {
  periodo: 'hoje' | '7' | '30';
  ajustes: { ativa: boolean; casoAte: number; prazoDias: number };
  kpis: { avaliacoes: number; media: number | null; entregues: number; notas: Record<string, number> };
  lista: Avaliacao[];
  mais: boolean;
};

export const NOMES_DA_NOTA = ['', 'Péssimo', 'Ruim', 'Regular', 'Bom', 'Excelente'];
export const PERIODOS_DA_NOTA = [
  { v: 'hoje', rotulo: 'Hoje', frase: 'hoje' },
  { v: '7', rotulo: '7 dias', frase: 'nos últimos 7 dias' },
  { v: '30', rotulo: '30 dias', frase: 'nos últimos 30 dias' },
] as const;

export const porOnde = (o: string) => (o === 'whatsapp' ? 'WhatsApp' : 'Página do pedido');

/** "hoje 20:54", "ontem 21:40" ou "16/11 20:30" — no fuso da operação. Só depois de montar (V35). */
export function quandoFoi(iso: string, agora: Date = new Date()): string {
  const fuso = { timeZone: 'America/Sao_Paulo' } as const;
  const dia = (d: Date) => d.toLocaleDateString('en-CA', fuso);
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('pt-BR', { ...fuso, hour: '2-digit', minute: '2-digit' });
  if (dia(d) === dia(agora)) return `hoje ${hora}`;
  if (dia(d) === dia(new Date(agora.getTime() - 86_400_000))) return `ontem ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { ...fuso, day: '2-digit', month: '2-digit' })} ${hora}`;
}
