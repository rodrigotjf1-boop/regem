import { hora } from '@/lib/atendimento';

// "📷 O QUE A FOTO MOSTRA" no caso (mig 442 — protótipo `mockups/regem-atendente-alergenos-agendado.html`, parte 3, decisão
// F5): a última foto que a IA leu da conversa de WhatsApp, quando o atendente virtual chamou a equipe em até 60 min.
// Vem de `detalhe.foto` (quem grava é o servidor — `atendimento.service.ts › abrirPeloRobo`). O Regem guarda só este texto
// (decisão F1); a foto continua na conversa do WhatsApp da loja.

export type FotoDoCaso = { tipo?: string | null; descricao?: string | null; em?: string | null };

export function FotoDoCaso({ foto }: { foto: FotoDoCaso | null | undefined }) {
  const descricao = String(foto?.descricao ?? '').trim();
  if (!descricao) return null;
  return (
    <section className="rounded-lg border border-border bg-secondary/40 p-3" aria-label="O que a foto mostra">
      <h4 className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 font-display text-sm font-bold">
        <span>
          <span aria-hidden="true">📷 </span>O que a foto mostra
        </span>
        <span className="font-body text-xs font-semibold text-secondary-foreground">texto da IA{foto?.em ? ` · ${hora(foto.em)}` : ''}</span>
      </h4>
      <p className="break-words text-sm">{descricao}</p>
      <p className="mt-1.5 text-xs text-secondary-foreground">
        Leitura automática: pode errar. O Regem guarda só este texto; a foto está na conversa do WhatsApp da loja.
      </p>
    </section>
  );
}
