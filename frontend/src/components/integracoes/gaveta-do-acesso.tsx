'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Selo } from '@/components/ui/lista';
import { Gaveta } from '@/components/ui/sobreposto';
import { SeloApp } from './selo-app';
import { DialogoTextoGuardado } from './texto-guardado';
import { TEXTO_ESCOPO, autorizadoPor, comoSaiu, diaEHora, haQuanto, type Acesso, type Aplicativo } from './textos';

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="font-display text-xs font-bold uppercase tracking-wider text-secondary-foreground">{titulo}</h3>
      <div className="text-[14px]">{children}</div>
    </section>
  );
}

/**
 * O que o acesso recebe: a frase do texto que o presidente viu, quando há; senão a do servidor para o aplicativo de
 * parceiro (a página não tem textos dele — os do catálogo daqui falam do Liame); senão a do catálogo da página.
 */
function recebe(app: Aplicativo, acesso: Acesso): { id: string; rotulo: string; texto: string }[] {
  const t = acesso.autorizacao?.texto;
  const doTexto = new Map(t ? [...t.necessarias, ...t.opcionais, ...t.dadosDosClientes, ...t.novas].map((p) => [p.id, p]) : []);
  return acesso.escopos.map((id) => {
    const p = doTexto.get(id);
    if (p) return { id, rotulo: p.rotulo, texto: p.frase };
    const c = app.classe === 'parceiro' ? app.frases?.[id] : TEXTO_ESCOPO[id];
    return { id, rotulo: c?.rotulo ?? id, texto: c?.texto ?? '' };
  });
}

// "Detalhes" de um acesso em Aplicativos conectados (protótipo "Autorização no Regem", aprovado em 21/10/2026): quem
// pediu, o que recebe, a autorização (com o texto guardado, quando veio do clique), o último acesso e o histórico.
export function GavetaDoAcesso({
  app,
  acesso,
  agora,
  aoFechar,
  aoRevogar,
  voltarPara,
}: {
  app: Aplicativo;
  acesso: Acesso;
  agora: Date;
  aoFechar: () => void;
  aoRevogar: () => void;
  voltarPara?: string;
}) {
  const [verTexto, setVerTexto] = useState(false);
  const aut = acesso.autorizacao ?? null;
  const texto = aut?.texto ?? null;
  const itens = recebe(app, acesso);
  const naoRecebe = texto
    ? [...texto.opcionais, ...texto.dadosDosClientes].filter((o) => !acesso.escopos.includes(o.id)).map((o) => o.rotulo.toLowerCase())
    : [];
  const historico = acesso.historico ?? [];
  const nome = `${app.rotulo} ${acesso.lojaNome ? `na ${acesso.lojaNome}` : 'em todas as lojas'}`;
  return (
    <Gaveta
      titulo={nome}
      aoFechar={aoFechar}
      fecharNoFundo
      voltarPara={voltarPara}
      rodape={
        <>
          {acesso.ativo && (
            <Button type="button" variant="outline" className="border-destructive/40 font-bold text-destructive hover:bg-destructive/10" onClick={aoRevogar}>
              Revogar
            </Button>
          )}
          <Button type="button" variant="outline" className="font-bold" onClick={aoFechar}>
            Fechar
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="flex items-start gap-3">
          <SeloApp cliente={app.cliente} rotulo={app.rotulo} pequeno />
          <div className="grid min-w-0 gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <b className="font-bold">{app.rotulo}</b>
              {app.classe === 'parceiro' ? (
                <Selo tom="neutro">Parceiro verificado pela DMS</Selo>
              ) : (
                app.cliente !== 'gogem' && <Selo tom="ok">Produto da DMS</Selo>
              )}
              <Selo tom={acesso.ativo && !acesso.suspenso ? 'ok' : 'neutro'}>{!acesso.ativo ? 'revogado' : acesso.suspenso ? 'suspenso' : 'ativo'}</Selo>
            </span>
            {app.descricao && <span className="text-[13px] text-secondary-foreground">{app.descricao}</span>}
          </div>
        </div>

        {texto && (
          <dl className="grid gap-2 rounded-[11px] border border-border bg-secondary px-3.5 py-3 text-[13.5px]">
            <div className="grid gap-0.5">
              <dt className="font-semibold text-secondary-foreground">Aplicativo de</dt>
              <dd>
                {texto.aplicativo.empresa}
                {texto.aplicativo.cnpj ? ` · CNPJ ${texto.aplicativo.cnpj}` : ''}
              </dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="font-semibold text-secondary-foreground">Pedido pela conta</dt>
              {/* Do texto guardado: o CNPJ já vem com a máscara, como o presidente viu. */}
              <dd className="break-words">
                {texto.contaQuePede.nome} no {app.rotulo} · {texto.contaQuePede.cnpj ? `CNPJ ${texto.contaQuePede.cnpj}` : 'sem CNPJ informado'} ·{' '}
                {texto.contaQuePede.email}
                {texto.contaQuePede.outraEmpresa ? ' · outra empresa' : ''}
              </dd>
            </div>
          </dl>
        )}

        <Bloco titulo="Recebe">
          {!acesso.ativo ? (
            <p>Nada: o acesso foi revogado.</p>
          ) : (
            <>
              <ul className="grid gap-2">
                {itens.map((i) => (
                  <li key={i.id} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 flex-none text-ok" aria-hidden="true" />
                    <span>
                      <b className="font-semibold">{i.rotulo}.</b> <span className="text-secondary-foreground">{i.texto}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {naoRecebe.length > 0 && <p className="mt-2 text-[13px] text-secondary-foreground">Não recebe: {naoRecebe.join(', ')}.</p>}
            </>
          )}
        </Bloco>

        <Bloco titulo="Autorização">
          <p>
            {autorizadoPor(acesso)}
            {texto ? ', com a senha.' : '.'}
          </p>
          {texto && aut ? (
            <p className="mt-1">
              <button
                type="button"
                className="font-bold text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setVerTexto(true)}
              >
                Ver o texto que você autorizou
              </button>
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-secondary-foreground">Sem texto guardado: ele começa com a autorização nova.</p>
          )}
        </Bloco>

        <Bloco titulo="Último acesso">
          <p>{acesso.ativo ? haQuanto(acesso.ultimoUsoEm, agora) : comoSaiu(acesso, app.rotulo)}</p>
          {acesso.ativo && acesso.suspenso && (
            <p className="mt-1 text-[13px] text-secondary-foreground">
              Suspenso: ficou 90 dias sem uso e não lê nada. Volta quando o {app.rotulo} pedir de novo e você autorizar.
            </p>
          )}
        </Bloco>

        <Bloco titulo="Histórico">
          {historico.length ? (
            <ol className="grid gap-2">
              {[...historico].reverse().map((h, i) => (
                <li key={`${h.em}-${i}`} className="grid gap-0.5">
                  <time dateTime={h.em} className="font-mono text-[12px] text-secondary-foreground">
                    {diaEHora(h.em)}
                  </time>
                  <span>{h.texto}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-secondary-foreground">Nada registrado ainda.</p>
          )}
        </Bloco>
      </div>
      {verTexto && texto && aut && <DialogoTextoGuardado texto={texto} versao={aut.versao} em={aut.em} por={aut.por} aoFechar={() => setVerTexto(false)} />}
    </Gaveta>
  );
}
