'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

const ESTADO: Record<string, string> = {
  rascunho: 'bg-slate-100 text-slate-700',
  vigente: 'bg-emerald-100 text-emerald-700',
  arquivado: 'bg-slate-100 text-slate-500',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DocumentoCard({ doc, onChanged }: { doc: any; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');

  async function publicar() {
    setBusy(true);
    setErro('');
    setMsg('');
    try {
      await api.post(`/documentos/${doc.id}/publicar`, {});
      onChanged();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  async function ciencia() {
    setBusy(true);
    setErro('');
    setMsg('');
    try {
      await api.post(`/documentos/${doc.id}/ciencia`, {});
      setMsg('Ciência registrada ✓');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium">{doc.titulo}</p>
          <p className="text-xs capitalize text-muted-foreground">{doc.tipo}</p>
        </div>
        <Badge className={ESTADO[doc.estado] ?? ESTADO.rascunho}>{doc.estado}</Badge>
      </div>
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      <div className="flex gap-2">
        {doc.estado !== 'vigente' && (
          <Button type="button" onClick={publicar} disabled={busy}>
            Publicar
          </Button>
        )}
        <Button type="button" variant="outline" onClick={ciencia} disabled={busy}>
          Dar ciência
        </Button>
      </div>
    </Card>
  );
}
