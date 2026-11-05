'use client';

import { porOndePassa } from '@/components/atendimento/faixa-da-ponte';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A PONTE DO CHAT EM EQUIPAMENTOS (peça 6 do protótipo de conexão, `mockups/regem-conexao-servidor.html` #p7): por loja,
// por qual PC passa o chat de cada canal conectado e qual fica de reserva — a mesma conta da faixa do Atendimento
// (`quemResponde`, que vem pronta em `e.ponte.canais`). Canal sem PC respondendo: o aviso, com o que fazer. Só aparece na
// nuvem (no servidor da loja a lista vem sem `ponte`) e com ao menos uma ponte cadastrada.

type Canal = 'ifood' | '99food';
type DoCanal = { responde: { nome: string; maquina: string | null } | null; reservas: string[] };
const NO: Record<Canal, string> = { ifood: 'no iFood', '99food': 'na 99' };

const pcDa = (e: any): string => e.ponte?.maquina || e.nome;

export function FaixaDaPonteNosPcs({ lista, nomeDaLoja }: { lista: any[]; nomeDaLoja: (unidadeId: string | null) => string }) {
  const pontes = lista.filter((e) => e.tipo === 'ponte_chat' && e.ativo !== false && e.ponte);
  if (!pontes.length) return null;
  if (!pontes.some((e) => e.ponte.ligada))
    return (
      <p className="rounded-md border-l-4 border-input bg-secondary px-3 py-2 text-sm" role="status" data-ponte-pcs="desligada">
        <strong>Ponte do chat desligada:</strong> as mensagens do chat do iFood e da 99 não entram no Atendimento. Ligue em Delivery ›
        Configurações › Atendimento, no grupo “iFood e 99 · chat pela ponte”.
      </p>
    );
  // Por loja quando há pontes em mais de uma (a sem loja entra em todas): a regra de quem responde é por loja.
  const nomeadas = [...new Set(pontes.map((e) => e.unidadeId).filter(Boolean))] as string[];
  const varias = nomeadas.length > 1;
  const lojas: (string | null)[] = varias ? nomeadas : [null];
  const linhas = lojas.map((u) => {
    const daLoja = pontes.filter((e) => !u || !e.unidadeId || e.unidadeId === u);
    const canais: [Canal, DoCanal][] = (['ifood', '99food'] as Canal[])
      .filter((c) => daLoja.some((e) => c in (e.ponte.canais ?? {})))
      .map((c): [Canal, DoCanal] => {
        const responde = daLoja.find((e) => e.ponte.canais?.[c] === 'responde');
        return [
          c,
          {
            responde: responde ? { nome: pcDa(responde), maquina: responde.ponte.maquina ?? null } : null,
            reservas: daLoja.filter((e) => e.ponte.canais?.[c] === 'reserva').map(pcDa),
          },
        ];
      });
    const semPc = canais.filter(([, c]) => !c.responde).map(([k]) => k);
    return { u, canais, semPc, passa: porOndePassa(canais) };
  });
  const comAviso = linhas.some((l) => l.semPc.length);
  const semCanal = linhas.every((l) => !l.canais.length);
  if (semCanal)
    return (
      <p className="rounded-md border-l-4 border-input bg-secondary px-3 py-2 text-sm" role="status" data-ponte-pcs="sem-canal">
        <strong>Ponte do chat ligada,</strong> mas nem o iFood nem a 99 estão conectados nesta empresa.
      </p>
    );
  return (
    <div
      className={`space-y-1 rounded-md border-l-4 px-3 py-2 text-sm ${comAviso ? 'border-destructive bg-destructive/10' : 'border-ok bg-ok/10'}`}
      role={comAviso ? 'alert' : 'status'}
      data-ponte-pcs={comAviso ? 'aviso' : 'ok'}
    >
      {linhas.map((l) => (
        <p key={l.u ?? 'todas'} className="break-words">
          {varias && <strong>{l.u ? nomeDaLoja(l.u) : 'Todas as lojas'}: </strong>}
          {l.semPc.length ? (
            <>
              <strong>Nenhum PC responde o chat {l.semPc.map((k) => NO[k]).join(' e ')} agora.</strong> O que o Regem manda no chat
              espera a ponte voltar; o que passar de 30 min não sai mais. No PC da ponte, abra o programa Regem · Ponte do chat e entre{' '}
              {l.semPc.map((k) => NO[k]).join(' e ')}.{l.passa ? ` · ${l.passa}` : ''}
            </>
          ) : (
            <>
              <strong>Ponte do chat em ordem:</strong> {l.passa}.
            </>
          )}
        </p>
      ))}
    </div>
  );
}
