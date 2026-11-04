'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Chave } from '@/components/ui/chave';

// "O ROBÔ FAZ MUDANÇAS SIMPLES" NO PEDIDO JÁ FEITO (PR 3 do pedido alterado; mig 363): nasce LIGADO (decisão 3A do dono).
// Grava na hora, à parte do "Salvar" da aba (o mesmo cadastro do lembrete e do aviso de atraso, robo_config). Cada frase
// do texto tem a regra que a sustenta em `cardapio/robo-mudanca.ts` (o que o robô muda e quando) e em
// `cardapio/robo-pedido.service.ts` (a conferência, a loja com servidor e o chamado quando ela não responde).
export function MudancaPeloRobo({ pode }: { pode: boolean }) {
  const [ligado, setLigado] = useState<boolean | null>(null);
  const [erro, setErro] = useState('');
  const [gravando, setGravando] = useState(false);
  useEffect(() => {
    api
      .whatsappRoboConfig()
      .then((r: any) => setLigado(r?.mudaPedido !== false))
      .catch((e) => setErro(e instanceof Error && e.message ? e.message : 'Não foi possível ler o ajuste.'));
  }, []);
  async function gravar(v: boolean) {
    setGravando(true);
    try {
      const r: any = await api.whatsappMudaPedidoSalvar(v);
      setLigado(r?.mudaPedido !== false);
      toast.success(v ? 'O robô volta a fazer mudanças simples no pedido.' : 'Mudanças no pedido ficam com a equipe.');
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Não foi possível salvar.');
    } finally {
      setGravando(false);
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">O robô faz mudanças simples no pedido</span>
        {ligado != null && (
          <Chave rotulo="O robô faz mudanças simples no pedido" ligada={ligado} ocupada={!pode || gravando} aoMudar={gravar} />
        )}
      </div>
      {erro ? (
        <p className="text-xs text-destructive">{erro}</p>
      ) : ligado == null ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        Com o pedido do cardápio aceito e ainda na loja, o robô põe, tira ou troca um item (uma mudança por pedido), manda a
        conferência com o novo total e o troco, e só muda depois do &quot;Pode alterar&quot; do cliente. A cozinha recebe o
        aviso de pedido alterado e sai a via nova. Item já pronto na cozinha, pedido pago pelo link que mudaria de valor e
        pedido com nota fiscal ficam com a equipe. Desligado, toda mudança vai para a equipe.
      </p>
    </div>
  );
}
