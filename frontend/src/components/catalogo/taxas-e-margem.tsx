'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Gaveta } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';
import { JEITOS, brl, numeroDigitado, pct, simples, type CanalCalc, type RespostaDasTaxas, type Taxas } from '@/lib/calculadora-preco';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "％ TAXAS E MARGEM DESTA LOJA" (R3 F5; protótipo `mockups/regem-conciliacao-ifood.html`, decisões 7 e 8): as taxas de cada app
// ligado (o plano, a comissão e o pagamento de cada jeito de entregar, a taxa fixa por entrega, a base da comissão com
// promoção, os pagos na entrega), o imposto (Simples pelo faturamento ou uma média), a maquininha, a margem, a antecipação,
// a entrega da loja e os itens por pedido. O faturamento, os itens por pedido e os pagos na entrega podem vir das vendas.

const NOME: Record<CanalCalc, { nome: string; do: string; no: string }> = {
  ifood: { nome: 'iFood', do: 'do iFood', no: 'no iFood' },
  '99food': { nome: '99', do: 'da 99', no: 'na 99' },
};
const dec = (n: number | null | undefined) => (n == null ? '' : String(Math.round(n * 100) / 100).replace('.', ','));

type FormApp = { plano: 'loja' | 'app'; baseComissao: 'cliente' | 'loja' | 'cheio'; parteDasVendas: boolean; parte: string; lojaCom: string; lojaPag: string; appCom: string; appPag: string; appFixa: string };
type Form = {
  apps: Record<CanalCalc, FormApp>;
  impostoModo: 'simples' | 'media';
  imposto: string;
  rbt12DasVendas: boolean;
  rbt12: string;
  maquininha: string;
  itensDasVendas: boolean;
  itens: string;
  margem: string;
  antecipa: boolean;
  antec: string;
  entregaLoja: string;
  arred: boolean;
};

function formDe(r: RespostaDasTaxas): Form {
  const t = r.taxas;
  const app = (c: CanalCalc): FormApp => ({
    plano: t[c].plano,
    baseComissao: t[c].baseComissao,
    parteDasVendas: t[c].parteNaEntrega == null,
    parte: dec(t[c].parteNaEntrega ?? r.vendas.parteNaEntrega[c]?.pct ?? 30),
    lojaCom: dec(t[c].loja.com),
    lojaPag: dec(t[c].loja.pag),
    appCom: dec(t[c].app.com),
    appPag: dec(t[c].app.pag),
    appFixa: dec(t[c].app.taxaFixa),
  });
  return {
    apps: { ifood: app('ifood'), '99food': app('99food') },
    impostoModo: t.geral.impostoModo,
    imposto: dec(t.geral.imposto),
    rbt12DasVendas: t.geral.rbt12 == null && r.vendas.rbt12 != null,
    rbt12: t.geral.rbt12 != null ? t.geral.rbt12.toLocaleString('pt-BR') : '',
    maquininha: dec(t.geral.maquininha),
    itensDasVendas: t.geral.itensPedido == null,
    itens: dec(t.geral.itensPedido ?? r.vendas.itensPorPedido ?? 2),
    margem: dec(t.geral.margem),
    antecipa: t.geral.antecipa,
    antec: dec(t.geral.antec),
    entregaLoja: dec(t.geral.entregaLoja),
    arred: t.geral.arred,
  };
}

/** O pedido de salvar (números como digitados — o servidor confere e diz o campo errado). */
function pedidoDe(f: Form, canais: CanalCalc[]): Partial<Record<keyof Taxas, unknown>> {
  const n = (v: string) => numeroDigitado(v) ?? v;
  const apps: any = {};
  for (const c of canais) {
    const a = f.apps[c];
    apps[c] = {
      plano: a.plano,
      baseComissao: a.baseComissao,
      parteNaEntrega: a.parteDasVendas ? null : n(a.parte),
      loja: { com: n(a.lojaCom), pag: n(a.lojaPag) },
      app: { com: n(a.appCom), pag: n(a.appPag), taxaFixa: n(a.appFixa) },
    };
  }
  return {
    ...apps,
    geral: {
      impostoModo: f.impostoModo,
      imposto: n(f.imposto),
      rbt12: f.rbt12DasVendas ? null : f.rbt12.trim() === '' ? null : n(f.rbt12),
      maquininha: n(f.maquininha),
      itensPedido: f.itensDasVendas ? null : n(f.itens),
      margem: n(f.margem),
      antecipa: f.antecipa,
      antec: n(f.antec),
      entregaLoja: n(f.entregaLoja),
      arred: f.arred,
    },
  };
}

