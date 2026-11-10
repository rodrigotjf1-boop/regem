'use client';

import { marcouLideranca, SETOR_ROTULO } from '@/lib/vagas-ficha';
import { doMapa, Escolhas, Grupo } from './campos';
import { iconeDaFuncao } from './capa';
import type { PropsEtapa } from './tipos';

// Etapa 2 — A vaga: as funções ABERTAS da página (cartões com o salário; marca quantas quiser — supervisão e gerência
// entram aqui, e quem marca uma delas responde a liderança na etapa 4) e os setores com facilidade.
export function EtapaVaga({ f, muda, p, erros }: PropsEtapa) {
  return (
    <>
      <Grupo campo="funcoes" erros={erros}>
        <span className="vg-perg">Quais funções te interessam?</span>
        <p className="vg-dica" style={{ margin: '-4px 0 10px' }}>
          Marque quantas quiser — uma, várias ou todas.
        </p>
        <Escolhas
          rotulo="Funções"
          tipo="opcao"
          multi
          opcoes={p.pagina.funcoes.map((fn) => ({
            v: fn.codigo,
            icone: iconeDaFuncao(fn.nome),
            rotulo: fn.nome,
            sub: fn.salario ? (
              <>
                <span className="vg-sal">{fn.salario}</span>
                {fn.lideranca ? ' · liderança' : ''}
              </>
            ) : fn.lideranca ? (
              'Liderança'
            ) : undefined,
          }))}
          valor={f.funcoes}
          aoMudar={(v) => muda('funcoes', v)}
        />
        {marcouLideranca(f, p) && <p className="vg-dica">Você marcou um cargo de liderança: na etapa de experiência vamos perguntar sobre isso.</p>}
      </Grupo>
      <Grupo campo="setores" erros={erros}>
        <span className="vg-perg">Em quais setores você tem facilidade?</span>
        <Escolhas
          rotulo="Setores com facilidade"
          multi
          opcoes={doMapa(SETOR_ROTULO).map((o) => (o.v === 'nenhum' ? { ...o, sozinho: true } : o))}
          valor={f.setores}
          aoMudar={(v) => muda('setores', v)}
        />
      </Grupo>
    </>
  );
}
