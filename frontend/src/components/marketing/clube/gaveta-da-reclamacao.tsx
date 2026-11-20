'use client';

import { useId, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Gaveta } from '@/components/ui/sobreposto';
import type { PainelDoClube } from './tipos';

// A gaveta do gatilho "Depois de uma reclamação" (protótipo `mockups/regem-clube-banner.html`, Marketing › Clube › Prêmio
// surpresa › "Mudar"): os prêmios que a equipe pode escolher no caso (até 6; o produto grátis chega depois), o limite por
// cliente e quem pode mandar. A equipe manda pelo caso, em Atendimento.
export function GavetaDaReclamacao({
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
  const g = painel.gatilhos.reclamacao;
  const opcoes = painel.premios.filter((p) => p.tipo !== 'produto');
  const max = painel.opcoes.premiosPorEscolhaMax;
  const [premios, setPremios] = useState<string[]>(g.premios.filter((x) => opcoes.some((p) => p.id === x)));
  const [limite, setLimite] = useState(g.limite);
  const [quem, setQuem] = useState(g.quem);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  function alternar(premioId: string) {
    setPremios((x) => (x.includes(premioId) ? x.filter((y) => y !== premioId) : x.length >= max ? x : [...x, premioId]));
  }

  async function salvar() {
    setErro('');
    if (!premios.length) {
      setErro('Escolha ao menos um prêmio que a equipe pode mandar.');
      return;
    }
    setSalvando(true);
    try {
      const p = (await api.clubeSalvarGatilhoReclamacao({ ...(ligar ? { ativo: true } : {}), premios, limite, quem })) as PainelDoClube;
      toast.success(ligar ? 'Prêmio de desculpas ligado.' : 'Prêmio de desculpas salvo.');
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
      titulo="Depois de uma reclamação"
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={salvando || !opcoes.length}>
            {salvando ? 'Salvando…' : ligar ? 'Ligar' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-secondary-foreground">
          A equipe escolhe o prêmio no caso do Atendimento, depois de resolver. É cortesia de atendimento: não depende de compra nova.
        </p>
        <div className="space-y-2">
          <span id={`${id}-premios`} className="text-sm font-semibold">Prêmios que a equipe pode escolher</span>
          {opcoes.length ? (
            <div className="grid grid-cols-1 gap-1.5" role="group" aria-labelledby={`${id}-premios`}>
              {opcoes.map((p) => {
                const marcado = premios.includes(p.id);
                return (
                  <label key={p.id} htmlFor={`${id}-p-${p.id}`} className="flex min-h-10 cursor-pointer items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                    <input
                      id={`${id}-p-${p.id}`}
                      type="checkbox"
                      className="mt-0.5 h-4 w-4"
                      checked={marcado}
                      disabled={!marcado && premios.length >= max}
                      onChange={() => alternar(p.id)}
                    />
                    <span className="min-w-0">
                      <b>{p.nome}</b>
                      <span className="block text-xs text-secondary-foreground">{p.descricao}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-sm">Nenhum prêmio de desconto ou de frete grátis ainda.</p>
          )}
          <p className="text-xs text-secondary-foreground">
            Até {max} prêmios. O produto grátis no prêmio surpresa chega numa próxima entrega.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={aoIrParaPremios}>
            ＋ Cadastrar novo prêmio
          </Button>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-limite`}>No máximo, por cliente</Label>
          <Select id={`${id}-limite`} value={limite} onChange={(e) => setLimite(e.target.value)}>
            {painel.opcoes.limitesDaReclamacao.map((o) => (
              <option key={o.valor} value={o.valor}>{o.rotulo}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-quem`}>Quem pode mandar</Label>
          <Select id={`${id}-quem`} value={quem} onChange={(e) => setQuem(e.target.value)}>
            {painel.opcoes.quemMandaDesculpas.map((o) => (
              <option key={o.valor} value={o.valor}>{o.rotulo}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <span className="text-sm font-semibold">Como chega ao cliente</span>
          <p className="text-sm">
            Pela conversa do WhatsApp do caso, com o link para revelar; o prêmio também fica na conta do cardápio. Só nos casos com o
            telefone do cliente: o iFood e a 99 não aceitam o cupom do Regem.
          </p>
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
