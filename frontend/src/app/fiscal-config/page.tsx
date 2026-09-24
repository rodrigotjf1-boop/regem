'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CredencialFiscal } from '@/components/fiscal/credencial-fiscal';
import { TerminaisFiscais } from '@/components/fiscal/terminais-fiscais';

/* eslint-disable @typescript-eslint/no-explicit-any */
const selectCls = 'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm';

export default function FiscalConfigPage() {
  const router = useRouter();
  const [f, setF] = useState<any>({ ambiente: '2', regime: 'simples', ativo: false });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  // cat resolvido no cliente (evita divergência de hidratação com o SSR).
  const [cat, setCat] = useState<string | null>(null);
  const isPresidente = cat === 'presidente';
  const [caixaLivre, setCaixaLivre] = useState<boolean | null>(null);

  const reload = useCallback(async () => {
    try {
      const [fc, cc] = await Promise.all([
        api.fiscalConfig(),
        api.caixaConfig().catch(() => ({ caixaLivre: false })),
      ]);
      setF(fc);
      setCaixaLivre(!!(cc as any).caixaLivre);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    setCat(getCategoria());
    reload();
  }, [reload, router]);

  async function toggleCaixaLivre(ativo: boolean) {
    try {
      await api.setCaixaLivre(ativo);
      setCaixaLivre(ativo);
      toast.success(ativo ? 'Atendente pode sangrar/suprir sem gerente.' : 'Sangria/suprimento exige gerente.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  const set = (patch: any) => setF((s: any) => ({ ...s, ...patch }));

  async function salvar() {
    setSalvando(true);
    try {
      await api.setFiscalConfig({
        ativo: f.ativo,
        ambiente: f.ambiente,
        regime: f.regime,
        crt: f.regime === 'simples' ? 1 : 3,
        serie: f.serie ? Number(f.serie) : 1,
        serieNuvem: f.serieNuvem ? Number(f.serieNuvem) : 2,
        cnpj: f.cnpj,
        razaoSocial: f.razaoSocial,
        nomeFantasia: f.nomeFantasia,
        ie: f.ie,
        uf: f.uf,
        codigoUf: f.codigoUf ? Number(f.codigoUf) : undefined,
        codigoMunicipio: f.codigoMunicipio ? Number(f.codigoMunicipio) : undefined,
        endereco: f.endereco,
        municipio: f.municipio,
        bairro: f.bairro,
        numero: f.numero,
        complemento: f.complemento,
        cep: f.cep,
        urlQrcodeProd: f.urlQrcodeProd,
        urlQrcodeHomolog: f.urlQrcodeHomolog,
        urlChaveProd: f.urlChaveProd,
        urlChaveHomolog: f.urlChaveHomolog,
        // Vazio = volta ao padrão da UF (no RJ, R$ 2.000).
        limiteIdentificacao: String(f.limiteIdentificacao ?? '').trim() === '' ? null : Number(f.limiteIdentificacao),
        deliverySemCpf: f.deliverySemCpf || 'presencial',
        contingenciaViaEstabelecimento: !!f.contingenciaViaEstabelecimento,
        infoFisco: String(f.infoFisco ?? '').trim(),
        // Vazio = "ainda não escolhido": a nota de comanda com taxa fica recusada até escolher.
        taxaServicoNfce: f.taxaServicoNfce || '',
      });
      toast.success('Configuração fiscal salva.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  if (cat === null) {
    return (
      <Shell eyebrow="Fiscal" title="Configuração fiscal">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </Shell>
    );
  }

  if (!isPresidente) {
    return (
      <Shell eyebrow="Fiscal" title="Configuração fiscal">
        <p className="text-sm text-muted-foreground">Acesso restrito ao presidente.</p>
      </Shell>
    );
  }

  return (
    <Shell eyebrow="Fiscal · NFC-e" title="Configuração fiscal">
      <div className="space-y-4">
        {erro && <p className="text-destructive">{erro}</p>}

        <Card className="border-warn/40 bg-warn/5 p-4 text-sm">
          <p className="font-semibold">A emissão ainda não está disponível</p>
          <p className="mt-1 text-muted-foreground">
            Falta a assinatura digital e a transmissão à SEFAZ. Enquanto isso, <b>nenhuma nota é
            emitida</b> — a venda continua normal, e o sistema recusa a emissão em vez de registrar
            uma nota que não existe na SEFAZ. Preencha os dados abaixo: eles já são conferidos antes
            de qualquer tentativa.
          </p>
        </Card>

        <Card className="space-y-4 p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={!!f.ativo} onChange={(e) => set({ ativo: e.target.checked })} className="h-4 w-4 accent-primary" />
            Emitir NFC-e automaticamente nas vendas desta unidade
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Ambiente</Label>
              <select aria-label="Ambiente" className={selectCls} value={f.ambiente} onChange={(e) => set({ ambiente: e.target.value })}>
                <option value="2">Homologação (teste)</option>
                <option value="1">Produção</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Regime tributário</Label>
              <select aria-label="Regime" className={selectCls} value={f.regime} onChange={(e) => set({ regime: e.target.value })}>
                <option value="simples">Simples Nacional</option>
                <option value="normal">Regime Normal</option>
              </select>
            </div>
            {/* Séries distintas por ponto de emissão: o balcão numera na série da loja e o
                delivery na da nuvem, então uma queda de internet não faz os dois emitirem
                notas com o mesmo número. As duas têm de ser diferentes, e nunca 0. */}
            {/* Taxa de serviço (garçom). Cada casa tem o seu protocolo e o contador decide: a CLT
                manda lançá-la na nota de consumo e diz que ela não é receita da casa; no Simples
                ela integra a receita bruta; no regime normal sai da base do ICMS até 10% (SP 15%).
                Sem escolha, a NFC-e de comanda com taxa é recusada — em vez de o sistema decidir. */}
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Taxa de serviço na NFC-e</Label>
              <select
                aria-label="Taxa de serviço na NFC-e"
                className={selectCls}
                value={f.taxaServicoNfce ?? ''}
                onChange={(e) => set({ taxaServicoNfce: e.target.value })}
              >
                <option value="">Ainda não definido (a nota de comanda com taxa é recusada)</option>
                <option value="fora_da_nota">Fora da nota fiscal — só nos itens da conta</option>
                <option value="item_tributado">Linha tributada — Simples Nacional (integra a receita bruta)</option>
                <option value="item_nao_tributado">Linha não tributada, CST 41 — regime normal, até 10% (SP 15%)</option>
              </select>
              <p className="text-[11px] text-muted-foreground">
                Defina com o contador. A linha na nota sai com exatamente o valor cobrado a mais, para o total bater com o
                pagamento.
              </p>
            </div>
            {/* Informação ao Fisco (`infAdFisco`). No RJ é o FECP (Lei 8.405/19), e o campo nunca
                fica vazio: "em caso de NÃO INCIDÊNCIA do FECP, deverá constar essa informação".
                Se incide ou não é fato tributário da loja — por isso o texto vem do contador, e a
                emissão em produção no RJ recusa enquanto estiver em branco. */}
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Informação ao Fisco (FECP) — obrigatória no RJ</Label>
              <Input
                value={f.infoFisco ?? ''}
                onChange={(e) => set({ infoFisco: e.target.value })}
                placeholder="Texto definido pelo contador — ex.: FECP não incidente nesta operação (Lei 8.405/19)"
              />
              <p className="text-[11px] text-muted-foreground">
                Sai no campo de informações ao Fisco de toda NFC-e. No RJ, sem ele a emissão em produção é recusada.
              </p>
            </div>
            {/* Contingência: o cupom do cliente sai sempre. A 2ª via de papel é a exceção —
                ela fica com o estabelecimento até a nota ser autorizada. Restaurante não
                arquiva cupom, e o MOC aceita no lugar a guarda eletrônica do XML, que é o que
                já fazemos. */}
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={!!f.contingenciaViaEstabelecimento}
                onChange={(e) => set({ contingenciaViaEstabelecimento: e.target.checked })}
                className="mt-1 h-4 w-4 accent-primary"
              />
              <span>
                Imprimir a 2ª via (&ldquo;via do estabelecimento&rdquo;) nas notas de contingência
                <span className="block text-xs text-muted-foreground">
                  Desligado, a guarda é o XML da nota, que já fica arquivado e pode ser reimpresso
                  quando o Fisco pedir. Para usar a guarda eletrônica, a loja precisa lavrar o
                  termo no livro Registro de Utilização de Documentos Fiscais (modelo 6).
                </span>
              </span>
            </label>
            {/* Pedido de entrega sem CPF: emitir declarando operação presencial (a taxa entra
                como despesa acessória, e o total continua batendo com o que o cliente pagou) ou
                não emitir. Venda sem nota nenhuma é infração; nota sem o CPF que o cliente não
                quis dar, não. */}
            <div className="space-y-1">
              <Label className="text-xs">Pedido de entrega sem CPF do cliente</Label>
              <select
                aria-label="Pedido de entrega sem CPF do cliente"
                className={selectCls}
                value={f.deliverySemCpf ?? 'presencial'}
                onChange={(e) => set({ deliverySemCpf: e.target.value })}
              >
                <option value="presencial">Emitir como operação presencial</option>
                <option value="nao_emitir">Não emitir a nota</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Valor a partir do qual o CPF é obrigatório</Label>
              <Input
                value={f.limiteIdentificacao ?? ''}
                onChange={(e) => set({ limiteIdentificacao: e.target.value })}
                placeholder="vazio = padrão da UF"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Série do balcão (servidor local)</Label>
              <Input value={f.serie ?? ''} onChange={(e) => set({ serie: e.target.value })} placeholder="1" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Série da nuvem (delivery e pedido online)</Label>
              <Input value={f.serieNuvem ?? ''} onChange={(e) => set({ serieNuvem: e.target.value })} placeholder="2" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CNPJ</Label>
              <Input value={f.cnpj ?? ''} onChange={(e) => set({ cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Razão social</Label>
              <Input value={f.razaoSocial ?? ''} onChange={(e) => set({ razaoSocial: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nome fantasia</Label>
              <Input value={f.nomeFantasia ?? ''} onChange={(e) => set({ nomeFantasia: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Inscrição estadual</Label>
              <Input value={f.ie ?? ''} onChange={(e) => set({ ie: e.target.value })} placeholder="ISENTO" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">UF</Label>
              <Input value={f.uf ?? ''} onChange={(e) => set({ uf: e.target.value })} placeholder="SP" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Código IBGE da UF</Label>
              <Input value={f.codigoUf ?? ''} onChange={(e) => set({ codigoUf: e.target.value })} placeholder="35" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Código IBGE do município</Label>
              <Input value={f.codigoMunicipio ?? ''} onChange={(e) => set({ codigoMunicipio: e.target.value })} placeholder="3550308" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Município</Label>
              <Input value={f.municipio ?? ''} onChange={(e) => set({ municipio: e.target.value })} placeholder="São Paulo" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Logradouro</Label>
              <Input value={f.endereco ?? ''} onChange={(e) => set({ endereco: e.target.value })} placeholder="Rua das Flores" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Número</Label>
              <Input value={f.numero ?? ''} onChange={(e) => set({ numero: e.target.value })} placeholder="100" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Complemento</Label>
              <Input value={f.complemento ?? ''} onChange={(e) => set({ complemento: e.target.value })} placeholder="LOJA 02" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bairro</Label>
              <Input value={f.bairro ?? ''} onChange={(e) => set({ bairro: e.target.value })} placeholder="Centro" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CEP</Label>
              <Input value={f.cep ?? ''} onChange={(e) => set({ cep: e.target.value })} placeholder="00000-000" />
            </div>
            {/* A URL de consulta do QR Code muda de estado para estado — não existe uma
                nacional. Sem a da UF da loja, o QR do cupom não é conferível. */}
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">URL de consulta do QR Code — homologação</Label>
              <Input
                value={f.urlQrcodeHomolog ?? ''}
                onChange={(e) => set({ urlQrcodeHomolog: e.target.value })}
                placeholder="https://…/ConsultaQRCode.aspx (da SEFAZ do seu estado)"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">URL de consulta do QR Code — produção</Label>
              <Input
                value={f.urlQrcodeProd ?? ''}
                onChange={(e) => set({ urlQrcodeProd: e.target.value })}
                placeholder="https://…/ConsultaQRCode.aspx (da SEFAZ do seu estado)"
              />
            </div>
            {/* A consulta PELA CHAVE é outro endereço, diferente do QR Code — é o que aparece
                impresso no cupom em "Consulte pela chave de acesso em…". */}
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">URL de consulta pela chave de acesso — homologação</Label>
              <Input
                value={f.urlChaveHomolog ?? ''}
                onChange={(e) => set({ urlChaveHomolog: e.target.value })}
                placeholder="a que a SEFAZ do seu estado publica para homologação"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">URL de consulta pela chave de acesso — produção</Label>
              <Input
                value={f.urlChaveProd ?? ''}
                onChange={(e) => set({ urlChaveProd: e.target.value })}
                placeholder="ex.: www.fazenda.rj.gov.br/nfce/consulta"
              />
            </div>
          </div>

          <Button type="button" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar configuração'}
          </Button>
        </Card>

        <CredencialFiscal />

        <TerminaisFiscais />

        <Card className="p-4">
          <h2 className="mb-1 font-display text-sm font-bold">Autorização de caixa</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Define se o atendente pode fazer sangria/suprimento no caixa sem autorização de um gerente.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!caixaLivre}
              onChange={(e) => toggleCaixaLivre(e.target.checked)}
              className="h-4 w-4 accent-primary"
              aria-label="Permitir sangria/suprimento pelo atendente"
            />
            Atendente pode fazer sangria/suprimento sem autorização
          </label>
        </Card>
      </div>
    </Shell>
  );
}
