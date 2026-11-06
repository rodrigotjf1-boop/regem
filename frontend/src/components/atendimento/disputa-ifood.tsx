'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useSenhaSemSalvar } from '@/lib/use-senha-sem-salvar';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { hora, tempoAte, type CasoDaFila } from '@/lib/atendimento';

// A DISPUTA DO iFOOD no caso da central (Onda 1, PR 2 — protótipo aprovado em 02/11/2026). Mostra o que o iFood mandou
// (a fala do cliente, as fotos, os itens, o prazo e o que ele faz sozinho sem resposta) e responde UMA vez: aceitar,
// recusar ou o que o iFood ofereceu (devolver parte do valor, crédito, mais tempo). Só gerente e presidente respondem — a
// senha diz quem (o servidor confere; supervisão não vale aqui).

/** Os motivos do iFood (`negotiationReasons` e os de aceite), como a equipe fala. Código desconhecido aparece como veio. */
export const MOTIVO_IFOOD: Record<string, string> = {
  HIGH_STORE_DEMAND: 'Loja em capacidade máxima',
  UNKNOWN_ISSUE: 'Problema não especificado',
  CUSTOMER_SATISFACTION: 'Satisfação do cliente',
  INVENTORY_CHECK: 'Verificação de disponibilidade',
  SYSTEM_ISSUE: 'Problema técnico',
  WRONG_ORDER: 'Pedido incorreto',
  PRODUCT_QUALITY: 'Qualidade do produto',
  LATE_DELIVERY: 'Entrega atrasada',
  CUSTOMER_REQUEST: 'Solicitação do cliente',
};
const MOTIVOS_DE_RECUSA = Object.keys(MOTIVO_IFOOD);
const motivo = (c: string | null | undefined) => (c ? MOTIVO_IFOOD[c] ?? c : '');

const QUANDO: Record<string, string> = {
  AFTER_DELIVERY: 'depois da entrega',
  AFTER_DELIVERY_PARTIALLY: 'parte do pedido, depois da entrega',
  DELAY: 'pedido atrasado',
  PREPARATION_TIME: 'durante o preparo',
};
const O_QUE_PEDE: Record<string, string> = {
  CANCELLATION: 'cancelar o pedido',
  PARTIAL_CANCELLATION: 'cancelar parte do pedido',
  PROPOSED_AMOUNT_REFUND: 'receber parte do valor de volta',
  PROPOSED_ADDITIONAL_TIME: 'mais tempo',
};
/** O que o iFood faz sozinho se ninguém responder (`timeoutAction`, doc oficial). */
const SOZINHO: Record<string, string> = {
  ACCEPT_CANCELLATION: 'o iFood aceita sozinho: cancela e o cliente recebe o valor de volta.',
  REJECT_CANCELLATION: 'o iFood recusa sozinho o pedido do cliente.',
  VOID: 'nada acontece sozinho, mas a loja perde a chance de responder.',
};
const brl = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const NOME_DA_PROPOSTA: Record<string, string> = {
  REFUND: 'Devolver parte do valor',
  BENEFIT: 'Crédito para o cliente no iFood',
  ADDITIONAL_TIME: 'Pedir mais tempo',
};

type Alternativa = { id: string; tipo: string; maxCentavos: number | null; minutos: number[]; motivos: string[] };
type Acao = { tipo: 'aceitar' } | { tipo: 'recusar' } | { tipo: 'propor'; alt: Alternativa };

