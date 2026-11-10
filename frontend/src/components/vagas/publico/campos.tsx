'use client';

import type { ReactNode } from 'react';

// As peças do formulário da página de vagas: o grupo de uma pergunta (com o erro dela), as escolhas em cartão ou em
// chip (uma ou várias — `aria-pressed`), o campo de texto e a caixa de marcar. Tamanho de toque ≥ 46 px (celular).

export type Erros = Record<string, string[]>;

export function Grupo({ campo, erros, children, className }: { campo: string; erros: Erros; children: ReactNode; className?: string }) {
  const msgs = erros[campo] ?? [];
  return (
    <div className={`vg-grupo${msgs.length ? ' vg-com-erro' : ''}${className ? ` ${className}` : ''}`} data-campo={campo}>
      {children}
      {msgs.length > 0 && (
        <p className="vg-erro" role="alert">
          {msgs.join(' ')}
        </p>
      )}
    </div>
  );
}

export interface Escolha {
  v: string;
  rotulo: ReactNode;
  icone?: ReactNode;
  sub?: ReactNode;
  forte?: boolean;
  /** Marcada, desmarca as outras (ex.: "Ainda não tenho prática"). */
  sozinho?: boolean;
}

interface PropsEscolhas {
  rotulo: string;
  opcoes: Escolha[];
  tipo?: 'chip' | 'opcao';
  className?: string;
}
type Uma = PropsEscolhas & { multi?: false; valor: string; aoMudar: (v: string) => void; opcional?: boolean };
type Varias = PropsEscolhas & { multi: true; valor: string[]; aoMudar: (v: string[]) => void };

export function Escolhas(props: Uma | Varias) {
  const { rotulo, opcoes, tipo = 'chip', className } = props;
  const marcado = (v: string) => (props.multi ? props.valor.includes(v) : props.valor === v);
  const clicar = (o: Escolha) => {
    if (props.multi) {
      const atual = props.valor;
      if (atual.includes(o.v)) props.aoMudar(atual.filter((x) => x !== o.v));
      else if (o.sozinho) props.aoMudar([o.v]);
      else props.aoMudar([...atual.filter((x) => !opcoes.find((p) => p.v === x)?.sozinho), o.v]);
    } else {
      props.aoMudar(props.valor === o.v && props.opcional ? '' : o.v);
    }
  };
  return (
    <div className={`${tipo === 'opcao' ? 'vg-opcoes' : 'vg-chips'}${className ? ` ${className}` : ''}`} role="group" aria-label={rotulo}>
      {opcoes.map((o) =>
        tipo === 'opcao' ? (
          <button key={o.v} type="button" className="vg-opcao" aria-pressed={marcado(o.v)} onClick={() => clicar(o)}>
            <span className="ico" aria-hidden="true">
              {o.icone}
            </span>
            <b>{o.rotulo}</b>
            {o.sub && <small>{o.sub}</small>}
          </button>
        ) : (
          <button key={o.v} type="button" className={`vg-chip${o.forte ? ' forte' : ''}`} aria-pressed={marcado(o.v)} onClick={() => clicar(o)}>
            {o.rotulo}
          </button>
        ),
      )}
    </div>
  );
}

/** Opções a partir de um mapa código → rótulo. */
export const doMapa = (mapa: Record<string, string>, so?: string[]): Escolha[] =>
  (so ?? Object.keys(mapa)).map((v) => ({ v, rotulo: mapa[v] }));

export function Texto({
  id, rotulo, valor, aoMudar, opcional, placeholder, tipo = 'text', modo, auto, max, area, classeRotulo = 'vg-perg',
}: {
  id: string;
  rotulo: ReactNode;
  valor: string;
  aoMudar: (v: string) => void;
  opcional?: boolean;
  placeholder?: string;
  tipo?: 'text' | 'tel' | 'email' | 'date';
  modo?: 'text' | 'tel' | 'email' | 'numeric';
  auto?: string;
  max?: number;
  area?: boolean;
  classeRotulo?: string;
}) {
  return (
    <>
      <label htmlFor={id} className={classeRotulo}>
        {rotulo} {opcional && <em>(opcional)</em>}
      </label>
      {area ? (
        <textarea id={id} value={valor} maxLength={max} placeholder={placeholder} onChange={(e) => aoMudar(e.target.value)} />
      ) : (
        <input
          id={id}
          type={tipo}
          inputMode={modo}
          autoComplete={auto ?? 'off'}
          value={valor}
          maxLength={max}
          placeholder={placeholder}
          onChange={(e) => aoMudar(e.target.value)}
        />
      )}
    </>
  );
}

export function Marcar({ id, marcado, aoMudar, children }: { id: string; marcado: boolean; aoMudar: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="vg-check" htmlFor={id}>
      <input id={id} type="checkbox" checked={marcado} onChange={(e) => aoMudar(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
