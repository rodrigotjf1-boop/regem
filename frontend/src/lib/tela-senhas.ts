// Tela de senhas (Cozinha em estações, entrega 4) — o que a TV e a gaveta de ajustes usam sem React:
//  · as faixas dos ajustes, iguais às do servidor (`backend/src/modules/tela-senhas/tela-senhas.regras.ts`) — o
//    `npm run check:tela-senhas` compara os dois arquivos;
//  · as cores da TV (sempre fundo branco, com a logo e o nome da loja);
//  · o relógio pelo servidor, a senha que acabou de ficar pronta e a credencial da TV.

/** Minutos da senha em Pronto, na ordem do seletor. 0 = "até o balcão entregar". */
export const TEMPOS_PRONTO_MIN = [2, 5, 10, 15, 20, 30, 0] as const;
export const TEMPO_PRONTO_PADRAO = 10;
export const SOM_PADRAO = true;

/** Tamanho das letras, em %: de 60 a 160, de 10 em 10. */
export const TAMANHO_MIN = 60;
export const TAMANHO_MAX = 160;
export const TAMANHO_PASSO = 10;
export const TAMANHO_PADRAO = 100;
export const CAMPOS_TAMANHO = ['pronto', 'preparando', 'titulos'] as const;
export type CampoTamanho = (typeof CAMPOS_TAMANHO)[number];
export type Tamanhos = Record<CampoTamanho, number>;
export const TAMANHOS_PADRAO: Tamanhos = { pronto: TAMANHO_PADRAO, preparando: TAMANHO_PADRAO, titulos: TAMANHO_PADRAO };

/** Como cada faixa de tamanho aparece na gaveta. */
export const ROTULO_TAMANHO: Record<CampoTamanho, string> = {
  pronto: 'Senhas em Pronto',
  preparando: 'Senhas em Preparando',
  titulos: 'Nome da loja e títulos',
};

export const rotuloTempo = (m: number) => (m === 0 ? 'Até o balcão entregar' : `${m} minutos`);

/**
 * As cores da TV: sempre fundo branco (decisão do dono, 21/10). O verde de Pronto é escuro o bastante para o texto
 * branco da senha que acabou de ficar pronta, e o cinza de Preparando se lê sobre o chip (medidos no check:tela-senhas).
 */
export const TEMA_TV = {
  fundo: '#FFFFFF',
  tinta: '#0F2230',
  fraco: '#5B6B79',
  linha: '#E1E6EC',
  chip: '#F1F4F7',
  ok: '#0B7A3E',
  okSuave: '#E3F4EA',
  sobreOk: '#FFFFFF',
  marca: '#0F2230', // fundo das iniciais quando a loja não tem logo
  erro: '#B4231C', // a mensagem de erro do pareamento (o mesmo vermelho do KDS claro)
  acao: '#E2A340', // o botão "Parear esta TV" (dourado do Regem)
  sobreAcao: '#0F2230',
} as const;

export interface SenhaTv {
  id: string;
  senha: number;
  prefixo: string | null;
}
export interface SenhaProntaTv extends SenhaTv {
  prontoEm: string;
  saiEm: string | null;
}
export interface QuadroTv {
  agora: string;
  tela: { id: string; nome: string };
  loja: { nome: string; logoRef: string | null; logoEmoji: string | null };
  ajustes: { tamanhos: Tamanhos; prontoMin: number; som: boolean };
  preparando: SenhaTv[];
  pronto: SenhaProntaTv[];
}

/** A diferença entre o relógio do servidor e o da TV, em ms: a TV tira a senha na hora certa mesmo com o relógio dela errado. */
export function desvioDoRelogio(agoraDoServidor: string, recebidoEm: number): number {
  const s = new Date(agoraDoServidor).getTime();
  return Number.isFinite(s) ? s - recebidoEm : 0;
}

/** A senha pronta ainda fica na tela? (`saiEm` null = até o balcão entregar.) */
export function aindaNaTela(s: SenhaProntaTv, agoraLocal: number, desvio: number): boolean {
  if (!s.saiEm) return true;
  const sai = new Date(s.saiEm).getTime();
  return !Number.isFinite(sai) || agoraLocal + desvio < sai;
}

/**
 * As senhas de Pronto que não estavam na leitura anterior — as que "chamam" (destaque e aviso sonoro). Na primeira
 * leitura nenhuma chama: a TV que acabou de ligar não apita pelas senhas que já estavam prontas.
 */
export function novasProntas(antes: readonly SenhaProntaTv[] | null, agora: readonly SenhaProntaTv[]): string[] {
  if (antes == null) return [];
  const ja = new Set(antes.map((s) => s.id));
  return agora.filter((s) => !ja.has(s.id)).map((s) => s.id);
}

/** Tamanhos vindos do servidor (ou de nada), com o padrão no que falta — a TV nunca desenha com um tamanho fora da faixa. */
export function tamanhosValidos(v: unknown): Tamanhos {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const t = { ...TAMANHOS_PADRAO };
  for (const c of CAMPOS_TAMANHO) {
    const n = o[c];
    if (typeof n === 'number' && Number.isInteger(n) && n >= TAMANHO_MIN && n <= TAMANHO_MAX && n % TAMANHO_PASSO === 0) t[c] = n;
  }
  return t;
}

/** As iniciais da loja, para o círculo quando ela não tem logo (ou a imagem não carrega). */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const letras = partes.length >= 2 ? partes[0][0] + partes[partes.length - 1][0] : (partes[0] ?? '').slice(0, 2);
  return letras.toUpperCase() || 'R';
}

// ── A credencial da TV (o pareamento): o id e o segredo que ela recebeu ao trocar o código. Fica no aparelho, como o
// segredo do PDV — é a identidade da TV, não dado de negócio. Leitura com try/catch: navegador sem armazenamento segue
// pedindo o código. ──
const CHAVE = 'regem_tela_senhas';
export interface CredencialTv {
  id: string;
  segredo: string;
  nome?: string;
}
export function lerCredencial(): CredencialTv | null {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? 'null');
    return v && typeof v.id === 'string' && typeof v.segredo === 'string' ? v : null;
  } catch {
    return null;
  }
}
export function guardarCredencial(c: CredencialTv) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(c));
  } catch {
    /* sem armazenamento: a TV pede o código de novo ao recarregar */
  }
}
export function esquecerCredencial() {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    /* nada a apagar */
  }
}
