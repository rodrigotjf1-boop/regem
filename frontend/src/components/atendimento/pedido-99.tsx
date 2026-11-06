'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useSenhaSemSalvar } from '@/lib/use-senha-sem-salvar';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { hora, tempoAte, type CasoDaFila } from '@/lib/atendimento';

// O PEDIDO DE CANCELAMENTO OU DE REEMBOLSO DO CLIENTE DA 99 no caso da central (Onda 1, PR 3 — protótipo v2 aprovado em
// 02/11/2026). Mostra o que o cliente escreveu à 99 (e as fotos, no reembolso), o relógio e o que acontece sem resposta, e
// responde UMA vez: aceitar ou recusar com um motivo da lista que a 99 mandou neste pedido. Só gerente e presidente
// respondem — a senha diz quem (o servidor confere).

/** Os motivos de recusa do CANCELAMENTO (`reason_list` da 99), como a equipe fala. Desconhecido aparece como veio. */
export const MOTIVO_CANCELAMENTO_99: Record<string, string> = {
  preparing: 'O pedido já está em preparo',
  prepared: 'O pedido já está pronto',
  'courier arrived': 'O entregador já chegou à loja',
  'courier taken': 'O entregador já levou o pedido',
};

/** Os motivos de recusa do REEMBOLSO (`base_reason_list` da 99, pelo nome), como a equipe fala. */
export const MOTIVO_REEMBOLSO_99: Record<string, string> = {
  'Communication with user redo a Delivery': 'Combinado com o cliente: entregar de novo',
  'Communication with user replace with others': 'Combinado com o cliente: trocar por outro item',
  'The merchandise already give courier': 'O pedido já foi entregue ao entregador',
  'Courier sent miss': 'O entregador errou a entrega',
  'User misunderstands': 'O cliente se enganou',
  'I just want refund a part': 'Reembolso só de uma parte',
  'Missing user information': 'Faltam dados do cliente',
  Other: 'Outro',
};

/** O texto da 99 traduzido (sem diferença de maiúscula); o que não conhecemos aparece como veio. */
export function traduzir99(mapa: Record<string, string>, s: string | null | undefined): string {
  if (!s) return '';
  const k = Object.keys(mapa).find((m) => m.toLowerCase() === s.trim().toLowerCase());
  return k ? mapa[k] : s;
}

const AJUSTE = '/delivery/configuracoes?aba=atendimento';

type Pedido99 = {
  tipo: 'cancelamento' | 'reembolso';
  pedidoExterno: string;
  motivoDoCliente: string | null;
  motivosDeRecusa: string[];
  motivosDoReembolso: Array<{ id: string; motivo: string }>;
  fotos: string[];
};

