'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CERTIFICADO A1 E CSC DA NFC-e.
//
// A tela nunca recebe nem mostra segredo: do servidor vem só o público (titular, CNPJ,
// validade, ID de cada CSC). O arquivo, a senha e o CSC seguem uma vez para o servidor, que
// guarda cifrado — e somem do estado da tela assim que o envio termina.

const selectCls = 'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm';

const fmtCnpj = (c?: string) =>
  (c ?? '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtData = (d?: string) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');

function lerComoBase64(arquivo: File): Promise<string> {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result ?? ''));
    r.onerror = () => falha(new Error('Não consegui ler o arquivo.'));
    r.readAsDataURL(arquivo); // o servidor tira o prefixo "data:...;base64,"
  });
}

export function CredencialFiscal() {
  const [info, setInfo] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const campoArquivo = useRef<HTMLInputElement>(null);
  const [senha, setSenha] = useState('');
  const [enviandoCert, setEnviandoCert] = useState(false);
  const [ambiente, setAmbiente] = useState<'1' | '2'>('2');
  const [cscId, setCscId] = useState('');
  const [csc, setCsc] = useState('');
  const [salvandoCsc, setSalvandoCsc] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setInfo(await api.fiscalCredencial());
      setErro('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar as credenciais');
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function enviarCertificado() {
    if (!arquivo || !senha) return;
    setEnviandoCert(true);
    try {
      const pfxBase64 = await lerComoBase64(arquivo);
      setInfo(await api.enviarCertificadoFiscal({ pfxBase64, senha }));
      toast.success('Certificado enviado e guardado com proteção.');
      setArquivo(null);
      if (campoArquivo.current) campoArquivo.current.value = '';
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não consegui enviar o certificado');
    } finally {
      setSenha(''); // a senha não fica na tela, deu certo ou não
      setEnviandoCert(false);
    }
  }

  async function salvarCsc() {
    if (!cscId || !csc) return;
    setSalvandoCsc(true);
    try {
      setInfo(await api.salvarCscFiscal({ ambiente, cscId, csc }));
      toast.success(`CSC de ${ambiente === '1' ? 'produção' : 'homologação'} guardado com proteção.`);
      setCscId('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não consegui salvar o CSC');
    } finally {
      setCsc(''); // idem: o CSC não fica na tela
      setSalvandoCsc(false);
    }
  }

  const cert = info?.certificado;
  const dias: number | null = cert?.diasParaVencer ?? null;
  const protegido = info?.protecaoConfigurada !== false;

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="font-display text-sm font-bold">Certificado digital e CSC</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Enviados uma vez e guardados protegidos. Depois disso, nem esta tela consegue mostrá-los de volta.
        </p>
      </div>

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {info && !protegido && (
        <p className="rounded-md border border-warn/40 bg-warn/5 p-3 text-sm">
          A proteção de segredos não está configurada neste servidor. Até ela ser configurada, o
          certificado e o CSC não podem ser cadastrados.
        </p>
      )}

      {/* ---- Certificado A1 ---- */}
      <section aria-labelledby="titulo-cert" className="space-y-3">
        <h3 id="titulo-cert" className="text-xs font-semibold text-muted-foreground">
          Certificado A1 (.pfx)
        </h3>
        {cert ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Titular</dt>
              <dd>{cert.titular}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">CNPJ</dt>
              <dd className="font-mono">{fmtCnpj(cert.cnpj)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Válido até</dt>
              <dd className="font-mono">{fmtData(cert.validoAte)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Situação</dt>
              <dd
                className={
                  dias == null ? '' : dias < 0 ? 'text-destructive' : dias <= 60 ? 'text-warn' : 'text-ok'
                }
              >
                {dias == null
                  ? '—'
                  : dias < 0
                    ? 'Vencido — a emissão para até trocar o certificado'
                    : dias <= 60
                      ? `Vence em ${dias} dia(s) — providencie a renovação`
                      : `Em dia (${dias} dias)`}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum certificado cadastrado.</p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cert-arquivo" className="text-xs">
              {cert ? 'Trocar certificado' : 'Arquivo do certificado'}
            </Label>
            <Input
              id="cert-arquivo"
              ref={campoArquivo}
              type="file"
              accept=".pfx,.p12"
              disabled={!protegido}
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cert-senha" className="text-xs">
              Senha do certificado
            </Label>
            <Input
              id="cert-senha"
              type="password"
              autoComplete="off"
              disabled={!protegido}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </div>
        </div>
        <Button
          type="button"
          onClick={enviarCertificado}
          disabled={!protegido || !arquivo || !senha || enviandoCert}
        >
          {enviandoCert ? 'Enviando…' : 'Enviar certificado'}
        </Button>
      </section>

      {/* ---- CSC ---- */}
      <section aria-labelledby="titulo-csc" className="space-y-3 border-t border-border pt-4">
        <h3 id="titulo-csc" className="text-xs font-semibold text-muted-foreground">
          CSC — código de segurança do QR Code
        </h3>
        <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <li>
            <span className="text-xs text-muted-foreground">Homologação (teste): </span>
            {info?.csc?.homologacao ? (
              <span className="font-mono">ID {info.csc.homologacao.id}</span>
            ) : (
              <span className="text-muted-foreground">não cadastrado</span>
            )}
          </li>
          <li>
            <span className="text-xs text-muted-foreground">Produção: </span>
            {info?.csc?.producao ? (
              <span className="font-mono">ID {info.csc.producao.id}</span>
            ) : (
              <span className="text-muted-foreground">não cadastrado</span>
            )}
          </li>
        </ul>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="csc-ambiente" className="text-xs">
              Ambiente
            </Label>
            <select
              id="csc-ambiente"
              className={selectCls}
              disabled={!protegido}
              value={ambiente}
              onChange={(e) => setAmbiente(e.target.value === '1' ? '1' : '2')}
            >
              <option value="2">Homologação (teste)</option>
              <option value="1">Produção</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="csc-id" className="text-xs">
              ID do CSC
            </Label>
            <Input
              id="csc-id"
              inputMode="numeric"
              disabled={!protegido}
              value={cscId}
              onChange={(e) => setCscId(e.target.value)}
              placeholder="000001"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="csc-valor" className="text-xs">
              CSC
            </Label>
            <Input
              id="csc-valor"
              type="password"
              autoComplete="off"
              disabled={!protegido}
              value={csc}
              onChange={(e) => setCsc(e.target.value)}
            />
          </div>
        </div>
        <Button type="button" onClick={salvarCsc} disabled={!protegido || !cscId || !csc || salvandoCsc}>
          {salvandoCsc ? 'Salvando…' : 'Salvar CSC'}
        </Button>
      </section>
    </Card>
  );
}