function CampoPct({ id, rotulo, valor, aoMudar, unidade = '%', ajuda, desligado }: { id: string; rotulo: string; valor: string; aoMudar: (v: string) => void; unidade?: string; ajuda?: string; desligado?: boolean }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>{rotulo}</Label>
      <div className="flex items-center gap-2">
        {unidade === 'R$' && <span className={`text-sm ${texto2}`}>R$</span>}
        <Input id={id} inputMode="decimal" value={valor} onChange={(e) => aoMudar(e.target.value)} disabled={desligado} autoComplete="off" />
        {unidade !== 'R$' && <span className={`text-sm ${texto2}`}>{unidade}</span>}
      </div>
      {ajuda && <p className={`text-xs ${texto2}`}>{ajuda}</p>}
    </div>
  );
}

export function TaxasEMargem({
  dados,
  canais,
  aoFechar,
  aoSalvar,
}: {
  dados: RespostaDasTaxas;
  canais: CanalCalc[];
  aoFechar: () => void;
  aoSalvar: (r: RespostaDasTaxas) => void;
}) {
  const [f, setF] = useState<Form>(() => formDe(dados));
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const v = dados.vendas;
  const mudar = (m: Partial<Form>) => setF((x) => ({ ...x, ...m }));
  const mudarApp = (c: CanalCalc, m: Partial<FormApp>) => setF((x) => ({ ...x, apps: { ...x.apps, [c]: { ...x.apps[c], ...m } } }));
  const rbt = f.rbt12DasVendas ? v.rbt12 : numeroDigitado(f.rbt12);
  const sn = simples(rbt);

  async function salvar() {
    setErro('');
    setOcupado(true);
    try {
      const r = await api.salvarTaxas(pedidoDe(f, canais));
      toast.success(`Taxas e margem da loja ${r.loja.nome} salvas.`);
      aoSalvar(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar as taxas.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Gaveta
      titulo="Taxas e margem desta loja"
      aoFechar={() => !ocupado && aoFechar()}
      larga
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void salvar()} disabled={ocupado}>
            {ocupado ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="space-y-5 text-sm">
        <p className="rounded-md border border-info/40 bg-info/10 px-3 py-2">
          {dados.salvas ? `Loja ${dados.loja.nome}. ` : ''}Os valores vêm preenchidos com <b>referências públicas</b> (iFood: Plano Básico 12% e Plano Entrega 23%, mais
          3,2% de pagamento online; 99: 10,9% com entrega da loja e 8,9% com entrega da 99, mais cerca de 3,2%). <b>Confira no seu contrato</b>{' '}
          e ajuste: as taxas mudam por região e por campanha. Maquininha, antecipação, entrega da loja e margem são exemplos: troque pelos da
          sua loja. O faturamento, os itens por pedido e os pagos na entrega podem vir das vendas da loja.
        </p>

        {canais.map((c) => {
          const a = f.apps[c];
          const j = JEITOS[c];
          const pv = v.parteNaEntrega[c];
          return (
            <fieldset key={c} className="space-y-3 rounded-lg border border-border p-3">
              <legend className="px-1 font-bold">{NOME[c].nome}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`tx-${c}-plano`}>O seu plano {NOME[c].no}</Label>
                  <Select id={`tx-${c}-plano`} value={a.plano} onChange={(e) => mudarApp(c, { plano: e.target.value as 'loja' | 'app' })}>
                    <option value="loja">
                      {j.loja.rot} ({j.loja.plano})
                    </option>
                    <option value="app">
                      {j.app.rot} ({j.app.plano})
                    </option>
                  </Select>
                  <p className={`text-xs ${texto2}`}>A calculadora marca o seu plano e mostra o outro para comparar.</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`tx-${c}-base`}>Com promoção, a comissão incide sobre</Label>
                  <Select id={`tx-${c}-base`} value={a.baseComissao} onChange={(e) => mudarApp(c, { baseComissao: e.target.value as FormApp['baseComissao'] })}>
                    <option value="cliente">O preço de venda depois de todos os descontos</option>
                    <option value="loja">O preço menos o desconto que a loja banca</option>
                    <option value="cheio">O preço cheio, antes do desconto</option>
                  </Select>
                  <p className={`text-xs ${texto2}`}>
                    {c === '99food' ? 'O guia oficial da 99: "o valor real da venda após os descontos".' : 'Confirme no Portal do Parceiro do iFood.'}
                  </p>
                </div>
                <CampoPct id={`tx-${c}-loja-com`} rotulo={`${j.loja.rot}: comissão`} valor={a.lojaCom} aoMudar={(x) => mudarApp(c, { lojaCom: x })} />
                <CampoPct id={`tx-${c}-loja-pag`} rotulo={`${j.loja.rot}: pagamento online`} valor={a.lojaPag} aoMudar={(x) => mudarApp(c, { lojaPag: x })} />
                <CampoPct id={`tx-${c}-app-com`} rotulo={`${j.app.rot}: comissão`} valor={a.appCom} aoMudar={(x) => mudarApp(c, { appCom: x })} />
                <CampoPct id={`tx-${c}-app-pag`} rotulo={`${j.app.rot}: pagamento online`} valor={a.appPag} aoMudar={(x) => mudarApp(c, { appPag: x })} />
                <CampoPct
                  id={`tx-${c}-app-fixa`}
                  rotulo={`${j.app.rot}: taxa fixa por entrega`}
                  unidade="R$"
                  valor={a.appFixa}
                  aoMudar={(x) => mudarApp(c, { appFixa: x })}
                  ajuda="Por pedido, além da comissão. Se o app cobra pela distância, use a média dos seus pedidos; 0 se não cobra."
                />
                <div className="space-y-1">
                  <CampoPct
                    id={`tx-${c}-parte`}
                    rotulo={`Pedidos ${NOME[c].do} pagos na entrega`}
                    valor={a.parteDasVendas ? dec(pv?.pct ?? 30) : a.parte}
                    aoMudar={(x) => mudarApp(c, { parte: x })}
                    desligado={a.parteDasVendas}
                  />
                  <label className="flex min-h-10 items-center gap-2 text-xs">
                    <input type="checkbox" className="h-4 w-4" checked={a.parteDasVendas} onChange={(e) => mudarApp(c, { parteDasVendas: e.target.checked })} />
                    {pv?.pct != null ? `Usar o das vendas (${pct(pv.pct)} em ${pv.pedidos} pedidos, ${v.dias} dias)` : `Usar o das vendas (sem pedidos ${NOME[c].do} em ${v.dias} dias: vale 30%)`}
                  </label>
                </div>
              </div>
            </fieldset>
          );
        })}

        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 font-bold">Imposto</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="tx-imp-modo">Como calcular</Label>
              <Select id="tx-imp-modo" value={f.impostoModo} onChange={(e) => mudar({ impostoModo: e.target.value as Form['impostoModo'] })}>
                <option value="simples">Simples Nacional, pelo faturamento</option>
                <option value="media">Uma média que eu informo</option>
              </Select>
            </div>
            {f.impostoModo === 'simples' ? (
              <div className="space-y-1">
                <CampoPct
                  id="tx-rbt"
                  rotulo="Faturamento dos últimos 12 meses"
                  unidade="R$"
                  valor={f.rbt12DasVendas ? (v.rbt12 ?? 0).toLocaleString('pt-BR') : f.rbt12}
                  aoMudar={(x) => mudar({ rbt12: x })}
                  desligado={f.rbt12DasVendas}
                />
                {v.rbt12 != null ? (
                  <label className="flex min-h-10 items-center gap-2 text-xs">
                    <input type="checkbox" className="h-4 w-4" checked={f.rbt12DasVendas} onChange={(e) => mudar({ rbt12DasVendas: e.target.checked })} />
                    Usar o das vendas da empresa ({brl(v.rbt12)})
                  </label>
                ) : (
                  <p className={`text-xs ${texto2}`}>{v.rbt12Motivo}</p>
                )}
              </div>
            ) : (
              <CampoPct id="tx-imp" rotulo="Imposto médio sobre a venda" valor={f.imposto} aoMudar={(x) => mudar({ imposto: x })} />
            )}
          </div>
          {f.impostoModo === 'simples' && (
            <p aria-live="polite" className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs">
              {sn
                ? `Simples Nacional, Anexo I (comércio — bares e restaurantes), faixa ${sn.faixa}: alíquota nominal ${pct(sn.nominal)}, efetiva ${pct(sn.efetiva)}. Confirme com o seu contador (o anexo depende da atividade).`
                : rbt != null && rbt > 4_800_000
                  ? 'Faturamento acima de R$ 4,8 milhões em 12 meses: fora do Simples. Use a média.'
                  : `Sem o faturamento, vale a média (${f.imposto || '6'}%).`}
            </p>
          )}
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 font-bold">Margem e repasse</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <CampoPct id="tx-margem" rotulo="Margem que você quer ganhar" valor={f.margem} aoMudar={(x) => mudar({ margem: x })} ajuda="Sobre o que a loja vende, depois de tudo." />
            <div className="space-y-1">
              <CampoPct id="tx-antec" rotulo="Antecipação do repasse" valor={f.antec} aoMudar={(x) => mudar({ antec: x })} desligado={!f.antecipa} />
              <label className="flex min-h-10 items-center gap-2 text-xs">
                <input type="checkbox" className="h-4 w-4" checked={f.antecipa} onChange={(e) => mudar({ antecipa: e.target.checked })} />
                Antecipo o repasse
              </label>
            </div>
            <CampoPct id="tx-maq" rotulo="Taxa da maquininha (média débito e crédito)" valor={f.maquininha} aoMudar={(x) => mudar({ maquininha: x })} ajuda="Nos pedidos pagos na entrega, no lugar do pagamento online." />
            <CampoPct
              id="tx-entrega"
              rotulo="Entrega da loja: custo por item"
              unidade="R$"
              valor={f.entregaLoja}
              aoMudar={(x) => mudar({ entregaLoja: x })}
              ajuda="O que a entrega custa à loja e a taxa de entrega não cobre, dividido pelos itens de um pedido médio."
            />
            <div className="space-y-1">
              <CampoPct id="tx-itens" rotulo="Itens por pedido (média)" unidade="itens" valor={f.itensDasVendas ? dec(v.itensPorPedido ?? 2) : f.itens} aoMudar={(x) => mudar({ itens: x })} desligado={f.itensDasVendas} />
              <label className="flex min-h-10 items-center gap-2 text-xs">
                <input type="checkbox" className="h-4 w-4" checked={f.itensDasVendas} onChange={(e) => mudar({ itensDasVendas: e.target.checked })} />
                {v.itensPorPedido != null ? `Usar o das vendas (${dec(v.itensPorPedido)} em ${v.pedidos} pedidos, ${v.dias} dias)` : `Usar o das vendas (sem pedidos em ${v.dias} dias: vale 2)`}
              </label>
            </div>
            <label className="flex min-h-10 items-center gap-2 self-end">
              <input type="checkbox" className="h-4 w-4" checked={f.arred} onChange={(e) => mudar({ arred: e.target.checked })} />
              Arredondar o preço recomendado para ,90
            </label>
          </div>
        </fieldset>

        {erro && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            {erro}
          </p>
        )}
      </div>
    </Gaveta>
  );
}
