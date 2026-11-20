'use client';

import { useId, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Gaveta } from '@/components/ui/sobreposto';
import type { PainelDoClube } from './tipos';

// A gaveta do gatilho "Pela classificação do marketing" (protótipo `mockups/regem-clube-banner.html`, Marketing › Clube ›
// Prêmio surpresa › "Mudar"): os segmentos do perfil do cliente (com quantos clientes há hoje em cada um), de quanto em
// quanto tempo cada cliente pode ganhar e o prêmio. Todos do segmento ganham — ninguém é escolhido por sorte. O prêmio
// espera na conta do cliente; o aviso pelo WhatsApp sai pela campanha (próxima entrega).
export function GavetaDaClassificacao({
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
  const g = painel.gatilhos.classificacao;
  const premios = painel.premios.filter((p) => p.tipo !== 'produto');
  const [segmentos, setSegmentos] = useState<string[]>(g.segmentos);
  const [periodo, setPeriodo] = useState(String(g.periodoDias));
  const [premioId, setPremioId] = useState(g.premioId && premios.some((p) => p.id === g.premioId) ? g.premioId : '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const { perfilLigado, contagens } = painel.classificacao;

  function alternar(s: string) {
    setSegmentos((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));
  }

  async function salvar() {
    setErro('');
    if (!segmentos.length) return setErro('Escolha ao menos um segmento.');
    if (!premioId) return setErro('Escolha o prêmio de quem está nos segmentos.');
    setSalvando(true);
    try {
      const p = (await api.clubeSalvarGatilhoClassificacao({
        ...(ligar ? { ativo: true } : {}),
        segmentos,
        premioId,
        periodoDias: Number(periodo),
      })) as PainelDoClube;
      toast.success(ligar ? 'Prêmio pela classificação ligado.' : 'Prêmio pela classificação salvo.');
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
      titulo="Pela classificação do marketing"
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={salvando || !perfilLigado}>
            {salvando ? 'Salvando…' : ligar ? 'Ligar' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-secondary-foreground">
          Os segmentos vêm do perfil do cliente (Delivery › Clientes), pelas compras de cada um. Todos do segmento ganham; ninguém é escolhido
          por sorte.
        </p>
        {!perfilLigado && (
          <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm" role="status">
            O módulo &quot;Perfil do cliente&quot; está desligado: ligue em Visão C&amp;O › Módulos do produto para usar os segmentos.
          </p>
        )}
        <div className="space-y-2">
          <span id={`${id}-segs`} className="text-sm font-semibold">Segmentos</span>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" role="group" aria-labelledby={`${id}-segs`}>
            {painel.opcoes.segmentosDaClassificacao.map((s) => (
              <label key={s.valor} htmlFor={`${id}-s-${s.valor}`} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                <input
                  id={`${id}-s-${s.valor}`}
                  type="checkbox"
                  className="h-4 w-4"
                  checked={segmentos.includes(s.valor)}
                  disabled={!perfilLigado}
                  onChange={() => alternar(s.valor)}
                />
                <span className="min-w-0">
                  {s.rotulo}
                  {perfilLigado && <span className="text-xs text-secondary-foreground"> · {contagens[s.valor] ?? 0} clientes</span>}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-secondary-foreground">Quem pediu &quot;não quero ser analisado&quot; e quem não tem telefone ficam de fora.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-periodo`}>Cada cliente ganha no máximo</Label>
          <Select id={`${id}-periodo`} value={periodo} onChange={(e) => setPeriodo(e.target.value)} disabled={!perfilLigado}>
            {painel.opcoes.periodosDaClassificacao.map((d) => (
              <option key={d} value={d}>1 vez a cada {d} dias</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-premio`}>Prêmio</Label>
          {premios.length ? (
            <Select id={`${id}-premio`} value={premioId} onChange={(e) => setPremioId(e.target.value)} disabled={!perfilLigado}>
              <option value="">Escolha o prêmio</option>
              {premios.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </Select>
          ) : (
            <p className="text-sm">Nenhum prêmio de desconto ou de frete grátis ainda.</p>
          )}
          <Button type="button" variant="outline" size="sm" onClick={aoIrParaPremios}>
            ＋ Cadastrar novo prêmio
          </Button>
        </div>
        <div className="space-y-1">
          <span className="text-sm font-semibold">Como chega ao cliente</span>
          <p className="text-sm">
            O prêmio espera na conta do cardápio (prêmios para revelar). O aviso pelo WhatsApp, só para quem aceitou mensagens, sai pela
            campanha com o prêmio surpresa — chega numa próxima entrega.
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