export function Pedido99({ caso: c, agora, aoMudar }: { caso: CasoDaFila; agora: number | null; aoMudar: () => Promise<void> }) {
  const p: Pedido99 | undefined = c.detalhe?.pedido99;
  const resposta = c.detalhe?.resposta;
  const recusando = !!c.detalhe?.recusaAutomatica;
  const semMotivo = !!c.detalhe?.semMotivoParaRecusar;
  const [acao, setAcao] = useState<'aceitar' | 'recusar' | null>(null);
  if (!p) return null;
  const cancelamento = p.tipo === 'cancelamento';
  const prazo = c.prazoEm && agora ? tempoAte(c.prazoEm, agora) : '';
  // O cancelamento fecha no prazo (a 99 recusa sozinha); o reembolso segue respondível até o Regem recusar (ou, sem a
  // lista de motivos, até as 24 h da 99 — o prazo do caso passa a ser esse).
  const aberta = c.situacao !== 'resolvido' && !resposta && !recusando && !((cancelamento || semMotivo) && prazo === 'venceu');
  const podeRecusar = cancelamento || p.motivosDoReembolso.length > 0;

  return (
    <div className="space-y-4">
      {aberta && prazo && prazo !== 'venceu' && (
        <div
          className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-3 ${cancelamento ? 'border-destructive/40 bg-destructive/10' : 'border-warn/40 bg-warn/10'}`}
        >
          <span className="font-mono text-3xl font-bold leading-none">{prazo}</span>
          <span className="min-w-0 flex-1 basis-56 text-sm">
            {cancelamento ? (
              <>
                Se ninguém responder até {hora(c.prazoEm)}, a <b>99 recusa sozinha</b> (regra da 99: a loja tem 5 min). Para o Regem
                aceitar na hora, sem passar pela fila, desligue o ajuste em{' '}
                <Link href={AJUSTE} className="font-semibold underline">
                  Delivery › Configurações › Atendimento
                </Link>
                .
              </>
            ) : semMotivo ? (
              <>
                O Regem não pôde recusar sozinho: a 99 não mandou a lista de motivos neste pedido. Aceite aqui ou recuse pelo app
                99Food Parceiros. Se ninguém responder até {hora(c.prazoEm)}, a <b>99 reembolsa sozinha</b> (24 h da 99).
              </>
            ) : (
              <>
                Se ninguém responder até {hora(c.prazoEm)}, o <b>Regem recusa</b> com o motivo do ajuste. Sem a recusa, a 99
                reembolsaria sozinha em 24 h.
              </>
            )}
          </span>
        </div>
      )}

      <section className="rounded-lg border border-border p-3">
        <h4 className="mb-1 flex flex-wrap items-baseline gap-x-2 font-display text-sm font-bold">
          O que o cliente escreveu à 99
          <span className="font-body text-xs font-semibold text-secondary-foreground">{cancelamento ? 'quer cancelar o pedido' : 'pede reembolso'}</span>
        </h4>
        <p className="whitespace-pre-line break-words text-sm">{p.motivoDoCliente ? `"${p.motivoDoCliente}"` : 'O cliente não escreveu nada.'}</p>
        {p.fotos.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Fotos do cliente">
            {p.fotos.map((u, n) => (
              <li key={u}>
                <a
                  href={u}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex min-h-10 items-center rounded-md border border-input px-3 text-sm font-semibold hover:border-secondary-foreground"
                >
                  Ver a foto {n + 1} <span className="sr-only">(abre em outra aba)</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border p-3 text-sm">
        <h4 className="mb-1 font-display text-sm font-bold">Chat da 99</h4>
        <p>A conversa com o cliente fica no app 99Food Parceiros. A 99 não libera o chat para sistemas.</p>
      </section>

      {aberta ? (
        <section className="space-y-2">
          <h4 className="font-display text-sm font-bold">Responder à 99</h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button type="button" className="h-auto min-h-11 whitespace-normal bg-destructive py-2 text-white hover:bg-destructive/90" onClick={() => setAcao('aceitar')}>
              {cancelamento ? 'Aceitar o cancelamento' : 'Aceitar o reembolso'}
            </Button>
            <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal py-2" disabled={!podeRecusar} onClick={() => setAcao('recusar')}>
              Recusar
            </Button>
          </div>
          {!podeRecusar && <p className="text-xs text-secondary-foreground">Recusar só pelo app 99Food Parceiros: a 99 não mandou a lista de motivos.</p>}
          <p className="text-xs text-secondary-foreground">
            🔒 Só gerente e presidente respondem, com a senha. A 99 aceita uma resposta só.{' '}
            <Link href={AJUSTE} className="font-semibold underline">
              Mudar o ajuste da 99
            </Link>
          </p>
        </section>
      ) : (
        <ComoFicou caso={c} pedido={p} prazoVenceu={prazo === 'venceu'} />
      )}

      {acao && <Responder99 caso={c} pedido={p} acao={acao} aoFechar={() => setAcao(null)} aoResponder={aoMudar} />}
    </div>
  );
}

function ComoFicou({ caso: c, pedido: p, prazoVenceu }: { caso: CasoDaFila; pedido: Pedido99; prazoVenceu: boolean }) {
  const resposta = c.detalhe?.resposta;
  const encerramento = c.detalhe?.encerramento;
  const cancelamento = p.tipo === 'cancelamento';
  const oQue = cancelamento ? 'o cancelamento' : 'o reembolso';
  const motivo = (m: string | null | undefined) => traduzir99(cancelamento ? MOTIVO_CANCELAMENTO_99 : MOTIVO_REEMBOLSO_99, m);
  let texto: string;
  if (resposta?.automatico) texto = `O Regem recusou ${oQue} sozinho: o tempo do ajuste acabou${resposta.motivo ? ` · ${motivo(resposta.motivo)}` : ''}${resposta.em ? ` · às ${hora(resposta.em)}` : ''}.`;
  else if (resposta)
    // `via` = "whatsapp": a resposta saiu pelo WhatsApp de quem decide (Gerente no WhatsApp, mig 375, parte 5b).
    texto = `${resposta.por ? `${resposta.por} ` : 'A loja '}${resposta.acao === 'aceitar' ? 'aceitou' : 'recusou'} ${oQue}${resposta.motivo ? ` · ${motivo(resposta.motivo)}` : ''}${resposta.em ? ` · às ${hora(resposta.em)}` : ''}${resposta.via === 'whatsapp' ? ' · pelo WhatsApp' : ''}.`;
  else if (c.decisao === 'aceito_automatico') texto = 'O Regem aceitou o cancelamento na hora: o ajuste "decidir na fila" está desligado.';
  else if (encerramento?.status === 'RECUSADO_PELA_99' || (cancelamento && prazoVenceu))
    texto = 'Ninguém respondeu em 5 min: a 99 recusou o cancelamento sozinha. O pedido segue.';
  else if (encerramento?.status === 'REEMBOLSADO_PELA_99' || (c.detalhe?.semMotivoParaRecusar && prazoVenceu))
    texto = 'Ninguém respondeu nas 24 h da 99: ela reembolsou o cliente sozinha.';
  else if (c.detalhe?.recusaAutomatica) texto = `O Regem está recusando ${oQue} agora: o tempo do ajuste acabou.`;
  else texto = 'Este pedido já foi respondido.';
  return (
    <section className="rounded-lg border border-border bg-secondary/40 p-3 text-sm">
      <h4 className="mb-1 font-display text-sm font-bold">Como ficou</h4>
      <p>{texto}</p>
      {resposta?.explicacao && <p className="mt-1 text-secondary-foreground">Explicação enviada: "{resposta.explicacao}"</p>}
    </section>
  );
}

function Responder99({
  caso,
  pedido: p,
  acao,
  aoFechar,
  aoResponder,
}: {
  caso: CasoDaFila;
  pedido: Pedido99;
  acao: 'aceitar' | 'recusar';
  aoFechar: () => void;
  aoResponder: () => Promise<void>;
}) {
  const cancelamento = p.tipo === 'cancelamento';
  // Cancelamento: a lista que veio (ou, se não veio, as quatro da documentação). Reembolso: a lista deste pedido, por id.
  const motivosCancel = p.motivosDeRecusa.length ? p.motivosDeRecusa : Object.keys(MOTIVO_CANCELAMENTO_99);
  const [motivo, setMotivo] = useState(cancelamento ? motivosCancel[0] ?? '' : p.motivosDoReembolso[0]?.id ?? '');
  const [explicacao, setExplicacao] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const campoSenha = useSenhaSemSalvar();

  const titulo = acao === 'aceitar' ? (cancelamento ? 'Aceitar o cancelamento' : 'Aceitar o reembolso') : cancelamento ? 'Recusar o cancelamento' : 'Recusar o reembolso';
  const efeito =
    acao === 'aceitar'
      ? cancelamento
        ? 'A 99 recebe o aceite e cancela o pedido.'
        : 'A 99 recebe o aceite e reembolsa o cliente.'
      : 'A 99 recebe a recusa com o motivo escolhido.';

  async function enviar() {
    if (enviando) return;
    setErro('');
    if (!senha.trim()) return setErro('Informe a senha de quem decide.');
    if (acao === 'recusar' && !motivo) return setErro('Escolha o motivo da recusa.');
    const corpo: { aceita: boolean; motivo?: string; motivoId?: string; explicacao?: string; senha: string } = { aceita: acao === 'aceitar', senha };
    if (acao === 'recusar') {
      if (cancelamento) corpo.motivo = motivo;
      else {
        corpo.motivoId = motivo;
        if (explicacao.trim()) corpo.explicacao = explicacao.trim();
      }
    }
    setEnviando(true);
    try {
      await api.atendimentoResponderPedido99(caso.id, corpo);
      toast.success('Resposta enviada à 99.');
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
            className={acao === 'aceitar' ? 'bg-destructive text-white hover:bg-destructive/90' : ''}
            disabled={enviando || !senha.trim()}
            onClick={() => void enviar()}
          >
            Enviar à 99
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          {efeito} <b>A loja não pode responder de novo depois.</b>
        </p>
        {acao === 'recusar' && (
          <label className="block space-y-1">
            <span className="font-semibold">Motivo (a lista vem da 99 neste pedido)</span>
            <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3">
              {cancelamento
                ? motivosCancel.map((m) => (
                    <option key={m} value={m}>
                      {traduzir99(MOTIVO_CANCELAMENTO_99, m)}
                    </option>
                  ))
                : p.motivosDoReembolso.map((m) => (
                    <option key={m.id} value={m.id}>
                      {traduzir99(MOTIVO_REEMBOLSO_99, m.motivo)}
                    </option>
                  ))}
            </select>
          </label>
        )}
        {acao === 'recusar' && !cancelamento && (
          <label className="block space-y-1">
            <span className="font-semibold">Explicação para a 99 (opcional)</span>
            <input value={explicacao} maxLength={200} onChange={(e) => setExplicacao(e.target.value)} className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3" />
          </label>
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
