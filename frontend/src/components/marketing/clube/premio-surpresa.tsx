'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Chave } from '@/components/ui/chave';
import { brl, Selo } from '@/components/ui/lista';
import { cn } from '@/lib/utils';
import { GavetaDoGatilho } from './gaveta-do-gatilho';
import type { PainelDoClube } from './tipos';

// Marketing › Clube › Prêmio surpresa (fase A1; protótipo `mockups/regem-clube-banner.html`, "Marketing › Clube" › Prêmio
// surpresa): como o cliente revela (raspadinha × roleta — as duas mostram o mesmo prêmio, já definido) e quando ele ganha.
// Nesta fase só o "Pedido entregue" liga; a reclamação, a classificação e a campanha chegam nas próximas entregas; a
// avaliação não é recomendada (Google e lei de promoções) e o aleatório é sorteio (só com o certificado da SPA). Só o
// presidente muda (o servidor confere; a tela só esconde as chaves).
const FORMAS: { valor: 'raspadinha' | 'roleta'; nome: string; ajuda: string }[] = [
  { valor: 'raspadinha', nome: '🪙 Raspadinha', ajuda: 'Raspa com o dedo e vê o prêmio.' },
  { valor: 'roleta', nome: '🎡 Roleta de prêmios', ajuda: 'Toca, a roda gira e para no prêmio.' },
];

function quando(iso: string): string {
  const d = new Date(iso);
  const fuso = { timeZone: 'America/Sao_Paulo' } as const;
  return `${d.toLocaleDateString('pt-BR', { ...fuso, day: '2-digit', month: '2-digit' })} às ${d.toLocaleTimeString('pt-BR', { ...fuso, hour: '2-digit', minute: '2-digit' })}`;
}

function Gatilho({ titulo, selo, children, chave }: { titulo: React.ReactNode; selo?: React.ReactNode; children: React.ReactNode; chave?: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="min-w-0 font-display text-base font-bold">{titulo}</h4>
        {chave ?? selo}
      </div>
      <div className="min-w-0 space-y-2 text-sm">{children}</div>
    </div>
  );
}

