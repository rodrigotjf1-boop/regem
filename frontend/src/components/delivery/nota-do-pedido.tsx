'use client';

import { useEffect, useId, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Chave } from '@/components/ui/chave';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "PEDIR UMA NOTA DEPOIS DA ENTREGA" (mig 453, fase A1 do protótipo `mockups/regem-avaliacao-pedido.html`, aba "Ajustes").
// Logo acima do cartão do Google: o liga/desliga (grava na hora, como os outros avisos), a nota que abre caso no
// Atendimento e o prazo para avaliar ("Salvar nota"). Cada frase tem a regra que a sustenta em
// `backend/src/modules/avaliacao-pedido/nota-do-pedido.ts` e `nota-do-pedido.service.ts`.

type Ajustes = { ativa: boolean; casoAte: number; prazoDias: number; opcoes: { casoAte: number[]; prazoDias: number[] } };
type Form = { casoAte: number; prazoDias: number };

const ROTULO_CASO: Record<number, string> = { 1: 'Só a nota 1', 2: '1 ou 2', 3: '1, 2 ou 3' };
const campo = 'h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60';

export function NotaDoPedido({ pode }: { pode: boolean }) {
  const [a, setA] = useState<Ajustes | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [gravando, setGravando] = useState(false);
  const id = useId();

  function aplicar(r: any) {
    if (!r?.nota) throw new Error('O servidor ainda não tem a "nota do pedido".');
    setA(r.nota);
    setF({ casoAte: r.nota.casoAte, prazoDias: r.nota.prazoDias });
    setLink(r.avaliacao?.link ?? null);
  }

  useEffect(() => {
    api
      .whatsappRoboConfig()
      .then(aplicar)
      .catch((e) => setErro(e instanceof Error && e.message ? e.message : 'Não foi possível ler o ajuste.'));
  }, []);

  /** O que mudou no formulário em relação ao que está gravado (só isso vai — o ausente mantém). */
  function mudancas(): Record<string, number> {
    if (!a || !f) return {};
    const m: Record<string, number> = {};
    if (f.casoAte !== a.casoAte) m.casoAte = f.casoAte;
    if (f.prazoDias !== a.prazoDias) m.prazoDias = f.prazoDias;
    return m;
  }

  async function gravar(corpo: Record<string, unknown>, ok: string) {
    setGravando(true);
    try {
      aplicar(await api.whatsappNotaSalvar(corpo));
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Não foi possível salvar.');
    } finally {
      setGravando(false);
    }
  }

  const ligar = (v: boolean) => gravar(v ? { ...mudancas(), ativa: true } : { ativa: false }, v ? '"Pedir uma nota" ligado.' : '"Pedir uma nota" desligado.');
  const pendente = Object.keys(mudancas()).length > 0;
  const travado = !pode || gravando;

  return (
    <div className="space-y-3 rounded-lg border border-border p-3" data-nota-do-pedido>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">Pedir uma nota depois da entrega</span>
        {a && <Chave rotulo="Pedir uma nota depois da entrega" ligada={a.ativa} ocupada={travado} aoMudar={ligar} />}
      </div>
      {erro ? <p className="text-xs text-destructive">{erro}</p> : !a || !f ? <p className="text-xs text-muted-foreground">Carregando…</p> : null}

      {a && f && (
        <>
          <p className="text-xs text-muted-foreground">
            Na página do pedido (o link do rastreio), o “Como foi o pedido?” aparece depois da entrega: nota de 1 a 5, o que
            mais pesou e um comentário — também na conexão por QR Code. Só pedidos do Regem: iFood, 99 e Anota Aí têm a
            avaliação deles. As notas ficam em Delivery › Avaliações.
          </p>
          <p className="rounded-md border border-border bg-secondary/60 px-3 py-2 text-[11px]" role="note">
            Formulário do WhatsApp oficial (o botão “Avaliar pedido” depois do “Tudo certo 👍”): em preparo pela DMS. Enquanto
            isso, a nota vem pela página do pedido.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1 text-xs">
              <label htmlFor={`${id}-caso`} className="block font-semibold">
                Nota que abre caso no Atendimento
              </label>
              <select id={`${id}-caso`} className={campo} disabled={travado} value={f.casoAte} onChange={(e) => setF({ ...f, casoAte: Number(e.target.value) })}>
                {a.opcoes.casoAte.map((n) => (
                  <option key={n} value={n}>
                    {ROTULO_CASO[n] ?? `até ${n}`}
                  </option>
                ))}
              </select>
              <span className="block text-[11px] text-muted-foreground">O caso “Avaliação”, ligado ao pedido.</span>
            </div>
            <div className="space-y-1 text-xs">
              <label htmlFor={`${id}-prazo`} className="block font-semibold">
                Prazo para avaliar
              </label>
              <select id={`${id}-prazo`} className={campo} disabled={travado} value={f.prazoDias} onChange={(e) => setF({ ...f, prazoDias: Number(e.target.value) })}>
                {a.opcoes.prazoDias.map((d) => (
                  <option key={d} value={d}>
                    {d} dias
                  </option>
                ))}
              </select>
              <span className="block text-[11px] text-muted-foreground">Depois da entrega. Passou, a página mostra “A avaliação deste pedido encerrou”.</span>
            </div>
          </div>

          <p className="text-xs">
            <span className="font-semibold">Depois da nota: </span>
            na nota 5, o obrigado leva o link do Google do cartão abaixo; nas notas de 1 a 4, só o obrigado.{' '}
            <span className="font-semibold" data-nota-link>
              {link ? 'Link do Google: colado ✓' : 'Sem link no cartão do Google: vai só o obrigado.'}
            </span>
          </p>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={travado || !pendente} onClick={() => void gravar(mudancas(), 'Nota do pedido salva.')}>
              Salvar nota
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
