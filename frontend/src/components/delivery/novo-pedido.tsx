'use client';

import { useEffect, useState } from 'react';
import { buscarCep } from '@/lib/geo';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SeletorProduto, type SelecaoProduto } from '@/components/pdv/seletor-produto';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type ItemNovo = { produtoId: string; label: string; preco: number; quantidade: number; observacao?: string };

// Novo pedido manual: entrega (com endereço) ou retirada no balcão.
export function NovoPedido({ onFechar, onCriado }: { onFechar: () => void; onCriado: () => void }) {
  const [tipo, setTipo] = useState<'entrega' | 'retirada'>('entrega');
  const [cliente, setCliente] = useState('');
  const [telefone, setTelefone] = useState('');
  const [cep, setCep] = useState('');
  const [rua, setRua] = useState('');
  const [numero, setNumero] = useState('');
  const [bairro, setBairro] = useState('');
  const [ref, setRef] = useState('');
  async function cepBlur(v: string) {
    const d = await buscarCep(v);
    if (d) { setRua((r) => r || d.logradouro); setBairro((b) => b || d.bairro); }
  }
  const [formas, setFormas] = useState<any[]>([]);
  const [forma, setForma] = useState('Dinheiro');
  const [trocoPara, setTrocoPara] = useState('');
  const [itens, setItens] = useState<ItemNovo[]>([]);
  const [busy, setBusy] = useState(false);
  const [enderecosCli, setEnderecosCli] = useState<any[]>([]);
  const [achou, setAchou] = useState<string | null>(null);

  useEffect(() => {
    api.formasPagamento().then((f: any) => {
      const ativas = (f as any[]).filter((x) => x.ativo);
      setFormas(ativas);
      if (ativas[0]) setForma(ativas[0].nome);
    }).catch(() => {});
  }, []);

  // Ao digitar o telefone, busca o cliente na base (autopreenchimento). Debounce.
  useEffect(() => {
    const tel = telefone.replace(/\D/g, '');
    if (tel.length < 10) {
      setEnderecosCli([]);
      setAchou(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r: any = await api.buscarClienteTelefone(tel);
        if (r?.cliente) {
          setAchou(r.cliente.nome || 'Cliente');
          if (r.cliente.nome) setCliente((c) => c || r.cliente.nome);
          setEnderecosCli(r.enderecos ?? []);
          const pr = (r.enderecos ?? []).find((e: any) => e.principal) ?? (r.enderecos ?? [])[0];
          if (pr) usarEndereco(pr, true);
        } else {
          setAchou(null);
          setEnderecosCli([]);
        }
      } catch {
        /* ignora */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [telefone]);

  function usarEndereco(e: any, soSeVazio = false) {
    if (soSeVazio && rua.trim()) return;
    setRua(e.logradouro || '');
    setNumero(e.numero || '');
    setBairro(e.bairro || '');
    setRef(e.referencia || e.complemento || '');
  }

  function addItem(s: SelecaoProduto) {
    setItens((a) => {
      const i = a.findIndex((x) => x.produtoId === s.produtoId && !x.observacao && !s.observacao);
      if (i >= 0) {
        const cp = [...a];
        cp[i] = { ...cp[i], quantidade: cp[i].quantidade + 1 };
        return cp;
      }
      return [...a, { produtoId: s.produtoId, label: s.label, preco: s.preco ?? 0, quantidade: 1, observacao: s.observacao }];
    });
  }

  const total = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const ehDinheiro = /dinheiro/i.test(forma);

  async function salvar() {
    if (itens.length === 0) return toast.error('Inclua ao menos um item.');
    if (tipo === 'entrega' && !rua.trim()) return toast.error('Informe o endereço da entrega.');
    setBusy(true);
    try {
      await api.criarPedidoDelivery({
        tipo,
        clienteNome: cliente.trim() || undefined,
        clienteTelefone: telefone.trim() || undefined,
        enderecoRua: tipo === 'entrega' ? rua.trim() : undefined,
        enderecoNumero: tipo === 'entrega' ? numero.trim() : undefined,
        enderecoBairro: tipo === 'entrega' ? bairro.trim() : undefined,
        enderecoReferencia: tipo === 'entrega' ? ref.trim() : undefined,
        formaPagamento: forma,
        trocoPara: ehDinheiro && trocoPara ? Number(trocoPara.replace(',', '.')) : undefined,
        itens: itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade, observacao: i.observacao })),
      });
      toast.success('Pedido lançado no quadro.');
      onCriado();
      onFechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao lançar pedido');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-3" onClick={onFechar}>
      <Card className="grid max-h-[92vh] w-full max-w-6xl gap-4 overflow-y-auto p-5 lg:grid-cols-[1fr_380px]" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <h3 className="mb-3 font-display text-base font-bold">Novo pedido</h3>
          <div className="mb-3 inline-flex rounded-lg border border-border p-0.5 text-sm">
            {(['entrega', 'retirada'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={`rounded-md px-3 py-1 capitalize ${tipo === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              >
                {t === 'entrega' ? '🛵 Entrega' : '🏪 Retirada'}
              </button>
            ))}
          </div>
          <div className="max-h-[64vh] min-h-[300px] overflow-y-auto rounded-lg border border-border p-2">
            <SeletorProduto onAdd={addItem} enviando={busy} />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label className="text-xs">Cliente</Label><Input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Nome" /></div>
            <div className="space-y-1"><Label className="text-xs">Telefone</Label><Input inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(00) 0000-0000" /></div>
          </div>
          {achou && (
            <p className="rounded-md bg-ok/10 px-2.5 py-1.5 text-xs text-ok">
              📇 Cliente encontrado: <b>{achou}</b>{enderecosCli.length > 0 ? ` · ${enderecosCli.length} endereço(s)` : ''}
            </p>
          )}
          {tipo === 'entrega' && enderecosCli.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {enderecosCli.map((e: any) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => usarEndereco(e)}
                  className="rounded-full border border-border px-2.5 py-1 text-xs hover:border-primary hover:text-primary"
                >
                  {e.apelido || `${e.logradouro ?? 'Endereço'}, ${e.numero ?? ''}`}{e.principal ? ' ★' : ''}
                </button>
              ))}
            </div>
          )}
          {tipo === 'entrega' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-xs">CEP</Label><Input value={cep} inputMode="numeric" onChange={(e) => setCep(e.target.value)} onBlur={(e) => cepBlur(e.target.value)} placeholder="00000-000" /></div>
              <div className="flex items-end"><span className="text-xs text-muted-foreground">Preenche rua e bairro automaticamente.</span></div>
              <div className="col-span-2 space-y-1"><Label className="text-xs">Rua</Label><Input value={rua} onChange={(e) => setRua(e.target.value)} placeholder="Rua / logradouro" /></div>
              <div className="space-y-1"><Label className="text-xs">Número</Label><Input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="123" /></div>
              <div className="space-y-1"><Label className="text-xs">Bairro</Label><Input value={bairro} onChange={(e) => setBairro(e.target.value)} placeholder="Bairro" /></div>
              <div className="col-span-2 space-y-1"><Label className="text-xs">Referência</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Ponto de referência" /></div>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Forma de pagamento</Label>
            <select value={forma} onChange={(e) => setForma(e.target.value)} aria-label="Forma de pagamento" className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm">
              {formas.map((f) => <option key={f.id} value={f.nome}>{f.nome}</option>)}
            </select>
          </div>
          {ehDinheiro && (
            <div className="space-y-1"><Label className="text-xs">Troco para</Label><Input inputMode="decimal" value={trocoPara} onChange={(e) => setTrocoPara(e.target.value)} placeholder="0,00" /></div>
          )}

          <div className="mt-1 border-t border-border pt-2">
            {itens.length === 0 && <p className="text-xs text-muted-foreground">Nenhum item ainda.</p>}
            {itens.map((i, k) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span>{i.quantidade}× {i.label}</span>
                <button type="button" className="text-xs text-destructive" onClick={() => setItens((s) => s.filter((_, j) => j !== k))}>tirar</button>
              </div>
            ))}
            <div className="mt-1 flex justify-between font-mono text-sm font-bold"><span>Total</span><span>{brl(total)}</span></div>
          </div>

          <div className="mt-auto flex gap-2">
            <Button type="button" variant="ghost" className="flex-1" onClick={onFechar}>Cancelar</Button>
            <Button type="button" className="flex-1" onClick={salvar} disabled={busy}>{busy ? '…' : 'Lançar pedido'}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
