'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Gaveta } from '@/components/ui/sobreposto';
import type { PainelDoClube } from './tipos';

// A gaveta dos prêmios que o CLIENTE ESCOLHE (o álbum completo — A2 — e cada nível da meta — A3): caixas com os prêmios
// de desconto e de frete grátis (o produto grátis chega numa próxima entrega), até o máximo por escolha.
export function GavetaPremiosDeEscolha({
  painel,
  titulo,
  ajuda,
  rotuloDoGrupo,
  valor,
  aoFechar,
  aoEscolher,
  aoIrParaPremios,
}: {
  painel: PainelDoClube;
  titulo: string;
  ajuda: string;
  rotuloDoGrupo: string;
  valor: string[];
  aoFechar: () => void;
  aoEscolher: (ids: string[]) => void;
  aoIrParaPremios: () => void;
}) {
  const id = useId();
  const opcoes = painel.premios.filter((p) => p.tipo !== 'produto');
  const max = painel.opcoes.premiosPorEscolhaMax;
  const [marcados, setMarcados] = useState<string[]>(valor.filter((x) => opcoes.some((p) => p.id === x)));
  const alternar = (p: string) => setMarcados((x) => (x.includes(p) ? x.filter((y) => y !== p) : x.length >= max ? x : [...x, p]));
  return (
    <Gaveta
      titulo={titulo}
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" onClick={() => aoEscolher(marcados)}>Usar estes prêmios</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-secondary-foreground">{ajuda}</p>
        {opcoes.length ? (
          <div className="grid grid-cols-1 gap-1.5" role="group" aria-label={rotuloDoGrupo}>
            {opcoes.map((p) => {
              const marcado = marcados.includes(p.id);
              return (
                <label key={p.id} htmlFor={`${id}-p-${p.id}`} className="flex min-h-10 cursor-pointer items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                  <input id={`${id}-p-${p.id}`} type="checkbox" className="mt-0.5 h-4 w-4" checked={marcado} disabled={!marcado && marcados.length >= max} onChange={() => alternar(p.id)} />
                  <span className="min-w-0">
                    <b>{p.nome}</b>
                    <span className="block text-xs text-secondary-foreground">{p.descricao}</span>
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <p className="text-sm">Nenhum prêmio de desconto ou de frete grátis ainda.</p>
        )}
        <p className="text-xs text-secondary-foreground">Até {max} prêmios. O produto grátis chega numa próxima entrega.</p>
        <Button type="button" variant="outline" size="sm" onClick={aoIrParaPremios}>
          ＋ Cadastrar novo prêmio
        </Button>
      </div>
    </Gaveta>
  );
}
