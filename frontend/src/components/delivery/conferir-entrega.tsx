'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Chave } from '@/components/ui/chave';

// "CHEGOU TUDO CERTO?" DEPOIS DA ENTREGA (B1 do plano do atendimento; mig 352): nasce desligado. Grava na hora, à parte do
// "Salvar" da aba (o mesmo cadastro do lembrete e do aviso de atraso, robo_config). Cada frase do texto tem a regra que a
// sustenta em `whatsapp/conferir-entrega.processor.ts` e `whatsapp/conferir-entrega.ts`. Só na API oficial (é onde o
// Regem confere a janela de 24 h — decisão do dono: "pesquisa só dentro da janela").
export function ConferirEntrega({ pode, loja }: { pode: boolean; loja: any }) {
  const [ligado, setLigado] = useState<boolean | null>(null);
  const [erro, setErro] = useState('');
  const [gravando, setGravando] = useState(false);
  useEffect(() => {
    api
      .whatsappRoboConfig()
      .then((r: any) => setLigado(!!r?.conferirEntrega))
      .catch((e) => setErro(e instanceof Error && e.message ? e.message : 'Não foi possível ler o ajuste.'));
  }, []);
  async function gravar(v: boolean) {
    setGravando(true);
    try {
      const r: any = await api.whatsappConferirEntregaSalvar(v);
      setLigado(!!r?.conferirEntrega);
      toast.success(v ? '"Chegou tudo certo?" ligado.' : '"Chegou tudo certo?" desligado.');
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
        <span className="text-xs font-semibold">Perguntar &quot;Chegou tudo certo?&quot; depois da entrega</span>
        {ligado != null && (
          <Chave rotulo='Perguntar "Chegou tudo certo?" depois da entrega' ligada={ligado} ocupada={!pode || gravando || (!oficial && !ligado)} aoMudar={gravar} />
        )}
      </div>
      {erro ? (
        <p className="text-xs text-destructive">{erro}</p>
      ) : ligado == null ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        20 minutos depois de o pedido de entrega ser concluído, o cliente recebe UMA pergunta com 3 botões: &quot;Tudo certo
        👍&quot;, &quot;Tive um problema&quot; e &quot;Não chegou&quot;. &quot;Tudo certo&quot; só recebe um obrigado;
        &quot;Tive um problema&quot; vira caso na tela Atendimento, e &quot;Não chegou&quot; vira caso urgente. Só para
        pedidos dos canais da própria loja (nunca iFood nem 99), só se o cliente falou com a loja nas últimas 24 h e sem
        ninguém da equipe na conversa.
      </p>
      {!oficial && <p className="text-[11px] font-semibold text-foreground">Disponível só com o WhatsApp oficial da loja.</p>}
    </div>
  );
}
