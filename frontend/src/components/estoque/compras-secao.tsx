'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Linha = { itemId: string; quantidade: string; custoUnitario: string };
// Conferência: o que de fato chegou, por linha da compra.
type Conf = { qtdRecebida: string; validade: string; indefinida: boolean; loteCodigo: string };

// Seção Compras do hub: gerar lista (produtos + quantidades, com filtro),
// data de recebimento + delegação, e receber (entra no estoque).
export function ComprasSecao({ itens, fornecedores }: { itens: any[]; fornecedores: any[] }) {
  const [listas, setListas] = useState<any[]>([]);
  const [colabs, setColabs] = useState<any[]>([]);
  const [novo, setNovo] = useState(false);
  const [busy, setBusy] = useState(false);

  // form
  const [nome, setNome] = useState('');
  const [fornecedorId, setFornecedorId] = useState('');
  const [dataRecebimento, setDataRecebimento] = useState('');
  const [delegadoId, setDelegadoId] = useState('');
  const [enviarKds, setEnviarKds] = useState(true);
  const [enviarDashboard, setEnviarDashboard] = useState(true);
  const [filtro, setFiltro] = useState('');
  const [linhas, setLinhas] = useState<Record<string, Linha>>({});

  // conferência (abre ao clicar em Receber)
  const [conferindo, setConferindo] = useState<any | null>(null);
  const [conf, setConf] = useState<Record<string, Conf>>({});

  const reload = useCallback(async () => {
    try {
      const [ls, cs] = await Promise.all([api.comprasListas(), api.colaboradores()]);
      setListas(ls as any[]);
      setColabs(cs as any[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar compras');
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  function toggle(itemId: string) {
    setLinhas((l) => {
      const n = { ...l };
      if (n[itemId]) delete n[itemId];
      else n[itemId] = { itemId, quantidade: '', custoUnitario: '' };
      return n;
    });
  }
  function setLinha(itemId: string, patch: Partial<Linha>) {
    setLinhas((l) => ({ ...l, [itemId]: { ...l[itemId], ...patch } }));
  }

  async function sugerir() {
    try {
      const s: any[] = await api.comprasSugestao();
      if (!s.length) { toast.error('Nenhum item abaixo do mínimo.'); return; }
      const n: Record<string, Linha> = {};
      for (const r of s) n[r.itemId] = { itemId: r.itemId, quantidade: String(r.sugerido), custoUnitario: '' };
      setLinhas(n);
      toast.success(`${s.length} item(ns) sugerido(s) do estoque baixo.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao sugerir');
    }
  }

  async function criar() {
    const sel = Object.values(linhas).filter((l) => Number(l.quantidade) > 0);
    if (!nome.trim() || sel.length === 0) {
      toast.error('Dê um nome e informe a quantidade de ao menos 1 produto.');
      return;
    }
    setBusy(true);
    try {
      await api.criarCompraLista({
        nome: nome.trim(),
        fornecedorId: fornecedorId || undefined,
        dataRecebimento: dataRecebimento || undefined,
        delegadoId: delegadoId || undefined,
        enviarKds,
        enviarDashboard,
        itens: sel.map((l) => ({
          itemId: l.itemId,
          quantidade: Number(l.quantidade),
          custoUnitario: l.custoUnitario ? Number(l.custoUnitario) : undefined,
        })),
      });
      toast.success('Lista de compras criada.');
      setNovo(false); setNome(''); setLinhas({}); setFiltro('');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar');
    } finally {
      setBusy(false);
    }
  }

  // Receber deixou de ser um `confirm()`: a quantidade PEDIDA entrava no estoque
  // mesmo quando chegava outra coisa. Agora abre a conferência do que chegou.
  async function abrirConferencia(id: string) {
    try {
      const l: any = await api.compraLista(id);
      const inicial: Record<string, Conf> = {};
      for (const it of l.itens ?? []) {
        inicial[it.id] = {
          qtdRecebida: String(it.quantidade ?? ''), // parte-se do pedido; corrige quem confere
          validade: '',
          // Memória por insumo: como ele foi conferido da última vez. A decisão
          // continua na tela para ser confirmada — só não se redigita.
          indefinida: !!it.sugestao?.validadeIndefinida,
          loteCodigo: '',
        };
      }
      setConf(inicial);
      setConferindo(l);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao abrir a conferência');
    }
  }

  function setConfLinha(id: string, patch: Partial<Conf>) {
    setConf((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  }

  async function confirmarConferencia() {
    const itens = conferindo?.itens ?? [];
    const pendente = itens.find((it: any) => {
      const c = conf[it.id];
      return !c || !(Number(c.qtdRecebida) >= 0) || (!c.validade && !c.indefinida);
    });
    if (pendente) {
      toast.error(`Confira "${pendente.nome}": quantidade recebida e validade (ou indefinida).`);
      return;
    }
    setBusy(true);
    try {
      await api.receberCompra(conferindo.id, {
        itens: itens.map((it: any) => ({
          compraItemId: it.id,
          qtdRecebida: Number(conf[it.id].qtdRecebida),
          validade: conf[it.id].indefinida ? undefined : conf[it.id].validade,
          validadeIndefinida: conf[it.id].indefinida || undefined,
          loteCodigo: conf[it.id].loteCodigo.trim() || undefined,
        })),
      });
      toast.success('Compra conferida e recebida — estoque atualizado.');
      setConferindo(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao receber');
    } finally {
      setBusy(false);
    }
  }

  const visiveis = itens.filter((i) =>
    !filtro.trim() || i.nome.toLowerCase().includes(filtro.trim().toLowerCase()),
  );
  const nSel = Object.keys(linhas).length;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold">Compras</h2>
        {!novo && (
          <Button size="sm" onClick={() => setNovo(true)}>
            <Plus className="h-4 w-4" /> Gerar lista
          </Button>
        )}
      </div>

      {novo && (
        <Card className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Nome da lista</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Compra da semana" />
            </div>
            <div className="space-y-1.5">
              <Label>Fornecedor</Label>
              <Select value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
                <option value="">— sem fornecedor —</option>
                {fornecedores.map((f) => (<option key={f.id} value={f.id}>{f.nome}</option>))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Data de recebimento</Label>
              <Input type="date" value={dataRecebimento} onChange={(e) => setDataRecebimento(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Delegar recebimento a (opcional)</Label>
              <Select value={delegadoId} onChange={(e) => setDelegadoId(e.target.value)}>
                <option value="">— ninguém —</option>
                {colabs.map((c) => (<option key={c.id} value={c.id}>{c.nome}</option>))}
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Produtos ({nSel} selecionado(s))</Label>
            <Button type="button" size="sm" variant="outline" onClick={sugerir}>
              <Sparkles className="h-4 w-4" /> Sugerir do estoque baixo
            </Button>
          </div>
          <Input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="🔎 filtrar produtos…" className="h-9" />
          <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
            {visiveis.length === 0 && <p className="text-xs text-muted-foreground">Nenhum produto.</p>}
            {visiveis.map((i) => {
              const l = linhas[i.id];
              return (
                <div key={i.id} className="flex items-center gap-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!l} onChange={() => toggle(i.id)} className="h-4 w-4 accent-primary" />
                    <span className="truncate">{i.nome} <span className="text-xs text-muted-foreground">({i.saldo} {i.unidadeMedida})</span></span>
                  </label>
                  {l && (
                    <>
                      <Input type="number" inputMode="decimal" value={l.quantidade} placeholder="qtd" className="h-9 w-20"
                        onChange={(e) => setLinha(i.id, { quantidade: e.target.value })} />
                      <Input type="number" inputMode="decimal" value={l.custoUnitario} placeholder="R$/un" className="h-9 w-20"
                        onChange={(e) => setLinha(i.id, { custoUnitario: e.target.value })} />
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={enviarKds} onChange={(e) => setEnviarKds(e.target.checked)} className="h-4 w-4 accent-primary" />
              Avisar no KDS ao receber
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={enviarDashboard} onChange={(e) => setEnviarDashboard(e.target.checked)} className="h-4 w-4 accent-primary" />
              Avisar no dashboard
            </label>
          </div>

          <div className="flex gap-2">
            <Button type="button" className="flex-1" disabled={busy} onClick={criar}>Criar lista</Button>
            <Button type="button" variant="outline" onClick={() => setNovo(false)}>Cancelar</Button>
          </div>
        </Card>
      )}

      {conferindo && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display font-semibold">Conferir: {conferindo.nome}</h3>
              <p className="text-xs text-muted-foreground">
                Confira o que realmente chegou. Só a quantidade recebida entra no estoque.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setConferindo(null)}>
              Cancelar
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Conferência dos itens da compra</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-1.5 pr-2 font-medium">Item</th>
                  <th className="pb-1.5 pr-2 font-medium">Pedido</th>
                  <th className="pb-1.5 pr-2 font-medium">Recebido *</th>
                  <th className="pb-1.5 pr-2 font-medium">Validade *</th>
                  <th className="pb-1.5 pr-2 font-medium">Lote</th>
                </tr>
              </thead>
              <tbody>
                {(conferindo.itens ?? []).map((it: any) => {
                  const c = conf[it.id];
                  if (!c) return null;
                  const pedida = Number(it.quantidade);
                  const rec = Number(c.qtdRecebida);
                  const difere = c.qtdRecebida !== '' && rec !== pedida;
                  return (
                    <tr key={it.id} className="border-t border-border align-top">
                      <td className="py-2 pr-2">
                        <span className="font-medium">{it.nome}</span>
                        <span className="text-xs text-muted-foreground"> {it.unidadeMedida}</span>
                      </td>
                      <td className="py-2 pr-2 tabular-nums text-muted-foreground">{pedida}</td>
                      <td className="py-2 pr-2">
                        <Input type="number" inputMode="decimal" className={`h-9 w-24 ${difere ? 'border-warn' : ''}`}
                          value={c.qtdRecebida} aria-label={`Quantidade recebida de ${it.nome}`}
                          onChange={(e) => setConfLinha(it.id, { qtdRecebida: e.target.value })} />
                        {difere && (
                          <p className="mt-0.5 text-[11px] text-warn">
                            {rec === 0 ? 'não veio' : rec < pedida ? 'veio menos' : 'veio mais'}
                          </p>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <Input type="date" className="h-9 w-40" value={c.validade} disabled={c.indefinida}
                          aria-label={`Validade de ${it.nome}`}
                          onChange={(e) => setConfLinha(it.id, { validade: e.target.value })} />
                        <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={c.indefinida}
                            onChange={(e) => setConfLinha(it.id, { indefinida: e.target.checked, validade: '' })} />
                          sem validade
                        </label>
                      </td>
                      <td className="py-2 pr-2">
                        <Input className="h-9 w-32" value={c.loteCodigo} placeholder="opcional"
                          aria-label={`Código do lote de ${it.nome}`}
                          onChange={(e) => setConfLinha(it.id, { loteCodigo: e.target.value })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            O código do lote é opcional, mas é ele que permite separar a mercadoria numa
            troca ou num recall sem abrir embalagem.
          </p>
          <Button type="button" className="w-full" disabled={busy} onClick={confirmarConferencia}>
            Confirmar recebimento
          </Button>
        </Card>
      )}

      {listas.length === 0 && !novo && (
        <Card className="p-6 text-center text-sm text-muted-foreground">Nenhuma lista de compras.</Card>
      )}
      {listas.map((l) => (
        <Card key={l.id} className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              {l.nome}
              {l.status === 'recebida'
                ? <Badge className="bg-ok/10 text-ok">recebida</Badge>
                : <Badge className="bg-warn/10 text-warn">aguardando</Badge>}
            </p>
            <p className="text-xs text-muted-foreground">
              {l.fornecedorNome ? `${l.fornecedorNome} · ` : ''}
              {l.itens} item(ns)
              {l.dataRecebimento ? ` · receber ${l.dataRecebimento}` : ''}
              {l.delegadoNome ? ` · ${l.delegadoNome}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {l.status !== 'recebida' && (
              <Button size="sm" onClick={() => abrirConferencia(l.id)}>Conferir e receber</Button>
            )}
            <Button type="button" variant="ghost" size="icon" aria-label="Remover lista" className="text-destructive"
              onClick={async () => { if (confirm('Remover esta lista?')) { await api.removerCompraLista(l.id); reload(); } }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      ))}
    </section>
  );
}
