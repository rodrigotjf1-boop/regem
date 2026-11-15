import { type MotivoSemResposta, ROTULO_DO_TEMA, temaDoQueFalta } from './mister-agente.regras';

// A QUALIDADE DO MISTER (F5 do docs/plano-mister.md; protótipo mockups/regem-dependencias-e-qualidade.html, vista
// "Console › Mister › Qualidade"). Só números: nunca o texto da pergunta ou da resposta (é da loja). As regras puras:
// os períodos aceitos, o texto de cada motivo de não responder e o de cada tema do que falta (F5.2 — o tema que o
// Mister anota antes de dizer "ainda não tenho acesso", de uma lista fechada).

export const PERIODOS_DA_QUALIDADE = [7, 30] as const;
export type PeriodoDaQualidade = (typeof PERIODOS_DA_QUALIDADE)[number];

/** O período pedido (7 ou 30 dias); qualquer outra coisa vira 7. */
export function periodoDaQualidade(v: unknown): PeriodoDaQualidade {
  return Number(v) === 30 ? 30 : 7;
}

/** Por que não respondeu, como o console mostra (os motivos são os de `MotivoSemResposta`). */
export const MOTIVO_NA_QUALIDADE: Record<MotivoSemResposta, string> = {
  sem_chave: 'a empresa não tem chave de IA',
  chave_recusada: 'a chave de IA da empresa foi recusada',
  sem_credito: 'sem crédito na conta de IA',
  teto_atingido: 'a conta de IA chegou ao teto de gasto',
  limite_por_minuto: 'a IA não respondeu (passageiro)',
  indisponivel: 'a IA não respondeu (passageiro)',
  pedido_invalido: 'a IA não respondeu (passageiro)',
  erro: 'a IA não respondeu (passageiro)',
  recusou: 'o assunto não é do Mister',
  nao_fechou: 'não fechou a resposta',
  limite: 'a pessoa chegou ao limite de perguntas',
  demorou: 'passou do tempo',
  interrompida: 'passou do tempo',
  desligado: 'o Mister estava desligado',
  sem_acesso: 'a pessoa não tinha acesso',
  envio: 'a resposta não saiu pelo WhatsApp',
  manutencao: 'em manutenção',
};

export function motivoNaQualidade(m: unknown): string {
  return MOTIVO_NA_QUALIDADE[String(m ?? '') as MotivoSemResposta] ?? 'outro motivo';
}

/** As linhas dos motivos agrupadas pelo texto (vários motivos dizem a mesma coisa), da maior para a menor. */
export function motivosAgrupados(linhas: Array<{ motivo: unknown; n: number }>): Array<{ motivo: string; quantas: number }> {
  const porTexto = new Map<string, number>();
  for (const l of linhas) {
    const t = motivoNaQualidade(l.motivo);
    porTexto.set(t, (porTexto.get(t) ?? 0) + (Number(l.n) || 0));
  }
  return [...porTexto.entries()].map(([motivo, quantas]) => ({ motivo, quantas })).sort((a, b) => b.quantas - a.quantas || a.motivo.localeCompare(b.motivo));
}

/** O que faltou, por tema, como o console mostra — da maior para a menor (tema fora da lista conta como "outro"). */
export function temasAgrupados(linhas: Array<{ tema: unknown; n: number }>): Array<{ tema: string; quantas: number }> {
  const porTexto = new Map<string, number>();
  for (const l of linhas) {
    const t = ROTULO_DO_TEMA[temaDoQueFalta(l.tema)];
    porTexto.set(t, (porTexto.get(t) ?? 0) + (Number(l.n) || 0));
  }
  return [...porTexto.entries()].map(([tema, quantas]) => ({ tema, quantas })).sort((a, b) => b.quantas - a.quantas || a.tema.localeCompare(b.tema));
}

/** O nome da consulta como o console mostra ("resumo_do_dia" → "resumo do dia"). */
export const nomeDaConsultaNaQualidade = (n: unknown): string => String(n ?? '').replace(/_/g, ' ').trim() || 'consulta sem nome';

/** Percentual inteiro (0 quando não há base). */
export const pct = (parte: number, total: number): number => (total > 0 ? Math.round((parte / total) * 100) : 0);

// ───────────────────────────── o que melhorar (o Mentor, parte 1) ─────────────────────────────
// Os números da própria Qualidade, juntos em padrões: a observação, a causa provável e a proposta — como o prompt do dono
// pede ("um padrão pode indicar falta de documentação, bug ou ferramenta inadequada; não resolver tudo reescrevendo
// prompt"). Regras fixas e só leitura: nada muda sozinho.

