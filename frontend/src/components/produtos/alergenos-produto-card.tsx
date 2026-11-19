'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Selo } from '@/components/ui/lista';
import { AlergenosProdutoGaveta, ResumoParaOCliente, type AlergenosDoProdutoLinha } from './alergenos-produto-gaveta';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O cartão "Alérgenos" no produto do cardápio (mig 454, D2): a situação e o resumo de como fica para o cliente, com o
// "Marcar alérgenos" que abre a mesma gaveta da conferência (Cadastros › Cardápio › Alérgenos).
export function AlergenosProdutoCard({ produtoId }: { produtoId: string }) {
  const [p, setP] = useState<AlergenosDoProdutoLinha | null>(null);
  const [erro, setErro] = useState(false);
  const [aberto, setAberto] = useState(false);
  const leitura = useRef(0);

  const carregar = useCallback(async () => {
    const minha = ++leitura.current;
    setErro(false);
    try {
      const r: any = await api.get(`/produtos/${produtoId}/alergenos`);
      if (minha === leitura.current) setP(r?.produtos?.[0] ?? null);
    } catch {
      if (minha === leitura.current) setErro(true);
    }
  }, [produtoId]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <Card className="mt-4 space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-sm font-bold">Alérgenos</h3>
          {p && (p.situacao === 'informado' ? <Selo tom="ok">Informado</Selo> : <Selo tom="aviso">Não informado</Selo>)}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setAberto(true)} disabled={!p}>
          Marcar alérgenos
        </Button>
      </div>
      {erro ? (
        <p className="text-sm">
          Não deu para ler os alérgenos.{' '}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => void carregar()}>Tentar de novo</button>
        </p>
      ) : !p ? (
        <p className="text-sm text-secondary-foreground" role="status">Carregando…</p>
      ) : (
        <ResumoParaOCliente p={p} />
      )}
      {aberto && p && (
        <AlergenosProdutoGaveta
          p={p}
          aoFechar={() => setAberto(false)}
          aoSalvar={() => {
            setAberto(false);
            void carregar();
          }}
        />
      )}
    </Card>
  );
}
