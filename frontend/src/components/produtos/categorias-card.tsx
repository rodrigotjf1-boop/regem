'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';
import { selectCls } from '@/components/produtos/types';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Categorias do catálogo: cadastrar, editar (foto/descrição/disponibilidade),
// excluir e reordenar arrastando. A ordem sem arrastar segue o cadastro.
export function CategoriasCard({
  categorias,
  catNome,
  setCatNome,
  catParent,
  setCatParent,
  onAdd,
  catLabel,
  reload,
  selected,
  onSelect,
}: {
  categorias: any[];
  catNome: string;
  setCatNome: (v: string) => void;
  catParent: string;
  setCatParent: (v: string) => void;
  onAdd: () => void;
  catLabel: (c: any) => string;
  reload: () => Promise<void> | void;
  selected?: string;
  onSelect?: (id: string) => void;
}) {
  // Ordem local (para o arrastar refletir na hora); segue a ordem recebida.
  const ordenadas = useMemo(() => [...categorias].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)), [categorias]);
  const [lista, setLista] = useState<any[]>(ordenadas);
  useEffect(() => setLista(ordenadas), [ordenadas]);

  const [drag, setDrag] = useState<number | null>(null);
  const [editar, setEditar] = useState<any>(null);

  async function soltar(destino: number) {
    if (drag === null || drag === destino) { setDrag(null); return; }
    const nova = [...lista];
    const [item] = nova.splice(drag, 1);
    nova.splice(destino, 0, item);
    setLista(nova);
    setDrag(null);
    try {
      await api.reordenarCategoriasProduto(nova.map((c) => c.id));
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao reordenar');
    }
  }

  async function excluir(c: any) {
    if (!confirm(`Excluir a categoria "${c.nome}"? Os produtos dela ficam sem categoria.`)) return;
    try {
      await api.excluirCategoriaProduto(c.id);
      toast.success('Categoria excluída.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao excluir');
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-2 font-display text-sm font-bold">Categorias</h2>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1 space-y-1">
          <Label className="text-xs">Nova categoria / subcategoria</Label>
          <Input value={catNome} onChange={(e) => setCatNome(e.target.value)} placeholder="Ex.: Bebidas" />
        </div>
        <select className={`${selectCls} w-40`} aria-label="Categoria pai" value={catParent} onChange={(e) => setCatParent(e.target.value)}>
          <option value="">— categoria raiz —</option>
          {categorias.filter((c) => !c.parentId).map((c) => (
            <option key={c.id} value={c.id}>sub de {c.nome}</option>
          ))}
        </select>
        <Button type="button" onClick={onAdd}>Adicionar</Button>
      </div>

      {onSelect && lista.length > 0 && (
        <button
          type="button"
          onClick={() => onSelect('')}
          className={`mt-3 w-full rounded-lg border px-2.5 py-2 text-left text-sm font-medium ${selected ? 'border-border' : 'border-primary bg-primary/5 text-primary'}`}
        >
          Todas as categorias
        </button>
      )}
      {lista.length > 0 && (
        <ul className="mt-1.5 space-y-1.5">
          {lista.map((c, i) => (
            <li
              key={c.id}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => soltar(i)}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${drag === i ? 'opacity-50' : ''} ${selected === c.id ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}
            >
              <span className="cursor-grab select-none text-muted-foreground" title="Arraste para reordenar" aria-hidden>⋮⋮</span>
              {c.imagemRef ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.imagemRef} alt={c.nome} className="h-8 w-8 flex-none rounded-md object-cover" />
              ) : (
                <span className="grid h-8 w-8 flex-none place-items-center rounded-md bg-secondary text-xs text-muted-foreground">🍽</span>
              )}
              <button
                type="button"
                onClick={() => onSelect?.(c.id)}
                className="min-w-0 flex-1 text-left"
                disabled={!onSelect}
              >
                <p className="truncate text-sm font-medium">{catLabel(c)}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {(c.disponibilidade?.length ?? 0) > 0 ? `${c.disponibilidade.length} janela(s) de horário` : 'Sempre visível'}
                  {c.descricao ? ` · ${c.descricao}` : ''}
                </p>
              </button>
              <button type="button" onClick={() => setEditar(c)} className="rounded px-2 py-1 text-xs font-semibold text-primary hover:bg-secondary">Editar</button>
              <button type="button" onClick={() => excluir(c)} className="rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10">Excluir</button>
            </li>
          ))}
        </ul>
      )}

      {editar && (
        <EditarCategoriaModal categoria={editar} onFechar={() => setEditar(null)} onSalvo={async () => { setEditar(null); await reload(); }} />
      )}
    </Card>
  );
}

