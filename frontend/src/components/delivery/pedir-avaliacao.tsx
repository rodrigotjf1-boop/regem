'use client';

import { useEffect, useId, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Chave } from '@/components/ui/chave';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PEDIR AVALIAÇÃO NO GOOGLE DEPOIS DA ENTREGA (pedido do dono, 04/11/2026; desenho aprovado no mesmo dia — mig 365). Logo
// abaixo do "Chegou tudo certo?": o liga/desliga (grava na hora, como os outros avisos), o link de avaliação da loja no
// Google, a mensagem, quando mandar, para quem ("só pedidos sem problema" — o padrão do dono — ou todos), a partir de qual
// pedido do cliente e quando pedir de novo a quem não tocou no link ("Salvar avaliação"). Cada frase tem a regra que a
// sustenta em `backend/src/modules/whatsapp/pedir-avaliacao.ts` e `pedir-avaliacao.processor.ts`.

type Ajustes = {
  ativa: boolean;
  link: string | null;
  texto: string;
  depoisMin: number;
  soSemProblema: boolean;
  aPartirDo: number;
  deNovoDias: number;
  doMes: { enviados: number; tocaram: number };
  opcoes: { depoisMin: number[]; aPartirDo: number[]; deNovoDias: number[] };
  textoPadrao: string;
};
type Form = { link: string; texto: string; depoisMin: number; soSemProblema: boolean; aPartirDo: number; deNovoDias: number };

const formDe = (a: Ajustes): Form => ({
  link: a.link ?? '',
  texto: a.texto,
  depoisMin: a.depoisMin,
  soSemProblema: a.soSemProblema,
  aPartirDo: a.aPartirDo,
  deNovoDias: a.deNovoDias,
});

/** A prévia da mensagem: "Ana" no {nome} e o link da loja no {link} (no envio, o link passa pelo Regem). */
function previa(texto: string, link: string): string {
  const l = link.trim() || '[link de avaliação]';
  return texto.replace(/\{nome\}/g, 'Ana').replace(/\{link\}/g, () => l);
}

const campo = 'h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60';

