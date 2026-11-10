'use client';

import {
  brl, DIA_ROTULO, GRAU_ATUAL_ROTULO, GRAU_FINAL_ROTULO, horarioTexto, marcouLideranca, MEIO_ROTULO, reais, SETOR_ROTULO,
  TURNO_ESTUDO_ROTULO, temPublico, temUber, type FichaForm, type PaginaPublica,
} from '@/lib/vagas-ficha';

// "Confira sua ficha antes de enviar": uma linha por etapa com "Editar" (abre a etapa; "Salvar e voltar ao resumo" traz
// de volta).
const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
/** "🔥 Chapa" → "Chapa": tira o primeiro pedaço quando ele não tem letra (o ícone). */
const semIcone = (s: string) => {
  const i = s.indexOf(' ');
  return i > 0 && !/[A-Za-zÀ-ú0-9]/.test(s.slice(0, i)) ? s.slice(i + 1) : s;
};

export function ResumoDaFicha({ f, p, idade, aoEditar }: { f: FichaForm; p: PaginaPublica; idade: number | null; aoEditar: (n: number) => void }) {
  const h = p.pagina.horarios;
  const nomeFuncao = (c: string) => p.pagina.funcoes.find((x) => x.codigo === c)?.nome ?? c;
  const escala =
    f.escala === 'tanto' ? `12x36 (${horarioTexto(h['12x36'])}) ou 5x2 (${horarioTexto(h['5x2'])})` : f.escala ? `${f.escala} (${horarioTexto(h[f.escala as '12x36' | '5x2'])})` : '';
  const horarios = [
    f.tipo === 'tanto' ? 'Fixa ou horista' : f.tipo === 'fixa' ? 'Vaga fixa' : 'Horista',
    f.tipo !== 'horista' ? escala : '',
    f.tipo !== 'fixa' && f.dias.length ? `horista ${f.dias.map((d) => DIA_ROTULO[d]).join(', ')} (${horarioTexto(h.horista)})` : '',
  ].filter(Boolean);
  const experiencia = { sim: 'Já trabalhou na área', outra: 'Trabalhou em outra área', primeiro: 'Primeiro emprego' }[f.experiencia] ?? '';
  const total = reais(f.valor_ida) + reais(f.valor_volta);
  const linhas: [number, string, string, string?][] = [
    [1, 'Você', `${f.nome}${idade !== null ? ` · ${idade} anos` : ''}`, `WhatsApp ${f.whatsapp}`],
    [2, 'A vaga', f.funcoes.map(nomeFuncao).join(', '), `Facilidade: ${f.setores.map((s) => semIcone(SETOR_ROTULO[s] ?? s)).join(', ')}`],
    [3, 'Horários', horarios.join(' · ')],
    [
      4,
      'Experiência',
      `${experiencia}${(f.experiencia === 'sim' || f.experiencia === 'outra') && f.exps.length ? ` · ${pl(f.exps.length, 'experiência', 'experiências')}` : ''}`,
      marcouLideranca(f, p) ? `Liderança: ${f.liderou === 'sim' ? pl(f.lids.length, 'experiência', 'experiências') : 'ainda não liderou'}` : undefined,
    ],
    [
      5,
      'Estudos e cursos',
      `${f.estuda === 'sim' ? `Estuda: ${GRAU_ATUAL_ROTULO[f.grau_atual] ?? ''} (${semIcone(TURNO_ESTUDO_ROTULO[f.turno_estudo] ?? '')})` : `Estudou até: ${GRAU_FINAL_ROTULO[f.grau_final] ?? ''}`} · ${f.escola}`,
      f.cursos_sit === 'nunca' ? 'Nenhum curso' : `Cursos: ${f.cursos.map((c) => c.nome).filter(Boolean).join(', ')}`,
    ],
    [
      6,
      'Onde mora',
      [f.bairro, f.cidade].filter(Boolean).join(', '),
      [
        f.meio.map((m) => MEIO_ROTULO[m]).join(' + '),
        temPublico(f) && f.conducoes ? pl(Number(f.conducoes), 'condução', 'conduções') : '',
        (temPublico(f) || temUber(f)) && total > 0 ? `${brl(total)}/dia` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    ],
  ];
  return (
    <div className="vg-resumo">
      {linhas.map(([n, titulo, texto, apoio]) => (
        <div className="vg-rf" key={n}>
          <b>{titulo}</b>
          <p>
            {texto}
            {apoio && <small>{apoio}</small>}
          </p>
          <button type="button" onClick={() => aoEditar(n)} aria-label={`Editar: ${titulo}`}>
            Editar
          </button>
        </div>
      ))}
    </div>
  );
}
