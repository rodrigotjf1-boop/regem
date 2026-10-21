'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { ONDE_LIGA, papelDaTela, type MapaNosKds } from './mapa-nos-kds';

// O diálogo do "Mostrar num KDS" (entrega 5): marcar as telas de KDS que trocam os pedidos pelo mapa dos entregadores.
// Pode ser mais de uma; a desmarcada volta aos pedidos. Quem usa monta com a lista recém-lida e desmonta ao fechar.
export function MapaNosKdsDialogo({
  dados,
  salvando,
  aoFechar,
  aoConfirmar,
}: {
  dados: MapaNosKds;
  salvando: boolean;
  aoFechar: () => void;
  aoConfirmar: (kdsIds: string[]) => void;
}) {
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(dados.telas.filter((t) => t.mapa).map((t) => t.id)));
  const vazio = dados.telas.length === 0;

  function alternar(id: string, marcado: boolean) {
    setMarcados((antes) => {
      const novo = new Set(antes);
      if (marcado) novo.add(id);
      else novo.delete(id);
      return novo;
    });
  }

  return (
    <Dialogo
      titulo="Mostrar o mapa nos KDS"
      aoFechar={aoFechar}
      voltarPara="mostrar-num-kds"
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          {!vazio && (
            <Button type="button" disabled={salvando} onClick={() => aoConfirmar([...marcados])}>
              {salvando ? 'Salvando…' : 'Mostrar o mapa nos KDS marcados'}
            </Button>
          )}
        </>
      }
    >
      {vazio ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          Nenhum KDS cadastrado nesta loja. Cadastre a tela em{' '}
          <Link href="/equipamentos" className="font-medium text-foreground underline underline-offset-2">
            Configurações › Equipamentos
          </Link>{' '}
          (tipo KDS) e ela aparece aqui.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Marque as telas que vão trocar os pedidos pelo mapa dos entregadores. Pode ser mais de uma; a desmarcada volta aos
            pedidos.
          </p>
          {!dados.ligado && (
            <p role="note" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              O mapa no KDS está desligado nesta loja: o KDS marcado mostra os pedidos até o gestor ligar em {ONDE_LIGA}. É a
              localização de pessoas, por isso começa desligado.
            </p>
          )}
          <fieldset className="mt-3">
            <legend className="sr-only">Telas de KDS da loja</legend>
            <ul className="flex flex-col gap-2">
              {dados.telas.map((t) => {
                const marcado = marcados.has(t.id);
                return (
                  <li key={t.id}>
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-secondary">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-5 w-5 flex-none accent-primary"
                        checked={marcado}
                        onChange={(e) => alternar(t.id, e.target.checked)}
                      />
                      <span className="min-w-0">
                        <span className="block break-words font-semibold">{t.nome}</span>
                        <span className="block text-xs text-muted-foreground">
                          {papelDaTela(t)}
                          {t.mapa ? (dados.ligado ? ' · mostra o mapa agora' : ' · marcado para o mapa') : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        </>
      )}
    </Dialogo>
  );
}
