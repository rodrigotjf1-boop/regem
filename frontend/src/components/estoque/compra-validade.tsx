'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialogo } from '@/components/ui/sobreposto';
import { num, texto2 } from '@/components/ui/lista';
import { nomeDeCompra } from '@/lib/produto-compra';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Campo = { validade: string; semValidade: boolean; salvando: boolean; feito: boolean };

// "Informar a validade" (P1 de "Pedidos e recebimento", mig 504 — protótipo `mockups/regem-pedidos-recebimento.html`): as
// linhas recebidas com "não sei" ganham a data ou "sem validade", uma por vez (cada uma é uma ação). O lote da linha recebe
// a mesma data no servidor. Fecha sozinho quando não sobra nenhuma.
export function InformarValidade({ lista, voltarPara, aoFechar, aoSalvar }: { lista: any; voltarPara?: string; aoFechar: () => void; aoSalvar: () => void }) {
  const pendentes: any[] = (lista.itens ?? []).filter((it: any) => it.validadePendente);
  const [campos, setCampos] = useState<Record<string, Campo>>(() =>
    Object.fromEntries(pendentes.map((it) => [it.id, { validade: '', semValidade: false, salvando: false, feito: false }])),
  );
  const [erro, setErro] = useState('');
  const mudar = (id: string, patch: Partial<Campo>) => setCampos((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  const faltam = pendentes.filter((it) => !campos[it.id]?.feito).length;

  async function salvar(it: any) {
    const c = campos[it.id];
    if (!c || c.salvando) return;
    if (!c.validade && !c.semValidade) {
      setErro(`Informe a validade de "${nomeDeCompra(it)}", ou marque "sem validade".`);
      return;
    }
    setErro('');
    mudar(it.id, { salvando: true });
    try {
      await api.informarValidadeCompra(lista.id, it.id, c.semValidade ? { validadeIndefinida: true } : { validade: c.validade });
      mudar(it.id, { salvando: false, feito: true });
      toast.success(`Validade de "${nomeDeCompra(it)}" informada.`);
      if (faltam <= 1) aoSalvar();
    } catch (e) {
      mudar(it.id, { salvando: false });
      setErro(e instanceof Error ? e.message : 'Não consegui informar a validade.');
    }
  }

  return (
    <Dialogo titulo={`Informar a validade: ${lista.nome}`} aoFechar={faltam < pendentes.length ? aoSalvar : aoFechar} voltarPara={voltarPara}
      rodape={<Button type="button" variant="outline" onClick={faltam < pendentes.length ? aoSalvar : aoFechar}>Fechar</Button>}>
      <div className="space-y-3 text-sm">
        <p className={texto2}>
          Estes itens entraram no estoque com a validade pendente (alguém marcou “não sei” no recebimento). Informe a data impressa na
          embalagem, ou “sem validade”.
        </p>
        {pendentes.length === 0 && <p>Nenhum item com a validade pendente neste pedido.</p>}
        <ul className="space-y-2">
          {pendentes.map((it) => {
            const c = campos[it.id];
            const titulo = nomeDeCompra(it);
            return (
              <li key={it.id} className={`rounded-lg border border-border p-3 ${c.feito ? 'bg-ok/10' : ''}`}>
                <p className="break-words font-semibold">{titulo}</p>
                <p className={`text-xs ${texto2}`}>
                  Recebido: <span className="font-mono">{num(it.qtdRecebida ?? it.quantidade)}</span> {it.unidadeMedida}
                </p>
                {c.feito ? (
                  <p className="mt-1 text-xs font-bold">✓ Validade informada</p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <Label htmlFor={`informar-validade-${it.id}`} className="text-xs">Validade</Label>
                      <Input id={`informar-validade-${it.id}`} type="date" className="w-44" value={c.validade} disabled={c.semValidade}
                        onChange={(e) => mudar(it.id, { validade: e.target.value })} />
                    </div>
                    <label className={`flex min-h-11 items-center gap-1.5 text-xs ${texto2}`}>
                      <input type="checkbox" className="h-4 w-4 accent-primary" checked={c.semValidade} aria-label={`Sem validade: ${titulo}`}
                        onChange={(e) => mudar(it.id, { semValidade: e.target.checked, validade: '' })} />
                      sem validade
                    </label>
                    <Button type="button" size="sm" onClick={() => salvar(it)} disabled={c.salvando}>{c.salvando ? 'Salvando…' : 'Salvar'}</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}
