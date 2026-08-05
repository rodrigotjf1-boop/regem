'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, Pencil, Trash2, Plus } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function UnidadesPage() {
  const router = useRouter();
  const [lista, setLista] = useState<any[] | null>(null);
  const [editar, setEditar] = useState<any | null>(null); // objeto em edição (ou {} para nova)

  const carregar = useCallback(async () => {
    setLista(((await api.unidades().catch(() => [])) as any[]) ?? []);
  }, []);
  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    carregar();
  }, [carregar, router]);

  async function remover(u: any) {
    if (!confirm(`Remover a unidade "${u.nome}"? Só é possível se não houver setores, turnos ou janelas nela.`)) return;
    try {
      await api.removerUnidade(u.id);
      toast.success('Unidade removida.');
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao remover');
    }
  }

  return (
    <Shell eyebrow="Configurações" title="Unidades">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            As lojas da sua rede. Cada colaborador, setor, turno e venda pertence a uma unidade.
          </p>
          <Button type="button" onClick={() => setEditar({})} className="gap-1.5">
            <Plus className="h-4 w-4" /> Nova unidade
          </Button>
        </div>

        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Unidades da rede</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Unidade</th>
                  <th className="px-4 py-3 font-medium">Endereço</th>
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {lista === null && (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">Carregando…</td></tr>
                )}
                {lista?.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                    Nenhuma unidade ainda. Cadastre a primeira loja da rede.
                  </td></tr>
                )}
                {lista?.map((u) => (
                  <tr key={u.id} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-medium">
                        <Building2 className="h-4 w-4 text-primary" /> {u.nome}
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${u.tipo === 'matriz' ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                          {u.tipo === 'matriz' ? 'Matriz' : 'Filial'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{u.endereco || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={() => setEditar(u)} className="rounded-md border border-border p-1.5 hover:bg-secondary" aria-label={`Editar ${u.nome}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => remover(u)} className="rounded-md border border-border p-1.5 text-destructive hover:bg-destructive/10" aria-label={`Remover ${u.nome}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {editar && <ModalUnidade item={editar} onClose={() => setEditar(null)} onSaved={() => { setEditar(null); carregar(); }} />}
    </Shell>
  );
}

function ModalUnidade({ item, onClose, onSaved }: { item: any; onClose: () => void; onSaved: () => void }) {
  const [nome, setNome] = useState<string>(item.nome ?? '');
  const [tipo, setTipo] = useState<string>(item.tipo ?? 'filial');
  const [endereco, setEndereco] = useState<string>(item.endereco ?? '');
  const [salvando, setSalvando] = useState(false);
  const novo = !item.id;

  async function salvar() {
    if (nome.trim().length < 2) return toast.error('Informe o nome da unidade (mín. 2 letras).');
    setSalvando(true);
    try {
      const body = { nome: nome.trim(), tipo, endereco: endereco.trim() || undefined };
      if (novo) await api.criarUnidade(body);
      else await api.atualizarUnidade(item.id, body);
      toast.success(novo ? 'Unidade criada.' : 'Unidade atualizada.');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md space-y-4 p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-base font-bold">{novo ? 'Nova unidade' : 'Editar unidade'}</h2>
        <div className="space-y-1.5">
          <Label className="text-xs">Nome da unidade</Label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Matriz, Filial Centro" autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Tipo</Label>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-card px-2 text-sm"
            aria-label="Tipo da unidade"
          >
            <option value="matriz">Matriz</option>
            <option value="filial">Filial</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Endereço (opcional)</Label>
          <Input value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número — bairro, cidade" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </Card>
    </div>
  );
}
