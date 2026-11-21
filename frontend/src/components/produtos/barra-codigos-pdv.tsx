'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSairSemSalvar } from '@/components/ui/ajustes';
import { Dialogo } from '@/components/ui/sobreposto';
import type { CodigosPdv } from '@/components/produtos/use-codigos-pdv';

const mostrar = (v: string | null) => (v ?? '').trim() || 'sem código';

// A barra de "N alterações ainda não salvas" dos códigos. Preencher um código vazio salva direto; trocar ou apagar um que já
// existe mostra antes o "de → para", porque o iFood, a 99 e o totem acham o item por ele (V57).
export function BarraCodigosPdv({ codigos }: { codigos: CodigosPdv }) {
  const [conferindo, setConferindo] = useState(false);
  const n = codigos.pendentes.length;
  const saida = useSairSemSalvar(n);
  const trocas = codigos.pendentes.filter((p) => (p.de ?? '').trim());
  const opcaoSemCodigo = codigos.pendentes.some((p) => p.tipo === 'opcao' && !p.para.trim());
  const produtoSemCodigo = codigos.pendentes.some((p) => p.tipo === 'produto' && !p.para.trim());

  async function confirmar() {
    await codigos.salvar();
    setConferindo(false);
  }

  return (
    <>
      {n > 0 && (
        <div className="sticky bottom-0 z-10 flex flex-none flex-wrap items-center justify-between gap-3 rounded-lg bg-foreground px-4 py-3 text-background shadow-lg">
          <div className="min-w-0 flex-1 basis-56 text-sm font-bold">
            <span role="status">{n === 1 ? '1 código ainda não salvo' : `${n} códigos ainda não salvos`}</span>
            {codigos.erro && (
              <div role="alert" className="mt-1 font-medium">
                <p>{codigos.erro}</p>
                {codigos.recusasComNome.length > 1 && (
                  <ul className="mt-1 max-h-24 list-disc space-y-0.5 overflow-y-auto pl-4 text-xs">
                    {codigos.recusasComNome.map((r) => (
                      <li key={r.chave}>
                        {r.nome}: {r.motivo}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <span className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="border-background/50 bg-transparent text-background hover:bg-background/10 hover:text-background"
              onClick={codigos.descartar}
              disabled={codigos.salvando}
            >
              Descartar
            </Button>
            <Button
              type="button"
              disabled={codigos.salvando}
              onClick={() => (trocas.length ? setConferindo(true) : void codigos.salvar())}
            >
              {codigos.salvando ? 'Salvando…' : 'Salvar códigos'}
            </Button>
          </span>
        </div>
      )}

      {conferindo && (
        <Dialogo
          alerta
          titulo={trocas.length === 1 ? 'Trocar 1 código PDV?' : `Trocar ${trocas.length} códigos PDV?`}
          aoFechar={() => !codigos.salvando && setConferindo(false)}
          rodape={
            <>
              <Button type="button" variant="outline" data-foco-inicial disabled={codigos.salvando} onClick={() => setConferindo(false)}>
                Voltar
              </Button>
              <Button type="button" disabled={codigos.salvando} onClick={confirmar}>
                {codigos.salvando ? 'Salvando…' : 'Trocar códigos'}
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <p>O iFood, a 99 e o totem acham o item por este código. Confira se o novo é o mesmo cadastrado em cada app.</p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {trocas.map((t) => (
                <li key={`${t.tipo}:${t.id}`} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2">
                  <span className="min-w-0 break-words font-medium">{t.nome}</span>
                  <span className="font-mono text-xs">
                    {mostrar(t.de)} → <b>{mostrar(t.para)}</b>
                  </span>
                </li>
              ))}
            </ul>
            {opcaoSemCodigo && <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2">A opção sem código vira observação: não cobra nem baixa estoque.</p>}
            {produtoSemCodigo && <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2">O produto sem código só se liga ao pedido dos apps se o nome for igual.</p>}
          </div>
        </Dialogo>
      )}

      {saida.destino && (
        <Dialogo
          alerta
          titulo="Sair sem salvar?"
          aoFechar={saida.ficar}
          rodape={
            <>
              <Button type="button" variant="outline" data-foco-inicial onClick={saida.ficar}>
                Continuar editando
              </Button>
              <Button type="button" variant="destructive" onClick={saida.sair}>
                Sair sem salvar
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {n === 1 ? 'Há 1 código que ainda não foi salvo. Se sair agora, ele se perde.' : `Há ${n} códigos que ainda não foram salvos. Se sair agora, eles se perdem.`}
          </p>
        </Dialogo>
      )}
    </>
  );
}
