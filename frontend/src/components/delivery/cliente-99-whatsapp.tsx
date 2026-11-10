'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Chave } from '@/components/ui/chave';

// O CLIENTE DA 99 PELO WHATSAPP DA LOJA (mig 388; pedido do dono, 09/11/2026): nasce desligado. Grava na hora, à parte do
// "Salvar" da aba (é o mesmo cadastro do aviso de atraso e do lembrete, robo_config). Cada frase do texto tem a regra que a
// sustenta: `DeliveryService.podeFalarPeloWhatsapp` (só a entrega da loja; iFood nunca), `AvisoDa99Processor` (o "saiu"),
// `EntregadorService.dispararChegada` (o "chegando", com o chat da 99 de reserva) e `avisoPelaOficial` (`paraOTelefone`).
export function Cliente99Whatsapp({ pode, loja }: { pode: boolean; loja: any }) {
  const [ligado, setLigado] = useState<boolean | null>(null);
  const [erro, setErro] = useState('');
  const [gravando, setGravando] = useState(false);
  useEffect(() => {
    api
      .whatsappRoboConfig()
      .then((r: any) => setLigado(!!r?.cliente99Whatsapp))
      .catch((e) => setErro(e instanceof Error && e.message ? e.message : 'Não foi possível ler o ajuste da 99.'));
  }, []);
  async function gravar(v: boolean) {
    setGravando(true);
    try {
      const r: any = await api.whatsappCliente99Salvar(v);
      setLigado(!!r?.cliente99Whatsapp);
      toast.success(v ? 'O cliente da 99 passa a receber pelo WhatsApp da loja.' : 'O cliente da 99 não recebe mais pelo WhatsApp da loja.');
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
        <span className="text-xs font-semibold">Falar com o cliente da 99 pelo WhatsApp</span>
        {ligado != null && (
          <Chave rotulo="Falar com o cliente da 99 pelo WhatsApp" ligada={ligado} ocupada={!pode || gravando} aoMudar={gravar} />
        )}
      </div>
      {erro ? (
        <p className="text-xs text-destructive">{erro}</p>
      ) : ligado == null ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        Quando o seu entregador leva o pedido da 99, o cliente recebe pelo WhatsApp da loja: o link para acompanhar a entrega
        quando o pedido sai, o aviso de que o entregador está chegando, o &quot;não consigo falar com você&quot; e a posição do
        entregador quando ele não acha o endereço. Pedido levado pelo entregador da 99 fica de fora (a 99 avisa). O iFood não
        permite: com o cliente do iFood, o entregador fala pelo chat do pedido.
      </p>
      {oficial && (
        <p role="status" className="rounded bg-warn/10 px-2 py-1 text-[11px] text-warn">
          No WhatsApp oficial, o cliente da 99 que nunca falou com a loja só recebe os modelos aprovados pela Meta (Marketing ›
          Modelos): &quot;Saiu para entrega&quot;, &quot;Pedido chegando&quot; e &quot;Entregador sem contato&quot;. Sem o
          modelo aprovado, o aviso não sai — o &quot;chegando&quot; vai então pelo chat da 99. A Meta pede que a pessoa tenha
          aceitado receber mensagens da loja.
        </p>
      )}
    </div>
  );
}