export function DisputaIfood({ caso: c, agora, aoMudar }: { caso: CasoDaFila; agora: number | null; aoMudar: () => Promise<void> }) {
  const d = (c as any).detalhe?.disputa;
  const resposta = (c as any).detalhe?.resposta;
  const encerramento = (c as any).detalhe?.encerramento;
  const [acao, setAcao] = useState<Acao | null>(null);
  if (!d) return null;
  const prazo = c.prazoEm && agora ? tempoAte(c.prazoEm, agora) : '';
  const aberta = c.situacao !== 'resolvido' && !resposta && prazo !== 'venceu';
  const alternativas: Alternativa[] = Array.isArray(d.alternativas) ? d.alternativas : [];
  return (
    <div className="space-y-4">
      {aberta && prazo && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
          <span className="font-mono text-3xl font-bold leading-none">{prazo}</span>
          <span className="min-w-0 flex-1 basis-56 text-sm">
            Se ninguém responder até {hora(c.prazoEm)}, {SOZINHO[d.acaoAutomatica] ?? 'o iFood decide sozinho.'}
          </span>
        </div>
      )}

      <section className="rounded-lg border border-border p-3">
        <h4 className="mb-1 flex flex-wrap items-baseline gap-x-2 font-display text-sm font-bold">
          O que o cliente pede ao iFood
          <span className="font-body text-xs font-semibold text-secondary-foreground">
            {[O_QUE_PEDE[d.acao], QUANDO[d.tipo]].filter(Boolean).join(' · ')}
          </span>
        </h4>
        <p className="whitespace-pre-line break-words text-sm">{d.mensagem ? `"${d.mensagem}"` : 'O cliente não escreveu nada.'}</p>
        {Array.isArray(d.itens) && d.itens.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-sm" aria-label="Itens contestados">
            {d.itens.map((i: any, n: number) => (
              <li key={n} className="flex flex-wrap justify-between gap-x-3">
                <span className="min-w-0 break-words">
                  {i.quantidade}× {i.nome ?? i.codigo ?? 'item'}
                </span>
                {i.centavos != null && <span className="font-mono">{brl(i.centavos)}</span>}
              </li>
            ))}
          </ul>
        )}
        {Array.isArray(d.fotos) && d.fotos.length > 0 && <FotosDaDisputa casoId={c.id} total={d.fotos.length} />}
      </section>

      {aberta ? (
        <section className="space-y-2">
          <h4 className="font-display text-sm font-bold">Responder ao iFood</h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
            <Button type="button" className="h-auto min-h-11 whitespace-normal bg-destructive py-2 text-white hover:bg-destructive/90" onClick={() => setAcao({ tipo: 'aceitar' })}>
              Aceitar o pedido do cliente
            </Button>
            {alternativas.map((a) => (
              <Button key={a.id || a.tipo} type="button" variant="outline" className="h-auto min-h-11 whitespace-normal py-2" onClick={() => setAcao({ tipo: 'propor', alt: a })}>
                {NOME_DA_PROPOSTA[a.tipo] ?? a.tipo}
                {a.maxCentavos != null ? ` · até ${brl(a.maxCentavos)}` : ''}
              </Button>
            ))}
            <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal py-2" onClick={() => setAcao({ tipo: 'recusar' })}>
              Recusar
            </Button>
          </div>
          <p className="text-xs text-secondary-foreground">🔒 Só gerente e presidente respondem, com a senha. O iFood aceita uma resposta só por disputa.</p>
        </section>
      ) : (
        <section className="rounded-lg border border-border bg-secondary/40 p-3 text-sm">
          <h4 className="mb-1 font-display text-sm font-bold">Como ficou</h4>
          {resposta && (
            <p>
              {resposta.por ? `${resposta.por} ` : 'A loja '}
              {resposta.acao === 'aceitar'
                ? 'aceitou o pedido do cliente'
                : resposta.acao === 'recusar'
                  ? 'recusou o pedido do cliente'
                  : `propôs ${resposta.tipo === 'ADDITIONAL_TIME' ? `mais ${resposta.minutos} min` : `${NOME_DA_PROPOSTA[resposta.tipo]?.toLowerCase() ?? 'outra coisa'}${resposta.centavos ? ` (${brl(resposta.centavos)})` : ''}`}`}
              {resposta.motivo ? ` · ${motivo(resposta.motivo)}` : ''}
              {resposta.em ? ` · às ${hora(resposta.em)}` : ''}
              {/* Gerente no WhatsApp (mig 375, parte 5b): a resposta saiu pelo WhatsApp de quem decide. */}
              {resposta.via === 'whatsapp' ? ' · pelo WhatsApp' : ''}.
            </p>
          )}
          {encerramento ? (
            <p className="mt-1">
              O iFood encerrou:{' '}
              {encerramento.status === 'ACCEPTED'
                ? 'aceita'
                : encerramento.status === 'REJECTED'
                  ? 'recusada'
                  : encerramento.status === 'EXPIRED'
                    ? 'o prazo venceu e ele decidiu sozinho'
                    : encerramento.status === 'ALTERNATIVE_REPLIED'
                      ? 'o cliente aceitou a proposta'
                      : encerramento.status}
              .
            </p>
          ) : resposta ? (
            <p className="mt-1 text-secondary-foreground">Esperando o iFood confirmar o resultado.</p>
          ) : (
            <p className="text-secondary-foreground">O prazo venceu: o iFood decide sozinho.</p>
          )}
        </section>
      )}

      {acao && <ResponderDisputa caso={c} disputa={d} acao={acao} aoFechar={() => setAcao(null)} aoResponder={aoMudar} />}
    </div>
  );
}

