'use client';

import { useId, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputMoeda } from '@/components/ui/input-moeda';
import { Dialogo } from '@/components/ui/sobreposto';
import { centavos, notasSugeridas, partesIguais, partesPorItem, valorDigitado } from '@/lib/balcao';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export type PagamentoDaVenda = { forma: string; valor: number; formaPagamentoId?: string };
type Modo = 'pessoas' | 'valor' | 'itens';
const MODOS: [Modo, string][] = [['pessoas', 'Por pessoas'], ['valor', 'Por valor'], ['itens', 'Por item']];

// Dividir a conta do balcão de três jeitos: por pessoas (partes iguais), por valor (como era) e por
// item (quem paga o quê). Cada parte tem a sua forma de pagamento. A conta é feita em centavos
// (`lib/balcao`), então a soma das partes é sempre o total — o servidor recebe a lista de pagamentos
// que já recebia. Maquininha integrada (TEF) não entra aqui, como antes: só no pagamento de uma forma.
export function DividirConta({
  total,
  servico,
  itens,
  formas,
  enviando,
  aoReceber,
  aoFechar,
}: {
  total: number;
  servico: number; // quanto do total é taxa de serviço
  itens: { key: string; rotulo: string; valor: number }[];
  formas: any[]; // formas de pagamento ativas (id, nome, tipo)
  enviando: boolean;
  aoReceber: (pagamentos: PagamentoDaVenda[]) => void;
  aoFechar: () => void;
}) {
  const id = useId();
  const [modo, setModo] = useState<Modo>('pessoas');
  const [n, setN] = useState(2); // pessoas (partes iguais)
  const [formaParte, setFormaParte] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<{ formaId: string; valor: string }[]>(() => [
    { formaId: formas[0]?.id ?? '', valor: '' },
    { formaId: formas[1]?.id ?? formas[0]?.id ?? '', valor: '' },
  ]);
  const [np, setNp] = useState(2); // pessoas (por item)
  const [donos, setDonos] = useState<Record<string, number | null>>({});
  const [formaPessoa, setFormaPessoa] = useState<string[]>([]);
  const [recebido, setRecebido] = useState('');

  const forma = (fid: string | undefined) => formas.find((f) => f.id === fid);
  const totalC = centavos(total);

  // Partes de cada modo → [{ quem, valor, formaId }]
  const partes: { quem: string; valor: number; formaId?: string }[] =
    modo === 'pessoas'
      ? partesIguais(total, n).map((valor, i) => ({ quem: `Pessoa ${i + 1}`, valor, formaId: formaParte[i] }))
      : modo === 'valor'
        ? linhas.map((l, i) => ({ quem: `Pagamento ${i + 1}`, valor: valorDigitado(l.valor), formaId: l.formaId }))
        : partesPorItem(itens.map((i) => i.valor), itens.map((i) => donos[i.key] ?? null), np, servico).map((valor, i) => ({ quem: `Pessoa ${i + 1}`, valor, formaId: formaPessoa[i] }));
  const cobradas = partes.filter((p) => p.valor > 0);
  const soma = cobradas.reduce((a, p) => a + centavos(p.valor), 0);
  const emDinheiro = cobradas.filter((p) => forma(p.formaId)?.tipo === 'dinheiro').reduce((a, p) => a + centavos(p.valor), 0) / 100;
  const rec = recebido === '' ? null : valorDigitado(recebido);

  let motivo = '';
  if (soma < totalC) motivo = `Faltam ${brl((totalC - soma) / 100)} para fechar o total`;
  else if (soma > totalC) motivo = `Os pagamentos passam ${brl((soma - totalC) / 100)} do total`;
  else if (cobradas.some((p) => !forma(p.formaId))) motivo = modo === 'valor' ? 'Escolha a forma de cada pagamento' : 'Escolha a forma de cada pessoa';
  else if (emDinheiro > 0 && rec != null && centavos(rec) < centavos(emDinheiro)) motivo = 'O recebido é menor que a parte em dinheiro';

  const receber = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (motivo || enviando) return;
    aoReceber(cobradas.map((p) => ({ forma: forma(p.formaId).nome, valor: p.valor, formaPagamentoId: p.formaId })));
  };

  const campo = 'h-11 min-w-0 rounded-md border border-input bg-card px-2 text-sm';
  const seletor = (valor: string | undefined, onMudar: (fid: string) => void, rotulo: string) => (
    <select aria-label={rotulo} value={valor ?? ''} onChange={(e) => onMudar(e.target.value)} className={`${campo} flex-[1_1_9rem]`}>
      <option value="">Forma de pagamento…</option>
      {formas.map((f) => (
        <option key={f.id} value={f.id}>
          {f.nome}
        </option>
      ))}
    </select>
  );
  const pessoas = (valor: number, mudar: (v: number) => void, max: number) => (
    <div role="group" aria-label="Quantas pessoas" className="flex items-center rounded-md border border-border bg-card">
      <button type="button" onClick={() => mudar(Math.max(2, valor - 1))} disabled={valor <= 2} aria-label="Menos uma pessoa" className="grid h-11 w-11 place-items-center rounded-md hover:bg-secondary disabled:opacity-30">
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="w-8 text-center font-mono text-base font-bold" data-teste="pessoas">{valor}</span>
      <button type="button" onClick={() => mudar(Math.min(max, valor + 1))} disabled={valor >= max} aria-label="Mais uma pessoa" className="grid h-11 w-11 place-items-center rounded-md hover:bg-secondary disabled:opacity-30">
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
  const linhaDaParte = 'flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2';

  return (
    <Dialogo
      titulo="Dividir conta"
      aoFechar={aoFechar}
      largura="lg"
      fecharNoFundo={false}
      voltarPara="busca-balcao"
      rodape={
        <>
          <p role="status" className={`mr-auto self-center text-sm font-semibold ${motivo ? 'text-foreground' : 'text-ok'}`}>
            {motivo || 'As partes fecham o total.'}
          </p>
          <Button type="button" variant="outline" onClick={aoFechar}>
            Voltar ao pedido
          </Button>
          <Button type="submit" form={id} disabled={!!motivo || enviando}>
            {enviando ? 'Finalizando…' : `Receber ${brl(total)}`}
          </Button>
        </>
      }
    >
      <form id={id} onSubmit={receber} className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Total a receber</p>
            <p className="font-mono text-3xl font-bold leading-tight">{brl(total)}</p>
          </div>
          <div role="group" aria-label="Como dividir" className="flex flex-wrap gap-1 rounded-lg border border-border bg-secondary p-1">
            {MODOS.map(([m, rotulo]) => (
              <button
                key={m}
                type="button"
                aria-pressed={modo === m}
                onClick={() => setModo(m)}
                className={`min-h-11 rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${modo === m ? 'border-primary bg-primary/15 text-foreground' : 'border-transparent text-muted-foreground'}`}
              >
                {rotulo}
              </button>
            ))}
          </div>
        </div>

        {modo === 'pessoas' && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold">Quantas pessoas</span>
              {pessoas(n, setN, 10)}
              <span className="text-sm text-muted-foreground">
                {n} × <b className="font-mono text-foreground">{brl(partes[n - 1]?.valor ?? 0)}</b>
                {partes[0]?.valor !== partes[n - 1]?.valor && ' · o centavo que sobra fica com as primeiras'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Mesma forma para todos</span>
              {formas.map((f) => (
                <button key={f.id} type="button" onClick={() => setFormaParte(Array(10).fill(f.id))} className="min-h-10 rounded-full border border-border bg-card px-3 text-sm font-semibold hover:bg-secondary">
                  {f.nome}
                </button>
              ))}
            </div>
          </>
        )}

        {modo === 'itens' && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold">Quantas pessoas</span>
              {pessoas(np, setNp, 6)}
              <span className="text-sm text-muted-foreground">Toque em quem paga cada item. “Todos” divide o item por igual.</span>
            </div>
            <ul className="space-y-1.5">
              {itens.map((it) => {
                const dono = donos[it.key] ?? null;
                const marca = (p: number) => `min-h-10 min-w-10 rounded-md border px-2 text-sm font-semibold ${dono === p ? 'border-primary bg-primary/15 text-foreground' : 'border-transparent text-muted-foreground'}`;
                return (
                  <li key={it.key} className={linhaDaParte}>
                    <span className="min-w-[9rem] flex-1 text-sm font-semibold">{it.rotulo}</span>
                    <b className="font-mono text-sm">{brl(it.valor)}</b>
                    <div role="group" aria-label={`Quem paga ${it.rotulo}`} className="flex flex-wrap gap-1 rounded-lg border border-border bg-secondary p-1">
                      {Array.from({ length: np }, (_, p) => (
                        <button key={p} type="button" aria-pressed={dono === p} onClick={() => setDonos((d) => ({ ...d, [it.key]: p }))} className={marca(p)}>
                          P{p + 1}
                        </button>
                      ))}
                      <button type="button" aria-pressed={dono == null || dono >= np} onClick={() => setDonos((d) => ({ ...d, [it.key]: null }))} className={dono == null || dono >= np ? 'min-h-10 rounded-md border border-primary bg-primary/15 px-2 text-sm font-semibold' : 'min-h-10 rounded-md border border-transparent px-2 text-sm font-semibold text-muted-foreground'}>
                        Todos
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <ul className="space-y-1.5" data-teste="partes">
          {modo === 'valor'
            ? linhas.map((l, i) => (
                <li key={i} className={linhaDaParte}>
                  {seletor(l.formaId, (fid) => setLinhas((s) => s.map((x, j) => (j === i ? { ...x, formaId: fid } : x))), `Forma do pagamento ${i + 1}`)}
                  <InputMoeda ariaLabel={`Valor do pagamento ${i + 1}`} value={l.valor} onChange={(v) => setLinhas((s) => s.map((x, j) => (j === i ? { ...x, valor: v } : x)))} placeholder="0,00" className="w-36" />
                  {linhas.length > 1 && (
                    <button type="button" onClick={() => setLinhas((s) => s.filter((_, j) => j !== i))} aria-label={`Tirar o pagamento ${i + 1}`} className="grid h-11 w-11 place-items-center rounded-md border border-border text-destructive hover:bg-secondary">
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))
            : partes.map((p, i) => (
                <li key={i} className={linhaDaParte}>
                  <span className="w-20 text-sm font-semibold">{p.quem}</span>
                  <b className="w-24 font-mono text-sm">{brl(p.valor)}</b>
                  {p.valor > 0 ? (
                    seletor(p.formaId, (fid) => (modo === 'pessoas' ? setFormaParte : setFormaPessoa)((s) => Object.assign([...s], { [i]: fid })), `Forma de pagamento da pessoa ${i + 1}`)
                  ) : (
                    <span className="text-sm text-muted-foreground">nada a pagar</span>
                  )}
                </li>
              ))}
        </ul>

        {modo === 'valor' && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setLinhas((s) => [...s, { formaId: formas[0]?.id ?? '', valor: totalC > soma ? ((totalC - soma) / 100).toFixed(2) : '' }])}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Pagamento
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setLinhas((s) => {
                  const outros = s.slice(0, -1).reduce((a, l) => a + centavos(valorDigitado(l.valor)), 0);
                  const falta = totalC - outros;
                  return s.map((l, j) => (j === s.length - 1 ? { ...l, valor: falta > 0 ? (falta / 100).toFixed(2) : '' } : l));
                })
              }
            >
              Pôr o que falta no último
            </Button>
          </div>
        )}

        {emDinheiro > 0 && (
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-lg border border-border bg-secondary p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold">Recebido em dinheiro</span>
              <InputMoeda ariaLabel="Valor recebido em dinheiro" value={recebido} onChange={setRecebido} placeholder={brl(emDinheiro).replace('R$', '').trim()} className="w-40" />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {notasSugeridas(emDinheiro).map((nota) => (
                <button key={nota} type="button" onClick={() => setRecebido(nota.toFixed(2))} className="min-h-11 rounded-full border border-border bg-card px-3 font-mono text-sm font-semibold hover:bg-secondary">
                  {brl(nota)}
                </button>
              ))}
            </div>
            <p className="w-full text-sm font-semibold" aria-live="polite" data-teste="troco-divisao">
              {emDinheiro !== total && <>Parte em dinheiro <b className="font-mono">{brl(emDinheiro)}</b> · </>}
              {rec == null ? 'informe o recebido para ver o troco.' : centavos(rec) < centavos(emDinheiro) ? <>faltam <b className="font-mono text-destructive">{brl(emDinheiro - rec)}</b></> : <>troco <b className="font-mono text-ok">{brl(rec - emDinheiro)}</b></>}
            </p>
          </div>
        )}
      </form>
    </Dialogo>
  );
}
