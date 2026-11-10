'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import type { CasoDaFila } from '@/lib/atendimento';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "AVISAR O ENTREGADOR" NO CASO (mig 391; pedido do dono, 10/11/2026: "caso a reclamação precise do atendimento, é tratada
// lá; caso o atendimento entenda que deve encaminhar ao entregador, envia a notificação do pedido ao entregador, que chega
// no app dele, e o entregador tem as opções"). O bloco aparece quando o pedido do caso está com um entregador pelo app:
// quem é, os avisos que ele recebeu (do robô, que avisa sozinho quando o cliente pergunta pelo pedido ou reclama da
// demora, e os da equipe) e o que ele fez no app; e "Avisar o entregador" com o motivo e o recado. O servidor decide se
// dá para avisar (pedido a caminho, entregue ou concluído há até 12 h) e diz por quê quando não dá.

type Aviso = {
  id: string;
  origem: 'robo' | 'atendimento';
  rotulo: string;
  texto: string | null;
  enviadoPor: string | null;
  em: string;
  vistoEm: string | null;
  respondidoEm: string | null;
  resposta: string | null;
  respostaSaiu: boolean | null;
};
type Situacao = {
  entregador: { id: string; nome: string | null } | null;
  podeAvisar: boolean;
  porQueNao: string | null;
  motivos: { valor: string; rotulo: string }[];
  avisos: Aviso[];
};

const RESPOSTA: Record<string, string> = {
  a_caminho: 'avisou o cliente que está a caminho',
  cheguei: 'avisou o cliente que chegou',
  imprevisto: 'avisou o cliente do imprevisto',
  ligou: 'ligou para o cliente',
  mensagem: 'mandou mensagem ao cliente',
  ok: 'marcou como visto',
};

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';

function situacaoDoAviso(a: Aviso): string {
  if (a.respondidoEm) {
    const saiu = a.respostaSaiu === false ? ' (a mensagem não saiu pelo canal do pedido)' : '';
    return `Às ${hora(a.respondidoEm)}, o entregador ${RESPOSTA[a.resposta ?? ''] ?? 'respondeu'}${saiu}.`;
  }
  if (a.vistoEm) return `O entregador viu às ${hora(a.vistoEm)} e ainda não respondeu.`;
  return 'Esperando o entregador abrir o aviso.';
}

export function AvisarOEntregador({ caso, aberto }: { caso: CasoDaFila; aberto: boolean }) {
  const [dados, setDados] = useState<Situacao | null>(null);
  const [erro, setErro] = useState('');
  const [escrevendo, setEscrevendo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);

  const ler = useCallback(() => {
    api
      .atendimentoEntregador(caso.id)
      .then((r: any) => {
        setDados(r as Situacao);
        setErro('');
      })
      .catch((e) => setErro(e instanceof Error && e.message ? e.message : 'Não foi possível ler o entregador do pedido.'));
  }, [caso.id]);

  // Lê ao abrir o caso e de 20 em 20 s (o que o entregador faz no app aparece sem recarregar a tela).
  useEffect(() => {
    ler();
    const t = setInterval(ler, 20_000);
    return () => clearInterval(t);
  }, [ler]);

  async function enviar() {
    if (!motivo) {
      toast.error('Escolha o motivo do aviso.');
      return;
    }
    setEnviando(true);
    try {
      await api.atendimentoAvisarEntregador(caso.id, { motivo, nota: nota.trim() || undefined });
      toast.success('Aviso enviado ao app do entregador.');
      setEscrevendo(false);
      setMotivo('');
      setNota('');
      ler();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Não foi possível avisar o entregador.');
    } finally {
      setEnviando(false);
    }
  }

  // Pedido sem entregador pelo app: o bloco não aparece (o caso segue como sempre).
  if (!dados?.entregador) return erro ? <p className="text-xs text-destructive">{erro}</p> : null;

  return (
    <section className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-display text-sm font-bold">Entregador do pedido</h4>
        <span className="font-semibold">{dados.entregador.nome ?? 'Entregador'}</span>
      </div>

      {dados.avisos.length > 0 && (
        <ul className="space-y-2" aria-label="Avisos ao entregador">
          {dados.avisos.map((a) => (
            <li key={a.id} className="rounded-md bg-secondary/40 px-3 py-2">
              <p className="break-words font-semibold">
                {hora(a.em)} · {a.rotulo}
                <span className="font-normal text-secondary-foreground">
                  {a.origem === 'robo' ? ' — o robô avisou' : a.enviadoPor ? ` — por ${a.enviadoPor}` : ''}
                </span>
              </p>
              {a.texto && <p className="mt-0.5 whitespace-pre-line break-words text-secondary-foreground">“{a.texto}”</p>}
              <p className="mt-0.5 text-xs text-secondary-foreground">{situacaoDoAviso(a)}</p>
            </li>
          ))}
        </ul>
      )}

      {erro && <p className="text-xs text-destructive">{erro}</p>}

      {aberto && dados.podeAvisar && !escrevendo && (
        <Button variant="outline" size="sm" onClick={() => setEscrevendo(true)}>
          Avisar o entregador
        </Button>
      )}
      {aberto && !dados.podeAvisar && dados.porQueNao && (
        <p className="text-xs text-secondary-foreground">{dados.porQueNao}</p>
      )}

      {escrevendo && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <label htmlFor={`aviso-motivo-${caso.id}`} className="text-xs font-semibold">
            Motivo
          </label>
          <select
            id={`aviso-motivo-${caso.id}`}
            className="h-10 w-full rounded-md border border-border bg-background px-2 text-sm"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          >
            <option value="">Escolha o motivo</option>
            {dados.motivos.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.rotulo}
              </option>
            ))}
          </select>
          <label htmlFor={`aviso-nota-${caso.id}`} className="text-xs font-semibold">
            Recado ao entregador (opcional)
          </label>
          <textarea
            id={`aviso-nota-${caso.id}`}
            rows={2}
            maxLength={300}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Ex.: levar 1 Coca 2 L que faltou e o troco de R$ 10"
          />
          <p className="text-[11px] text-secondary-foreground">
            O aviso chega no app do entregador com o pedido. Ele pode ligar, mandar mensagem ou avisar o cliente que está a
            caminho, que chegou ou que teve um imprevisto — e o que ele fizer aparece aqui.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void enviar()} disabled={enviando}>
              {enviando ? 'Enviando…' : 'Enviar ao entregador'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEscrevendo(false)} disabled={enviando}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
