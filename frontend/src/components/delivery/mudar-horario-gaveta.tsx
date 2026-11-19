'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Gaveta } from '@/components/ui/sobreposto';
import { JanelasEscolha, type JanelasDoDia } from '@/components/agendado/janelas-escolha';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "MUDAR O HORÁRIO" DO PEDIDO AGENDADO NO PAINEL DO DELIVERY (mig 455, D4b — protótipo, parte 2, "Mudar o horário" em gaveta;
// G6: a loja muda a qualquer momento antes de sair). As janelas não contam o próprio pedido; o servidor confere a janela e o
// limite de novo, grava quem mudou na auditoria e avisa o cliente ("horário mudou").

const SP = 'America/Sao_Paulo';
function valorDe(iso: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: SP, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

export function MudarHorarioGaveta({ pedido: p, aoFechar, aoMudar }: { pedido: any; aoFechar: () => void; aoMudar: () => void }) {
  const atual = p.agendamento ? valorDe(p.agendamento) : null;
  const [novo, setNovo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const tipo = p.tipo === 'entrega' ? 'entrega' : 'retirada';

  async function salvar() {
    if (!novo || salvando) return;
    setSalvando(true);
    setErro('');
    try {
      await api.agendadoMudarHorario(p.id, novo);
      toast.success(`Horário mudado para ${novo.slice(8, 10)}/${novo.slice(5, 7)} às ${novo.slice(11)}. O cliente foi avisado.`);
      aoMudar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para mudar o horário.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo={`Mudar o horário · pedido ${p.displayId ?? ''}`}
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" onClick={() => void salvar()} disabled={!novo || novo === atual || salvando}>
            {salvando ? 'Mudando…' : 'Mudar o horário'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {p.clienteNome ? `${p.clienteNome} · ` : ''}
          {tipo === 'entrega' ? 'Entrega' : 'Retirada'}
          {atual ? ` · agora: ${atual.slice(8, 10)}/${atual.slice(5, 7)} às ${atual.slice(11)}` : ''}
        </p>
        <JanelasEscolha
          idBase="painel-agendado"
          carregar={(dia) => api.agendadoJanelasDaLoja(dia, tipo, p.id) as Promise<JanelasDoDia>}
          atual={atual}
          escolhida={novo}
          aoEscolher={setNovo}
        />
        <p className="text-xs text-muted-foreground">O cliente recebe o aviso do horário novo, e o cartão da cozinha muda junto.</p>
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{erro}</p>}
      </div>
    </Gaveta>
  );
}
