'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { SeloApp } from './selo-app';
import { type Acesso, type Aplicativo, autorizadoPor, comoSaiu, haQuanto, plural, resumoDoAcesso } from './textos';

const chip = 'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold';
const botaoRevogar = 'h-auto min-h-9 border-destructive/40 px-3 py-1.5 text-[12.5px] font-bold text-destructive hover:bg-destructive/10';

// Um aplicativo conectado: quem é, quantas lojas lê e a tabela dos acessos (os ativos com o
// botão de revogar; os últimos revogados, apagados, com o que aconteceu).
export function CartaoAplicativo({
  app,
  agora,
  aoRevogar,
}: {
  app: Aplicativo;
  agora: Date;
  /** `acesso` nulo = todas as lojas do aplicativo. `origem` = o botão, para devolver o foco. */
  aoRevogar: (acesso: Acesso | null, origem: HTMLButtonElement) => void;
}) {
  const daEmpresa = app.abrangencia === 'empresa';
  const idTitulo = `app-${app.cliente}`;
  return (
    <Card className="overflow-hidden p-0">
      <article aria-labelledby={idTitulo}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-[18px] py-4">
          <SeloApp cliente={app.cliente} rotulo={app.rotulo} pequeno />
          <span className="mr-auto grid leading-tight">
            <b id={idTitulo} className="font-display text-base font-extrabold">
              {app.rotulo}
            </b>
            {app.descricao && <span className="text-[12.5px] text-secondary-foreground">{app.descricao}</span>}
          </span>
          {app.ativos ? (
            <span className={cn(chip, 'bg-ok/15 text-ok')}>
              Ativo · {daEmpresa ? 'todas as lojas' : plural(app.ativos, 'loja', 'lojas')}
            </span>
          ) : (
            <span className={cn(chip, 'border border-border bg-secondary text-secondary-foreground')}>Sem acesso</span>
          )}
        </div>
        {/* `relative`: os textos só para leitor de tela (sr-only, absolutos) ficam presos à área com rolagem. */}
        <div className="relative overflow-x-auto border-t border-border">
          <table className="w-full min-w-[620px] text-[13.5px]">
            <caption className="sr-only">Lojas que o {app.rotulo} lê, o que recebe, quem autorizou e o último acesso</caption>
            <thead>
              <tr className="bg-secondary text-left font-display text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="px-[18px] py-2.5">Loja</th>
                <th scope="col" className="px-[18px] py-2.5">Recebe</th>
                <th scope="col" className="px-[18px] py-2.5">Autorizado por</th>
                <th scope="col" className="px-[18px] py-2.5">Último acesso</th>
                <th scope="col" className="px-[18px] py-2.5 text-right">
                  <span className="sr-only">Ação</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {app.acessos.map((a) => {
                const loja = a.lojaNome ?? 'Todas as lojas';
                const r = resumoDoAcesso(a.escopos, app.cliente);
                return (
                  <tr key={a.id} className={cn('border-t border-border align-middle', !a.ativo && 'text-muted-foreground')}>
                    <td className="whitespace-nowrap px-[18px] py-3 font-bold">{loja}</td>
                    <td className="px-[18px] py-3">
                      {a.ativo ? r.recebe : '—'}
                      {a.ativo && r.nota && <small className="block text-[12.5px] text-secondary-foreground">{r.nota}</small>}
                    </td>
                    <td className="px-[18px] py-3">{autorizadoPor(a)}</td>
                    <td className="px-[18px] py-3">{a.ativo ? haQuanto(a.ultimoUsoEm, agora) : comoSaiu(a, app.rotulo)}</td>
                    <td className="px-[18px] py-3 text-right">
                      {a.ativo ? (
                        <Button
                          type="button"
                          variant="outline"
                          className={botaoRevogar}
                          aria-label={`Revogar o ${app.rotulo} ${a.lojaNome ? `na ${a.lojaNome}` : 'em todas as lojas'}`}
                          onClick={(e) => aoRevogar(a, e.currentTarget)}
                        >
                          Revogar
                        </Button>
                      ) : (
                        <span className={cn(chip, 'border border-border bg-secondary text-secondary-foreground')}>Revogado</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-t border-border px-[18px] py-3.5 text-[13px] text-secondary-foreground">
          <p className="max-w-[56ch]">
            {daEmpresa
              ? `Este acesso é emitido pela distribuição DMS a pedido do presidente. Para ligar de novo depois de revogar, fale com o suporte.`
              : `Para incluir outra loja ou mudar o que o ${app.rotulo} recebe, comece pelo ${app.rotulo}, em Contas conectadas.`}
          </p>
          {app.ativos > 1 && (
            <Button type="button" variant="outline" className={botaoRevogar} onClick={(e) => aoRevogar(null, e.currentTarget)}>
              Revogar todas as lojas
            </Button>
          )}
        </div>
      </article>
    </Card>
  );
}
