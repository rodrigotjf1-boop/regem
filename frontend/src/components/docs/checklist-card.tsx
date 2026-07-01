'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

const ESTADO: Record<string, string> = {
  rascunho: 'bg-slate-100 text-slate-700',
  pendente_aprovacao: 'bg-amber-100 text-amber-800',
  vigente: 'bg-emerald-100 text-emerald-700',
  arquivado: 'bg-slate-100 text-slate-500',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ChecklistCard({ cl, onChanged }: { cl: any; onChanged: () => void }) {
  const [item, setItem] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');

  async function addItem() {
    if (!item.trim()) return;
    setBusy(true);
    setErro('');
    try {
      await api.post(`/checklists/${cl.id}/itens`, { descricao: item });
      setItem('');
      onChanged();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  async function publicar() {
    setBusy(true);
    setErro('');
    try {
      await api.post(`/checklists/${cl.id}/publicar`, {});
      onChanged();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{cl.nome}</p>
        <Badge className={ESTADO[cl.estado] ?? ESTADO.rascunho}>{cl.estado}</Badge>
      </div>
      <div className="flex gap-2">
        <Input
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder="Novo item do checklist"
        />
        <Button type="button" variant="outline" onClick={addItem} disabled={busy}>
          Add
        </Button>
      </div>
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      {cl.estado !== 'vigente' && (
        <Button type="button" className="w-full" onClick={publicar} disabled={busy}>
          Publicar (gera POP)
        </Button>
      )}
    </Card>
  );
}
