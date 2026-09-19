import { createHash } from 'node:crypto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Qual release do servidor local oferecer a UMA loja (distribuição ESCALONADA — ERR-051).
//
// Antes o update-check entregava o último publicado a todas as lojas ao mesmo tempo. Agora,
// como o Chrome (1–5% → 100%) e o electron-builder (stagingPercentage):
//   • recolhido → nunca é oferecido;  pausado → ninguém novo recebe;
//   • lojas_piloto recebem antes (independe do percentual);
//   • percentual: a loja entra se o sorteio ESTÁVEL dela (hash empresa+versão) < percentual —
//     subir de 10% para 30% mantém os 10% que já receberam (o sorteio não muda);
//   • quem não se identifica (servidor na 1.29.x, sem token) só vê release em 100%.
// Entre os elegíveis vence a MAIOR versão (não o último publicado): republicar uma versão
// antiga não rebaixa ninguém, e o anti-downgrade do atualizar.ps1 segue valendo.

export type ReleaseLinha = {
  versao: string;
  url: string;
  sha256: string;
  assinatura: string | null;
  assinatura_v2?: string | null;
  expira_em?: string | Date | null;
  notas: string | null;
  percentual?: number | null;
  lojas_piloto?: string[] | null;
  pausado?: boolean | null;
  recolhido?: boolean | null;
  publicado_em?: string | Date | null;
};

export function compararVersao(a: string, b: string): number {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// 0..99, estável para o par empresa+versão.
export function sorteioDaLoja(tenantId: string, versao: string): number {
  const h = createHash('sha256').update(`${tenantId}|${versao}`).digest();
  return h.readUInt32BE(0) % 100;
}

export function elegivel(rel: ReleaseLinha, tenantId: string | null): boolean {
  if (rel.recolhido || rel.pausado) return false;
  const pct = rel.percentual ?? 100;
  if (pct >= 100) return true;
  if (!tenantId) return false;
  if ((rel.lojas_piloto ?? []).includes(tenantId)) return true;
  return sorteioDaLoja(tenantId, rel.versao) < pct;
}

export function escolherRelease(rels: ReleaseLinha[], tenantId: string | null): ReleaseLinha | null {
  let melhor: ReleaseLinha | null = null;
  for (const r of rels) {
    if (!elegivel(r, tenantId)) continue;
    if (!melhor) { melhor = r; continue; }
    const c = compararVersao(r.versao, melhor.versao);
    const maisNovo =
      c > 0 ||
      (c === 0 && new Date(r.publicado_em ?? 0).getTime() > new Date(melhor.publicado_em ?? 0).getTime());
    if (maisNovo) melhor = r;
  }
  return melhor;
}

// A versão que a loja está rodando foi RECOLHIDA? (a tela avisa o gestor)
export function versaoRecolhida(rels: ReleaseLinha[], versao: string | null | undefined): boolean {
  if (!versao) return false;
  return rels.some((r) => r.recolhido && compararVersao(r.versao, versao) === 0);
}
