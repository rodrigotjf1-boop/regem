'use client';

import { useState } from 'react';
import { ArrowLeft, Pencil, Trash2, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { EntityForm, type FieldDef } from '@/components/cadastros/entity-form';
import { type Secao } from '@/components/cadastros/build-secoes';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Converte o valor da linha no defaultValue (string) que o EntityForm espera.
function toDefault(field: FieldDef, row: any): string {
  if (field.fromRow) return field.fromRow(row);
  const val = row[field.name];
  if (Array.isArray(val)) return val.join(',');
  if (typeof val === 'boolean') return val ? '1' : '';
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (field.type === 'time') return s.slice(0, 5);
  if (field.type === 'date') return s.slice(0, 10);
  return s;
}

// Detalhe de uma seção: cadastro + lista dos itens já cadastrados (editar/excluir).
export function SecaoDetalhe({
  sec,
  ver,
  onBack,
  reload,
}: {
  sec: Secao;
  ver: number;
  onBack: () => void;
  reload: () => Promise<void>;
}) {
  const [editId, setEditId] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const rows: any[] = sec.rows ?? [];
  const label = sec.rowLabel ?? ((r: any) => r.nome ?? r.id);
  const podeEditar = !!sec.update;
  const podeExcluir = !!sec.remove;

  async function excluir(r: any) {
    if (!sec.remove) return;
    if (!confirm(`Excluir "${label(r)}"? Esta ação não pode ser desfeita.`)) {
      return;
    }
    setErro('');
    setExcluindo(r.id);
    try {
      await sec.remove(r.id);
      await reload();
      toast.success(`"${label(r)}" excluído.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao excluir';
      setErro(msg);
      // Toast além do texto: o aviso fica acima da lista e passava despercebido
      // quando o formulário empurrava a mensagem para fora da tela.
      toast.error(msg);
    } finally {
      setExcluindo(null);
    }
  }

  function editFields(row: any): FieldDef[] {
    return sec.fields
      .filter((f) => !(sec.editHide ?? []).includes(f.name))
      .map((f) => ({ ...f, defaultValue: toDefault(f, row) }));
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Cadastros
      </button>

      <Card className="p-4">
        <h2 className="mb-3 font-display text-lg font-semibold">{sec.titulo}</h2>
        <EntityForm
          key={`${sec.key}-${ver}`}
          fields={sec.fields}
          submitLabel="Adicionar"
          onSubmit={async (v) => {
            await sec.submit(v);
            await reload();
            toast.success('Cadastro salvo.');
          }}
        />
      </Card>

      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}

      {rows.length > 0 && (
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            Cadastrados ({rows.length})
          </p>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-border p-2.5"
              >
                {editId === r.id && podeEditar ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Editando</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditId(null)}
                      >
                        <X className="h-4 w-4" /> Cancelar
                      </Button>
                    </div>
                    <EntityForm
                      key={`edit-${r.id}-${ver}`}
                      fields={editFields(r)}
                      submitLabel="Salvar alterações"
                      onSubmit={async (v) => {
                        await sec.update!(r.id, v);
                        setEditId(null);
                        await reload();
                        toast.success('Alterações salvas.');
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm">{label(r)}</span>
                    <div className="flex flex-none items-center gap-1">
                      {podeEditar && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Editar"
                          onClick={() => {
                            setErro('');
                            setEditId(r.id);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {podeExcluir && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Excluir"
                          disabled={excluindo === r.id}
                          onClick={() => excluir(r)}
                        >
                          {excluindo === r.id ? (
                            <span className="text-xs">…</span>
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
