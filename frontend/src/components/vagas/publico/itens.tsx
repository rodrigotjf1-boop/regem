'use client';

import {
  CARGO_ROTULO, CURSO_SITUACAO_ROTULO, EQUIPE_ROTULO, SUGESTOES_DE_CURSO, TEMPO_ROTULO,
  type CursoForm, type ExperienciaForm, type LiderancaForm,
} from '@/lib/vagas-ficha';
import { doMapa, Escolhas, Marcar, Texto } from './campos';

// Os itens das listas da ficha: uma experiência de trabalho, uma de liderança, um curso. Cada um com "Remover".
const VINCULOS = { carteira: '📘 Carteira assinada', informal: '🤝 Informal (sem carteira)' };

function Cabeca({ titulo, aoRemover }: { titulo: string; aoRemover: () => void }) {
  return (
    <div className="vg-item-cab">
      <b>{titulo}</b>
      <button type="button" className="vg-remover" onClick={aoRemover}>
        Remover
      </button>
    </div>
  );
}

export function ItemExperiencia({
  x, n, aoMudar, aoRemover,
}: { x: ExperienciaForm; n: number; aoMudar: (x: ExperienciaForm) => void; aoRemover: () => void }) {
  const set = <K extends keyof ExperienciaForm>(k: K, v: ExperienciaForm[K]) => aoMudar({ ...x, [k]: v });
  return (
    <div className="vg-item">
      <Cabeca titulo={`Experiência ${n}`} aoRemover={aoRemover} />
      <Texto id={`${x.id}-emp`} classeRotulo="vg-perg-p" rotulo="Onde você trabalhou?" max={120} valor={x.empresa} aoMudar={(v) => set('empresa', v)} placeholder="Nome da empresa ou do lugar" />
      <Texto id={`${x.id}-fun`} classeRotulo="vg-perg-p" rotulo="Qual era a sua função?" max={80} valor={x.funcao} aoMudar={(v) => set('funcao', v)} placeholder="Ex.: chapeiro, atendente, auxiliar" />
      <span className="vg-perg-p">Por quanto tempo?</span>
      <Escolhas rotulo="Por quanto tempo" opcoes={doMapa(TEMPO_ROTULO)} valor={x.tempo} aoMudar={(v) => set('tempo', v)} />
      <span className="vg-perg-p">Como era o vínculo?</span>
      <Escolhas rotulo="Vínculo" opcoes={doMapa(VINCULOS)} valor={x.vinculo} aoMudar={(v) => set('vinculo', v)} />
      <Marcar id={`${x.id}-atual`} marcado={x.atual} aoMudar={(v) => set('atual', v)}>
        Ainda trabalho lá
      </Marcar>
      <Texto id={`${x.id}-desc`} classeRotulo="vg-perg-p" rotulo="O que você fazia?" opcional area max={300} valor={x.descricao} aoMudar={(v) => set('descricao', v)} placeholder="Ex.: chapa, montagem, caixa, fritadeira…" />
    </div>
  );
}

export function ItemLideranca({
  x, n, aoMudar, aoRemover,
}: { x: LiderancaForm; n: number; aoMudar: (x: LiderancaForm) => void; aoRemover: () => void }) {
  const set = <K extends keyof LiderancaForm>(k: K, v: LiderancaForm[K]) => aoMudar({ ...x, [k]: v });
  return (
    <div className="vg-item">
      <Cabeca titulo={`Liderança ${n}`} aoRemover={aoRemover} />
      <span className="vg-perg-p">Qual era o cargo?</span>
      <Escolhas rotulo="Cargo de liderança" opcoes={doMapa(CARGO_ROTULO)} valor={x.cargo} aoMudar={(v) => set('cargo', v)} />
      <Texto id={`${x.id}-emp`} classeRotulo="vg-perg-p" rotulo="Em qual empresa?" max={120} valor={x.empresa} aoMudar={(v) => set('empresa', v)} placeholder="Nome da empresa" />
      <span className="vg-perg-p">Quantas pessoas você liderava?</span>
      <Escolhas rotulo="Tamanho da equipe" opcoes={doMapa(EQUIPE_ROTULO)} valor={x.equipe} aoMudar={(v) => set('equipe', v)} />
      <span className="vg-perg-p">Por quanto tempo?</span>
      <Escolhas rotulo="Por quanto tempo" opcoes={doMapa(TEMPO_ROTULO)} valor={x.tempo} aoMudar={(v) => set('tempo', v)} />
      <span className="vg-perg-p">Como era o vínculo?</span>
      <Escolhas rotulo="Vínculo" opcoes={doMapa(VINCULOS)} valor={x.vinculo} aoMudar={(v) => set('vinculo', v)} />
      <Texto
        id={`${x.id}-desc`}
        classeRotulo="vg-perg-p"
        rotulo="Conte o que você fazia como líder"
        area
        max={400}
        valor={x.descricao}
        aoMudar={(v) => set('descricao', v)}
        placeholder="Ex.: montava a escala, abria e fechava a loja, conferia caixa e estoque, treinava a equipe…"
      />
    </div>
  );
}

export function ItemCurso({ x, n, aoMudar, aoRemover }: { x: CursoForm; n: number; aoMudar: (x: CursoForm) => void; aoRemover: () => void }) {
  const set = <K extends keyof CursoForm>(k: K, v: CursoForm[K]) => aoMudar({ ...x, [k]: v });
  return (
    <div className="vg-item">
      <Cabeca titulo={`Curso ${n}`} aoRemover={aoRemover} />
      <Texto id={`${x.id}-nome`} classeRotulo="vg-perg-p" rotulo="Qual curso?" max={80} valor={x.nome} aoMudar={(v) => set('nome', v)} placeholder="Ex.: Manipulação de alimentos" />
      <div className="vg-sugestoes" aria-label="Sugestões de curso">
        {SUGESTOES_DE_CURSO.map((s) => (
          <button key={s} type="button" className="vg-sug" onClick={() => set('nome', s)}>
            {s.replace('Boas práticas / ', '').replace(/^./, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>
      <Texto id={`${x.id}-onde`} classeRotulo="vg-perg-p" rotulo="Onde?" max={80} valor={x.onde} aoMudar={(v) => set('onde', v)} placeholder="Ex.: SENAC, SEBRAE, on-line" />
      <span className="vg-perg-p">Situação</span>
      <Escolhas rotulo="Situação do curso" opcoes={doMapa(CURSO_SITUACAO_ROTULO)} valor={x.situacao} aoMudar={(v) => set('situacao', v)} />
    </div>
  );
}
