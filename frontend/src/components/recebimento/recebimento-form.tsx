'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { ImageUpload } from '@/components/ui/image-upload';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Item = { id: string; nome: string; unidadeMedida?: string };
type Fornecedor = { id: string; nome: string };
type Linha = {
  itemId: string;
  qtdEsperada: string;
  qtdRecebida: string;
  divergencia: string;
  validade: string;
  obs: string;
};

const DIVERGENCIAS = [
  { value: 'ok', label: 'OK' },
  { value: 'parcial', label: 'Parcial / faltou' },
  { value: 'nao_veio', label: 'Não veio' },
  { value: 'danificado', label: 'Danificado' },
  { value: 'excedente', label: 'Excedente' },
];

function sugere(esp: string, rec: string) {
  const e = Number(esp || 0);
  const r = Number(rec || 0);
  if (e > 0 && r === 0) return 'nao_veio';
  if (e > 0 && r < e) return 'parcial';
  if (e > 0 && r > e) return 'excedente';
  return 'ok';
}

function linhaVazia(itens: Item[]): Linha {
  return {
    itemId: itens[0]?.id ?? '',
    qtdEsperada: '',
    qtdRecebida: '',
    divergencia: 'ok',
    validade: '',
    obs: '',
  };
}

export function RecebimentoForm({
  fornecedores,
  itens,
  onCreated,
  onCancel,
}: {
  fornecedores: Fornecedor[];
  itens: Item[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [fornecedorId, setFornecedorId] = useState('');
  const [data, setData] = useState(hoje);
  const [notaRef, setNotaRef] = useState('');
  const [notaFotoRef, setNotaFotoRef] = useState('');
  const [obs, setObs] = useState('');
  const [linhas, setLinhas] = useState<Linha[]>([linhaVazia(itens)]);
  const [erro, setErro] = useState('');
  const [saving, setSaving] = useState(false);

  function setLinha(i: number, patch: Partial<Linha>) {
    setLinhas((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setSaving(true);
    try {
      const validas = linhas.filter((l) => l.itemId);
      if (validas.length === 0) throw new Error('Adicione ao menos um item.');
      await api.criarRecebimento({
        fornecedorId: fornecedorId || undefined,
        data,
        notaRef: notaRef || undefined,
        notaFotoRef: notaFotoRef || undefined,
        obs: obs || undefined,
        itens: validas.map((l) => ({
          itemId: l.itemId,
          qtdEsperada: l.qtdEsperada ? Number(l.qtdEsperada) : 0,
          qtdRecebida: l.qtdRecebida ? Number(l.qtdRecebida) : 0,
          divergencia: l.divergencia,
          validade: l.validade || undefined,
          obs: l.obs || undefined,
        })),
      });
      onCreated();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={salvar} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fr">Fornecedor</Label>
            <Select
              id="fr"
              value={fornecedorId}
              onChange={(e) => setFornecedorId(e.target.value)}
            >
              <option value="">— sem fornecedor —</option>
              {fornecedores.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dt">Data</Label>
            <Input
              id="dt"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nr">Nº / identificação da nota</Label>
            <Input
              id="nr"
              value={notaRef}
              onChange={(e) => setNotaRef(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Foto da nota</Label>
            <ImageUpload value={notaFotoRef} onChange={setNotaFotoRef} />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Conferência de itens</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setLinhas((ls) => [...ls, linhaVazia(itens)])}
            >
              <Plus className="h-4 w-4" /> Item
            </Button>
          </div>

          {itens.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Cadastre itens de estoque primeiro (seção Estoque abaixo).
            </p>
          )}

          {linhas.map((l, i) => (
            <div
              key={i}
              className="space-y-2 rounded-lg border border-border p-3"
            >
              <div className="flex items-center gap-2">
                <Select
                  value={l.itemId}
                  onChange={(e) => setLinha(i, { itemId: e.target.value })}
                >
                  {itens.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.nome}
                      {it.unidadeMedida ? ` (${it.unidadeMedida})` : ''}
                    </option>
                  ))}
                </Select>
                {linhas.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remover item"
                    onClick={() =>
                      setLinhas((ls) => ls.filter((_, idx) => idx !== i))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs">Esperado</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={l.qtdEsperada}
                    onChange={(e) =>
                      setLinha(i, {
                        qtdEsperada: e.target.value,
                        divergencia: sugere(e.target.value, l.qtdRecebida),
                      })
                    }
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Recebido</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={l.qtdRecebida}
                    onChange={(e) =>
                      setLinha(i, {
                        qtdRecebida: e.target.value,
                        divergencia: sugere(l.qtdEsperada, e.target.value),
                      })
                    }
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Divergência</Label>
                  <Select
                    value={l.divergencia}
                    onChange={(e) => setLinha(i, { divergencia: e.target.value })}
                  >
                    {DIVERGENCIAS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Validade</Label>
                  <Input
                    type="date"
                    value={l.validade}
                    onChange={(e) => setLinha(i, { validade: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ob">Observações</Label>
          <Input
            id="ob"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="Opcional"
          />
        </div>

        {erro && (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar recebimento (rascunho)'}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Salvar cria um rascunho. O estoque só é atualizado ao{' '}
          <strong>confirmar</strong> o recebimento na lista.
        </p>
      </form>
    </Card>
  );
}