function EditarCategoriaModal({ categoria, onFechar, onSalvo }: { categoria: any; onFechar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(categoria.nome ?? '');
  const [descricao, setDescricao] = useState(categoria.descricao ?? '');
  const [imagemRef, setImagemRef] = useState(categoria.imagemRef ?? '');
  const [janelas, setJanelas] = useState<any[]>(Array.isArray(categoria.disponibilidade) ? categoria.disponibilidade : []);
  const [busy, setBusy] = useState(false);

  function addJanela() { setJanelas((j) => [...j, { dias: [], inicio: '00:00', fim: '23:59' }]); }
  function upJanela(i: number, patch: any) { setJanelas((j) => j.map((x, k) => (k === i ? { ...x, ...patch } : x))); }
  function toggleDia(i: number, d: number) {
    setJanelas((j) => j.map((x, k) => (k === i ? { ...x, dias: x.dias.includes(d) ? x.dias.filter((y: number) => y !== d) : [...x.dias, d] } : x)));
  }

  async function salvar() {
    if (!nome.trim()) { toast.error('Informe o nome.'); return; }
    setBusy(true);
    try {
      await api.atualizarCategoriaProduto(categoria.id, {
        nome: nome.trim(),
        descricao,
        imagemRef,
        disponibilidade: janelas.filter((j) => (j.dias ?? []).length > 0),
      });
      toast.success('Categoria salva.');
      onSalvo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onClick={onFechar}>
      <Card className="max-h-[85vh] w-full max-w-md overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-display text-base font-bold">Editar categoria</h3>
          <button type="button" onClick={onFechar} className="ml-auto text-sm text-muted-foreground hover:underline">Fechar ✕</button>
        </div>

        <div className="flex gap-3">
          <ImageUpload value={imagemRef} onChange={setImagemRef} id={`cat-${categoria.id}`} alt="Categoria" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descrição</Label>
              <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Opcional" className="min-h-[52px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <Label className="text-xs">Disponibilidade</Label>
            <button type="button" onClick={addJanela} className="text-xs font-semibold text-primary">＋ janela</button>
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">Sem janelas = categoria sempre visível no cardápio.</p>
          <div className="space-y-2">
            {janelas.map((j, i) => (
              <div key={i} className="rounded-lg border border-border p-2.5">
                <div className="flex flex-wrap gap-1">
                  {DIAS.map((d, di) => (
                    <button key={di} type="button" onClick={() => toggleDia(i, di)}
                      className={`rounded px-2 py-1 text-[11px] font-semibold ${j.dias.includes(di) ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                      {d}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">de</span>
                  <input type="time" aria-label="Início" value={j.inicio} onChange={(e) => upJanela(i, { inicio: e.target.value })} className="rounded border border-input bg-card px-2 py-1 text-sm" />
                  <span className="text-muted-foreground">até</span>
                  <input type="time" aria-label="Fim" value={j.fim} onChange={(e) => upJanela(i, { fim: e.target.value })} className="rounded border border-input bg-card px-2 py-1 text-sm" />
                  <button type="button" onClick={() => setJanelas((jj) => jj.filter((_, k) => k !== i))} className="ml-auto text-xs text-destructive">remover</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Button type="button" className="mt-5 w-full" disabled={busy} onClick={salvar}>{busy ? 'Salvando…' : 'Salvar categoria'}</Button>
      </Card>
    </div>
  );
}
