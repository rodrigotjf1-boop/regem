'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TRIBUTOS APROXIMADOS NO CUPOM (Lei 12.741) — que tabela do IBPT vale e o token OPCIONAL do
// lojista (mig 292). Sem token nada muda: a Regem mantém a tabela. Com token, a tabela vem do
// IBPT em nome da empresa. O token segue uma vez para o servidor, que testa e guarda cifrado; a
// tela só volta a ver os 4 últimos caracteres.

const PASSO_A_PASSO_IBPT = 'https://deolhonoimposto.ibpt.org.br/Site/PassoPasso';

const fmtCnpj = (c?: string | null) =>
  (c ?? '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtDia = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const fmtMomento = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

const SITUACAO_TOKEN: Record<string, { texto: string; cls: string }> = {
  ok: { texto: 'Funcionando', cls: 'text-ok' },
  invalido: { texto: 'Recusado pelo IBPT', cls: 'text-destructive' },
  erro: { texto: 'Não consegui confirmar', cls: 'text-warn' },
};

export function TributosAproximados() {
  const [info, setInfo] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [token, setToken] = useState('');
  const [trocando, setTrocando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [removendo, setRemovendo] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setInfo(await api.tributosAprox());
      setErro('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar os tributos aproximados');
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvarToken() {
    if (!token.trim()) return;
    setSalvando(true);
    try {
      const r: any = await api.salvarTokenIbpt(token.trim());
      setInfo(r);
      setTrocando(false);
      toast.success(
        r?.token?.status === 'ok'
          ? 'Token aceito pelo IBPT e guardado com proteção. Sua tabela começa a chegar em instantes.'
          : 'Token guardado. O IBPT não respondeu agora — confiro de novo amanhã.',
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não consegui salvar o token');
    } finally {
      setToken(''); // o token não fica na tela, deu certo ou não
      setSalvando(false);
    }
  }

  async function removerToken() {
    if (!confirm('Remover o token do IBPT?\nOs cupons voltam a usar a tabela da Regem.')) return;
    setRemovendo(true);
    try {
      setInfo(await api.removerTokenIbpt());
      toast.success('Token removido. Os cupons voltam a usar a tabela da Regem.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não consegui remover o token');
    } finally {
      setRemovendo(false);
    }
  }

  const tk = info?.token;
  const protegido = info?.protecaoConfigurada !== false;
  const propria = info?.tabelaPropria;
  const regem = info?.tabelaRegem;
  const situacao = tk?.status ? SITUACAO_TOKEN[tk.status] : null;
  const mostrarCampo = !info?.servidorLocal && (!tk?.configurado || trocando);

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="font-display text-sm font-bold">Tributos aproximados no cupom (Lei 12.741)</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          O cupom mostra quanto do preço é imposto, pela tabela do IBPT. A Regem mantém essa tabela em dia
          para você — não precisa fazer nada. O valor é só informativo: não muda preço, caixa nem relatório.
        </p>
      </div>

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {/* ---- Tabela em uso ---- */}
      {info && (
        <section aria-labelledby="titulo-tabela-ibpt" className="space-y-2">
          <h3 id="titulo-tabela-ibpt" className="text-xs font-semibold text-muted-foreground">
            Tabela em uso
          </h3>
          {!info.uf ? (
            <p className="text-sm text-muted-foreground">Preencha e salve a UF do emitente acima.</p>
          ) : info.emUso === 'propria' ? (
            <p className="text-sm">
              <span className="font-semibold text-ok">Sua tabela</span>, vinda do IBPT pelo seu token — versão{' '}
              <span className="font-mono">{propria?.versao}</span> ({info.uf}), válida até{' '}
              <span className="font-mono">{fmtDia(propria?.vigenciaFim)}</span>.
            </p>
          ) : info.emUso === 'regem' ? (
            <p className="text-sm">
              <span className="font-semibold">Tabela da Regem</span> — IBPT {info.uf} versão{' '}
              <span className="font-mono">{regem?.versao}</span>, válida até{' '}
              <span className="font-mono">{fmtDia(regem?.vigenciaFim)}</span>.
            </p>
          ) : (
            <p className="rounded-md border border-warn/40 bg-warn/5 p-3 text-sm">
              Não há tabela do IBPT vigente para {info.uf}: os cupons saem sem o valor aproximado dos tributos.
              A Regem já foi avisada e envia a tabela nova.
            </p>
          )}
          {propria && info.emUso !== 'propria' && info.ncmsSemPropria > 0 && (
            <p className="text-xs text-muted-foreground">
              Sua tabela ainda não cobre {info.ncmsSemPropria} de {info.ncms} NCM(s) dos seus produtos. Até cobrir,
              vale a tabela da Regem — a sua completa sozinha na próxima atualização.
            </p>
          )}
        </section>
      )}

      {/* ---- Token do lojista (opcional) ---- */}
      {info && (
        <section aria-labelledby="titulo-token-ibpt" className="space-y-3 border-t border-border pt-4">
          <h3 id="titulo-token-ibpt" className="text-xs font-semibold text-muted-foreground">
            Seu token do IBPT (opcional)
          </h3>
          <p className="text-xs text-muted-foreground">
            Se preferir que a tabela venha direto do IBPT em nome da sua empresa, informe o token dela. Sem token,
            continua valendo a tabela da Regem.
          </p>

          {info.servidorLocal && (
            <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              Este é o servidor da loja. O token do IBPT é informado no painel na nuvem, e a tabela chega aqui
              sozinha.
            </p>
          )}

          {!info.servidorLocal && !protegido && (
            <p className="rounded-md border border-warn/40 bg-warn/5 p-3 text-sm">
              A proteção de segredos não está configurada neste servidor. Até ela ser configurada, o token não
              pode ser cadastrado.
            </p>
          )}

          {!info.servidorLocal && tk?.configurado && (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Token</dt>
                <dd className="font-mono">••••{tk.final}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Vale para</dt>
                <dd>{tk.escopo === 'loja' ? 'Esta loja' : 'Todas as lojas da empresa'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Situação</dt>
                <dd className={situacao?.cls ?? ''}>{situacao?.texto ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Última verificação</dt>
                <dd className="font-mono">{fmtMomento(tk.verificadoEm)}</dd>
              </div>
              {tk.mensagem && (
                <div className="sm:col-span-2">
                  <dt className="sr-only">Detalhe</dt>
                  <dd className="text-xs text-muted-foreground">{tk.mensagem}</dd>
                </div>
              )}
            </dl>
          )}

          {!info.servidorLocal && tk?.configurado && !trocando && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setTrocando(true)} disabled={!protegido}>
                Trocar token
              </Button>
              <Button type="button" variant="outline" onClick={removerToken} disabled={removendo}>
                {removendo ? 'Removendo…' : 'Remover token'}
              </Button>
            </div>
          )}

          {mostrarCampo && (
            <>
              <details className="rounded-md border border-border p-3 text-sm" open={!tk?.configurado}>
                <summary className="cursor-pointer font-semibold">Como conseguir o token — passo a passo</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  <li>
                    Abra o site De Olho no Imposto, do IBPT:{' '}
                    <a
                      href={PASSO_A_PASSO_IBPT}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all font-medium text-primary underline underline-offset-2"
                    >
                      deolhonoimposto.ibpt.org.br
                    </a>
                    .
                  </li>
                  <li>Crie a sua conta de pessoa física e confirme o e-mail e o celular que o site pedir.</li>
                  <li>
                    Cadastre a empresa com o CNPJ deste estabelecimento:{' '}
                    <span className="font-mono">{fmtCnpj(info.cnpj) || '— preencha o CNPJ acima —'}</span>.
                  </li>
                  <li>Com a empresa cadastrada, o site mostra o token dela. Copie o token inteiro.</li>
                  <li>Cole aqui embaixo e clique em &quot;Salvar token&quot;. Testamos na hora com o IBPT.</li>
                </ol>
                <p className="mt-2 text-xs text-muted-foreground">
                  O cadastro no IBPT é gratuito e é feito por você. A Regem nunca pede a sua senha do site.
                </p>
              </details>

              <div className="space-y-1">
                <Label htmlFor="ibpt-token" className="text-xs">
                  Token do IBPT
                </Label>
                <Input
                  id="ibpt-token"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={!protegido}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={salvarToken} disabled={!protegido || !token.trim() || salvando}>
                  {salvando ? 'Testando com o IBPT…' : 'Salvar token'}
                </Button>
                {trocando && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setTrocando(false);
                      setToken('');
                    }}
                  >
                    Cancelar
                  </Button>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </Card>
  );
}
