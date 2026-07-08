'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api, getCategoria } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ESTADO: Record<string, { label: string; cls: string }> = {
  rascunho: { label: 'Rascunho', cls: 'bg-secondary text-muted-foreground' },
  pendente_aprovacao: {
    label: 'Aguardando aprovação',
    cls: 'bg-warn/10 text-warn',
  },
  vigente: { label: 'Vigente', cls: 'bg-ok/10 text-ok' },
  arquivado: { label: 'Arquivado', cls: 'bg-secondary text-muted-foreground' },
};

export function ChecklistCard({
  cl,
  onChanged,
}: {
  cl: any;
  onChanged: () => void;
}) {
  const [descricao, setDescricao] = useState('');
  const [procedimento, setProcedimento] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const cat = getCategoria();
  const gestor = cat === 'presidente' || cat === 'gerente';
  const itens: any[] = cl.itens ?? [];
  const st = ESTADO[cl.estado] ?? ESTADO.rascunho;

  async function acao(fn: () => Promise<unknown>) {
    setBusy(true);
    setErro('');
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  async function addItem() {
    if (descricao.trim().length < 2) {
      setErro('Descreva o item (mín. 2 caracteres).');
      return;
    }
    await acao(async () => {
      await api.post(`/checklists/${cl.id}/itens`, {
        descricao,
        procedimento: procedimento || undefined,
        ordem: itens.length,
      });
      setDescricao('');
      setProcedimento('');
    });
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{cl.nome}</p>
        <Badge className={st.cls}>{st.label}</Badge>
      </div>

      {/* Itens */}
      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum item ainda. Adicione os passos que virarão o POP.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {itens.map((it, idx) => (
            <li key={it.id} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded bg-secondary font-mono text-[11px] font-bold text-muted-foreground">
                {idx + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p>{it.descricao}</p>
                {it.procedimento && (
                  <p className="text-xs text-muted-foreground">
                    {it.procedimento}
                  </p>
                )}
              </div>
              {cl.estado !== 'vigente' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remover item"
                  disabled={busy}
                  onClick={() =>
                    acao(() => api.del(`/checklists/itens/${it.id}`))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}

      {/* Adicionar item (só enquanto não vigente) */}
      {cl.estado !== 'vigente' && (
        <div className="space-y-2 rounded-md border border-border p-2">
          <Input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Item do checklist (ex.: Higienizar bancadas)"
          />
          <Input
            value={procedimento}
            onChange={(e) => setProcedimento(e.target.value)}
            placeholder="Como fazer (vira o passo do POP) — opcional"
          />
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={addItem}
            disabled={busy}
          >
            Adicionar item
          </Button>
        </div>
      )}

      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}

      {/* Fluxo de aprovação por perfil */}
      {cl.estado === 'rascunho' && !gestor && (
        <Button
          type="button"
          className="w-full"
          disabled={busy || itens.length === 0}
          onClick={() => acao(() => api.post(`/checklists/${cl.id}/submeter`, {}))}
        >
          Submeter para aprovação
        </Button>
      )}
      {(cl.estado === 'rascunho' || cl.estado === 'pendente_aprovacao') &&
        gestor && (
          <Button
            type="button"
            className="w-full"
            disabled={busy || itens.length === 0}
            onClick={() => acao(() => api.post(`/checklists/${cl.id}/publicar`, {}))}
          >
            Publicar (gera POP)
          </Button>
        )}
      {cl.estado === 'pendente_aprovacao' && !gestor && (
        <p className="text-center text-sm text-muted-foreground">
          Aguardando aprovação do gestor.
        </p>
      )}
    </Card>
  );
}
