'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Copy, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KebabMenu } from '@/components/ui/kebab-menu';
import { selectCls } from '@/components/produtos/types';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

/* eslint-disable @typescript-eslint/no-explicit-any */

const REGRA_LABEL: Record<string, string> = {
  uma: 'Escolhe 1',
  varias_sem_repeticao: 'Vários (sem repetição)',
  varias_com_repeticao: 'Vários (com repetição)',
};
const CANAIS = [
  { v: 'delivery', l: 'Delivery' },
  { v: 'balcao', l: 'Balcão' },
  { v: 'mesa_publico', l: 'Mesa (público)' },
  { v: 'mesa_interno', l: 'Mesa (interno)' },
];

// Complementos reutilizáveis (etapas): regra de seleção, obrigatório, canais e as
// opções ligadas. Depois são anexados aos produtos (Fase 4).
export function ComplementosCatalogoCard() {
  const [lista, setLista] = useState<any[]>([]);
  const [opcoes, setOpcoes] = useState<any[]>([]);
  const [editar, setEditar] = useState<any>(null);

  const carregar = useCallback(async () => {
    const [c, o] = await Promise.all([
      api.complementosCatalogo().catch(() => []),
      api.opcoesCatalogo().catch(() => []),
    ]);
    setLista(c as any[]);
    setOpcoes(o as any[]);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function excluir(c: any) {
    if (!confirm(`Excluir o complemento "${c.nome}"?`)) return;
    try { await api.excluirComplementoCatalogo(c.id); toast.success('Complemento excluído.'); await carregar(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Erro'); }
  }
  const [sinc, setSinc] = useState(false);
  async function sincronizar() {
    setSinc(true);
    try {
      const r: any = await api.sincronizarComplementosCatalogo();
      const criados = r?.complementosCriados ?? 0;
      const reus = r?.complementosReusados ?? 0;
      toast.success(criados || reus ? `Sincronizado: ${criados} novo(s), ${reus} reaproveitado(s).` : 'Nada novo para sincronizar.');
      await carregar();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao sincronizar'); }
    finally { setSinc(false); }
  }
  async function duplicar(c: any) {
    try {
      await api.criarComplementoCatalogo({
        nome: `${c.nome} (cópia)`,
        regra: c.regra,
        obrigatorio: c.obrigatorio,
        min: c.min,
        max: c.max,
        canais: c.canais ?? [],
        itens: (c.itens ?? []).map((it: any, i: number) => ({ opcaoId: it.opcaoId, preco: it.preco ?? '', ordem: i })),
      });
      toast.success('Complemento duplicado.');
      await carregar();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao duplicar'); }
  }

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-display text-sm font-bold">Complementos (etapas)</h2>
        <span className="font-mono text-xs text-muted-foreground">{lista.length}</span>
        <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={sincronizar} disabled={sinc}>
          {sinc ? 'Sincronizando…' : 'Sincronizar do cardápio'}
        </Button>
        <Button type="button" size="sm" onClick={() => setEditar({})}>＋ Novo complemento</Button>
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">Etapa reutilizável (ex.: “Escolha a bebida”, “Adicionais”). Junta opções e vira etapa nos produtos. Importou o cardápio? Use <strong>Sincronizar do cardápio</strong> para trazer os grupos dos produtos para cá.</p>

      {lista.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhum complemento ainda.</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {lista.map((c) => (
            <li key={c.id} className="rounded-lg border border-border bg-card p-2.5">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{c.nome}</p>
                <KebabMenu
                  label={`Ações de ${c.nome}`}
                  items={[
                    { label: 'Editar', icon: <Pencil className="h-4 w-4" />, onClick: () => setEditar(c) },
                    { label: 'Duplicar', icon: <Copy className="h-4 w-4" />, onClick: () => duplicar(c) },
                    { label: 'Excluir', icon: <Trash2 className="h-4 w-4" />, onClick: () => excluir(c), destructive: true },
                  ]}
                />
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {REGRA_LABEL[c.regra] ?? c.regra}{c.obrigatorio ? ' · obrigatório' : ''} · {(c.itens ?? []).length} opção(ões)
              </p>
              {(c.itens ?? []).length > 0 && (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{(c.itens ?? []).map((i: any) => i.nome).join(', ')}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {editar && (
        <ComplementoModal complemento={editar} opcoes={opcoes} onFechar={() => setEditar(null)} onSalvo={async () => { setEditar(null); await carregar(); }} />
      )}
    </Card>
  );
}

function ComplementoModal({ complemento, opcoes, onFechar, onSalvo }: { complemento: any; opcoes: any[]; onFechar: () => void; onSalvo: () => void }) {
  const novo = !complemento?.id;
  const [nome, setNome] = useState(complemento.nome ?? '');
  const [regra, setRegra] = useState(complemento.regra ?? 'uma');
  const [obrigatorio, setObrigatorio] = useState(complemento.obrigatorio ?? false);
  const [min, setMin] = useState<any>(complemento.min ?? 0);
  const [max, setMax] = useState<any>(complemento.max ?? '');
  const [canais, setCanais] = useState<string[]>(complemento.canais ?? CANAIS.map((c) => c.v));
  const [itens, setItens] = useState<any[]>(
    (complemento.itens ?? []).map((i: any) => ({ opcaoId: i.opcaoId, preco: i.preco ?? '' })),
  );
  const [addId, setAddId] = useState('');
  const [busy, setBusy] = useState(false);
  const varios = regra !== 'uma';

  const nomeOpcao = (id: string) => opcoes.find((o) => o.id === id)?.nome ?? '—';
  function addOpcao() {
    if (!addId || itens.some((i) => i.opcaoId === addId)) return;
    setItens((s) => [...s, { opcaoId: addId, preco: '' }]);
    setAddId('');
  }
  function toggleCanal(v: string) {
    setCanais((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  }

  async function salvar() {
    if (!nome.trim()) { toast.error('Informe o nome.'); return; }
    setBusy(true);
    const body = { nome: nome.trim(), regra, obrigatorio, min, max, canais, itens: itens.map((it, i) => ({ ...it, ordem: i })) };
    try {
      if (novo) await api.criarComplementoCatalogo(body);
      else await api.atualizarComplementoCatalogo(complemento.id, body);
      toast.success('Complemento salvo.');
      onSalvo();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao salvar'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onClick={onFechar}>
      <Card className="max-h-[88vh] w-full max-w-md overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-display text-base font-bold">{novo ? 'Novo complemento' : 'Editar complemento'}</h3>
          <button type="button" onClick={onFechar} className="ml-auto text-sm text-muted-foreground hover:underline">Fechar ✕</button>
        </div>

        <div className="space-y-1"><Label className="text-xs">Nome</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Escolha a bebida" /></div>

        <div className="mt-3 space-y-1">
          <Label className="text-xs">O cliente pode escolher</Label>
          <select className={selectCls} aria-label="Regra de escolha" value={regra} onChange={(e) => setRegra(e.target.value)}>
            <option value="uma">Apenas uma das opções</option>
            <option value="varias_sem_repeticao">Mais de uma (sem repetição)</option>
            <option value="varias_com_repeticao">Mais de uma (com repetição)</option>
          </select>
        </div>

        <div className="mt-2 flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={obrigatorio} onChange={(e) => setObrigatorio(e.target.checked)} />
            Escolha obrigatória
          </label>
          {varios && (
            <div className="ml-auto flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">mín</span>
              <Input type="number" value={min} onChange={(e) => setMin(e.target.value)} className="h-8 w-16" />
              <span className="text-muted-foreground">máx</span>
              <Input type="number" value={max} onChange={(e) => setMax(e.target.value)} className="h-8 w-16" placeholder="—" />
            </div>
          )}
        </div>

        <div className="mt-3">
          <Label className="text-xs">Disponível em</Label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {CANAIS.map((c) => (
              <button key={c.v} type="button" onClick={() => toggleCanal(c.v)}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${canais.includes(c.v) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
                {c.l}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <Label className="text-xs">Opções deste complemento</Label>
          <div className="mt-1 flex gap-1.5">
            <select className={selectCls} aria-label="Adicionar opção" value={addId} onChange={(e) => setAddId(e.target.value)}>
              <option value="">Escolha uma opção…</option>
              {opcoes.filter((o) => !itens.some((i) => i.opcaoId === o.id)).map((o) => (
                <option key={o.id} value={o.id}>{o.nome}</option>
              ))}
            </select>
            <Button type="button" size="sm" variant="outline" onClick={addOpcao} disabled={!addId}>Adicionar</Button>
          </div>
          <ul className="mt-2 space-y-1.5">
            {itens.length === 0 && <li className="text-xs text-muted-foreground">Nenhuma opção ligada ainda.</li>}
            {itens.map((it, i) => (
              <li key={it.opcaoId} className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{nomeOpcao(it.opcaoId)}</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">+R$</span>
                  <Input type="number" value={it.preco} onChange={(e) => setItens((s) => s.map((x, k) => (k === i ? { ...x, preco: e.target.value } : x)))} className="h-8 w-20" placeholder="0,00" />
                </div>
                <button type="button" onClick={() => setItens((s) => s.filter((_, k) => k !== i))} className="text-xs text-destructive">remover</button>
              </li>
            ))}
          </ul>
        </div>

        <Button type="button" className="mt-5 w-full" disabled={busy} onClick={salvar}>{busy ? 'Salvando…' : 'Salvar complemento'}</Button>
      </Card>
    </div>
  );
}
