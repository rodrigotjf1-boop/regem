'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialogo } from '@/components/ui/sobreposto';
import { fichaDe, quandoDe, quantidadeDe } from './ordem';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Cancelar uma ordem (só gestão). O motivo é pedido aqui — antes era a caixa de texto do navegador.
export function CancelarOrdem({ ordem, voltarPara, aoFechar, aoCancelar }: { ordem: any; voltarPara: string; aoFechar: () => void; aoCancelar: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState('');
  async function confirmar() {
    if (gravando) return;
    setErro('');
    setGravando(true);
    try {
      await api.cancelarOrdem(ordem.id, motivo.trim() || undefined);
      toast.success('Ordem cancelada.');
      aoCancelar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao cancelar');
      setGravando(false);
    }
  }
  return (
    <Dialogo alerta titulo="Cancelar ordem" aoFechar={aoFechar} voltarPara={voltarPara}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={gravando}>Manter a ordem</Button>
          <Button type="button" variant="destructive" onClick={confirmar} disabled={gravando}>{gravando ? 'Cancelando…' : 'Cancelar a ordem'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <p>Cancelar <b>{fichaDe(ordem)}</b> ({quantidadeDe(ordem)}, {quandoDe(ordem)})?</p>
        <div className="space-y-1.5">
          <Label htmlFor="cancelar-motivo">Motivo do cancelamento</Label>
          <Input id="cancelar-motivo" data-foco-inicial value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: faltou insumo" autoComplete="off" />
        </div>
        <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">A ordem vai para as encerradas como cancelada, com o motivo. O estoque não muda.</p>
        {erro && <p role="alert" className="font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}
