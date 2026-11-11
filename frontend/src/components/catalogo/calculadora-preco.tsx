'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Gaveta } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';
import {
  JEITOS, PROMO_PADRAO, brl, calcular, numeroDigitado, numerosEfetivos, pct, type CanalCalc, type JeitoDeEntregar, type Promo, type RespostaDasTaxas, type Taxas,
} from '@/lib/calculadora-preco';

// A CALCULADORA DE PREÇO (R3 F5; protótipo `mockups/regem-conciliacao-ifood.html`, "A calculadora de preço", decisão 9): parte do
// custo real da ficha (com a perda) + a embalagem; mostra os dois jeitos de entregar do app com o plano da loja marcado, o
// preço recomendado e o mínimo, o que o preço de hoje deixa (você recebe, lucro, margem) e a promoção. Os campos daqui são
// simulação (não mudam as taxas da loja — isso é em "％ Taxas e margem"). É sugestão: nada muda sem o "Usar este preço".

const NOME: Record<CanalCalc, { nome: string; no: string; do: string }> = {
  ifood: { nome: 'iFood', no: 'no iFood', do: 'do iFood' },
  '99food': { nome: '99', no: 'na 99', do: 'da 99' },
};
const dec = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

export type ItemDaCalculadora = { id: string; nome: string; custo: number; emb: number; precoHoje: number | null; semEntrega?: boolean; fonteDoCusto?: string | null };