function FotosDaDisputa({ casoId, total }: { casoId: string; total: number }) {
  const [fotos, setFotos] = useState<Record<number, string | 'erro' | 'carregando'>>({});
  useEffect(() => () => Object.values(fotos).forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u)), [fotos]);
  const ver = async (n: number) => {
    setFotos((f) => ({ ...f, [n]: 'carregando' }));
    try {
      const url = await api.atendimentoFotoUrl(casoId, n);
      setFotos((f) => ({ ...f, [n]: url }));
    } catch {
      setFotos((f) => ({ ...f, [n]: 'erro' }));
    }
  };
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {Array.from({ length: total }, (_, n) => {
        const f = fotos[n];
        if (f && f !== 'erro' && f !== 'carregando')
          return (
            <a key={n} href={f} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f} alt={`Foto ${n + 1} do cliente`} className="h-24 w-28 rounded-md border border-border object-cover" />
            </a>
          );
        return (
          <button
            key={n}
            type="button"
            onClick={() => void ver(n)}
            disabled={f === 'carregando'}
            className="grid h-24 w-28 place-items-center rounded-md border border-dashed border-input px-2 text-center text-xs text-secondary-foreground hover:border-secondary-foreground"
          >
            {f === 'carregando' ? 'Carregando…' : f === 'erro' ? 'Não veio. Tentar de novo' : `Ver a foto ${n + 1}`}
          </button>
        );
      })}
    </div>
  );
}