export function PremioSurpresa({
  painel,
  podeMudar,
  aoMudar,
  aoIrParaPremios,
}: {
  painel: PainelDoClube;
  podeMudar: boolean;
  aoMudar: (p: PainelDoClube) => void;
  aoIrParaPremios: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [gaveta, setGaveta] = useState<null | { ligar: boolean }>(null);
  const g = painel.gatilhos.entregue;
  const premio = painel.premios.find((p) => p.id === g.premioId) ?? null;

  async function mudarForma(forma: 'raspadinha' | 'roleta') {
    if (forma === painel.config.surpresaForma || ocupado) return;
    setOcupado(true);
    try {
      aoMudar((await api.clubeSalvarConfig({ surpresaForma: forma })) as PainelDoClube);
      toast.success(forma === 'roleta' ? 'Agora o cliente gira a roleta.' : 'Agora o cliente raspa a raspadinha.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível mudar a forma.');
    } finally {
      setOcupado(false);
    }
  }

  async function ligarEntregue(ligado: boolean) {
    if (ligado && !g.premioId) return setGaveta({ ligar: true }); // ligar pede o prêmio antes
    setOcupado(true);
    try {
      aoMudar((await api.clubeSalvarGatilhoEntregue({ ativo: ligado })) as PainelDoClube);
      toast.success(ligado ? 'Pedido entregue ligado.' : 'Pedido entregue desligado.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Não foi possível mudar o gatilho.';
      toast.error(msg);
      if (ligado) setGaveta({ ligar: true }); // o prêmio que estava não serve mais: escolher outro
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-5">
      {!painel.config.surpresaAtivo && (
        <p className="rounded-md border border-border bg-secondary px-3 py-2 text-sm" role="status">
          O prêmio surpresa está desligado: ligue em Visão geral. Os gatilhos ligados só dão prêmio com ele ligado.
        </p>
      )}

      <section className="space-y-2" aria-labelledby="clube-forma">
        <h3 id="clube-forma" className="font-display text-lg font-bold">Como o cliente revela</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-labelledby="clube-forma">
          {FORMAS.map((f) => {
            const ativa = painel.config.surpresaForma === f.valor;
            return (
              <button
                key={f.valor}
                type="button"
                aria-pressed={ativa}
                disabled={!podeMudar || ocupado}
                onClick={() => void mudarForma(f.valor)}
                className={cn(
                  'grid min-h-16 gap-0.5 rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
                  ativa ? 'border-primary bg-primary/10' : 'border-border bg-card',
                  !podeMudar && !ativa && 'opacity-70',
                )}
              >
                <b className="text-sm">{f.nome}</b>
                <span className="text-xs text-secondary-foreground">{f.ajuda}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-secondary-foreground">As duas mostram o mesmo prêmio, que já foi definido quando o cliente ganhou o direito.</p>
      </section>

      <section className="space-y-3" aria-labelledby="clube-quando">
        <h3 id="clube-quando" className="font-display text-lg font-bold">Quando o cliente ganha</h3>

        <Gatilho
          titulo={
            <>
              Pedido entregue <Selo tom="info">recomendado</Selo>
            </>
          }
          chave={
            podeMudar ? (
              <Chave ligada={g.ativo} aoMudar={(v) => void ligarEntregue(v)} rotulo="Pedido entregue" ocupada={ocupado} />
            ) : (
              <Selo tom={g.ativo ? 'ok' : 'neutro'}>{g.ativo ? 'Ligado' : 'Desligado'}</Selo>
            )
          }
        >
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              A cada pedido a partir de <b className="font-mono">{brl(painel.config.minimo)}</b>
            </span>
            <span>
              Prêmio: <b>{premio ? premio.nome : 'nenhum escolhido'}</b>
            </span>
            {premio && (
              <span>
                Validade: <b>{premio.validadeDias} dias</b>
              </span>
            )}
          </div>
          <p className="text-xs text-secondary-foreground">
            {g.ativo && g.desde
              ? `Valem os pedidos concluídos desde ${quando(g.desde)}. O cliente revela na página do pedido e na conta do cardápio.`
              : 'Ao ligar, valem só os pedidos concluídos dali em diante. O cliente revela na página do pedido e na conta do cardápio.'}
          </p>
          {podeMudar && (
            <Button type="button" variant="outline" size="sm" onClick={() => setGaveta({ ligar: false })}>
              Mudar
            </Button>
          )}
        </Gatilho>

        <Gatilho titulo="Depois de uma reclamação" selo={<Selo>Chega numa próxima entrega</Selo>}>
          <p>A equipe manda pelo caso, em Atendimento, escolhendo o prêmio da lista; no máximo um por cliente por mês.</p>
        </Gatilho>
        <Gatilho titulo="Pela classificação do marketing" selo={<Selo>Chega numa próxima entrega</Selo>}>
          <p>Todos de um segmento (Em risco, Inativos, Campeões…) ganham, uma vez por período; o prêmio espera na conta do cliente.</p>
        </Gatilho>
        <Gatilho titulo="Em disparo (campanha)" selo={<Selo>Chega numa próxima entrega</Selo>}>
          <p>Na hora de criar a campanha, a opção &quot;Mandar um prêmio surpresa&quot;: todos os destinatários ganham.</p>
        </Gatilho>
        <Gatilho titulo="Depois da avaliação" selo={<Selo tom="aviso">não recomendado</Selo>}>
          <p className="text-secondary-foreground">
            O Google proíbe dar benefício em troca de avaliação, boa ou ruim, e pode tirar as avaliações do ar e bloquear o perfil. A lei de
            promoções trata a avaliação como &quot;outro critério além da compra&quot;. No lugar dele, use &quot;Pedido entregue&quot;: o prêmio sai
            na entrega, antes de qualquer pedido de nota.
          </p>
        </Gatilho>
        <Gatilho titulo="Aleatório, alguns por dia" selo={<Selo tom="critico">sorteio · precisa de autorização</Selo>}>
          <p className="text-secondary-foreground">
            Escolher clientes por sorte, em quantidade limitada, é sorteio: a lei exige autorização da Secretaria de Prêmios e Apostas (Ministério
            da Fazenda), pedida com 40 a 120 dias de antecedência e com regulamento. Fica travado até o certificado de autorização.
          </p>
        </Gatilho>
      </section>

      {gaveta && (
        <GavetaDoGatilho
          painel={painel}
          ligar={gaveta.ligar}
          aoFechar={() => setGaveta(null)}
          aoSalvar={(p) => {
            aoMudar(p);
            setGaveta(null);
          }}
          aoIrParaPremios={() => {
            setGaveta(null);
            aoIrParaPremios();
          }}
        />
      )}
    </div>
  );
}