function Linha({ rotulo, valor, total = false }: { rotulo: React.ReactNode; valor: React.ReactNode; total?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${total ? 'border-t border-border pt-1 font-semibold' : ''}`}>
      <span className="min-w-0">{rotulo}</span>
      <span className="shrink-0 font-mono">{valor}</span>
    </div>
  );
}

export function CalculadoraPreco({
  item,
  canal,
  dados,
  podeUsar,
  aoFechar,
  aoUsar,
  aoAbrirTaxas,
}: {
  item: ItemDaCalculadora;
  canal: CanalCalc;
  dados: RespostaDasTaxas;
  podeUsar: boolean;
  aoFechar: () => void;
  aoUsar: (valor: number) => Promise<void>;
  aoAbrirTaxas: () => void;
}) {
  const t0 = dados.taxas;
  const [margem, setMargem] = useState(dec(t0.geral.margem));
  const [antecipa, setAntecipa] = useState(t0.geral.antecipa);
  const [antec, setAntec] = useState(dec(t0.geral.antec));
  const [itens, setItens] = useState(dec(numerosEfetivos(t0, dados.vendas, canal).itensPedido));
  const [arred, setArred] = useState(t0.geral.arred);
  const [base, setBase] = useState(t0[canal].baseComissao);
  const [taxaFixa, setTaxaFixa] = useState(dec(t0[canal].app.taxaFixa));
  const [promo, setPromo] = useState<Promo>(PROMO_PADRAO);
  const [descTxt, setDescTxt] = useState({ desconto: '30', descontoRs: '10', lojaBanca: '100', appFixo: '5' });
  const [usando, setUsando] = useState<number | null>(null);
  const n = NOME[canal];

  // As taxas da loja com o que se mudou aqui (só a simulação).
  const t: Taxas = useMemo(() => {
    const x: Taxas = JSON.parse(JSON.stringify(t0));
    const num = (v: string, d: number) => numeroDigitado(v) ?? d;
    x.geral.margem = Math.min(90, Math.max(0, num(margem, t0.geral.margem)));
    x.geral.antecipa = antecipa;
    x.geral.antec = num(antec, t0.geral.antec);
    x.geral.itensPedido = Math.min(50, Math.max(1, num(itens, 2)));
    x.geral.arred = arred;
    x[canal].baseComissao = base;
    x[canal].app.taxaFixa = Math.max(0, num(taxaFixa, t0[canal].app.taxaFixa));
    return x;
  }, [t0, margem, antecipa, antec, itens, arred, base, taxaFixa, canal]);
  const promoEf: Promo = useMemo(() => {
    const num = (v: string, d: number) => numeroDigitado(v) ?? d;
    return { ...promo, desconto: num(descTxt.desconto, 0), descontoRs: num(descTxt.descontoRs, 0), lojaBanca: Math.min(100, Math.max(0, num(descTxt.lojaBanca, 100))), appFixo: num(descTxt.appFixo, 0) };
  }, [promo, descTxt]);
  const ef = numerosEfetivos(t, dados.vendas, canal);

  async function usar(valor: number) {
    setUsando(valor);
    try {
      await aoUsar(valor);
    } finally {
      setUsando(null);
    }
  }

  const cenario = (k: JeitoDeEntregar) => {
    const r = calcular({ custo: item.custo, emb: item.emb, semEntrega: item.semEntrega }, canal, k, t, dados.vendas, promoEf);
    const ref = item.precoHoje != null ? item.precoHoje : r.recomendado;
    const v = ref != null ? r.com(ref) : null;
    const seu = t[canal].plano === k;
    const j = JEITOS[canal][k];
    return (
      <section key={k} aria-label={j.rot} className={`min-w-0 space-y-2 rounded-lg border p-3 ${seu ? 'border-primary bg-primary/5' : 'border-border'}`}>
        <h4 className="flex flex-wrap items-center gap-2 font-display font-bold">
          {j.rot}
          {seu && <span className="rounded-full bg-info/15 px-2 py-0.5 text-xs font-semibold">o seu plano</span>}
        </h4>
        <p className={`text-xs ${texto2}`}>
          {j.plano} · comissão {pct(r.partes.comissao)} · pagamento e cartão {pct(r.partes.pagamento)}
          {k === 'loja' && !item.semEntrega ? ` (${pct(ef.parteNaEntrega)} pagos na entrega, maquininha ${pct(t.geral.maquininha)})` : ''}
          {t.geral.antecipa ? ` · antecipação ${pct(t.geral.antec)}` : ''} · imposto {pct(r.imposto)}
          {r.entrega ? ` · entrega ${brl(r.entrega)}/item` : ''}
          {r.taxaFixa ? ` · taxa fixa ${brl(r.taxaFixa)}/pedido` : ''}
        </p>
        {k === 'app' && !item.semEntrega && (
          <div className="space-y-1">
            <Label htmlFor={`calc-fixa-${canal}`}>Taxa fixa por entrega (média pela distância)</Label>
            <div className="flex items-center gap-2">
              <span className={`text-sm ${texto2}`}>R$</span>
              <Input id={`calc-fixa-${canal}`} inputMode="decimal" value={taxaFixa} onChange={(e) => setTaxaFixa(e.target.value)} autoComplete="off" />
            </div>
          </div>
        )}
        {r.recomendado == null ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">As taxas, o desconto e a margem passam do preço: não há preço que pague. Baixe a margem ou o desconto.</p>
        ) : (
          <div>
            <p className={`text-xs ${texto2}`}>{promoEf.ligada ? `Preço cheio para ganhar ${pct(t.geral.margem)} com a promoção` : `Preço recomendado ${n.no}`}</p>
            <p className="font-mono text-2xl font-bold">{brl(r.recomendado)}</p>
            <p className={`text-xs ${texto2}`}>
              mínimo para não ter prejuízo: <span className="font-mono">{brl(r.minimo)}</span>
            </p>
          </div>
        )}
        {v && (
          <div className="space-y-1 text-xs">
            <Linha rotulo={<b>{item.precoHoje != null ? `Com o preço de hoje (${brl(item.precoHoje)})` : `Com o preço recomendado (${brl(r.recomendado)})`}</b>} valor="" />
            {promoEf.ligada && <Linha rotulo="Cliente paga" valor={brl(v.clientePaga)} />}
            {promoEf.ligada && v.descontoLoja > 0 && <Linha rotulo="Desconto bancado pela loja" valor={`− ${brl(v.descontoLoja)}`} />}
            {promoEf.ligada && v.descontoApp > 0 && <Linha rotulo="Desconto bancado pelo app" valor={brl(v.descontoApp)} />}
            <Linha rotulo="A loja vende" valor={brl(v.vende)} total />
            <Linha rotulo={`Comissão (${pct(r.partes.comissao)}${promoEf.ligada ? ` de ${brl(v.baseComissao)}` : ''})`} valor={`− ${brl(v.comissao)}`} />
            <Linha rotulo={`Pagamento e cartão (${pct(r.partes.pagamento)}${promoEf.ligada ? ` de ${brl(v.clientePaga)}` : ''})`} valor={`− ${brl(v.pagamento)}`} />
            {t.geral.antecipa && <Linha rotulo={`Antecipação (${pct(r.partes.antecipacao)})`} valor={`− ${brl(v.antecipacao)}`} />}
            <Linha rotulo={`Imposto (${pct(r.imposto)})`} valor={`− ${brl(v.imposto)}`} />
            <Linha rotulo="Custo do produto" valor={`− ${brl(item.custo)}`} />
            {item.emb > 0 && <Linha rotulo="Embalagem" valor={`− ${brl(item.emb)}`} />}
            {r.entrega > 0 && <Linha rotulo="Entrega por item" valor={`− ${brl(r.entrega)}`} />}
            {r.taxaFixaItem > 0 && <Linha rotulo={`Taxa fixa da entrega (${brl(r.taxaFixa)} ÷ ${dec(r.n)} itens)`} valor={`− ${brl(r.taxaFixaItem)}`} />}
            <Linha
              rotulo="Ganho líquido"
              valor={
                <span className={v.lucro < 0 ? 'text-destructive' : 'text-ok'}>
                  {brl(v.lucro)} · {pct(v.margem)}
                </span>
              }
              total
            />
            <p className={texto2}>
              Neste preço, a loja aguenta bancar até <b className="font-mono">{pct(r.descontoMax(ref!).pct)}</b> de desconto (
              <span className="font-mono">{brl(r.descontoMax(ref!).rs)}</span> por item) sem prejuízo.
            </p>
          </div>
        )}
        {r.recomendado != null && podeUsar && (
          <Button type="button" size="sm" variant={seu ? 'default' : 'outline'} disabled={usando != null} onClick={() => void usar(r.recomendado!)}>
            {usando === r.recomendado ? 'Usando…' : `Usar ${brl(r.recomendado)} como preço ${n.no}`}
          </Button>
        )}
      </section>
    );
  };

  return (
    <Gaveta titulo={`Calcular o preço ${n.no}: ${item.nome}`} aoFechar={aoFechar} larga rodape={<Button type="button" variant="outline" onClick={aoFechar}>Fechar</Button>}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2">
          <span>
            Custo <b className="font-mono">{brl(item.custo)}</b>
            {item.emb > 0 && (
              <>
                {' '}· Embalagem <b className="font-mono">{brl(item.emb)}</b>
              </>
            )}
            <span className={`ml-1 text-xs ${texto2}`}>{item.fonteDoCusto ? `(${item.fonteDoCusto})` : ''}</span>
          </span>
          <span className="text-xs">
            Imposto:{' '}
            {ef.simples ? `Simples, faixa ${ef.simples.faixa}: ${pct(ef.simples.efetiva)}` : `média ${pct(t.geral.imposto)}`} ·{' '}
            <button type="button" className="font-semibold underline decoration-primary decoration-2 underline-offset-2" onClick={aoAbrirTaxas}>
              ％ Taxas e margem
            </button>
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="calc-margem">Margem que você quer ganhar</Label>
            <div className="flex items-center gap-2">
              <Input id="calc-margem" inputMode="decimal" value={margem} onChange={(e) => setMargem(e.target.value)} autoComplete="off" />
              <span className={texto2}>%</span>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="calc-antec">Antecipação do repasse</Label>
            <div className="flex items-center gap-2">
              <Input id="calc-antec" inputMode="decimal" value={antec} onChange={(e) => setAntec(e.target.value)} disabled={!antecipa} autoComplete="off" />
              <span className={texto2}>%</span>
            </div>
            <label className="flex min-h-10 items-center gap-2 text-xs">
              <input type="checkbox" className="h-4 w-4" checked={antecipa} onChange={(e) => setAntecipa(e.target.checked)} /> Antecipo o repasse
            </label>
          </div>
          <div className="space-y-1">
            <Label htmlFor="calc-itens">Itens por pedido (média)</Label>
            <div className="flex items-center gap-2">
              <Input id="calc-itens" inputMode="decimal" value={itens} onChange={(e) => setItens(e.target.value)} autoComplete="off" />
              <span className={texto2}>itens</span>
            </div>
          </div>
          <label className="flex min-h-10 items-center gap-2 self-end">
            <input type="checkbox" className="h-4 w-4" checked={arred} onChange={(e) => setArred(e.target.checked)} /> Arredondar para ,90
          </label>
        </div>

        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 font-bold">Promoção {n.do}</legend>
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" className="h-4 w-4" checked={promo.ligada} onChange={(e) => setPromo((p) => ({ ...p, ligada: e.target.checked }))} />
            Simular uma promoção (o app pede um desconto)
          </label>
          {promo.ligada && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="calc-promo-tipo">Desconto ao cliente</Label>
                <Select id="calc-promo-tipo" value={promo.tipo} onChange={(e) => setPromo((p) => ({ ...p, tipo: e.target.value as Promo['tipo'] }))}>
                  <option value="pct">% no preço do item</option>
                  <option value="rsItem">Valor fixo no item (R$)</option>
                  <option value="rsPedido">Valor fixo no pedido — cupom (R$)</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="calc-desc">{promo.tipo === 'pct' ? 'Desconto no item' : promo.tipo === 'rsItem' ? 'Desconto por item' : 'Desconto no pedido'}</Label>
                <div className="flex items-center gap-2">
                  {promo.tipo !== 'pct' && <span className={texto2}>R$</span>}
                  <Input
                    id="calc-desc"
                    inputMode="decimal"
                    value={promo.tipo === 'pct' ? descTxt.desconto : descTxt.descontoRs}
                    onChange={(e) => setDescTxt((d) => (promo.tipo === 'pct' ? { ...d, desconto: e.target.value } : { ...d, descontoRs: e.target.value }))}
                    autoComplete="off"
                  />
                  {promo.tipo === 'pct' && <span className={texto2}>%</span>}
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="calc-quem">Quem banca o desconto</Label>
                <Select id="calc-quem" value={promo.quemBanca} onChange={(e) => setPromo((p) => ({ ...p, quemBanca: e.target.value as Promo['quemBanca'] }))}>
                  <option value="parte">A loja banca uma parte (%)</option>
                  <option value="appFixo">O app banca um valor fixo (R$)</option>
                </Select>
              </div>
              {promo.quemBanca === 'parte' ? (
                <div className="space-y-1">
                  <Label htmlFor="calc-banca">Quanto do desconto a loja banca</Label>
                  <div className="flex items-center gap-2">
                    <Input id="calc-banca" inputMode="decimal" value={descTxt.lojaBanca} onChange={(e) => setDescTxt((d) => ({ ...d, lojaBanca: e.target.value }))} autoComplete="off" />
                    <span className={texto2}>%</span>
                  </div>
                  <p className={`text-xs ${texto2}`}>100% = a loja paga o desconto inteiro; o resto o app banca.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="calc-app-fixo">Quanto o app banca {promo.tipo === 'rsPedido' ? 'por pedido' : 'por item'} (valor médio)</Label>
                  <div className="flex items-center gap-2">
                    <span className={texto2}>R$</span>
                    <Input id="calc-app-fixo" inputMode="decimal" value={descTxt.appFixo} onChange={(e) => setDescTxt((d) => ({ ...d, appFixo: e.target.value }))} autoComplete="off" />
                  </div>
                  <div role="group" aria-label="Valores comuns" className="flex flex-wrap items-center gap-1 text-xs">
                    <span className={texto2}>Comuns:</span>
                    {[5, 7, 9].map((x) => (
                      <Button key={x} type="button" size="sm" variant="outline" aria-pressed={numeroDigitado(descTxt.appFixo) === x} onClick={() => setDescTxt((d) => ({ ...d, appFixo: String(x) }))}>
                        {brl(x)}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="calc-base">A comissão {n.do} incide sobre</Label>
                <Select id="calc-base" value={base} onChange={(e) => setBase(e.target.value as Taxas['ifood']['baseComissao'])}>
                  <option value="cliente">O preço de venda depois de todos os descontos (o que o cliente paga)</option>
                  <option value="loja">O preço menos o desconto que a loja banca</option>
                  <option value="cheio">O preço cheio, antes do desconto</option>
                </Select>
                <p className={`text-xs ${texto2}`}>
                  {canal === '99food'
                    ? 'O guia oficial da 99 diz: a comissão é calculada sobre "o valor real da venda após os descontos".'
                    : 'O iFood não publica a regra para todas as promoções: num exemplo publicado, a base é o preço menos o desconto da loja. Confirme no Portal do Parceiro.'}{' '}
                  O pagamento online sai sempre sobre o que o cliente paga.
                </p>
              </div>
            </div>
          )}
        </fieldset>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{(['loja', 'app'] as const).map(cenario)}</div>

        <p className={`text-xs ${texto2}`}>
          Como a conta é feita: a loja vende o preço menos a parte do desconto que ela banca (o que o app banca volta para a loja); o cliente paga o
          preço menos o desconto inteiro. A comissão sai sobre a base escolhida; o pagamento e o cartão, sobre o que o cliente paga; a antecipação e o
          imposto, sobre o que a loja vende; depois, o custo, a embalagem, a entrega e a taxa fixa por entrega (o que é por pedido entra dividido pelos
          itens de um pedido médio). O recomendado é o preço em que o ganho líquido chega à margem escolhida; o mínimo, em que o ganho é zero. A
          mensalidade do app não entra (é por mês, não por item). É sugestão: nada muda sem o &quot;Usar&quot;.
        </p>
      </div>
    </Gaveta>
  );
}
