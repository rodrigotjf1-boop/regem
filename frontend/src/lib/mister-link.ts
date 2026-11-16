// A PÁGINA DO LINK COM PIN DO MISTER (F4.2a, mig 433; protótipo `mockups/regem-mister-pin.html`, aprovado em 16/11/2026).
// O tipo do que o servidor responde e as contas puras da página. O estado vem decidido do servidor (a página nunca decide
// pelo relógio dela se a proposta venceu); o relógio da página só escreve o "faltam N min".

export type EstadoDoLinkDoMister = 'proposta' | 'fazendo' | 'feito' | 'naodeu' | 'recusou' | 'venceu' | 'bloqueado';

export type VistaDoLinkDoMister = {
  estado: EstadoDoLinkDoMister;
  empresa: string;
  titulo: string;
  itens: string[];
  detalhe: string | null;
  valor: number | null;
  botao: string;
  pedidoPor: string;
  valeAte: string;
  valeAteHora: string;
  restam: number;
  resultado: string | null;
  concluidaHora: string | null;
  respondida: { hora: string; nome: string; final: string | null } | null;
  erro: string | null;
};

/** Os estados em que a página ainda espera o servidor (a execução segue sozinha; a página só acompanha). */
export const ESPERANDO: EstadoDoLinkDoMister[] = ['fazendo'];

/** O "faltam N min" do prazo; null quando já passou (o servidor é que diz "venceu" na próxima leitura). */
export function faltam(valeAte: string, agora: number): string | null {
  const ms = new Date(valeAte).getTime() - agora;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const min = Math.ceil(ms / 60_000);
  return min <= 1 ? 'falta menos de 1 min' : `faltam ${min} min`;
}

/** O PIN digitado: só os dígitos, até 6 (o PIN do Regem tem de 4 a 6). */
export const soDigitosDoPin = (v: string) => v.replace(/\D+/g, '').slice(0, 6);
export const pinCompleto = (v: string) => /^\d{4,6}$/.test(v);

/** O resultado gravado começa em minúscula (vai depois de "Não deu:" na conversa); na página, abre a frase. */
export const comMaiuscula = (t: string | null) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');

/** O valor em reais, como na tela. */
export const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** A linha de quem respondeu: "Autorizado às 21:05 por Ana (telefone com final 4821)." */
export function linhaDaResposta(v: VistaDoLinkDoMister): string | null {
  if (!v.respondida) return null;
  const quem = `${v.respondida.nome}${v.respondida.final ? ` (telefone com final ${v.respondida.final})` : ''}`;
  if (v.estado === 'recusou') return `Não autorizado às ${v.respondida.hora} por ${quem}.`;
  return `Autorizado às ${v.respondida.hora} por ${quem}.`;
}
