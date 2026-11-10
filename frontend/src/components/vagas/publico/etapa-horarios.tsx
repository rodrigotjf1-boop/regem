'use client';

import { DIA_ROTULO, DIAS, horarioTexto } from '@/lib/vagas-ficha';
import { Escolhas, Grupo, Texto, type Escolha } from './campos';
import type { PropsEtapa } from './tipos';

// Etapa 3 — Horários. O horário sai da ESCALA (dono, 10/11/2026: 12x36 das 15h às 3h; 5x2 das 19h às 3h; o horista nos
// dias marcados — tudo ajustável pela loja): não há pergunta "diurno ou noturno". Os dias aparecem quando a pessoa não
// escolhe só vaga fixa.
export function EtapaHorarios({ f, muda, p, erros }: PropsEtapa) {
  const pg = p.pagina;
  const h = pg.horarios;
  const tipos: Escolha[] = [];
  if (pg.vagaFixa) tipos.push({ v: 'fixa', icone: '📅', rotulo: 'Vaga fixa', sub: 'Carteira assinada, com escala' });
  if (pg.horista) tipos.push({ v: 'horista', icone: '⏱️', rotulo: 'Horista', sub: 'Por hora, nos dias de mais movimento' });
  if (pg.vagaFixa && pg.horista) tipos.push({ v: 'tanto', icone: '🤝', rotulo: 'Tanto faz', sub: 'Topo as duas' });
  const escalas: Escolha[] = [];
  if (h['12x36'].ativa) escalas.push({ v: '12x36', icone: '12h', rotulo: `12x36 · ${horarioTexto(h['12x36'])}`, sub: 'Trabalha 12 h, descansa 36 h' });
  if (h['5x2'].ativa) escalas.push({ v: '5x2', icone: '5×2', rotulo: `5x2 · ${horarioTexto(h['5x2'])}`, sub: 'Trabalha 5 dias, folga 2' });
  if (escalas.length > 1) escalas.push({ v: 'tanto', icone: '🤝', rotulo: 'Tanto faz', sub: 'Qualquer uma das duas' });
  const fins = [h['12x36'], h['5x2'], h.horista].filter((x) => x.ativa).map((x) => x.fim);
  const fimUnico = fins.length && fins.every((x) => x === fins[0]) ? fins[0] : null;
  const horaFim = fimUnico ? Number(fimUnico.slice(0, 2)) : null;
  const madrugada = horaFim !== null && horaFim < 6;
  return (
    <>
      <Grupo campo="tipo" erros={erros}>
        <span className="vg-perg">Que tipo de vaga você procura?</span>
        <Escolhas rotulo="Tipo de vaga" tipo="opcao" opcoes={tipos} valor={f.tipo} aoMudar={(v) => muda('tipo', v)} />
      </Grupo>
      {(f.tipo === 'fixa' || f.tipo === 'tanto') && (
        <Grupo campo="escala" erros={erros}>
          <span className="vg-perg">Qual escala você prefere?</span>
          <Escolhas rotulo="Escala" tipo="opcao" opcoes={escalas} valor={f.escala} aoMudar={(v) => muda('escala', v)} />
        </Grupo>
      )}
      {madrugada && (
        <p className="vg-nota" style={{ margin: '-8px 0 24px' }}>
          🌙 Os horários terminam às {horaFim}h da manhã. Na etapa &quot;Onde você mora&quot; você conta como volta para casa.
        </p>
      )}
      {(f.tipo === 'horista' || f.tipo === 'tanto') && (
        <Grupo campo="dias" erros={erros}>
          <span className="vg-perg">Em quais dias você pode trabalhar?</span>
          <Escolhas
            rotulo="Dias disponíveis"
            multi
            className="vg-dias"
            opcoes={DIAS.map((d) => ({ v: d, rotulo: DIA_ROTULO[d], forte: h.horista.dias.includes(d) }))}
            valor={f.dias}
            aoMudar={(v) => muda('dias', v)}
          />
          <p className="vg-legenda">
            <span aria-hidden="true" />
            Dias com mais vagas de horista{h.horista.ativa ? ` · horista trabalha ${horarioTexto(h.horista)}` : ''}
          </p>
          <Texto
            id="vg-obs-hor"
            rotulo="Quer explicar algo sobre seus horários?"
            opcional
            area
            max={200}
            classeRotulo="vg-perg-p"
            valor={f.obs_horarios}
            aoMudar={(v) => muda('obs_horarios', v)}
            placeholder="Ex.: sábado só depois das 14h"
          />
        </Grupo>
      )}
    </>
  );
}
