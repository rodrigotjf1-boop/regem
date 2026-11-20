'use client';

import { useEffect, useId, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputMoeda } from '@/components/ui/input-moeda';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Gaveta } from '@/components/ui/sobreposto';
import { cn } from '@/lib/utils';
import { NOME_DO_TIPO, type PainelDoClube, type PremioDoClube, type TipoDePremio } from './tipos';

// A gaveta do prêmio (protótipo `mockups/regem-clube-banner.html`, "Marketing › Clube" › Prêmios › gaveta): o nome que o
// cliente vê, o tipo (desconto em %, em R$, frete grátis, produto grátis), o valor de cada tipo, o pedido mínimo e a
// validade. Criar e editar mandam tudo; o servidor confere de novo (os mesmos limites do `check` da mig 471).
const TIPOS: TipoDePremio[] = ['percentual', 'valor', 'fretegratis', 'produto'];

export function GavetaDoPremio({
  premio,
  validades,
  nomeMax,
  aoFechar,
  aoSalvar,
}: {
  /** `null` = novo prêmio. */
  premio: PremioDoClube | null;
  validades: number[];
  nomeMax: number;
  aoFechar: () => void;
  aoSalvar: (painel: PainelDoClube) => void;
}) {
  const ids = { nome: useId(), tipo: useId(), valor: useId(), teto: useId(), produto: useId(), minimo: useId(), validade: useId() };
  const [nome, setNome] = useState(premio?.nome ?? '');
  const [tipo, setTipo] = useState<TipoDePremio>(premio?.tipo ?? 'percentual');
  const [valor, setValor] = useState(premio && (premio.tipo === 'percentual' || premio.tipo === 'valor') ? String(premio.valor) : '');
  const [teto, setTeto] = useState(premio?.teto != null ? String(premio.teto) : '');
  const [produtoId, setProdutoId] = useState(premio?.produtoId ?? '');
  const [minimo, setMinimo] = useState(premio?.minimo ? String(premio.minimo) : '');
  const [validade, setValidade] = useState(String(premio?.validadeDias ?? 7));
  const [produtos, setProdutos] = useState<Array<{ id: string; nome: string }> | null>(null);
  const [erroProdutos, setErroProdutos] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // Os produtos só quando o tipo pede (a lista pode ser grande).
  useEffect(() => {
    if (tipo !== 'produto' || produtos) return;
    let vivo = true;
    api
      .clubeProdutos()
      .then((r: any) => vivo && setProdutos(Array.isArray(r) ? r : []))
      .catch(() => vivo && setErroProdutos(true));
    return () => {
      vivo = false;
    };
  }, [tipo, produtos]);

  async function salvar() {
    setErro('');
    const corpo: Record<string, unknown> = {
      nome,
      tipo,
      minimo: minimo === '' ? 0 : Number(minimo),
      validadeDias: Number(validade),
    };
    if (tipo === 'percentual') {
      corpo.valor = valor === '' ? NaN : Number(valor);
      corpo.teto = teto === '' ? null : Number(teto);
    } else if (tipo === 'valor') corpo.valor = valor === '' ? NaN : Number(valor);
    else if (tipo === 'produto') corpo.produtoId = produtoId;
    setSalvando(true);
    try {
      const painel = (premio ? await api.clubeEditarPremio(premio.id, corpo) : await api.clubeCriarPremio(corpo)) as PainelDoClube;
      toast.success(premio ? 'Prêmio salvo.' : 'Prêmio criado.');
      aoSalvar(painel);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Não foi possível salvar o prêmio.';
      setErro(msg);
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo={premio ? premio.nome : 'Novo prêmio'}
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : premio ? 'Salvar prêmio' : 'Criar prêmio'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor={ids.nome}>Nome que o cliente vê</Label>
          <Input id={ids.nome} value={nome} maxLength={nomeMax} onChange={(e) => setNome(e.target.value)} placeholder="Batata média grátis" />
        </div>

        <div className="space-y-1">
          <span id={ids.tipo} className="text-sm font-semibold">Tipo</span>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={ids.tipo}>
            {TIPOS.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tipo === t}
                onClick={() => setTipo(t)}
                className={cn(
                  'min-h-10 rounded-full border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  tipo === t ? 'border-foreground bg-foreground text-background' : 'border-input bg-card text-foreground',
                )}
              >
                {NOME_DO_TIPO[t]}
              </button>
            ))}
          </div>
          {tipo === 'produto' && (
            <p className="text-xs text-secondary-foreground">Produto grátis entra como 100% de desconto nele: a nota, o estoque e o faturamento seguem certos.</p>
          )}
        </div>

        {tipo === 'percentual' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={ids.valor}>Desconto (%)</Label>
              <Input id={ids.valor} type="number" inputMode="numeric" min={1} max={100} value={valor} onChange={(e) => setValor(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={ids.teto}>Teto do desconto (opcional)</Label>
              <InputMoeda id={ids.teto} value={teto} onChange={setTeto} placeholder="sem teto" />
            </div>
          </div>
        )}
        {tipo === 'valor' && (
          <div className="space-y-1">
            <Label htmlFor={ids.valor}>Desconto (R$)</Label>
            <InputMoeda id={ids.valor} value={valor} onChange={setValor} />
          </div>
        )}
        {tipo === 'produto' && (
          <div className="space-y-1">
            <Label htmlFor={ids.produto}>Produto</Label>
            <Select id={ids.produto} value={produtoId} onChange={(e) => setProdutoId(e.target.value)} disabled={!produtos}>
              <option value="">{produtos ? 'Escolha o produto' : erroProdutos ? 'Não deu para ler os produtos' : 'Carregando os produtos…'}</option>
              {(produtos ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </Select>
            {produtos && !produtos.length && <p className="text-xs text-secondary-foreground">Nenhum produto ativo no cardápio ainda.</p>}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={ids.minimo}>Pedido mínimo para usar</Label>
            <InputMoeda id={ids.minimo} value={minimo} onChange={setMinimo} placeholder="sem mínimo" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={ids.validade}>Validade</Label>
            <Select id={ids.validade} value={validade} onChange={(e) => setValidade(e.target.value)}>
              {validades.map((d) => (
                <option key={d} value={d}>{d} dias</option>
              ))}
            </Select>
          </div>
        </div>

        <p className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-secondary-foreground">
          Sem limite de quantidade: escolha só prêmios que a loja consegue dar a todos. O prêmio vira um cupom pessoal, que só o
          cliente que ganhou usa, no cardápio online ou no WhatsApp da loja.
        </p>
        {erro && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {erro}
          </p>
        )}
      </div>
    </Gaveta>
  );
}
