'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialogo } from '@/components/ui/sobreposto';
import { num, texto2 } from '@/components/ui/lista';
import { fichaDe, quantidadeDe } from './ordem';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tipo = 'total' | 'parcial' | 'nao';
const TIPOS: { v: Tipo; rotulo: string }[] = [
  { v: 'total', rotulo: 'Total' },
  { v: 'parcial', rotulo: 'Parcial' },
  { v: 'nao', rotulo: 'Não concluída' },
];

// Concluir (ou lançar) uma ordem: como terminou, quanto rendeu e o PIN de quem produziu. Total e
// parcial baixam os insumos da ficha na hora; "não concluída" e "lançar depois" não mexem no estoque.
export function ConcluirOrdem({ ordem, voltarPara, aoFechar, aoSalvar }: { ordem: any; voltarPara: string; aoFechar: () => void; aoSalvar: () => void }) {
  const [tipo, setTipo] = useState<Tipo>('total');
  const [qtd, setQtd] = useState('');
  const [motivo, setMotivo] = useState('');
  const [pin, setPin] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const planejada = Number(ordem.quantidadePlanejada) || 0;

  const falta = (msg: string, id: string) => {
    setErro(msg);
    document.getElementById(id)?.focus();
  };
  async function enviar(depois: boolean) {
    if (salvando) return;
    if (!depois) {
      // As mesmas recusas do servidor, antes de ir até ele.
      if (tipo === 'parcial' && !(Number(qtd) > 0)) return falta('Informe a quantidade produzida.', 'concluir-qtd');
      if (tipo === 'parcial' && Number(qtd) >= planejada) return falta('No parcial, a quantidade é menor que a planejada. Se rendeu tudo, escolha “Total”.', 'concluir-qtd');
      if (tipo === 'nao' && !motivo.trim()) return falta('Informe o motivo da não conclusão.', 'concluir-motivo');
      if (!pin) return falta('Confirme com o PIN de quem produziu.', 'concluir-pin');
    }
    setErro('');
    setSalvando(true);
    try {
      const r: any = await api.concluirOrdem(
        ordem.id,
        depois ? { viaImpressa: true } : { tipo, quantidadeProduzida: tipo === 'parcial' ? Number(qtd) : undefined, pin, motivo: tipo === 'nao' ? motivo.trim() : undefined },
      );
      toast.success(
        depois
          ? 'Ordem em “Aguardando lançamento”.'
          : tipo === 'nao'
            ? 'Ordem encerrada como não concluída.'
            : `Conclusão registrada.${r?.estoque?.insumosBaixados != null ? ` ${r.estoque.insumosBaixados} insumo(s) baixado(s).` : ''}`,
      );
      aoSalvar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao concluir');
      setSalvando(false);
    }
  }
  const opcao = (ligada: boolean) =>
    `min-h-11 border-r border-input px-2 text-sm font-semibold last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
      ligada ? 'bg-foreground text-background' : 'bg-card text-foreground hover:bg-secondary'
    }`;

  return (
    <Dialogo
      titulo={`Concluir: ${fichaDe(ordem)}`}
      aoFechar={aoFechar}
      voltarPara={voltarPara}
      fecharNoFundo={false}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="button" variant="outline" onClick={() => void enviar(true)} disabled={salvando}>Lançar depois</Button>
          <Button type="button" onClick={() => void enviar(false)} disabled={salvando}>{salvando ? 'Salvando…' : 'Confirmar com PIN'}</Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className={texto2}>Planejado: <b className="font-mono text-foreground">{quantidadeDe(ordem)}</b></p>
        <div>
          <span className="mb-1 block font-medium">Como terminou</span>
          <div className="grid grid-cols-3 overflow-hidden rounded-md border border-input" role="group" aria-label="Como terminou">
            {TIPOS.map((t) => (
              <button key={t.v} type="button" aria-pressed={tipo === t.v} className={opcao(tipo === t.v)} onClick={() => { setTipo(t.v); setErro(''); }}>{t.rotulo}</button>
            ))}
          </div>
        </div>
        {tipo === 'parcial' && (
          <div className="space-y-1.5">
            <Label htmlFor="concluir-qtd">Quantidade produzida (menor que {num(planejada)})</Label>
            <Input id="concluir-qtd" inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))} placeholder="Ex.: 8" autoComplete="off" />
          </div>
        )}
        {tipo === 'nao' && (
          <div className="space-y-1.5">
            <Label htmlFor="concluir-motivo">Motivo</Label>
            <Input id="concluir-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por que não foi produzido?" autoComplete="off" />
          </div>
        )}
        <p className="rounded-md bg-secondary px-3 py-2">
          {tipo === 'nao'
            ? 'A ordem é encerrada como não concluída, com o motivo. O estoque não muda.'
            : `${tipo === 'total' ? 'Total' : 'Parcial'} dá baixa nos insumos da ficha${tipo === 'parcial' ? ', na proporção do que rendeu' : ''}. Se a ordem tem insumo de saída, o produzido entra no estoque.`}
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="concluir-pin">PIN (assinatura de quem produziu)</Label>
          <Input id="concluir-pin" data-foco-inicial type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN do colaborador" autoComplete="off" />
        </div>
        <p className={`text-xs ${texto2}`}>
          <b>Lançar depois</b>: a ordem vai para as pendências (“Aguardando lançamento”), sem PIN e sem mexer no estoque, até alguém lançar o resultado.
          Este botão não imprime nada.
        </p>
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}
