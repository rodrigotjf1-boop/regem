'use client';

import Link from 'next/link';
import type { SituacaoDaPonte } from '@/lib/atendimento';
import { COMO_RETOMAR_A_PONTE } from '@/lib/ponte-do-chat';

// A FAIXA DA PONTE DO CHAT no topo da tela Atendimento (ponte do chat do iFood e da 99, parte A2 — protótipo
// `mockups/regem-central-atendimento.html` v3). Desligada (ou sem leitura, como no servidor da loja): nada.
// Ligada: por canal conectado, por qual PC o chat passa e qual fica de reserva; algum canal sem PC respondendo: o aviso
// de que o que o Regem manda no chat espera a ponte voltar e, depois de 30 min, não sai mais (a regra do `pegar` em
// `ponte-chat.service.ts`). As mensagens dos clientes entram na fila na etapa 2; até lá a faixa não diz que entram aqui.

type Canal = 'ifood' | '99food';
type DoCanal = { responde: { nome: string; maquina: string | null } | null; reservas: string[] };

const NOME: Record<Canal, string> = { ifood: 'iFood', '99food': '99' };
const NO: Record<Canal, string> = { ifood: 'no iFood', '99food': 'na 99' };

/** "agora" / "há 3 min" / "há 2 h" — `agora` só existe depois de montar (V35). */
export function haQuanto(iso: string | null, agora: number | null): string | null {
  if (!iso || agora === null) return null;
  const min = Math.max(0, Math.floor((agora - new Date(iso).getTime()) / 60_000));
  return min < 1 ? 'agora' : min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h`;
}

/** "iFood e 99 pela ponte do PC do delivery · reserva do iFood: Servidor da loja" (os canais que têm PC respondendo). */
export function porOndePassa(canais: [Canal, DoCanal][]): string {
  const comPc = canais.filter(([, c]) => c.responde);
  if (!comPc.length) return '';
  const nomes = new Set(comPc.map(([, c]) => c.responde!.nome));
  const partes =
    nomes.size === 1
      ? [`${comPc.map(([k]) => NOME[k]).join(' e ')} pela ponte do ${comPc[0][1].responde!.nome}`]
      : comPc.map(([k, c]) => `${NOME[k]} pela ponte do ${c.responde!.nome}`);
  for (const [k, c] of comPc)
    if (c.reservas.length) partes.push(`reserva${canais.length > 1 ? ` do ${NOME[k]}` : ''}: ${c.reservas.join(' e ')}`);
  return partes.join(' · ');
}

export function FaixaDaPonte({ ponte, agora }: { ponte: SituacaoDaPonte | null; agora: number | null }) {
  if (!ponte || !ponte.ligada) return null;
  const canais = (Object.entries(ponte.canais) as [Canal, DoCanal | undefined][]).filter(
    (x): x is [Canal, DoCanal] => !!x[1] && x[0] in NOME,
  );
  if (!canais.length)
    return (
      <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-secondary-foreground" role="status" data-ponte="sem-canal">
        A ponte do chat está ligada, mas nem o iFood nem a 99 estão conectados nesta empresa.
      </p>
    );

  const semPc = canais.filter(([, c]) => !c.responde).map(([k]) => k);
  const passa = porOndePassa(canais);
  const ultima = haQuanto(ponte.ultimaMensagemEm, agora);
  // pausada pela pessoa no PC (mig 368): o que fazer é retomar lá, não "entrar no iFood"
  const pausadas = ponte.pausadas ?? [];

  if (semPc.length)
    return (
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
        role="alert"
        data-ponte="sem-sinal"
      >
        <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-bold text-destructive">
          ⚠️ Ponte do chat {pausadas.length ? 'pausada' : 'sem sinal'} {semPc.map((k) => NO[k]).join(' e ')}
        </span>
        <span className="min-w-0 flex-1 basis-64 break-words">
          O que o Regem manda no chat (saiu para entrega, entregador chegando) espera a ponte voltar; o que passar de
          30 min não sai mais.{' '}
          {pausadas.length ? (
            <>
              Pausada pela loja: {pausadas.join(' e ')}. {COMO_RETOMAR_A_PONTE}
            </>
          ) : ponte.pontes ? (
            <>
              No PC da ponte, abra o programa Regem · Ponte do chat e entre {semPc.map((k) => NO[k]).join(' e ')}.
            </>
          ) : (
            <>
              Nenhum PC está cadastrado como ponte: cadastre e pareie em{' '}
              <Link href="/equipamentos" className="font-semibold underline underline-offset-2">
                Configurações › Equipamentos
              </Link>
              .
            </>
          )}
          {passa && <span className="text-secondary-foreground"> · {passa}</span>}
        </span>
      </div>
    );

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-sm"
      role="status"
      data-ponte="ligada"
    >
      <span className="rounded-full border border-ok/40 bg-ok/15 px-2 py-0.5 text-xs font-bold text-foreground">🔗 Ponte do chat ligada</span>
      <span className="min-w-0 flex-1 basis-64 break-words text-secondary-foreground">
        {passa}
        {pausadas.length ? ` · pausada: ${pausadas.join(' e ')}` : ''}
        {ultima ? ` · última mensagem do cliente ${ultima}` : ''}
      </span>
    </div>
  );
}
