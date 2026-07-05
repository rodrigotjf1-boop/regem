'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { brl, selectCls } from '@/components/produtos/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Um grupo de complementos + suas opções + formulário de nova opção.
export function GrupoComplemento({
  grupo,
  fichaIngs,
  insumos,
  produtos,
  onAddOpcao,
  onDelGrupo,
  onDelOpcao,
}: {
  grupo: any;
  fichaIngs: any[];
  insumos: any[];
  produtos: any[];
  onAddOpcao: (grupo: any, dados: any) => void;
  onDelGrupo: (id: string) => void;
  onDelOpcao: (id: string) => void;
}) {
  const remover = grupo.tipo === 'remover';
  const escolha = grupo.tipo === 'escolha';
  const badge = remover ? 'retirar' : escolha ? 'escolher' : 'adicionar';
  const [nome, setNome] = useState('');
  const [precoDelta, setPrecoDelta] = useState('');
  const [ref, setRef] = useState(''); // fichaIngredienteId (remover) / itemId (adicionar) / produtoRefId (escolha)
  const [quantidade, setQuantidade] = useState('1');

  function submit() {
    if (!nome.trim() && !ref) return;
    const dados: any = { nome: nome.trim() };
    if (remover) {
      dados.fichaIngredienteId = ref || undefined;
      if (!dados.nome && ref) {
        const ing = fichaIngs.find((i) => i.id === ref);
        dados.nome = ing?.insumoNome ?? ing?.subFichaNome ?? 'ingrediente';
      }
    } else if (escolha) {
      dados.precoDelta = precoDelta !== '' ? Number(String(precoDelta).replace(',', '.')) : 0;
      dados.produtoRefId = ref || undefined;
      if (!dados.nome && ref) dados.nome = produtos.find((p) => p.id === ref)?.nome ?? 'opção';
    } else {
      dados.precoDelta = precoDelta !== '' ? Number(String(precoDelta).replace(',', '.')) : 0;
      dados.itemId = ref || undefined;
      dados.quantidade = Number(String(quantidade).replace(',', '.')) || 1;
    }
    onAddOpcao(grupo, dados);
    setNome('');
    setPrecoDelta('');
    setRef('');
    setQuantidade('1');
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">
          {grupo.nome}{' '}
          <span className={`ml-1 rounded px-1.5 py-0.5 text-xs ${remover ? 'bg-warn/10 text-warn' : escolha ? 'bg-primary/10 text-primary' : 'bg-info/10 text-info'}`}>
            {badge}
          </span>
          {(grupo.min > 0 || grupo.max) && (
            <span className="ml-1 text-[11px] text-muted-foreground">
              {grupo.min > 0 ? 'obrigatório · ' : ''}{grupo.max ? `até ${grupo.max}` : ''}
            </span>
          )}
        </span>
        <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => onDelGrupo(grupo.id)}>
          remover grupo
        </Button>
      </div>

      {(grupo.opcoes ?? []).length === 0 && (
        <p className="mb-2 text-xs text-muted-foreground">Sem opções ainda.</p>
      )}
      <div className="mb-2 space-y-1">
        {(grupo.opcoes ?? []).map((o: any) => (
          <div key={o.id} className="flex items-center gap-2 rounded border border-border px-2 py-1 text-sm">
            <span className="flex-1">{o.nome}</span>
            {Number(o.precoDelta) > 0 && (
              <span className="font-mono text-xs text-primary">+ {brl(Number(o.precoDelta))}</span>
            )}
            <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => onDelOpcao(o.id)}>×</Button>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Input placeholder="Nome da opção" value={nome} onChange={(e) => setNome(e.target.value)} />
        {remover ? (
          <select
            aria-label="Ingrediente da ficha a retirar"
            className={`${selectCls} sm:col-span-2`}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          >
            <option value="">— ingrediente da ficha —</option>
            {fichaIngs.map((i) => (
              <option key={i.id} value={i.id}>{i.insumoNome ?? i.subFichaNome ?? 'ingrediente'}</option>
            ))}
          </select>
        ) : escolha ? (
          <>
            <Input type="number" placeholder="+ R$ (opcional)" value={precoDelta} onChange={(e) => setPrecoDelta(e.target.value)} />
            <select
              aria-label="Produto vinculado (opcional)"
              className={selectCls}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            >
              <option value="">— sem produto (só rótulo) —</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </>
        ) : (
          <>
            <Input type="number" placeholder="+ R$" value={precoDelta} onChange={(e) => setPrecoDelta(e.target.value)} />
            <select
              aria-label="Insumo a dar baixa"
              className={selectCls}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            >
              <option value="">— insumo (baixa) —</option>
              {insumos.map((i) => (
                <option key={i.id} value={i.id}>{i.nome}</option>
              ))}
            </select>
            <Input type="number" placeholder="Qtd baixa" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </>
        )}
        <Button type="button" variant="outline" size="sm" onClick={submit}>＋ opção</Button>
      </div>
    </div>
  );
}
