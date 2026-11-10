'use client';

import { horarioTexto, type PaginaPublica } from '@/lib/vagas-ficha';

// A capa da página de vagas: a logo da LOJA (a de Configurações › Loja › "Logo da loja") em destaque no bloco da cor
// principal, a vitrine das funções abertas com o salário, os benefícios, "como funciona" e o botão.
export const iconeDaFuncao = (nome: string) =>
  /chapeir/i.test(nome) ? '🔥' : /auxiliar|cozinh/i.test(nome) ? '🔪' : /atend|caix|garç/i.test(nome) ? '🙋' : /supervis/i.test(nome) ? '⭐' : /ger[eê]n/i.test(nome) ? '🏅' : /entreg|motob/i.test(nome) ? '🛵' : '🍔';

/** "R$ 1.900,00" → "R$ 1.900" (na vitrine; a etapa da vaga mostra o texto inteiro). */
const salarioCurto = (s: string) => s.replace(/,00$/, '');
const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join('');

export function LogoDaLoja({ p, classe = 'vg-logo' }: { p: PaginaPublica; classe?: string }) {
  if (p.loja.logoRef)
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={classe} src={p.loja.logoRef} alt={p.loja.nome} />;
  return <span className="vg-logo-texto">{p.loja.logoEmoji?.trim() || iniciais(p.loja.nome)}</span>;
}

export function Capa({ p, aoComecar }: { p: PaginaPublica; aoComecar: () => void }) {
  const pg = p.pagina;
  const selos: string[] = [];
  if (pg.vagaFixa) selos.push('Vaga fixa');
  if (pg.horista && pg.horarios.horista.ativa) selos.push('Horista');
  if (pg.vagaFixa && pg.horarios['12x36'].ativa) selos.push(`12x36 ${horarioTexto(pg.horarios['12x36'])}`);
  if (pg.vagaFixa && pg.horarios['5x2'].ativa) selos.push(`5x2 ${horarioTexto(pg.horarios['5x2'])}`);
  return (
    <section aria-labelledby="vg-capa-tit">
      <div className="vg-hero">
        <LogoDaLoja p={p} />
        <span className="vg-selo">🔥 Estamos contratando</span>
        <h1 id="vg-capa-tit">{pg.titulo}</h1>
        {pg.frase && <p>{pg.frase}</p>}
        {selos.length > 0 && (
          <ul className="vg-selos">
            {selos.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="vg-corpo">
        <h2 className="vg-titulo-sec">
          Vagas abertas <small>salário base</small>
        </h2>
        <div className="vg-vagas">
          {pg.funcoes.map((f) => (
            <div className="vg-vaga" key={f.codigo}>
              {f.lideranca && <span className="vg-lid">Liderança</span>}
              <span aria-hidden="true" style={{ fontSize: 24 }}>
                {iconeDaFuncao(f.nome)}
              </span>
              <b>{f.nome}</b>
              {f.salario && <span className={`vg-sal${/^R\$/.test(f.salario) ? '' : ' peq'}`}>{salarioCurto(f.salario)}</span>}
            </div>
          ))}
        </div>
        {pg.beneficios.length > 0 && (
          <div className="vg-cartao">
            <h2>
              <span aria-hidden="true">🎁</span> Benefícios
            </h2>
            <ul className="vg-lista-ok">
              {pg.beneficios.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="vg-cartao">
          <h2>
            <span aria-hidden="true">📋</span> Como funciona
          </h2>
          <ol className="vg-passos">
            <li>Responda 7 etapas rápidas — leva uns 6 minutos</li>
            <li>A gerência analisa as fichas</li>
            <li>Se o seu perfil combinar, chamamos você no WhatsApp</li>
          </ol>
        </div>
        <button type="button" className="vg-cta" onClick={aoComecar}>
          Quero me candidatar →
        </button>
        <p className="vg-mini">🔒 Seus dados ficam só com {p.loja.nome}, para a seleção de vagas.</p>
      </div>
    </section>
  );
}
