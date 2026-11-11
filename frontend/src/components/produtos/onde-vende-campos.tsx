'use client';

import { ondeNaoVende, type OndeVende } from '@/lib/cadastro-onde-vende';

// "Onde vende" do produto NOVO (R3 F7; protótipo `mockups/regem-conciliacao-ifood.html`, "E no Cadastros › Cardápio, como
// fica", decisão 1): três caixas — Regem (balcão e cardápio digital juntos), iFood e 99 (cada app só com ele ligado).
// Todas marcadas = todos os catálogos; uma só = vende só ali. Depois de criado, a pausa de cada canal e o "onde vende" dos
// apps mudam em Delivery › Gestão do catálogo. As frases dos apps são as da gaveta de lá (o que o servidor faz).
export function OndeVendeCampos({
  valor,
  aoMudar,
  comIfood,
  com99,
  codigo,
}: {
  valor: OndeVende;
  aoMudar: (o: OndeVende) => void;
  comIfood: boolean;
  com99: boolean;
  codigo: string;
}) {
  const semCodigo = !codigo.trim();
  const fora = ondeNaoVende(valor, comIfood, com99);
  const nenhum = !valor.regem && (!comIfood || !valor.ifood) && (!com99 || !valor.n99);
  const caixa = 'h-4 w-4 flex-none accent-primary';
  return (
    <fieldset className="rounded-xl border border-border bg-card p-4" aria-describedby="onde-vende-ajuda">
      <legend className="px-1 font-display text-sm font-bold">Onde vende</legend>
      <div className="space-y-3">
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" className={caixa} checked={valor.regem} onChange={(e) => aoMudar({ ...valor, regem: e.target.checked })} />
          Regem (balcão e cardápio digital)
        </label>
        {comIfood && (
          <div className="space-y-1">
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" className={caixa} checked={valor.ifood} onChange={(e) => aoMudar({ ...valor, ifood: e.target.checked })} />
              iFood
            </label>
            {valor.ifood && (
              <p className="pl-6 text-[11px] text-muted-foreground">
                {semCodigo
                  ? 'Sem código PDV: não liga ao iFood.'
                  : 'Pôr no iFood um produto que não existe lá: crie-o no Gestor de Pedidos com o mesmo código.'}
              </p>
            )}
          </div>
        )}
        {com99 && (
          <div className="space-y-1">
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" className={caixa} checked={valor.n99} onChange={(e) => aoMudar({ ...valor, n99: e.target.checked })} />
              99
            </label>
            {valor.n99 && (
              <p className="pl-6 text-[11px] text-muted-foreground">
                {semCodigo
                  ? 'Sem código PDV: não liga à 99.'
                  : 'O item que ainda não existe na 99 vai pelo "Exportar catálogo" (Delivery › Painel › ⚙️ › Integrações › 99Food).'}
              </p>
            )}
          </div>
        )}
      </div>
      <p id="onde-vende-ajuda" className="mt-3 text-[11px] text-muted-foreground" aria-live="polite">
        {nenhum
          ? 'Nenhum marcado: o produto fica cadastrado, fora de todos os catálogos.'
          : fora.length
            ? `Não vende ${fora.join(', ')}. Todos marcados = todos os catálogos.`
            : `Todos marcados = todos os catálogos. Só um = vende só ali${comIfood ? ' (ex.: um combo só do iFood)' : ''}.`}
        {' '}Depois de criado, a pausa de cada canal muda em Delivery › Gestão do catálogo.
      </p>
    </fieldset>
  );
}
