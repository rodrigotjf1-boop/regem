'use client';

import { GRAU_ATUAL_ROTULO, GRAU_FINAL_ROTULO, TURNO_ESTUDO_ROTULO } from '@/lib/vagas-ficha';
import { doMapa, Escolhas, Grupo, Texto } from './campos';
import { ItemCurso } from './itens';
import { novoId, type PropsEtapa } from './tipos';

// Etapa 5 — Estudos e cursos (dono, 10/11/2026): ainda estuda ou já encerrou → o que cursa (e o turno da aula) ou até onde
// estudou, e onde. O mesmo para cursos: está fazendo, já fez ou nunca fez → qual, onde e a situação.
export function EtapaEstudos({ f, muda, erros }: PropsEtapa) {
  const novoCurso = (situacao: string) => ({ id: novoId(), nome: '', onde: '', situacao });
  return (
    <>
      <Grupo campo="estuda" erros={erros}>
        <span className="vg-perg">Você ainda estuda?</span>
        <Escolhas
          rotulo="Ainda estuda"
          tipo="opcao"
          opcoes={[
            { v: 'sim', icone: '🎒', rotulo: 'Sim, estou estudando', sub: 'Escola, supletivo, técnico ou faculdade' },
            { v: 'nao', icone: '🎓', rotulo: 'Não, já encerrei', sub: 'Terminei ou parei de estudar' },
          ]}
          valor={f.estuda}
          aoMudar={(v) => muda('estuda', v)}
        />
      </Grupo>
      {f.estuda === 'sim' && (
        <Grupo campo="grau_atual" erros={erros}>
          <span className="vg-perg">O que você está cursando?</span>
          <Escolhas rotulo="O que está cursando" opcoes={doMapa(GRAU_ATUAL_ROTULO)} valor={f.grau_atual} aoMudar={(v) => muda('grau_atual', v)} />
        </Grupo>
      )}
      {f.estuda === 'nao' && (
        <Grupo campo="grau_final" erros={erros}>
          <span className="vg-perg">Até onde você estudou?</span>
          <Escolhas rotulo="Até onde estudou" opcoes={doMapa(GRAU_FINAL_ROTULO)} valor={f.grau_final} aoMudar={(v) => muda('grau_final', v)} />
        </Grupo>
      )}
      {f.estuda && (
        <Grupo campo="escola" erros={erros}>
          <Texto
            id="vg-escola"
            rotulo={f.estuda === 'sim' ? 'Onde você estuda?' : 'Onde você estudou por último?'}
            max={120}
            valor={f.escola}
            aoMudar={(v) => muda('escola', v)}
            placeholder="Nome da escola ou da faculdade"
          />
        </Grupo>
      )}
      {f.estuda === 'sim' && (
        <Grupo campo="turno_estudo" erros={erros}>
          <span className="vg-perg">Em qual turno você estuda?</span>
          <Escolhas rotulo="Turno da aula" opcoes={doMapa(TURNO_ESTUDO_ROTULO)} valor={f.turno_estudo} aoMudar={(v) => muda('turno_estudo', v)} />
          <p className="vg-dica">Assim a escala não cai no horário da sua aula.</p>
        </Grupo>
      )}
      <div className="vg-bloco">
        <h3>📜 Cursos</h3>
        <p>Manipulação de alimentos, cozinha, atendimento, informática… qualquer curso conta.</p>
        <Grupo campo="cursos_sit" erros={erros}>
          <span className="vg-perg">Você faz ou já fez algum curso?</span>
          <Escolhas
            rotulo="Cursos"
            opcoes={[
              { v: 'fazendo', rotulo: 'Estou fazendo um curso' },
              { v: 'fez', rotulo: 'Já fiz cursos' },
              { v: 'nunca', rotulo: 'Nunca fiz curso' },
            ]}
            valor={f.cursos_sit}
            aoMudar={(v) => {
              muda('cursos_sit', v);
              // o primeiro curso já vem com a situação da resposta de cima
              if (v !== 'nunca' && !f.cursos.length) muda('cursos', [novoCurso(v === 'fazendo' ? 'fazendo' : 'concluido')]);
            }}
          />
        </Grupo>
        {(f.cursos_sit === 'fazendo' || f.cursos_sit === 'fez') && (
          <Grupo campo="cursos" erros={erros}>
            {f.cursos.map((x, i) => (
              <ItemCurso
                key={x.id}
                x={x}
                n={i + 1}
                aoMudar={(nx) => muda('cursos', f.cursos.map((y) => (y.id === x.id ? nx : y)))}
                aoRemover={() => muda('cursos', f.cursos.filter((y) => y.id !== x.id))}
              />
            ))}
            <button type="button" className="vg-add" onClick={() => muda('cursos', [...f.cursos, novoCurso('concluido')])}>
              ＋ Adicionar outro curso
            </button>
          </Grupo>
        )}
      </div>
    </>
  );
}
