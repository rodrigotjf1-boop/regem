'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SeletorDeUnidade } from '@/components/ui/seletor-de-unidade';
import { arredondarInformado, chaveUnidade, unidadesDoProduto } from '@/lib/conversao-unidade';
import { avisosDasConversoes, TOM_DO_AVISO } from '@/lib/aviso-conversao';

// CONVERSÕES DO RENDIMENTO DA FICHA TÉCNICA (mig 319) — logo abaixo de "Rendimento" e "Unidade" (pedido do
// dono, 14/10/2026: "a conversão logo após escolher o tipo de unidade de medida, logo ali próximo, porque
// embaixo vêm muitos ingredientes"). Mesma forma das conversões do produto do estoque: "1 saco = 1,5 kg".
// A ficha que usa esta como sub-receita escolhe em qual dessas unidades informa a quantidade.

export type ConversaoDaFicha = { unidadeDe: string; fator: string; unidadePara: string };

const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** As linhas completas (unidades e fator > 0), como vão para o servidor. */
export function conversoesParaSalvar(conversoes: ConversaoDaFicha[]) {
  return conversoes
    .map((c) => ({ unidadeDe: c.unidadeDe, fator: Number(String(c.fator).replace(',', '.')), unidadePara: c.unidadePara }))
    .filter((c) => c.unidadeDe && c.unidadePara && Number.isFinite(c.fator) && c.fator > 0);
}

export function ConversoesDoRendimento({
  unidade,
  rendimento,
  conversoes,
  onChange,
  usadaEm,
}: {
  unidade: string;
  rendimento: number;
  conversoes: ConversaoDaFicha[];
  onChange: (conversoes: ConversaoDaFicha[]) => void;
  /** Em quantas fichas esta entra como sub-receita (as linhas delas são refeitas ao salvar). */
  usadaEm: number;
}) {
  const avisos = avisosDasConversoes(unidade, conversoes);
  // "Rende 10 saco = 15 kg = 15.000 grama": o rendimento em cada unidade que as conversões alcançam.
  const equivalentes =
    rendimento > 0
      ? unidadesDoProduto(unidade, conversoesParaSalvar(conversoes))
          .filter((u) => u.fator !== 1)
          .map((u) => `${num(arredondarInformado(rendimento / u.fator))} ${u.unidade}`)
      : [];
  const mudar = (i: number, patch: Partial<ConversaoDaFicha>) => onChange(conversoes.map((c, n) => (n === i ? { ...c, ...patch } : c)));
  const nova = (): ConversaoDaFicha => ({ unidadeDe: unidade || 'porção', fator: '', unidadePara: chaveUnidade(unidade) === 'kg' ? 'porção' : 'kg' });

  return (
    <div className="space-y-2 rounded-lg border border-border p-2.5" data-bloco="conversoes-rendimento">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">Conversões do rendimento</span>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...conversoes, nova()])}>
          <Plus className="h-4 w-4" /> Conversão
        </Button>
      </div>
      <p className="text-xs text-secondary-foreground">
        Quanto pesa ou em quanto se divide o que a ficha rende. Ex.: 1 <b>saco</b> = 1,5 <b>kg</b>; 1 <b>saco</b> = 10 <b>porção</b>.
        {' '}A ficha que usar esta como sub-receita escolhe em qual dessas unidades informa a quantidade. Quilo e grama, litro e ml
        {' '}o sistema converte sozinho.
      </p>
      {conversoes.map((c, i) => {
        const aviso = avisos[i];
        return (
          <div key={i} className="space-y-1">
            {/* Estreito: "1 saco =" numa linha e "1,5 kg 🗑" na outra; largo: tudo numa linha. */}
            <div className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-1.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto_5rem_minmax(0,1fr)_auto]">
              <span className="text-right sm:text-left">1</span>
              <SeletorDeUnidade ariaLabel={`Conversão ${i + 1}: unidade`} value={c.unidadeDe} onChange={(u) => mudar(i, { unidadeDe: u })} />
              <span className="w-10 text-center sm:w-auto">=</span>
              <Input type="number" min={0} step="any" inputMode="decimal" value={c.fator} placeholder="1,5"
                aria-label={`Conversão ${i + 1}: quanto vale`} onChange={(e) => mudar(i, { fator: e.target.value })} />
              <SeletorDeUnidade ariaLabel={`Conversão ${i + 1}: em que unidade`} value={c.unidadePara} onChange={(u) => mudar(i, { unidadePara: u })} />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remover a conversão ${i + 1}`}
                onClick={() => onChange(conversoes.filter((_, n) => n !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {aviso && (
              <p role={aviso.tom === 'erro' ? 'alert' : 'status'} data-aviso-conversao={aviso.tom} className={`rounded-md px-2.5 py-1.5 text-sm ${TOM_DO_AVISO[aviso.tom]}`}>
                {aviso.texto}
              </p>
            )}
          </div>
        );
      })}
      {equivalentes.length > 0 && (
        <p role="status" className="text-xs" id="ficha-rende-equivale">
          Rende <b>{num(rendimento)} {unidade}</b> = {equivalentes.join(' = ')}.
        </p>
      )}
      {usadaEm > 0 && (
        <p className="text-xs text-secondary-foreground">
          Usada como sub-receita em {usadaEm === 1 ? '1 ficha' : `${usadaEm} fichas`}: ao mudar a unidade ou as conversões, as quantidades
          {' '}de lá são refeitas para continuar valendo o que foi informado.
        </p>
      )}
    </div>
  );
}
