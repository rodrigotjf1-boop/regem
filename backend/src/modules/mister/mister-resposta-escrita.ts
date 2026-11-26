import { paraOWhatsapp } from '../whatsapp/formato-da-resposta';

// A RESPOSTA ESCRITA PELA IA (versão 10, fase C9; aprovada pelo dono em 25/11/2026: "até na saída robótica, o ideal é a IA
// tratar também a saída, dar uma variada de vez em quando" — `docs/plano-mister.md` § "Versão 10", protótipo
// `mockups/regem-mister-v10.html`, "A resposta é da IA"). O Regem continua dizendo O QUE aconteceu (a frase fixa, com os números
// que ele gravou e releu); a IA só diz do jeito dela, no tom da empresa, variando as palavras. A conferência é a da M4c, mais
// apertada: todo número da frase fixa tem de estar no texto escrito (nada some) e nenhum número novo aparece; o caminho do menu
// (com "›") e o que está entre aspas ficam como estão; sem link. Passou do prazo, falhou ou não passou: vai a frase fixa.
// Puro: sem banco, sem IA.

/** O nome no medidor da IA (Mister › IA e uso). */
export const RECURSO_DA_RESPOSTA_ESCRITA = 'mister_resposta_escrita';
/** A pessoa espera a resposta do botão: passou disto, vai a frase fixa (o protótipo: 5 segundos). */
export const PRAZO_DA_RESPOSTA_ESCRITA_MS = 5_000;
export const SAIDA_DA_RESPOSTA_ESCRITA = 800;

export function instrucoesDaRespostaEscrita(jeito: string[]): string {
  return [
    'Você é o Mister, o administrador virtual do Regem, no WhatsApp do dono ou do gerente da loja. O Regem acabou de fazer (ou não conseguiu fazer) o que a pessoa autorizou, e escreveu a mensagem abaixo. Reescreva essa mensagem do seu jeito, como numa conversa, variando as palavras (não comece sempre igual).',
    'REGRAS:',
    '- Mantenha TODOS os números exatamente como estão (valores, quantidades, horas, datas, códigos). Não some, não arredonde, não tire nenhum e não acrescente outro.',
    '- Mantenha exatamente o que está entre aspas e o caminho do menu (as partes com "›").',
    '- Não acrescente fato, promessa, pergunta nova nem conselho. Se a mensagem diz que não deu, deixe claro que não deu e o motivo.',
    '- 1 a 4 frases curtas, sem título e sem saudação; no máximo 1 emoji; sem link. Responda só com o texto.',
    ...(jeito.length ? ['', 'O JEITO DESTA EMPRESA (só o tom; as regras acima continuam valendo):', ...jeito] : []),
  ].join('\n');
}

export type MotivoDaRespostaFixa = 'vazio' | 'longo' | 'link' | 'numero_novo' | 'numero_sumiu' | 'menu' | 'aspas';

/** Cada número como está escrito (sem o sinal), na ordem. */
const numerosDe = (t: string): string[] => String(t).match(/\d+(?:[.,:/]\d+)*/g) ?? [];

/**
 * Confere o texto escrito contra a frase fixa. Passa: o texto no formato do WhatsApp. Não passa: o motivo (e vai a fixa).
 * Os números se comparam como estão escritos ("R$ 1.240,00" tem de continuar "1.240,00"): a IA não reformata número.
 */
export function conferirRespostaEscrita(escrito: unknown, fixo: string): { texto: string } | { motivo: MotivoDaRespostaFixa } {
  const texto = paraOWhatsapp(escrito).trim();
  if (!texto) return { motivo: 'vazio' };
  if (texto.length > Math.max(400, Math.round(fixo.length * 1.6))) return { motivo: 'longo' };
  if (/https?:\/\/|www\./i.test(texto) && !/https?:\/\/|www\./i.test(fixo)) return { motivo: 'link' };
  const doFixo = numerosDe(fixo);
  const doEscrito = numerosDe(texto);
  if (doEscrito.some((n) => !doFixo.includes(n))) return { motivo: 'numero_novo' };
  if (doFixo.some((n) => !doEscrito.includes(n))) return { motivo: 'numero_sumiu' };
  const plano = (t: string) => t.replace(/[*_~]/g, '').replace(/\s+/g, ' ');
  for (const m of fixo.match(/[^\s.,:;()]+(?:\s+›\s+[^\s.,:;()]+)+/g) ?? []) if (!plano(texto).includes(plano(m))) return { motivo: 'menu' };
  for (const m of fixo.match(/"[^"]{2,80}"/g) ?? []) if (!plano(texto).includes(plano(m))) return { motivo: 'aspas' };
  return { texto };
}
