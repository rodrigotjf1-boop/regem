'use client';

import { COMECA_ROTULO, idadeEm, ORIGEM_ROTULO } from '@/lib/vagas-ficha';
import { doMapa, Escolhas, Grupo, Marcar, Texto } from './campos';
import { ResumoDaFicha } from './resumo';
import type { PropsEtapa } from './tipos';

// Etapa 7 — Para terminar: situação atual, quando começa, as perguntas extras que a loja deixou ligadas, o resumo para
// conferir, a guarda dos dados (obrigatória) e, por último, o termo de mensagens e e-mails (OPCIONAL e separado — dono,
// 10/11/2026; consentimento casado não vale pela LGPD, e a Meta exige o aceite para a loja mandar mensagem automática).
const SIM_NAO = [
  { v: 'sim', rotulo: 'Sim' },
  { v: 'nao', rotulo: 'Não' },
];

export function EtapaFinal(props: PropsEtapa & { aoEditar: (n: number) => void }) {
  const { f, muda, p, erros, hoje, aoEditar } = props;
  const perg = p.pagina.perguntas;
  const comecaOpcoes = doMapa(COMECA_ROTULO).filter((o) => o.v !== 'aviso' || f.trabalhando === 'sim');
  return (
    <>
      <Grupo campo="trabalhando" erros={erros}>
        <span className="vg-perg">Você está trabalhando agora?</span>
        <Escolhas
          rotulo="Está trabalhando agora"
          opcoes={SIM_NAO}
          valor={f.trabalhando}
          aoMudar={(v) => {
            muda('trabalhando', v);
            if (v !== 'sim' && f.comeca === 'aviso') muda('comeca', '');
          }}
        />
      </Grupo>
      <Grupo campo="comeca" erros={erros}>
        <span className="vg-perg">Quando você pode começar?</span>
        <Escolhas rotulo="Quando pode começar" opcoes={comecaOpcoes} valor={f.comeca} aoMudar={(v) => muda('comeca', v)} />
      </Grupo>
      {perg.cnh && f.setores.includes('delivery') && (
        <div className="vg-bloco">
          <h3>🛵 Para o delivery</h3>
          <Grupo campo="cnh" erros={erros}>
            <span className="vg-perg">Tem CNH categoria A?</span>
            <Escolhas
              rotulo="CNH categoria A"
              opcoes={[
                { v: 'sim', rotulo: 'Sim' },
                { v: 'tirando', rotulo: 'Estou tirando' },
                { v: 'nao', rotulo: 'Não' },
              ]}
              valor={f.cnh}
              aoMudar={(v) => muda('cnh', v)}
            />
          </Grupo>
          <Grupo campo="moto" erros={erros}>
            <span className="vg-perg">Tem moto própria?</span>
            <Escolhas rotulo="Moto própria" opcoes={SIM_NAO} valor={f.moto} aoMudar={(v) => muda('moto', v)} />
          </Grupo>
        </div>
      )}
      {perg.feriados && (
        <Grupo campo="feriados" erros={erros}>
          <span className="vg-perg">Pode trabalhar em feriados e datas de muito movimento?</span>
          <Escolhas
            rotulo="Feriados"
            opcoes={[
              { v: 'sim', rotulo: 'Sim' },
              { v: 'alguns', rotulo: 'Em alguns' },
              { v: 'nao', rotulo: 'Não' },
            ]}
            valor={f.feriados}
            aoMudar={(v) => muda('feriados', v)}
            opcional
          />
        </Grupo>
      )}
      {perg.ja_trabalhou && (
        <Grupo campo="ja_trabalhou" erros={erros}>
          <span className="vg-perg">Já trabalhou na {p.loja.nome} antes?</span>
          <Escolhas rotulo="Já trabalhou aqui" opcoes={SIM_NAO} valor={f.ja_trabalhou} aoMudar={(v) => muda('ja_trabalhou', v)} opcional />
        </Grupo>
      )}
      <Grupo campo="origem" erros={erros}>
        <span className="vg-perg">Como ficou sabendo da vaga?</span>
        <Escolhas rotulo="Como ficou sabendo" opcoes={doMapa(ORIGEM_ROTULO)} valor={f.origem_declarada} aoMudar={(v) => muda('origem_declarada', v)} opcional />
      </Grupo>
      {perg.indicacao && f.origem_declarada === 'indicacao' && (
        <Grupo campo="indicacao" erros={erros}>
          <Texto id="vg-ind" rotulo="Quem te indicou?" opcional max={80} valor={f.indicado_por} aoMudar={(v) => muda('indicado_por', v)} placeholder="Nome de quem trabalha aqui" />
        </Grupo>
      )}
      {perg.sobre && (
        <Grupo campo="sobre" erros={erros}>
          <Texto
            id="vg-sobre"
            rotulo="Quer contar algo sobre você?"
            opcional
            area
            max={400}
            valor={f.sobre}
            aoMudar={(v) => muda('sobre', v)}
            placeholder="Ex.: por que quer trabalhar com a gente, do que você mais gosta de fazer…"
          />
          <p className="vg-dica">{f.sobre.length}/400</p>
        </Grupo>
      )}
      <Grupo campo="resumo" erros={erros}>
        <span className="vg-perg">Confira sua ficha antes de enviar</span>
        <ResumoDaFicha f={f} p={p} idade={idadeEm(f.nascimento, hoje)} aoEditar={aoEditar} />
      </Grupo>
      <Grupo campo="consentimento" erros={erros}>
        <div className="vg-consent">
          <Marcar id="vg-consent" marcado={f.consentimento} aoMudar={(v) => muda('consentimento', v)}>
            {p.termos.guarda}
          </Marcar>
        </div>
      </Grupo>
      <Grupo campo="comunicacao" erros={erros}>
        <div className="vg-consent">
          <Marcar id="vg-comunic" marcado={f.comunicacao} aoMudar={(v) => muda('comunicacao', v)}>
            <b>{p.termos.comunicacao.resumo}</b> <em className="vg-opc">(opcional)</em>
          </Marcar>
          <details className="vg-termo">
            <summary>Ler o termo de autorização</summary>
            {p.termos.comunicacao.texto.map((t) => (
              <p key={t.slice(0, 24)}>{t}</p>
            ))}
          </details>
        </div>
      </Grupo>
      {/* campo-isca: escondido de quem usa a tela; robô que preenche tudo é ignorado pelo servidor */}
      <div className="vg-isca" aria-hidden="true">
        <label htmlFor="vg-site">Site</label>
        <input id="vg-site" tabIndex={-1} autoComplete="off" value={f.site} onChange={(e) => muda('site', e.target.value)} />
      </div>
    </>
  );
}
