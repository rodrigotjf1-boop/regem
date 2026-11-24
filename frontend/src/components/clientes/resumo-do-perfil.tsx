'use client';

import { useId } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O RESUMO NO TOPO DA FICHA DO PERFIL (pedido do dono em 24/11/2026: "um resumo de uma frase", a opção 3). A equipe entende
// o cliente sem rolar as camadas. Só junta o que a ficha já recebe do servidor, sem IA e sem custo, no modelo do bloco
// "Em uma frase" da Saúde da base (protótipo `mockups/regem-perfil-cliente.html`). Cada frase só entra quando o dado existe.

const DIA_HABITUAL = ['às segundas', 'às terças', 'às quartas', 'às quintas', 'às sextas', 'aos sábados', 'aos domingos'];
const FAIXA_HABITUAL: Record<string, string> = {
  madrugada: 'de madrugada',
  manha: 'de manhã',
  almoco: 'no almoço',
  tarde: 'à tarde',
  inicio_noite: 'no início da noite',
  noite: 'à noite',
};
const diaMes = (data: string) => new Date(`${data.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const dias = (n: number) => (n === 1 ? '1 dia' : `${n} dias`);

/** As frases do resumo, na ordem: quem é, o que pede, quando pede, o que vem agora e os cuidados. */
export function frasesDoResumo(p: any, segmento?: string | null, alergia?: string | null): string[] {
  const frases: string[] = [];
  const pedidos = Number(p?.pedidos_diretos) || 0;
  const qtd = pedidos === 1 ? '1 pedido direto' : `${pedidos} pedidos diretos`;
  frases.push(segmento ? `${segmento}, com ${qtd}.` : `${qtd.charAt(0).toUpperCase()}${qtd.slice(1)}.`);

  const gosto = p?.camadas?.gosto ?? {};
  if (gosto.de_sempre?.nome) frases.push(`Costuma pedir ${gosto.de_sempre.nome}.`);
  else if (gosto.favoritos?.[0]?.nome) frases.push(`Mais pedido: ${gosto.favoritos[0].nome}.`);

  const intervalo = pedidos >= 2 && p?.intervalo_dias != null ? Math.max(1, Math.round(Number(p.intervalo_dias))) : null;
  const quando = [
    DIA_HABITUAL[Number(p?.dia_habitual) - 1],
    FAIXA_HABITUAL[String(p?.faixa_habitual ?? '')],
    intervalo == null ? undefined : intervalo === 1 ? 'todo dia' : `a cada ${intervalo} dias`,
  ].filter(Boolean);
  if (quando.length) frases.push(`Pede ${quando.join(', ')}.`);

  // Atrasado pelas mesmas etiquetas do servidor (`atraso` = dias sem pedir ÷ intervalo habitual); senão, a previsão.
  const etiquetas: string[] = Array.isArray(p?.etiquetas) ? p.etiquetas : [];
  const atrasado = etiquetas.includes('em_risco') || etiquetas.includes('atrasado');
  const semPedir = intervalo != null && p?.atraso != null ? Math.round(Number(p.atraso) * Number(p.intervalo_dias)) : null;
  if (atrasado && semPedir != null) frases.push(`Está atrasado: já são ${dias(semPedir)} sem pedir.`);
  else if (p?.proximo_previsto) frases.push(`Próximo pedido previsto para ${diaMes(String(p.proximo_previsto))}.`);

  if (etiquetas.includes('reclamou_recente')) frases.push('Reclamou recentemente.');
  if (alergia) frases.push(`Alergia informada pelo cliente: ${alergia}.`);
  if (p?.confianca === 'baixa') frases.push('Pouco histórico: confira antes de usar.');
  return frases;
}

export function ResumoDoPerfil({ perfil, segmento, alergia }: { perfil: any; segmento?: string | null; alergia?: string | null }) {
  const id = useId();
  const frases = frasesDoResumo(perfil, segmento, alergia);
  return (
    <section aria-labelledby={id} className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3" data-resumo-do-perfil>
      <h3 id={id} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Em uma frase
      </h3>
      <p className="mt-1 text-sm leading-relaxed">{frases.join(' ')}</p>
    </section>
  );
}
