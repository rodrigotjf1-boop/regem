'use client';

import { comMaiuscula, listaParaLer } from '@/lib/alergenos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O BLOCO "ALÉRGENOS" na página do produto do cardápio online (mig 454, D2 — protótipo `regem-atendente-alergenos-agendado
// .html`). Só o produto "informado" recebe `alergenos` do servidor (A4): sem ele, nada aparece. A ordem: "contém", depois
// "pode conter", depois glúten e lactose, a nota dos adicionais (A7) e a frase de cautela da loja por último (A9).
export function AlergenosDoProduto({ a, frase }: { a: any; frase?: string | null }) {
  if (!a || typeof a !== 'object') return null;
  const contem: string[] = Array.isArray(a.contem) ? a.contem : [];
  const podeConter: string[] = Array.isArray(a.podeConter) ? a.podeConter : [];
  const gl = a.gluten === 'sim' ? 'Contém glúten' : a.gluten === 'nao' ? 'Não contém glúten' : null;
  const la = a.lactose === 'sim' ? 'contém lactose' : a.lactose === 'nao' ? 'não contém lactose' : null;
  const glLa = [gl, la].filter(Boolean).join(' · ');
  return (
    <section className="p-alerg" aria-label="Alérgenos">
      <h3>Alérgenos</h3>
      {contem.length > 0 && <p><b>Contém:</b> {listaParaLer(contem)}.</p>}
      {podeConter.length > 0 && <p><b>Pode conter:</b> {listaParaLer(podeConter)}.</p>}
      {!contem.length && !podeConter.length && <p>Nenhum alérgeno da lista.</p>}
      {glLa && <p>{comMaiuscula(glLa)}.</p>}
      <p className="p-alerg-n">Vale para o produto como vem. Adicionais podem mudar.</p>
      {frase && <p className="p-alerg-n">{frase}</p>}
    </section>
  );
}
