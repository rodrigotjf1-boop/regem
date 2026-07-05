'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { selectCls } from '@/components/produtos/types';
import { GrupoComplemento } from '@/components/produtos/grupo-complemento';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function ComplementosCard({
  comps,
  fichaIngs,
  insumos,
  produtos,
  novoGrupo,
  setNovoGrupo,
  onAddOpcao,
  onDelGrupo,
  onDelOpcao,
  onAddGrupo,
}: {
  comps: any[];
  fichaIngs: any[];
  insumos: any[];
  produtos: any[];
  novoGrupo: { nome: string; tipo: string };
  setNovoGrupo: (fn: (s: { nome: string; tipo: string }) => { nome: string; tipo: string }) => void;
  onAddOpcao: (grupo: any, dados: any) => void;
  onDelGrupo: (id: string) => void;
  onDelOpcao: (id: string) => void;
  onAddGrupo: () => void;
}) {
  return (
    <Card className="p-4">
      <h2 className="font-display text-lg font-semibold">Opcionais & adicionais</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        <b>Opcional (retirar):</b> cliente pede “sem cebola” — não dá baixa naquele ingrediente da ficha.{' '}
        <b>Adicional (extra):</b> “+ bacon” — soma preço e dá baixa no insumo.
      </p>

      <div className="space-y-3">
        {comps.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum grupo. Crie um abaixo.</p>
        )}
        {comps.map((g) => (
          <GrupoComplemento
            key={g.id}
            grupo={g}
            fichaIngs={fichaIngs}
            insumos={insumos}
            produtos={produtos}
            onAddOpcao={onAddOpcao}
            onDelGrupo={onDelGrupo}
            onDelOpcao={onDelOpcao}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-3">
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Novo grupo</Label>
          <Input
            value={novoGrupo.nome}
            onChange={(e) => setNovoGrupo((s) => ({ ...s, nome: e.target.value }))}
            placeholder="Ex.: Remover ingredientes / Adicionais"
          />
        </div>
        <select
          aria-label="Tipo do grupo de complementos"
          className={`${selectCls} w-44`}
          value={novoGrupo.tipo}
          onChange={(e) => setNovoGrupo((s) => ({ ...s, tipo: e.target.value }))}
        >
          <option value="remover">Opcional (retirar)</option>
          <option value="adicionar">Adicional (extra)</option>
          <option value="escolha">Escolha (etapa — escolher 1/N)</option>
        </select>
        <Button type="button" onClick={onAddGrupo}>Adicionar grupo</Button>
      </div>
    </Card>
  );
}
