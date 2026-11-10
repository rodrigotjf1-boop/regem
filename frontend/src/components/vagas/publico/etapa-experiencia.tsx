'use client';

import { marcouLideranca } from '@/lib/vagas-ficha';
import { Escolhas, Grupo } from './campos';
import { ItemExperiencia, ItemLideranca } from './itens';
import { novoId, type PropsEtapa } from './tipos';

// Etapa 4 — Experiência: na área, em outra área ou primeiro emprego; as experiências (vínculo carteira ou informal); e,
// para quem marcou supervisão ou gerência, se já liderou — com cargo, equipe, tempo, vínculo e o que fazia.
export function EtapaExperiencia({ f, muda, p, erros }: PropsEtapa) {
  const novaExp = () => ({ id: novoId(), empresa: '', funcao: '', tempo: '', vinculo: '', atual: false, descricao: '' });
  const novaLid = () => ({ id: novoId(), cargo: '', empresa: '', equipe: '', tempo: '', vinculo: '', descricao: '' });
  return (
    <>
      <Grupo campo="experiencia" erros={erros}>
        <span className="vg-perg">Já trabalhou em hamburgueria, lanchonete, restaurante ou cozinha?</span>
        <Escolhas
          rotulo="Experiência na área"
          tipo="opcao"
          opcoes={[
            { v: 'sim', icone: '🍔', rotulo: 'Sim', sub: 'Já trabalhei na área' },
            { v: 'outra', icone: '🧰', rotulo: 'Em outra área', sub: 'Já trabalhei, mas não com comida' },
            { v: 'primeiro', icone: '🌱', rotulo: 'Primeiro emprego', sub: 'Ainda não trabalhei' },
          ]}
          valor={f.experiencia}
          aoMudar={(v) => {
            muda('experiencia', v);
            if ((v === 'sim' || v === 'outra') && !f.exps.length) muda('exps', [novaExp()]);
          }}
        />
      </Grupo>
      {(f.experiencia === 'sim' || f.experiencia === 'outra') && (
        <Grupo campo="exps" erros={erros}>
          <span className="vg-perg">
            Conte suas experiências <em>(a mais recente primeiro)</em>
          </span>
          {f.exps.map((x, i) => (
            <ItemExperiencia
              key={x.id}
              x={x}
              n={i + 1}
              aoMudar={(nx) => muda('exps', f.exps.map((y) => (y.id === x.id ? nx : y)))}
              aoRemover={() => muda('exps', f.exps.filter((y) => y.id !== x.id))}
            />
          ))}
          <button type="button" className="vg-add" onClick={() => muda('exps', [...f.exps, novaExp()])}>
            ＋ Adicionar outra experiência
          </button>
        </Grupo>
      )}
      {marcouLideranca(f, p) && (
        <div className="vg-bloco">
          <h3>⭐ Liderança</h3>
          <p>Você marcou interesse em supervisão ou gerência.</p>
          <Grupo campo="liderou" erros={erros}>
            <span className="vg-perg">Já trabalhou como supervisor(a), líder ou gerente?</span>
            <Escolhas
              rotulo="Já trabalhou em liderança"
              opcoes={[
                { v: 'sim', rotulo: 'Sim' },
                { v: 'nao', rotulo: 'Ainda não' },
              ]}
              valor={f.liderou}
              aoMudar={(v) => {
                muda('liderou', v);
                if (v === 'sim' && !f.lids.length) muda('lids', [novaLid()]);
              }}
            />
          </Grupo>
          {f.liderou === 'sim' && (
            <Grupo campo="lids" erros={erros} className="vg-sem-margem">
              {f.lids.map((x, i) => (
                <ItemLideranca
                  key={x.id}
                  x={x}
                  n={i + 1}
                  aoMudar={(nx) => muda('lids', f.lids.map((y) => (y.id === x.id ? nx : y)))}
                  aoRemover={() => muda('lids', f.lids.filter((y) => y.id !== x.id))}
                />
              ))}
              <button type="button" className="vg-add" onClick={() => muda('lids', [...f.lids, novaLid()])}>
                ＋ Adicionar outra liderança
              </button>
            </Grupo>
          )}
        </div>
      )}
    </>
  );
}
