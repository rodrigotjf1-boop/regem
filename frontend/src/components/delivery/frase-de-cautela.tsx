'use client';

import { FRASE_DE_CAUTELA_MAX, FRASE_DE_CAUTELA_PADRAO } from '@/lib/alergenos';

// O GRUPO "ALÉRGENOS" de Delivery › Configurações › Cardápio digital › Cardápio (mig 454, A9): a frase de cautela da loja,
// que aparece embaixo dos alérgenos na página do produto e no fim da primeira resposta do atendente sobre alergia. Vazia =
// a padrão; o servidor recusa gravar vazia (a tela avisa antes).
export function FraseDeCautela({ valor, aoMudar, pode }: { valor: string | null | undefined; aoMudar: (v: string) => void; pode: boolean }) {
  const texto = valor ?? FRASE_DE_CAUTELA_PADRAO;
  const vazia = !texto.trim();
  return (
    <section className="space-y-2 rounded-lg border border-border p-3" aria-labelledby="frase-cautela-titulo">
      <div>
        <h3 id="frase-cautela-titulo" className="text-sm font-bold">Alérgenos</h3>
        <p className="text-xs text-muted-foreground">
          A frase de cautela da loja aparece embaixo dos alérgenos na página do produto e no fim da resposta do atendente virtual
          sobre alergia. Vale para a loja inteira. Os alérgenos de cada produto se conferem em Cadastros › Cardápio › Alérgenos.
        </p>
      </div>
      <label htmlFor="frase-cautela" className="text-sm font-medium">Frase de cautela da loja</label>
      <textarea
        id="frase-cautela"
        value={texto}
        maxLength={FRASE_DE_CAUTELA_MAX}
        disabled={!pode}
        onChange={(e) => aoMudar(e.target.value)}
        rows={3}
        aria-describedby="frase-cautela-conta"
        className="block w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span id="frase-cautela-conta" className="text-muted-foreground">{texto.length}/{FRASE_DE_CAUTELA_MAX}</span>
        {pode && texto !== FRASE_DE_CAUTELA_PADRAO && (
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => aoMudar(FRASE_DE_CAUTELA_PADRAO)}>
            Voltar ao texto padrão
          </button>
        )}
      </div>
      {vazia && (
        <p role="alert" className="text-xs font-semibold text-destructive">
          A frase vazia não é aceita: sem ela, o cliente poderia ler &quot;não contém&quot; como garantia.
        </p>
      )}
    </section>
  );
}
