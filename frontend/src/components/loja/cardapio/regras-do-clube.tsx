'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Cardapio } from './use-cardapio';

// AS REGRAS DO CLUBE no cardápio (o banner "Ao tocar, abre: Regras do clube" — fase B3 do `docs/plano-clube-e-banner.md`).
// O servidor monta as regras das ferramentas ligadas (as mesmas do painel da loja); sem nenhuma ligada, a lista vem vazia.

type Estado = { carregando: true } | { carregando: false; regras: string[]; erro: boolean };

export function RegrasDoClube({ c }: { c: Cardapio }) {
  const [e, setE] = useState<Estado>({ carregando: true });
  useEffect(() => {
    let vivo = true;
    api
      .cardapioRegrasDoClube(c.token)
      .then((r: any) => vivo && setE({ carregando: false, regras: Array.isArray(r?.regras) ? r.regras.map(String) : [], erro: false }))
      .catch(() => vivo && setE({ carregando: false, regras: [], erro: true }));
    return () => {
      vivo = false;
    };
  }, [c.token]);
  return (
    <>
      <div className="p-dim" onClick={c.voltar} />
      <div className="p-modal" role="dialog" aria-label="Regras do clube">
        <h3>Regras do clube</h3>
        {e.carregando ? (
          <p className="c-note">Carregando…</p>
        ) : e.erro ? (
          <p className="c-note">Não deu para ler as regras agora. Tente de novo em instantes.</p>
        ) : e.regras.length ? (
          <ul className="c-regras">
            {e.regras.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="c-note">O clube desta loja ainda não está aberto.</p>
        )}
        <button type="button" className="p-btn2" onClick={c.voltar}>
          Fechar
        </button>
      </div>
    </>
  );
}
