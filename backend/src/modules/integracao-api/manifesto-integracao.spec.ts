import 'reflect-metadata';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { CAMINHO_MANIFESTO, conferirManifesto, problemasDoGatilho, VERSAO_PACOTE } from '../../dms/integracao-dms';
import { ESCOPOS_INTEGRACAO } from './escopos';
import { IntegracaoApiController } from './integracao-api.controller';
import { ESCOPOS_KEY } from './integracao-token.guard';
import { CAMINHO_DO_MANIFESTO, ROTAS_FORA_DO_PREFIXO } from './ligacao.regras';
import { ESCOPOS_DA_PORTA, manifestoDaPorta, ROTAS_DA_PORTA } from './manifesto-integracao';
import { EVENTO_DO_RECURSO, EVENTO_DO_RETRATO } from './webhook-integracao';

// O manifesto da porta de integração (Padrão DMS §13; F4, parte A): sem banco nem HTTP. O arquivo do repositório
// (`docs/dms-manifesto.json`) é o que o código monta; com `ATUALIZAR_MANIFESTO=1`, este teste o regrava. A rota sem
// credencial e o kit no modo `manifesto` estão em `dms-id.http.spec.ts`.

const ARQUIVO = join(__dirname, '..', '..', '..', '..', 'docs', 'dms-manifesto.json');
const textoDoManifesto = () => `${JSON.stringify(manifestoDaPorta(), null, 2)}\n`;

/** As rotas do controller da porta, lidas dos decoradores do Nest: `MÉTODO /api/v1/integracao/... permissão`. */
function rotasDoController(): string[] {
  const prefixo = Reflect.getMetadata(PATH_METADATA, IntegracaoApiController) as string;
  const proto = IntegracaoApiController.prototype as unknown as Record<string, unknown>;
  const rotas: string[] = [];
  for (const nome of Object.getOwnPropertyNames(proto)) {
    const fn = proto[nome];
    if (nome === 'constructor' || typeof fn !== 'function') continue;
    const caminho = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
    const metodo = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
    if (caminho === undefined || metodo === undefined) continue;
    const escopos = (Reflect.getMetadata(ESCOPOS_KEY, fn) as string[] | undefined) ?? [];
    if (escopos.length > 1) throw new Error(`a rota ${nome} pede mais de um escopo: o manifesto leva uma permissão por rota`);
    const completo = `/api/v1/${prefixo}/${caminho}`.replace(/\/+$/, '').replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    rotas.push(`${RequestMethod[metodo]} ${completo} ${escopos[0] ?? '-'}`);
  }
  return rotas.sort();
}

describe('manifesto da porta de integração (Padrão §13)', () => {
  it('passa na conferência do pacote', () => {
    expect(conferirManifesto(manifestoDaPorta())).toEqual([]);
  });

  it('o arquivo do repositório é o que o código monta (ATUALIZAR_MANIFESTO=1 regrava)', () => {
    if (process.env.ATUALIZAR_MANIFESTO === '1') writeFileSync(ARQUIVO, textoDoManifesto());
    expect(existsSync(ARQUIVO)).toBe(true);
    expect(readFileSync(ARQUIVO, 'utf8').replace(/\r\n/g, '\n')).toBe(textoDoManifesto());
  });

  it('cada rota do controller está no manifesto, com o método, o caminho e a permissão do código: nenhuma a mais, nenhuma a menos', () => {
    const doManifesto = ROTAS_DA_PORTA.map((r) => `${r.metodo} ${r.caminho} ${r.permissao ?? '-'}`).sort();
    expect(doManifesto).toEqual(rotasDoController());
    expect(doManifesto.length).toBe(15);
  });

  it('as permissões são os escopos do Regem menos os do totem, cada uma com a frase e só a classe dms (o parceiro vem na parte F)', () => {
    const m = manifestoDaPorta() as any;
    const nomes = Object.keys(m['x-dms-permissoes']).sort();
    expect(nomes).toEqual(ESCOPOS_INTEGRACAO.filter((e) => !e.startsWith('totem.')).sort());
    expect([...ESCOPOS_DA_PORTA].sort()).toEqual(nomes);
    for (const nome of nomes) {
      const p = m['x-dms-permissoes'][nome];
      expect(p.classes).toEqual(['dms']);
      expect(p.frase.length).toBeGreaterThan(10);
      expect(p.frase.length).toBeLessThanOrEqual(200);
    }
    const sensiveis = nomes.filter((n) => m['x-dms-permissoes'][n].sensivel);
    expect(sensiveis).toEqual(['clientes.ler', 'clientes.telefone.ler', 'custos.ler', 'vendas.99food.ler']);
    // a frase do telefone é a mesma da tela do clique
    expect(m['x-dms-permissoes']['clientes.telefone.ler'].frase).toMatch(/^O telefone de quem fez o pedido/);
  });

  it('os avisos: os seis tipos das tabelas do aviso, com o exemplo de corpoDoAviso, só com o gatilho', () => {
    const m = manifestoDaPorta() as any;
    const tipos = (m['x-dms-avisos'] as Array<{ tipo: string; permissao: string; exemplo: Record<string, unknown> }>).map((a) => `${a.tipo} ${a.permissao}`).sort();
    const daTabela = [...Object.values(EVENTO_DO_RECURSO), ...Object.values(EVENTO_DO_RETRATO)].map((e) => `${e.tipo} ${e.escopo}`).sort();
    expect(tipos).toEqual(daTabela);
    for (const a of m['x-dms-avisos']) expect(problemasDoGatilho(a.exemplo, a.tipo)).toEqual([]);
  });

  it('a credencial é só o DMS ID: o Regem não tem o acesso próprio, e o rgm_it_ é a credencial antiga', () => {
    const m = manifestoDaPorta() as any;
    expect(m.security).toEqual([{ dmsId: [] }]);
    expect(Object.keys(m.components.securitySchemes)).toEqual(['dmsId']);
  });

  it('fica de fora o que não é a porta de dados: a troca pela ligação, o OAuth e o totem', () => {
    const caminhos = Object.keys((manifestoDaPorta() as any).paths);
    expect(caminhos.filter((c) => /dms-id|autorizacao\/(pedido|token)|\/sync\/|externa-pdv|totem/.test(c))).toEqual([]);
    expect(caminhos.every((c) => c.startsWith('/api/v1/integracao/'))).toBe(true);
  });

  it('o produto, a versão do contrato e a versão da cópia do pacote', () => {
    const m = manifestoDaPorta() as any;
    expect(m.info['x-dms-produto']).toBe('regem');
    expect(m.info.version).toBe('1.0.0');
    expect(m.info['x-dms-pacote']).toBe(VERSAO_PACOTE);
    expect(m.servers).toEqual([{ url: 'https://api.dmsregem.com' }]);
  });

  it('o caminho é o do Padrão e fica fora do prefixo /api/v1', () => {
    expect(`/${CAMINHO_DO_MANIFESTO}`).toBe(CAMINHO_MANIFESTO);
    expect(ROTAS_FORA_DO_PREFIXO.map((r) => r.path)).toContain(CAMINHO_DO_MANIFESTO);
  });

  it('montado uma vez: a mesma resposta a cada pedido', () => {
    expect(manifestoDaPorta()).toBe(manifestoDaPorta());
  });
});
