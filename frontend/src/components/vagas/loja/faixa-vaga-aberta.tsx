'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { AvisoDoBanco } from '@/lib/vagas-ficha';

// F4b, parte 1 (protótipo `mockups/regem-vagas-talentos.html`, a faixa "Vaga aberta" de Candidatos): quando uma função
// ABERTA na Página de vagas tem gente no banco de talentos que a quer e autorizou mensagens, a faixa diz quantos e abre a
// gaveta de avisar. É uma sugestão: sem ninguém para avisar (ou sem a página, ou a leitura falhou), a faixa não aparece.
export function FaixaVagaAberta({ versao, aoAvisar }: { versao: number; aoAvisar: (funcao: string) => void }) {
  const [dados, setDados] = useState<AvisoDoBanco | null>(null);
  const leitura = useRef(0);
  useEffect(() => {
    const minha = ++leitura.current;
    api
      .vagasAvisoDoBanco()
      .then((d) => minha === leitura.current && setDados(d))
      .catch(() => minha === leitura.current && setDados(null));
  }, [versao]);

  const funcoes = dados?.funcoes;
  const f = Array.isArray(funcoes) ? funcoes.find((x) => x.dentro > 0) : undefined;
  if (!f) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border-l-4 border-primary bg-primary/10 px-4 py-3" role="status" data-faixa-vaga-aberta>
      <p className="min-w-[14rem] flex-1 text-sm">
        <b>📣 Vaga aberta: {f.nome}.</b>{' '}
        {f.dentro === 1 ? '1 pessoa do banco de talentos quer essa função e autorizou mensagens.' : `${f.dentro} pessoas do banco de talentos querem essa função e autorizaram mensagens.`}
      </p>
      <Button type="button" onClick={() => aoAvisar(f.codigo)}>
        Avisar o banco de talentos
      </Button>
    </div>
  );
}
