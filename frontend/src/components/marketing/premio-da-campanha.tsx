'use client';

import { useEffect, useId, useState } from 'react';
import { api } from '@/lib/api';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { PainelDoClube } from './clube/tipos';

// "🎁 Mandar um prêmio surpresa" na criação da campanha (fase A1d do Clube, mig 477; protótipo
// `mockups/regem-clube-banner.html`, "Em disparo (campanha)"). Só aparece com o prêmio surpresa e o gatilho "Em disparo"
// ligados no Clube; o servidor confere de novo ao criar. Todos os destinatários ganham o prêmio escolhido; o link da
// campanha leva ao link pessoal dele (raspadinha ou roleta).
export function PremioDaCampanha({ valor, aoMudar }: { valor: string; aoMudar: (premioId: string) => void }) {
  const id = useId();
  const [painel, setPainel] = useState<PainelDoClube | null>(null);

  useEffect(() => {
    let vivo = true;
    api
      .clubePainel()
      .then((p: any) => vivo && setPainel(p as PainelDoClube))
      .catch(() => vivo && setPainel(null)); // sem o Clube (perfil sem acesso, servidor da loja): a opção não aparece
    return () => {
      vivo = false;
    };
  }, []);

  if (!painel?.config.surpresaAtivo || !painel.gatilhos?.campanha?.ativo) return null;
  const premios = painel.premios.filter((p) => p.tipo !== 'produto');
  if (!premios.length) return null;
  const forma = painel.config.surpresaForma === 'roleta' ? 'gira a roleta' : 'raspa a raspadinha';

  return (
    <div className="space-y-1 rounded-lg border border-dashed border-border p-3">
      <Label htmlFor={`${id}-premio`}>🎁 Prêmio surpresa (opcional)</Label>
      <Select id={`${id}-premio`} value={valor} onChange={(e) => aoMudar(e.target.value)}>
        <option value="">Sem prêmio</option>
        {premios.map((p) => (
          <option key={p.id} value={p.id}>{p.nome}</option>
        ))}
      </Select>
      <p className="text-xs text-secondary-foreground">
        Todos os destinatários ganham este prêmio: o link da campanha leva cada um ao seu prêmio, onde ele {forma}. No modelo oficial, o link
        vai no botão &quot;Peça agora&quot; do modelo; sem esse botão, o prêmio espera na conta do cardápio.
      </p>
    </div>
  );
}
