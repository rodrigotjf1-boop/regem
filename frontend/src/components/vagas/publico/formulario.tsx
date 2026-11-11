'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ETAPAS, TOTAL_ETAPAS, errosDaEtapa, type Erro, type FichaForm, type PaginaPublica } from '@/lib/vagas-ficha';
import { LogoDaLoja } from './capa';
import type { Erros } from './campos';
import { EtapaVoce } from './etapa-voce';
import { EtapaVaga } from './etapa-vaga';
import { EtapaHorarios } from './etapa-horarios';
import { EtapaExperiencia } from './etapa-experiencia';
import { EtapaEstudos } from './etapa-estudos';
import { EtapaEndereco } from './etapa-endereco';
import { EtapaFinal } from './etapa-final';

// A ficha em 7 etapas: o topo com o anel do progresso e a marca da loja, a etapa da vez (entra deslizando), o aviso de
// erros (recontado a cada resposta e some quando a etapa fica completa) e o rodapé Voltar / Continuar. "Editar" do resumo abre a etapa e o
// botão vira "Salvar e voltar ao resumo".
export function Formulario({ p, f, muda, hoje, enviando, erroDoEnvio, aoSair, aoEnviar }: {
  p: PaginaPublica;
  f: FichaForm;
  muda: <K extends keyof FichaForm>(k: K, v: FichaForm[K]) => void;
  hoje: string;
  enviando: boolean;
  erroDoEnvio: string;
  aoSair: () => void;
  aoEnviar: () => void;
}) {
  const [etapa, setEtapa] = useState(1);
  const [erros, setErros] = useState<Erro[]>([]);
  const [editando, setEditando] = useState(false);
  const titulo = useRef<HTMLHeadingElement>(null);

  // a resposta nova tira o erro daquele campo (o aviso do topo reconta sozinho)
  const mudaLimpando: typeof muda = (k, v) => {
    muda(k, v);
    const campo = k === 'valor_ida' || k === 'valor_volta' ? 'valor' : k === 'uber_obs' ? 'uber_motivo' : k === 'indicado_por' ? 'indicacao' : String(k);
    setErros((es) => (es.some((e) => e.campo === campo) ? es.filter((e) => e.campo !== campo) : es));
  };
  // o erro de um item da lista (experiência, curso) sai quando a lista inteira fica certa
  useEffect(() => {
    if (!erros.length) return;
    const agora = errosDaEtapa(etapa, f, p, hoje);
    setErros((es) => es.filter((e) => agora.some((a) => a.campo === e.campo)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);

  const ir = (n: number) => {
    setEtapa(n);
    setErros([]);
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => titulo.current?.focus({ preventScroll: true }));
  };
  const avancar = () => {
    const es = errosDaEtapa(etapa, f, p, hoje);
    if (es.length) {
      setErros(es);
      requestAnimationFrame(() => {
        const g = document.querySelector<HTMLElement>(`[data-campo="${es[0].campo}"]`);
        g?.scrollIntoView({ block: 'center' });
        g?.querySelector<HTMLElement>('input, textarea, button')?.focus({ preventScroll: true });
      });
      return;
    }
    if (editando && etapa < TOTAL_ETAPAS) {
      setEditando(false);
      ir(TOTAL_ETAPAS);
      return;
    }
    if (etapa < TOTAL_ETAPAS) ir(etapa + 1);
    else aoEnviar();
  };
  const voltar = () => (etapa === 1 ? aoSair() : ir(etapa - 1));

  const porCampo: Erros = {};
  for (const e of erros) (porCampo[e.campo] ??= []).push(e.msg);
  const props = { f, muda: mudaLimpando, p, erros: porCampo, hoje };
  const info = ETAPAS[etapa - 1];
  const faltam = new Set(erros.map((e) => e.campo)).size;

  return (
    <form noValidate onSubmit={(e) => e.preventDefault()}>
      <div className="vg-topo">
        <div className="vg-topo-linha">
          <div
            className="vg-anel"
            style={{ '--vg-pct': `${(etapa / TOTAL_ETAPAS) * 100}%` } as CSSProperties}
            role="progressbar"
            aria-label={`Etapa ${etapa} de ${TOTAL_ETAPAS}`}
            aria-valuemin={1}
            aria-valuemax={TOTAL_ETAPAS}
            aria-valuenow={etapa}
          >
            <span aria-hidden="true">
              {etapa}/{TOTAL_ETAPAS}
            </span>
          </div>
          <div className="vg-topo-txt">
            <span className="vg-marca">
              {p.loja.logoRef && <LogoDaLoja p={p} classe="" />}
              <span>{p.loja.nome} · Ficha</span>
            </span>
            <h2 ref={titulo} tabIndex={-1}>
              {info.titulo}
            </h2>
          </div>
        </div>
        <p className="vg-sub">{info.sub}</p>
      </div>
      {(faltam > 0 || erroDoEnvio) && (
        <div className="vg-aviso" role="alert">
          {faltam > 0 ? (faltam === 1 ? 'Falta 1 resposta nesta etapa.' : `Faltam ${faltam} respostas nesta etapa.`) : erroDoEnvio}
        </div>
      )}
      <section className="vg-etapa" key={etapa}>
        {etapa === 1 && <EtapaVoce {...props} />}
        {etapa === 2 && <EtapaVaga {...props} />}
        {etapa === 3 && <EtapaHorarios {...props} />}
        {etapa === 4 && <EtapaExperiencia {...props} />}
        {etapa === 5 && <EtapaEstudos {...props} />}
        {etapa === 6 && <EtapaEndereco {...props} />}
        {etapa === 7 && (
          <EtapaFinal
            {...props}
            aoEditar={(n) => {
              setEditando(true);
              ir(n);
            }}
          />
        )}
      </section>
      <div className="vg-rodape">
        <button type="button" className="vg-sec" onClick={voltar}>
          ← Voltar
        </button>
        <button type="button" className="vg-cta" onClick={avancar} disabled={enviando}>
          {etapa === TOTAL_ETAPAS ? (enviando ? 'Enviando…' : 'Enviar minha ficha ✓') : editando ? 'Salvar e voltar ao resumo ✓' : (
            <>
              Continuar <span className="vg-seta" aria-hidden="true">→</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}
