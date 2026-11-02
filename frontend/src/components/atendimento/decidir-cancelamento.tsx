'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { avisarComprovante } from '@/lib/comprovante';
import { useSenhaSemSalvar } from '@/lib/use-senha-sem-salvar';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { ItensDaPerda, type MarcaDaPerda } from '@/components/delivery/itens-da-perda';
import type { CasoDaFila } from '@/lib/atendimento';

// O CANCELAMENTO PEDIDO PELO CLIENTE (cardápio online, robô, Anota AI): aceitar cancela o pedido de verdade — pelo
// MESMO serviço do painel do Delivery, que exige a senha de quem libera e pergunta o destino dos insumos (ERR-339:
// reutilizados × perda, com a perda por item). Recusar só encerra o caso. Era o painel de chamados do Delivery; veio
// para a central de atendimento (02/11/2026) com o mesmo comportamento.

/** Só o pedido já aceito tem cozinha — o mesmo critério do painel. Pedido sem situação conhecida: pergunta assim mesmo. */
const STATUS_COM_COZINHA = ['confirmado', 'pronto', 'despachado', 'entregue'];

export function DecidirCancelamento({ caso, aoDecidir }: { caso: CasoDaFila; aoDecidir: () => void }) {
  const [aceitando, setAceitando] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [reaproveitado, setReaproveitado] = useState(true);
  const [perda, setPerda] = useState<MarcaDaPerda[] | null>(null);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const campoSenha = useSenhaSemSalvar(); // o navegador não oferece guardar a senha do gestor (V54)
  const temCozinha = !caso.pedidoStatus || STATUS_COM_COZINHA.includes(String(caso.pedidoStatus));

  async function decidir(aceita: boolean) {
    if (enviando) return;
    if (aceita && !senha.trim()) {
      setErro('Informe a senha de quem libera.');
      return;
    }
    setErro('');
    setEnviando(true);
    try {
      const res: any = await api.decidirCancelamento(caso.id, {
        aceita,
        ...(aceita
          ? { senha, motivo: motivo.trim() || undefined, reaproveitado, perdaItens: reaproveitado ? null : perda }
          : {}),
      });
      toast.success(aceita ? 'Pedido cancelado.' : 'Cancelamento recusado.');
      avisarComprovante(res); // o cancelamento aceito imprime o comprovante
      setAceitando(false);
      setRecusando(false);
      aoDecidir();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" className="flex-1 bg-destructive text-white hover:bg-destructive/90" onClick={() => setAceitando(true)}>
        Aceitar o cancelamento
      </Button>
      <Button type="button" variant="outline" className="flex-1" onClick={() => setRecusando(true)}>
        Recusar
      </Button>

      {recusando && (
        <Dialogo
          titulo="Recusar o cancelamento"
          aoFechar={() => setRecusando(false)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setRecusando(false)}>Voltar</Button>
              <Button type="button" disabled={enviando} onClick={() => decidir(false)}>Recusar</Button>
            </>
          }
        >
          <p className="text-sm">O pedido segue normalmente e o caso é resolvido. Avise o cliente, se quiser.</p>
          {erro && <p className="mt-2 text-sm text-destructive" role="alert">{erro}</p>}
        </Dialogo>
      )}

      {aceitando && (
        <Dialogo
          titulo="Aceitar o cancelamento"
          alerta
          fecharNoFundo={false}
          aoFechar={() => setAceitando(false)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setAceitando(false)}>Voltar</Button>
              <Button
                type="button"
                className="bg-destructive text-white hover:bg-destructive/90"
                disabled={enviando || !senha.trim()}
                onClick={() => decidir(true)}
              >
                Cancelar o pedido
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <p>O pedido é cancelado, como no painel do Delivery.</p>
            <label className="block space-y-1">
              <span className="font-semibold">Motivo</span>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Vazio: cancelamento solicitado pelo cliente"
                className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3"
              />
            </label>
            {temCozinha && (
              <div className="space-y-1.5">
                <p className="font-semibold">O que aconteceu com os insumos deste pedido?</p>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Destino dos insumos">
                  <button
                    type="button"
                    aria-pressed={reaproveitado}
                    onClick={() => setReaproveitado(true)}
                    className={`min-w-[8rem] flex-1 rounded-md border px-2 py-2 text-left ${reaproveitado ? 'border-primary bg-primary/15' : 'border-border text-secondary-foreground'}`}
                  >
                    ♻️ Reutilizados (ficam no estoque)
                  </button>
                  <button
                    type="button"
                    aria-pressed={!reaproveitado}
                    onClick={() => setReaproveitado(false)}
                    className={`min-w-[8rem] flex-1 rounded-md border px-2 py-2 text-left ${!reaproveitado ? 'border-destructive bg-destructive/10' : 'border-border text-secondary-foreground'}`}
                  >
                    🗑️ Perda (saem do estoque)
                  </button>
                </div>
                {!reaproveitado && caso.pedidoId && <ItensDaPerda pedidoId={caso.pedidoId} onChange={setPerda} />}
              </div>
            )}
            <label className="block space-y-1">
              <span className="font-semibold">Senha de quem libera (presidente, gerente ou supervisão)</span>
              <input
                {...campoSenha}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3"
              />
            </label>
            {erro && <p className="text-destructive" role="alert">{erro}</p>}
          </div>
        </Dialogo>
      )}
    </div>
  );
}