function ResponderDisputa({
  caso,
  disputa: d,
  acao,
  aoFechar,
  aoResponder,
}: {
  caso: CasoDaFila;
  disputa: any;
  acao: Acao;
  aoFechar: () => void;
  aoResponder: () => Promise<void>;
}) {
  const motivosAceite: string[] = Array.isArray(d.motivosParaAceitar) ? d.motivosParaAceitar : [];
  const alt = acao.tipo === 'propor' ? acao.alt : null;
  const [motivoSel, setMotivoSel] = useState(
    acao.tipo === 'aceitar' ? motivosAceite[0] ?? '' : acao.tipo === 'recusar' ? MOTIVOS_DE_RECUSA[3] : alt?.motivos?.[0] ?? '',
  );
  const [detalhe, setDetalhe] = useState('');
  const [valor, setValor] = useState('');
  const [minutos, setMinutos] = useState<number | null>(alt?.minutos?.[0] ?? null);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const campoSenha = useSenhaSemSalvar();
  const dinheiro = alt && (alt.tipo === 'REFUND' || alt.tipo === 'BENEFIT');

  const titulo =
    acao.tipo === 'aceitar' ? 'Aceitar o pedido do cliente' : acao.tipo === 'recusar' ? 'Recusar o pedido do cliente' : NOME_DA_PROPOSTA[alt!.tipo] ?? 'Propor';
  const efeito =
    acao.tipo === 'aceitar'
      ? d.acao === 'PARTIAL_CANCELLATION'
        ? 'O iFood cancela os itens contestados e o cliente recebe esse valor de volta.'
        : 'O iFood cancela o pedido e o cliente recebe o valor de volta.'
      : acao.tipo === 'recusar'
        ? 'O iFood registra a recusa da loja.'
        : 'O cliente vê a proposta no app do iFood e decide.';

  async function enviar() {
    if (enviando) return;
    setErro('');
    const corpo: Record<string, unknown> = { acao: acao.tipo, senha };
    if (acao.tipo === 'aceitar') {
      if (motivoSel) corpo.motivo = motivoSel;
      if (detalhe.trim()) corpo.detalhe = detalhe.trim();
    } else if (acao.tipo === 'recusar') {
      corpo.motivo = motivoSel;
    } else if (alt) {
      corpo.tipo = alt.tipo;
      if (dinheiro) {
        const v = Math.round(Number(String(valor).replace(/\./g, '').replace(',', '.')) * 100);
        if (!Number.isFinite(v) || v <= 0) return setErro('Informe o valor.');
        if (alt.maxCentavos != null && v > alt.maxCentavos) return setErro(`O iFood aceita no máximo ${brl(alt.maxCentavos)}.`);
        corpo.centavos = v;
      } else {
        corpo.minutos = minutos;
        if (motivoSel) corpo.motivo = motivoSel;
      }
    }
    if (!senha.trim()) return setErro('Informe a senha de quem decide.');
    setEnviando(true);
    try {
      await api.atendimentoResponderDisputa(caso.id, corpo);
      toast.success('Resposta enviada ao iFood.');
      aoFechar();
      await aoResponder();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível responder.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      titulo={titulo}
      alerta
      fecharNoFundo={false}
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>
            Voltar
          </Button>
          <Button
            type="button"
            className={acao.tipo === 'aceitar' ? 'bg-destructive text-white hover:bg-destructive/90' : ''}
            disabled={enviando || !senha.trim()}
            onClick={() => void enviar()}
          >
            Enviar ao iFood
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          {efeito} <b>A loja não pode responder de novo depois.</b>
        </p>
        {acao.tipo === 'aceitar' && motivosAceite.length > 0 && (
          <label className="block space-y-1">
            <span className="font-semibold">Motivo (a lista vem do iFood nesta disputa)</span>
            <select value={motivoSel} onChange={(e) => setMotivoSel(e.target.value)} className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3">
              {motivosAceite.map((m) => (
                <option key={m} value={m}>
                  {motivo(m)}
                </option>
              ))}
            </select>
          </label>
        )}
        {acao.tipo === 'aceitar' && (
          <label className="block space-y-1">
            <span className="font-semibold">Detalhe (opcional)</span>
            <input value={detalhe} maxLength={200} onChange={(e) => setDetalhe(e.target.value)} className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3" />
          </label>
        )}
        {acao.tipo === 'recusar' && (
          <label className="block space-y-1">
            <span className="font-semibold">Motivo (os da lista do iFood)</span>
            <select value={motivoSel} onChange={(e) => setMotivoSel(e.target.value)} className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3">
              {MOTIVOS_DE_RECUSA.map((m) => (
                <option key={m} value={m}>
                  {motivo(m)}
                </option>
              ))}
            </select>
          </label>
        )}
        {dinheiro && (
          <label className="block space-y-1">
            <span className="font-semibold">Valor (R$){alt?.maxCentavos != null ? ` · até ${brl(alt.maxCentavos)}` : ''}</span>
            <input value={valor} inputMode="decimal" onChange={(e) => setValor(e.target.value)} placeholder="Ex.: 6,00" className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3" />
          </label>
        )}
        {alt?.tipo === 'ADDITIONAL_TIME' && (
          <>
            <div className="space-y-1">
              <span className="font-semibold">Quanto tempo a mais</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Minutos a mais">
                {alt.minutos.map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={minutos === m}
                    onClick={() => setMinutos(m)}
                    className={`min-h-10 flex-1 rounded-md border px-3 ${minutos === m ? 'border-primary bg-primary/15 font-bold' : 'border-border'}`}
                  >
                    {m} min
                  </button>
                ))}
              </div>
            </div>
            {alt.motivos.length > 0 && (
              <label className="block space-y-1">
                <span className="font-semibold">Motivo do atraso (a lista vem do iFood)</span>
                <select value={motivoSel} onChange={(e) => setMotivoSel(e.target.value)} className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3">
                  {alt.motivos.map((m) => (
                    <option key={m} value={m}>
                      {motivo(m)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        <label className="block space-y-1">
          <span className="font-semibold">Senha de quem decide (gerente ou presidente)</span>
          <input {...campoSenha} value={senha} onChange={(e) => setSenha(e.target.value)} className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3" />
        </label>
        {erro && (
          <p className="text-destructive" role="alert">
            {erro}
          </p>
        )}
      </div>
    </Dialogo>
  );
}
