'use client';

import { useId, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import {
  DESCRICAO_DO_CANAL,
  NOME_NA_FRASE,
  fimDaPrevia,
  fraseDaPrevia,
  montarMensagemDaPausa,
  voltaDaPrevia,
  type EstadoDasPausas,
} from '@/lib/pausa-dos-pedidos';
import { AvisoDaPausa, MensagemComDestaque } from './aviso-da-pausa';

/** Botão de escolha (motivo, tempo): o marcado em dourado, com `aria-pressed`. */
function Opcao({ marcado, onClick, children }: { marcado: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={marcado}
      onClick={onClick}
      className={cn(
        'rounded-lg border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        marcado ? 'border-primary bg-primary/15 font-semibold text-foreground' : 'border-border bg-card text-foreground hover:border-primary/60',
      )}
    >
      {children}
    </button>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-2 font-display text-xs font-bold uppercase tracking-wide text-muted-foreground">{titulo}</legend>
      {children}
    </fieldset>
  );
}

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

/**
 * "Pausar pedidos" (mig 392; protótipo `mockups/regem-pausa.html`, painel): o que pausar (cada canal com a sua pausa), o
 * motivo (pronto ou escrito), por quanto tempo e o que o cliente vai ver. Só aparecem os canais que dá para pausar daqui
 * agora — o iFood e a 99 entram quando a pausa pela API deles estiver ligada.
 */
export function DialogoPausa({
  estado,
  aoFechar,
  aoPausar,
}: {
  estado: EstadoDasPausas;
  aoFechar: () => void;
  aoPausar: (novo: EstadoDasPausas) => void;
}) {
  const disponiveis = estado.canais.filter((c) => c.disponivel);
  // F5: o iFood ou a 99 que a empresa tem mas não dá para pausar daqui agora aparecem apagados, com o porquê.
  const semPoder = estado.canais.filter((c) => !c.disponivel && c.canal !== 'cardapio' && c.motivo);
  const [canais, setCanais] = useState<Set<string>>(() => new Set(disponiveis.slice(0, 1).map((c) => c.canal)));
  const [motivo, setMotivo] = useState('pedidos');
  const [outro, setOutro] = useState('');
  const [livre, setLivre] = useState<string>('30');
  // A 99 só aceita 10, 20 ou 30 min ou "até o fim do dia" (`fim`).
  const [livre99, setLivre99] = useState<string>('30');
  const temposDa99 = estado.temposDa99?.length ? estado.temposDa99 : [10, 20, 30];
  // A hora do "Até": daqui a uma hora, arredondada para a dezena (o seletor nativo troca).
  const [ate, setAte] = useState(() => {
    const d = new Date(Date.now() + 60 * 60_000);
    d.setMinutes(Math.ceil(d.getMinutes() / 10) * 10, 0, 0);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const idOutro = useId();
  const idAte = useId();

  const tempo = livre === 'ate' ? { ate } : { minutos: Number(livre) };
  const tempo99 = livre99 === 'fim' ? { fimDoDia: true } : { minutos: Number(livre99) };
  // O tempo "livre" vale para o cardápio digital e o iFood; a 99 tem o dela.
  const comTempoLivre = canais.has('cardapio') || canais.has('ifood');
  const tituloDoTempo = canais.has('cardapio') && canais.has('ifood') ? 'Cardápio digital e iFood' : canais.has('ifood') ? 'iFood' : 'Cardápio digital';
  const comExterno = canais.has('ifood') || canais.has('food99');
  const semMotivo = motivo === 'outro' && !outro.trim();
  const n = canais.size;
  const falta = estado.escolherLoja
    ? 'Escolha a loja no topo da tela.'
    : n === 0
      ? 'Escolha o que pausar.'
      : semMotivo
        ? 'Escreva o motivo.'
        : null;

  const previa = useMemo(() => {
    const agora = new Date();
    // A prévia mostra a volta do cardápio digital (ou do iFood); só com a 99 escolhida, a da 99.
    const fim = fimDaPrevia(comTempoLivre || !canais.has('food99') ? tempo : tempo99, agora);
    const frase = fraseDaPrevia(estado.motivos.find((m) => m.motivo === motivo)?.frase, outro);
    return fim ? { frase, volta: voltaDaPrevia(fim, agora) } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motivo, outro, livre, livre99, ate, canais, estado.motivos]);

  const rotuloDoBotao = n === 0 ? '⏸ Pausar' : n === 1 ? `⏸ Pausar ${NOME_NA_FRASE[[...canais][0]] ?? 'o canal'}` : `⏸ Pausar ${n} canais`;

  async function pausar() {
    if (falta || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const novo = (await api.deliveryPausar({
        canais: [...canais],
        motivo,
        ...(motivo === 'outro' ? { motivoTexto: outro.trim() } : {}),
        ...(comTempoLivre ? { tempo } : {}),
        ...(canais.has('food99') ? { tempo99 } : {}),
      })) as EstadoDasPausas;
      const p = novo.canais.find((c) => canais.has(c.canal))?.pausa;
      const destino = canais.has('ifood') && canais.has('food99') ? 'ao iFood e à 99' : canais.has('ifood') ? 'ao iFood' : 'à 99';
      const fora = comExterno ? ` · o pedido de pausa vai ${destino} em instantes` : '';
      toast.success(p ? `Pausado até ${p.volta.amanha ? 'amanhã às ' : ''}${p.volta.hora} · motivo registrado${fora}` : `Pausado · motivo registrado${fora}`);
      aoPausar(novo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para pausar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      titulo="Pausar pedidos"
      aoFechar={aoFechar}
      rodape={
        <>
          {falta && <span className="mr-auto self-center text-sm text-muted-foreground">{falta}</span>}
          <Button type="button" variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button type="button" onClick={pausar} disabled={!!falta || enviando}>
            {enviando ? 'Pausando…' : rotuloDoBotao}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">Escolha o que pausar. Cada canal tem a sua pausa — dá para pausar só um.</p>
        {estado.escolherLoja && (
          <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
            Esta empresa tem um cardápio digital em cada loja: escolha a loja no topo da tela para pausar o dela.
          </p>
        )}

        <Grupo titulo="1 · O que pausar">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {disponiveis.map((c, i) => {
              const marcado = canais.has(c.canal);
              return (
                <button
                  key={c.canal}
                  type="button"
                  aria-pressed={marcado}
                  data-foco-inicial={i === 0 ? '' : undefined}
                  onClick={() =>
                    setCanais((s) => {
                      const x = new Set(s);
                      if (x.has(c.canal)) x.delete(c.canal);
                      else x.add(c.canal);
                      return x;
                    })
                  }
                  className={cn(
                    'min-w-0 rounded-xl border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    marcado ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/60',
                  )}
                >
                  <span className="flex items-center gap-2 font-display text-sm font-bold">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'grid h-5 w-5 shrink-0 place-items-center rounded-md border text-xs',
                        marcado ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-transparent',
                      )}
                    >
                      ✓
                    </span>
                    {c.nome}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{DESCRICAO_DO_CANAL[c.canal] ?? ''}</span>
                  {/* A cor fica na bolinha: o laranja e o verde como letra pequena não chegam a 4,5:1 no branco. */}
                  <span className="mt-1 flex items-center gap-1.5 text-xs font-semibold">
                    <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', c.pausa ? 'bg-warn' : 'bg-ok')} />
                    {c.pausa ? `pausado até ${c.pausa.volta.amanha ? 'amanhã às ' : ''}${c.pausa.volta.hora}` : c.canal === 'food99' ? 'aberta agora' : 'aberto agora'}
                  </span>
                </button>
              );
            })}
            {semPoder.map((c) => (
              <div key={c.canal} aria-disabled="true" className="min-w-0 rounded-xl border-2 border-dashed border-border bg-card p-3 text-left">
                <span className="font-display text-sm font-bold text-muted-foreground">{c.nome}</span>
                <span className="mt-1 block text-xs text-foreground">{c.motivo}</span>
              </div>
            ))}
          </div>
          {!disponiveis.length && <p className="text-sm text-muted-foreground">Nada para pausar nesta loja pelo Regem.</p>}
        </Grupo>

        <Grupo titulo="2 · Por que vai pausar?">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Motivo">
            {estado.motivos.map((m) => (
              <Opcao key={m.motivo} marcado={motivo === m.motivo} onClick={() => setMotivo(m.motivo)}>
                {m.motivo === 'outro' ? 'Outro motivo…' : m.rotulo}
              </Opcao>
            ))}
          </div>
          {motivo === 'outro' && (
            <div className="mt-3">
              <label htmlFor={idOutro} className="mb-1 block text-sm font-medium">
                Escreva o motivo (o cliente lê)
              </label>
              <input
                id={idOutro}
                value={outro}
                maxLength={estado.motivoTextoMax}
                onChange={(e) => setOutro(e.target.value)}
                placeholder="Ex.: estamos trocando o gás"
                autoComplete="off"
                autoFocus
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="mt-1 block text-right font-mono text-xs text-muted-foreground">
                {outro.length}/{estado.motivoTextoMax}
              </span>
            </div>
          )}
        </Grupo>

        <Grupo titulo="3 · Por quanto tempo">
          {comTempoLivre && canais.has('food99') && (
            <p className="mb-1 text-xs font-semibold text-muted-foreground">{tituloDoTempo}</p>
          )}
          <div className={cn('flex flex-wrap items-center gap-2', !comTempoLivre && 'hidden')} role="group" aria-label={`Tempo: ${tituloDoTempo}`}>
            {estado.temposDoCardapio.map((m) => (
              <Opcao key={m} marcado={livre === String(m)} onClick={() => setLivre(String(m))}>
                {m === 60 ? '1 hora' : `${m} min`}
              </Opcao>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <Opcao marcado={livre === 'ate'} onClick={() => setLivre('ate')}>
                Até
              </Opcao>
              <label htmlFor={idAte} className="sr-only">
                Hora de reabrir
              </label>
              <input
                id={idAte}
                type="time"
                value={ate}
                onChange={(e) => {
                  setAte(e.target.value);
                  setLivre('ate');
                }}
                className="h-9 rounded-md border border-input bg-card px-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </span>
          </div>
          {canais.has('food99') && (
            <div className={cn(comTempoLivre && 'mt-3')}>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">99 · a 99 só aceita estes tempos</p>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Tempo da 99">
                {temposDa99.map((m) => (
                  <Opcao key={m} marcado={livre99 === String(m)} onClick={() => setLivre99(String(m))}>
                    {m} min
                  </Opcao>
                ))}
                <Opcao marcado={livre99 === 'fim'} onClick={() => setLivre99('fim')}>
                  Até o fim do dia
                </Opcao>
              </div>
            </div>
          )}
        </Grupo>

        <Grupo titulo="4 · O cliente vai ver">
          {previa && estado.mensagemModelo ? (
            // F3 (mig 394): a mensagem pronta como o cliente recebe no WhatsApp (o nome de exemplo é "Ana").
            <div className="rounded-xl bg-secondary p-3">
              <MensagemComDestaque
                texto={montarMensagemDaPausa(estado.mensagemModelo, { nome: 'Ana', frase: previa.frase, volta: previa.volta })}
                className="max-w-md rounded-lg rounded-tl-none bg-card p-3 text-sm shadow-sm"
              />
            </div>
          ) : previa ? (
            <AvisoDaPausa frase={previa.frase} volta={previa.volta} className="rounded-xl border border-warn/40 bg-warn/10 p-3" />
          ) : (
            <p className="text-sm text-muted-foreground">Escolha a hora de reabrir.</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {estado.mensagemModelo
              ? 'O atendente manda esta mensagem na primeira vez que o cliente escrever durante a pausa (WhatsApp, Instagram e Messenger — nos dois últimos, sem o negrito). No cardápio online aparece o aviso da pausa, e o pedido é recusado com o motivo e a hora de volta. O texto se muda em Delivery › Configurações › Atendimento.'
              : 'No cardápio online. O pedido feito pelo site ou pelo atendente do WhatsApp, Instagram e Messenger é recusado com o motivo e a hora de volta.'}
          </p>
          {comExterno && (
            <p className="mt-1 text-xs text-muted-foreground">
              {canais.has('ifood') && canais.has('food99') ? 'No iFood e na 99' : canais.has('ifood') ? 'No iFood' : 'Na 99'}, a loja aparece fechada
              temporariamente no app até a hora de reabrir — o Regem pede a pausa e mostra na faixa quando o canal aceitou.
            </p>
          )}
        </Grupo>

        {erro && (
          <p role="alert" className="font-medium text-destructive">
            {erro}
          </p>
        )}
        {disponiveis.some((c) => c.pausa && canais.has(c.canal)) && (
          <p className="text-xs text-muted-foreground">
            Já pausado ({disponiveis
              .filter((c) => c.pausa && canais.has(c.canal))
              .map((c) => `${c.nome}, desde ${hora(c.pausa!.pausadoEm)}`)
              .join('; ')}): pausar de novo troca o motivo e a hora de reabrir.
          </p>
        )}
      </div>
    </Dialogo>
  );
}
