'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* eslint-disable @typescript-eslint/no-explicit-any */
const selectCls = 'h-11 rounded-md border border-input bg-card px-2 text-sm';
const TIPOS = [
  { v: 'dinheiro', l: 'Dinheiro' },
  { v: 'pix', l: 'Pix' },
  { v: 'credito', l: 'Crédito' },
  { v: 'debito', l: 'Débito' },
  { v: 'vr', l: 'Vale-refeição' },
  { v: 'outro', l: 'Outro' },
];

// Cadastro de formas de pagamento (usado pelo PDV e pelo cardápio).
export function FormasPagamentoCard() {
  const [formas, setFormas] = useState<any[]>([]);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('outro');
  const [busy, setBusy] = useState(false);

  async function carregar() {
    setFormas((await api.formasPagamento().catch(() => [])) as any[]);
  }
  useEffect(() => {
    carregar();
  }, []);

  async function adicionar() {
    if (!nome.trim()) return toast.error('Informe o nome.');
    setBusy(true);
    try {
      await api.criarFormaPagamento({ nome: nome.trim(), tipo });
      setNome('');
      setTipo('outro');
      await carregar();
      toast.success('Forma de pagamento adicionada.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao adicionar');
    } finally {
      setBusy(false);
    }
  }

  async function alternar(f: any) {
    try {
      await api.ativarFormaPagamento(f.id, !f.ativo);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    }
  }

  return (
    <Card className="p-4">
      <h2 className="font-display text-sm font-bold">Formas de pagamento</h2>
      <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
        Aparecem no PDV e no cardápio digital. Desative as que não usa.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {formas.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => alternar(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${f.ativo ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground line-through'}`}
            title={f.ativo ? 'Ativa — clique para desativar' : 'Inativa — clique para ativar'}
          >
            {f.nome}
          </button>
        ))}
        {formas.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma cadastrada.</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Cartão Ame, Vale-refeição" className="max-w-[220px]" />
        <select aria-label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={selectCls}>
          {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
        </select>
        <Button type="button" variant="outline" size="sm" onClick={adicionar} disabled={busy}>＋ adicionar</Button>
      </div>
    </Card>
  );
}
