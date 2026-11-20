'use client';

import { useId, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { brl } from '@/components/ui/lista';
import { Gaveta } from '@/components/ui/sobreposto';
import type { PainelDoClube } from './tipos';

// A gaveta do gatilho "Pedido entregue" (protótipo `mockups/regem-clube-banner.html`, Marketing › Clube › Prêmio surpresa ›
// "Mudar"): o prêmio de quem tem o pedido entregue. O produto grátis no prêmio surpresa chega numa próxima entrega (a
// lista mostra só desconto e frete grátis; o servidor também recusa). O pedido mínimo é o do clube (Visão geral).
export function GavetaDoGatilho({
  painel,
  ligar,
  aoFechar,
  aoSalvar,
  aoIrParaPremios,
}: {
  painel: PainelDoClube;
  /** Aberta pela chave: salvar também liga o gatilho. */
  ligar: boolean;
  aoFechar: () => void;
  aoSalvar: (p: PainelDoClube) => void;
  aoIrParaPremios: () => void;
}) {
  const id = useId();
  const g = painel.gatilhos.entregue;
  const opcoes = painel.premios.filter((p) => p.tipo !== 'produto');
  const [premioId, setPremioId] = useState(g.premioId && opcoes.some((p) => p.id === g.premioId) ? g.premioId : '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const escolhido = opcoes.find((p) => p.id === premioId) ?? null;

  async function salvar() {
    setErro('');
    if (!premioId) {
      setErro('Escolha o prêmio de quem tem o pedido entregue.');
      return;
    }
    setSalvando(true);
    try {
      const p = (await api.clubeSalvarGatilhoEntregue(ligar ? { ativo: true, premioId } : { premioId })) as PainelDoClube;
      toast.success(ligar ? 'Pedido entregue ligado.' : 'Prêmio do pedido entregue salvo.');
      aoSalvar(p);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Não foi possível salvar o gatilho.';
      setErro(msg);
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo="Pedido entregue"
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={salvando || !opcoes.length}>
            {salvando ? 'Salvando…' : ligar ? 'Ligar com este prêmio' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-secondary-foreground">Prêmio surpresa · quando o cliente ganha</p>
        <div className="space-y-1">
          <span className="text-sm font-semibold">Dar o prêmio a cada</span>
          <p className="text-sm">Pedido entregue, pelo cardápio online ou pelo WhatsApp da loja.</p>
        </div>
        <div className="space-y-1">
          <span className="text-sm font-semibold">Pedido a partir de</span>
          <p className="text-sm">
            <span className="font-mono">{brl(painel.config.minimo)}</span> — o mínimo do clube, que vale para as três ferramentas (muda em Visão geral).
            Pedido cancelado não conta.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-premio`}>Prêmio</Label>
          {opcoes.length ? (
            <Select id={`${id}-premio`} value={premioId} onChange={(e) => setPremioId(e.target.value)}>
              <option value="">Escolha o prêmio</option>
              {opcoes.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </Select>
          ) : (
            <p className="text-sm">Nenhum prêmio de desconto ou de frete grátis ainda.</p>
          )}
          <p className="text-xs text-secondary-foreground">
            {escolhido ? `${escolhido.descricao}. ` : ''}Todo cliente que cumprir a regra ganha este prêmio: a raspadinha e a roleta só o revelam. O produto
            grátis no prêmio surpresa chega numa próxima entrega.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={aoIrParaPremios}>
            ＋ Cadastrar novo prêmio
          </Button>
        </div>
        <div className="space-y-1">
          <span className="text-sm font-semibold">Onde o cliente revela</span>
          <p className="text-sm">Na página do pedido, depois da entrega, e em &quot;Sua conta&quot; do cardápio (prêmio para revelar).</p>
        </div>
        {erro && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {erro}
          </p>
        )}
      </div>
    </Gaveta>
  );
}