export type CausaProvavel = 'falta_consulta' | 'erro_na_consulta' | 'instrucao' | 'da_empresa';
export const CAUSA_NA_TELA: Record<CausaProvavel, string> = {
  falta_consulta: 'falta consulta',
  erro_na_consulta: 'erro na consulta',
  instrucao: 'instrução',
  da_empresa: 'da empresa',
};
/** O tema que mais faltou só vira padrão a partir de tantas vezes. */
export const MINIMO_DO_TEMA = 3;
/** A consulta só é julgada com tantos usos no período, e vira padrão se falhar mais que esta fração. */
export const MINIMO_DE_USOS = 10;
export const FALHA_DA_CONSULTA = 0.1;
/** O motivo da empresa (chave, crédito) só vira padrão a partir de tantas perguntas. */
export const MINIMO_DO_MOTIVO = 3;
const OUTRO_TEMA = 'outro assunto';

export interface Padrao {
  causa: CausaProvavel;
  observacao: string;
  porque: string;
  proposta: string;
}

export interface EntradaDoQueMelhorar {
  /** O que faltou, por tema (o texto do console), com quantas empresas. */
  temas: Array<{ tema: string; quantas: number; empresas: number }>;
  /** As consultas do período, com o nome do console. */
  consultas: Array<{ nome: string; vezes: number; falhas: number }>;
  /** A última avaliação que terminou — ou null. */
  avaliacao: { quando: string; acertos: number; total: number; primeiraErrada: { pergunta: string; falha: string } | null } | null;
  /** Os motivos que são da empresa (chave, crédito), com o texto do console. */
  motivosDaEmpresa: Array<{ motivo: string; quantas: number; empresas: number; empresa: string | null }>;
}

const vezes = (n: number) => `${n} ${n === 1 ? 'vez' : 'vezes'}`;
const empresas = (n: number) => `${n} ${n === 1 ? 'empresa' : 'empresas'}`;

/** Os padrões do período, na ordem: o que falta, o que quebra, o que a avaliação pegou e o que é da empresa. */
export function padroesParaMelhorar(e: EntradaDoQueMelhorar): Padrao[] {
  const padroes: Padrao[] = [];
  const tema = [...e.temas].filter((t) => t.tema !== OUTRO_TEMA).sort((a, b) => b.quantas - a.quantas || a.tema.localeCompare(b.tema))[0];
  if (tema && tema.quantas >= MINIMO_DO_TEMA)
    padroes.push({
      causa: 'falta_consulta',
      observacao: `"${tema.tema}" faltou ${vezes(tema.quantas)}, em ${empresas(tema.empresas)} (o que mais faltou)`,
      porque: 'nenhuma consulta do Mister traz esse dado',
      proposta: `Consulta nova de ${tema.tema} · abrir tarefa`,
    });
  for (const c of e.consultas.filter((x) => x.vezes >= MINIMO_DE_USOS && x.falhas / x.vezes > FALHA_DA_CONSULTA).sort((a, b) => b.falhas / b.vezes - a.falhas / a.vezes).slice(0, 3))
    padroes.push({
      causa: 'erro_na_consulta',
      observacao: `"${c.nome}" não leu ${vezes(c.falhas)}, de ${c.vezes} (${pct(c.falhas, c.vezes)}%)`,
      porque: `a mesma consulta falhando mais de ${Math.round(FALHA_DA_CONSULTA * 100)}%`,
      proposta: `Ver o log das ${c.falhas} falhas · abrir tarefa`,
    });
  const a = e.avaliacao;
  if (a && a.total > 0 && a.acertos < a.total)
    padroes.push({
      causa: 'instrucao',
      observacao: `A avaliação de ${a.quando} errou ${a.total - a.acertos} de ${a.total}${a.primeiraErrada ? `: "${a.primeiraErrada.pergunta}" — ${a.primeiraErrada.falha}` : ''}`,
      porque: 'a resposta não bateu com a conferência da pergunta fixa',
      proposta: 'Ver as erradas na avaliação, ajustar a instrução ou a consulta e rodar de novo',
    });
  for (const m of e.motivosDaEmpresa.filter((x) => x.quantas >= MINIMO_DO_MOTIVO).sort((x, y) => y.quantas - x.quantas))
    padroes.push({
      causa: 'da_empresa',
      observacao: `"${m.motivo}" em ${m.quantas} perguntas${m.empresas === 1 && m.empresa ? `, todas da ${m.empresa}` : `, em ${empresas(m.empresas)}`}`,
      porque: 'não é do Mister: é a chave ou a conta de IA da empresa',
      proposta: 'Nada nas instruções · a empresa resolve no menu Mister, em "IA e uso"',
    });
  return padroes;
}
