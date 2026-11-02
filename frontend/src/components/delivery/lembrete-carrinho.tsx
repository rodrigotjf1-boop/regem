'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Chave } from '@/components/ui/chave';

// O LEMBRETE DO PEDIDO QUE FICOU PELA METADE NO ROBÔ (mig 349; Onda 0 do plano do atendimento): nasce desligado. Grava
// na hora, à parte do "Salvar" da aba (é o mesmo cadastro do tempo de pausa e do aviso de atraso, robo_config). Cada
// frase do texto tem a regra que a sustenta em `cardapio/lembrete-do-carrinho.processor.ts`.
export function LembreteCarrinho({ pode, loja }: { pode: boolean; loja: any }) {
  const [ligado, setLigado] = useState<boolean | null>(null);
  const [erro, setErro] = useState('');
  const [gravando, setGravando] = useState(false);
  useEffect(() => {
    api
      .whatsappRoboConfig()
      .then((r: any) => setLigado(!!r?.lembreteCarrinho))
      .catch((e) => setErro(e instanceof Error && e.message ? e.message : 'Não foi possível ler o lembrete.'));
  }, []);
  async function gravar(v: boolean) {
    setGravando(true);
    try {
      const r: any = await api.whatsappLembreteCarrinhoSalvar(v);
      setLigado(!!r?.lembreteCarrinho);
      toast.success(v ? 'Lembrete do pedido parado ligado.' : 'Lembrete do pedido parado desligado.');
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Não foi possível salvar.');
    } finally {
      setGravando(false);
    }
  }
  const oficial = loja?.provedor === 'cloud';
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">Lembrar o cliente do pedido que ficou pela metade</span>
        {ligado != null && (
          <Chave
            rotulo="Lembrar o cliente do pedido que ficou pela metade"
            ligada={ligado}
            ocupada={!pode || gravando}
            aoMudar={gravar}
          />
        )}
      </div>
      {erro ? (
        <p className="text-xs text-destructive">{erro}</p>
      ) : ligado == null ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        Quando o cliente começa o pedido com o robô e para no meio, ele recebe UMA mensagem 30 minutos depois: &quot;Seu
        pedido ainda está aqui comigo 🛒. Quer que eu finalize?&quot;. Só com a loja aberta, a conversa sem atendente e o
        pedido parado há menos de 3 horas.
        {oficial ? ' No WhatsApp oficial, só se o cliente falou com a loja nas últimas 24 h.' : ''}
      </p>
    </div>
  );
}
