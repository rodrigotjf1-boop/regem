'use client';

import { horarioTexto, type PaginaPublica } from '@/lib/vagas-ficha';

// A capa da página de vagas (mockups/regem-vagas-moderno.html): a logo da LOJA (a de Configurações › Loja › "Logo da
// loja") sob a luz da cor principal, o título com a última palavra em destaque, os números rápidos, as vagas abertas em
// lista com o salário, os benefícios, "como funciona" e o botão fixo no rodapé.
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

/** O título com a última palavra em destaque (degradê da cor de destaque). */
function TituloComBrilho({ texto }: { texto: string }) {
  const t = texto.trim();
  const i = t.lastIndexOf(' ');
  if (i < 0) return <span className="vg-brilho">{t}</span>;
  return (
    <>
      {t.slice(0, i + 1)}
      <span className="vg-brilho">{t.slice(i + 1)}</span>
    </>
  );
}

export function Capa({ p, aoComecar }: { p: PaginaPublica; aoComecar: () => void }) {
  const pg = p.pagina;
  const selos: string[] = [];
  if (pg.vagaFixa) selos.push('Vaga fixa');
  if (pg.horista && pg.horarios.horista.ativa) selos.push('Horista');
  if (pg.vagaFixa && pg.horarios['12x36'].ativa) selos.push(`12x36 ${horarioTexto(pg.horarios['12x36'])}`);
  if (pg.vagaFixa && pg.horarios['5x2'].ativa) selos.push(`5x2 ${horarioTexto(pg.horarios['5x2'])}`);
  const nVagas = pg.funcoes.length;
  return (
    <section aria-labelledby="vg-capa-tit">
      <div className="vg-hero">
        <LogoDaLoja p={p} />
        <span className="vg-selo">
          <span className="vg-pulso" aria-hidden="true" /> Estamos contratando
        </span>
        <h1 id="vg-capa-tit">
          <TituloComBrilho texto={pg.titulo} />
        </h1>
        {pg.frase && <p>{pg.frase}</p>}
        <ul className="vg-numeros">
          {nVagas > 0 && (
            <li>
              <b>{nVagas}</b>
              <span>{nVagas === 1 ? 'vaga aberta' : 'vagas abertas'}</span>
            </li>
          )}
          <li>
            <b>6 min</b>
            <span>para se inscrever</span>
          </li>
          {pg.beneficios.length > 0 && (
            <li>
              <b>{pg.beneficios.length}</b>
              <span>{pg.beneficios.length === 1 ? 'benefício' : 'benefícios'}</span>
            </li>
          )}
        </ul>
        {selos.length > 0 && (
          <ul className="vg-selos" aria-label="Formas de trabalho">
            {selos.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="vg-corpo">
        {nVagas > 0 && (
          <>
            <h2 className="vg-titulo-sec">
              Vagas abertas <small>salário base</small>
            </h2>
            <ul className="vg-vagas">
              {pg.funcoes.map((f) => (
                <li className="vg-vaga" key={f.codigo}>
                  <span className="vg-ic" aria-hidden="true">
                    {iconeDaFuncao(f.nome)}
                  </span>
                  <span>
                    <b>{f.nome}</b>
                    {f.lideranca && <span className="vg-lid">Liderança</span>}
                  </span>
                  {f.salario && (
                    <span className={`vg-sal${/^R\$/.test(f.salario) ? '' : ' peq'}`}>
                      {salarioCurto(f.salario)}
                      {/^R\$/.test(f.salario) && <small>por mês</small>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {pg.beneficios.length > 0 && (
          <>
            <h2 className="vg-titulo-sec">Benefícios</h2>
            <ul className="vg-beneficios">
              {pg.beneficios.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </>
        )}
        <h2 className="vg-titulo-sec">Como funciona</h2>
        <ol className="vg-passos">
          <li>
            <span>
              <b>Responda 7 etapas rápidas</b>
              <span>Leva uns 6 minutos, direto do celular.</span>
            </span>
          </li>
          <li>
            <span>
              <b>A gerência analisa as fichas</b>
              <span>Todas as fichas são lidas.</span>
            </span>
          </li>
          <li>
            <span>
              <b>Chamamos você no WhatsApp</b>
              <span>Se o seu perfil combinar com a vaga.</span>
            </span>
          </li>
        </ol>
      </div>
      <div className="vg-cta-barra">
        <button type="button" className="vg-cta" onClick={aoComecar}>
          Quero me candidatar <span className="vg-seta" aria-hidden="true">→</span>
        </button>
        <p className="vg-mini">🔒 Seus dados ficam só com {p.loja.nome}, para a seleção de vagas.</p>
      </div>
    </section>
  );
}