export function PedirAvaliacao({ pode, loja }: { pode: boolean; loja: any }) {
  const [a, setA] = useState<Ajustes | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [erro, setErro] = useState('');
  const [gravando, setGravando] = useState(false);
  const id = useId();
  const oficial = loja?.provedor === 'cloud';

  useEffect(() => {
    api
      .whatsappRoboConfig()
      .then((r: any) => {
        if (!r?.avaliacao) throw new Error('O servidor ainda não tem o "Pedir avaliação".');
        setA(r.avaliacao);
        setF(formDe(r.avaliacao));
      })
      .catch((e) => setErro(e instanceof Error && e.message ? e.message : 'Não foi possível ler o ajuste.'));
  }, []);

  /** O que mudou no formulário em relação ao que está gravado (só isso vai — o ausente mantém). */
  function mudancas(): Record<string, unknown> {
    if (!a || !f) return {};
    const m: Record<string, unknown> = {};
    if (f.link.trim() !== (a.link ?? '')) m.link = f.link.trim() || null;
    if (f.texto.trim() !== a.texto.trim()) m.texto = f.texto.trim();
    if (f.depoisMin !== a.depoisMin) m.depoisMin = f.depoisMin;
    if (f.soSemProblema !== a.soSemProblema) m.soSemProblema = f.soSemProblema;
    if (f.aPartirDo !== a.aPartirDo) m.aPartirDo = f.aPartirDo;
    if (f.deNovoDias !== a.deNovoDias) m.deNovoDias = f.deNovoDias;
    return m;
  }

  async function gravar(corpo: Record<string, unknown>, ok: string) {
    setGravando(true);
    try {
      const r: any = await api.whatsappAvaliacaoSalvar(corpo);
      setA(r.avaliacao);
      setF(formDe(r.avaliacao));
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Não foi possível salvar.');
    } finally {
      setGravando(false);
    }
  }

  // Ligar leva junto o que mudou (o link colado e ainda não salvo): o servidor exige o link para ligar.
  const ligar = (v: boolean) => gravar(v ? { ...mudancas(), ativa: true } : { ativa: false }, v ? '"Pedir avaliação" ligado.' : '"Pedir avaliação" desligado.');
  const pendente = Object.keys(mudancas()).length > 0;
  const travado = !pode || gravando;

  return (
    <div className="space-y-3 rounded-lg border border-border p-3" data-pedir-avaliacao>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">Pedir avaliação no Google depois da entrega</span>
        {a && <Chave rotulo="Pedir avaliação no Google depois da entrega" ligada={a.ativa} ocupada={travado || (!oficial && !a.ativa)} aoMudar={ligar} />}
      </div>
      {erro ? <p className="text-xs text-destructive">{erro}</p> : !a || !f ? <p className="text-xs text-muted-foreground">Carregando…</p> : null}

      {a && f && (
        <>
          <label className="block space-y-1 text-xs">
            <span className="font-semibold">Link de avaliação da loja no Google</span>
            <input
              className={campo}
              inputMode="url"
              autoComplete="off"
              disabled={travado}
              value={f.link}
              placeholder="https://g.page/r/…/review"
              onChange={(e) => setF({ ...f, link: e.target.value })}
            />
            <span className="block text-[11px] text-muted-foreground">
              No Perfil da Empresa no Google: “Pedir avaliações” → copie o link. Só link do Google.
            </span>
          </label>

          <label className="block space-y-1 text-xs">
            <span className="font-semibold">Mensagem</span>
            <textarea
              rows={3}
              maxLength={500}
              className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
              disabled={travado}
              value={f.texto}
              onChange={(e) => setF({ ...f, texto: e.target.value })}
            />
            <span className="block text-[11px] text-muted-foreground">
              {'{nome}'} = o primeiro nome do cliente · {'{link}'} = o link de avaliação (obrigatório).{' '}
              <button type="button" className="font-semibold underline underline-offset-2" disabled={travado} onClick={() => setF({ ...f, texto: a.textoPadrao })}>
                Voltar ao texto padrão
              </button>
            </span>
          </label>
          <p className="break-words rounded-md bg-secondary/60 px-3 py-2 text-xs" aria-live="polite">
            <span className="font-semibold">Prévia: </span>
            {previa(f.texto, f.link)}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block space-y-1 text-xs">
              <span className="font-semibold">Enviar</span>
              <select className={campo} disabled={travado} value={f.depoisMin} onChange={(e) => setF({ ...f, depoisMin: Number(e.target.value) })}>
                {a.opcoes.depoisMin.map((m) => (
                  <option key={m} value={m}>
                    {m >= 60 ? `${m / 60} h` : `${m} min`} depois da entrega
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-semibold">Cliente a partir do</span>
              <select className={campo} disabled={travado} value={f.aPartirDo} onChange={(e) => setF({ ...f, aPartirDo: Number(e.target.value) })}>
                {a.opcoes.aPartirDo.map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? '1º pedido (todos)' : `${n}º pedido`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-semibold">De novo, se não tocou no link</span>
              <select className={campo} disabled={travado} value={f.deNovoDias} onChange={(e) => setF({ ...f, deNovoDias: Number(e.target.value) })}>
                {a.opcoes.deNovoDias.map((d) => (
                  <option key={d} value={d}>
                    depois de {d} dias
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset className="space-y-1.5 text-xs">
            <legend className="mb-1 font-semibold">Para quem</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name={`${id}-quem`} className="mt-0.5" disabled={travado} checked={f.soSemProblema} onChange={() => setF({ ...f, soSemProblema: true })} />
              <span>
                Só pedidos sem problema — entregue no prazo, sem aviso de atraso, sem caso de problema ou cancelamento e sem
                “Tive um problema”
              </span>
            </label>
            {f.soSemProblema && (
              <p className="ml-6 rounded-md border border-warn/50 bg-warn/10 px-2 py-1 text-[11px] text-foreground" role="note">
                ⚠ O Google proíbe pedir avaliação só a quem teve pedido bom: pode apagar avaliações e penalizar o perfil da loja.
              </p>
            )}
            <label className="flex items-start gap-2">
              <input type="radio" name={`${id}-quem`} className="mt-0.5" disabled={travado} checked={!f.soSemProblema} onChange={() => setF({ ...f, soSemProblema: false })} />
              <span>Todos os pedidos entregues</span>
            </label>
          </fieldset>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground" data-avaliacao-mes>
              Este mês: {a.doMes.enviados} {a.doMes.enviados === 1 ? 'enviado' : 'enviados'} · {a.doMes.tocaram} tocaram no link
            </span>
            <Button type="button" variant="outline" disabled={travado || !pendente} onClick={() => void gravar(mudancas(), 'Avaliação salva.')}>
              Salvar avaliação
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Uma mensagem por pedido de ENTREGA dos canais da própria loja, pelo WhatsApp oficial, só se o cliente falou com a
            loja nas últimas 24 h e sem ninguém da equipe na conversa. Quem já tocou no link e quem pediu para não receber
            mensagens não recebem. Pedido do iFood e da 99: a avaliação é pedida pela própria plataforma, no app dela.
          </p>
          {!oficial && <p className="text-[11px] font-semibold text-foreground">Disponível só com o WhatsApp oficial da loja.</p>}
        </>
      )}
    </div>
  );
}
