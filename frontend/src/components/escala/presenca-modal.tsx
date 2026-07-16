'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';

/* eslint-disable @typescript-eslint/no-explicit-any */

const OPCOES = [
  { v: 'presente', l: 'Presente', emoji: '✅' },
  { v: 'falta_justificada', l: 'Falta justificada', emoji: '📄' },
  { v: 'falta_injustificada', l: 'Falta injustificada', emoji: '⛔' },
];

// Marca a presença de um dia escalado. Falta justificada exige comprovante (upload).
export function PresencaModal({
  aloc,
  onClose,
  onSaved,
}: {
  aloc: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [presenca, setPresenca] = useState<string>(
    aloc.presenca && aloc.presenca !== 'prevista' ? aloc.presenca : 'presente',
  );
  const [comprovante, setComprovante] = useState<string>(aloc.comprovanteRef ?? '');
  const [obs, setObs] = useState<string>(aloc.presencaObs ?? '');
  const [salvando, setSalvando] = useState(false);
  const ehJust = presenca === 'falta_justificada';

  async function salvar() {
    if (ehJust && !comprovante) return toast.error('Anexe o comprovante da falta justificada.');
    setSalvando(true);
    try {
      await api.marcarPresenca(aloc.id, {
        presenca,
        comprovanteRef: ehJust ? comprovante : undefined,
        obs: obs.trim() || undefined,
      });
      toast.success('Presença registrada.');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-sm space-y-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="font-display text-base font-bold">Presença</h2>
          <p className="text-xs text-muted-foreground">
            {aloc.colaboradorNome} · {String(aloc.data).split('-').reverse().join('/')}
          </p>
        </div>
        <div className="space-y-1.5">
          {OPCOES.map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setPresenca(o.v)}
              aria-pressed={presenca === o.v}
              className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
                presenca === o.v
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border text-muted-foreground'
              }`}
            >
              {o.emoji} {o.l}
            </button>
          ))}
        </div>
        {ehJust && (
          <div className="space-y-1.5">
            <Label className="text-xs">Comprovante (atestado, foto)</Label>
            <ImageUpload
              value={comprovante}
              onChange={(url) => setComprovante(url)}
              id={`comprovante-${aloc.id}`}
              alt="Comprovante da falta"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">Observação (opcional)</Label>
          <Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="motivo / detalhe" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Registrar'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
