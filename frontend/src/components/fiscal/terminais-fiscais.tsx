'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';

/* eslint-disable @typescript-eslint/no-explicit-any */

// QUAIS TERMINAIS EMITEM NFC-e.
//
// Numa troca de sistema a loja opera com os dois ao mesmo tempo: um caixa emitindo pelo antigo,
// outro pelo Regem. O terminal desmarcado vende com o comprovante "CUPOM NAO FISCAL", e a mesma
// venda nunca sai com duas notas. Quem muda é presidente ou gerência — o servidor recusa os
// demais —, e cada mudança fica na auditoria.
export function TerminaisFiscais() {
  const [lista, setLista] = useState<any[] | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    try {
      setLista((await api.terminaisFiscais()) as any[]);
      setErro('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar os terminais.');
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function alternar(t: any, emite: boolean) {
    setSalvando(t.id);
    try {
      await api.definirTerminalFiscal(t.id, emite);
      toast.success(emite ? `${t.nome} passa a emitir NFC-e.` : `${t.nome} deixa de emitir NFC-e.`);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(null);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-1 font-display text-sm font-bold">Terminais que emitem NFC-e</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Desmarcado, o terminal vende com o comprovante &ldquo;cupom não fiscal&rdquo; — use durante a troca de
        sistema, para a mesma venda não sair com duas notas. Só presidente e gerência alteram, e cada mudança
        fica registrada.
      </p>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {lista && lista.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum PDV ou totem cadastrado nesta loja.</p>
      )}
      <div className="space-y-2">
        {(lista ?? []).map((t) => (
          <label
            key={t.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
          >
            <span className="min-w-0">
              <span className="font-medium">{t.nome}</span>{' '}
              <span className="text-xs text-muted-foreground">{t.tipo === 'totem' ? 'Totem' : 'PDV'}</span>
            </span>
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={!!t.emiteNfce}
                disabled={salvando === t.id}
                onChange={(e) => alternar(t, e.target.checked)}
                aria-label={`${t.nome} emite NFC-e`}
              />
              <span className="text-xs">{t.emiteNfce ? 'Emite NFC-e' : 'Cupom não fiscal'}</span>
            </span>
          </label>
        ))}
      </div>
    </Card>
  );
}
