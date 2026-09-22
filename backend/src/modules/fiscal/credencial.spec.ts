import { randomBytes } from 'node:crypto';
import * as forge from 'node-forge';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  certificadoParaAssinar,
  credencialParaEmissao,
  obterCredencial,
  resumoPublico,
  salvarCertificado,
  salvarCsc,
  testarAssinatura,
} from './credencial';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CERTIFICADO A1 E CSC GUARDADOS CIFRADOS (mig 279), contra o Postgres de verdade.
//
// O que precisa ser verdade, e por quê:
//   • no banco NÃO aparece o arquivo, a senha nem o CSC — nem em pedaço;
//   • a tela recebe só o público; nenhuma coluna cifrada sai por aqui;
//   • certificado de outra empresa, senha errada ou sem chave de proteção: nada é guardado;
//   • cada ambiente tem o seu CSC e a emissão pega o do ambiente certo;
//   • o que foi guardado volta inteiro para assinar.
// Nenhum certificado real entra: o .pfx é fabricado aqui.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('credencial.spec: sem TEST_PG_URL — PULADO');

const CNPJ = '12345678000195';
const SENHA = 'Senha-Do-Certificado-9!';

function pfxDeTeste(cnpj: string, senha: string): Buffer {
  const k = forge.pki.rsa.generateKeyPair(1024);
  const c = forge.pki.createCertificate();
  c.publicKey = k.publicKey;
  c.serialNumber = '12fa9c';
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 60 * 86_400_000);
  c.setSubject([{ name: 'commonName', value: `BAR DE TESTE LTDA:${cnpj}` }]);
  c.setIssuer([{ name: 'commonName', value: 'AC DE TESTE' }]);
  c.sign(k.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(k.privateKey, [c], senha, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

descrever('credenciais fiscais cifradas, contra o Postgres', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const chaveOriginal = process.env.SEGREDOS_CHAVE;
  let tenant = '';
  let unidade = '';
  const pfx = pfxDeTeste(CNPJ, SENHA);

  beforeAll(async () => {
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    tenant = (await pool.query(`insert into empresa (nome) values ('Teste credencial') returning id`)).rows[0].id;
    unidade = (
      await pool.query(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [tenant])
    ).rows[0].id;
    await pool.query(
      `insert into fiscal_config (tenant_id, unidade_id, ativo, ambiente, cnpj) values ($1,$2,true,'2',$3)`,
      [tenant, unidade, CNPJ],
    );
  });

  afterAll(async () => {
    if (chaveOriginal === undefined) delete process.env.SEGREDOS_CHAVE;
    else process.env.SEGREDOS_CHAVE = chaveOriginal;
    if (tenant) await pool.query('delete from empresa where id = $1', [tenant]);
    await pool.end();
  });

  it('guarda o certificado e o banco NÃO contém o arquivo nem a senha', async () => {
    const r = await salvarCertificado(db, tenant, unidade, {
      pfxBase64: pfx.toString('base64'),
      senha: SENHA,
    });
    expect(r.cnpj).toBe(CNPJ);

    const linha = (await pool.query('select * from fiscal_credencial where tenant_id = $1', [tenant])).rows[0];
    const tudo = JSON.stringify(linha);
    expect(tudo).not.toContain(SENHA);
    expect(tudo).not.toContain(pfx.toString('base64').slice(0, 40));
    expect(linha.cert_pfx_cifrado.startsWith('v1:')).toBe(true);
    expect(linha.cert_titular).toBe('BAR DE TESTE LTDA');
  }, 60000);

  it('a tela recebe só o público — nenhuma coluna cifrada', async () => {
    const pub = resumoPublico(await obterCredencial(db, tenant, unidade));
    const txt = JSON.stringify(pub);
    expect(txt).not.toMatch(/v1:|cifrad/);
    expect(pub.certificado?.cnpj).toBe(CNPJ);
    expect(pub.protecaoConfigurada).toBe(true);
  }, 60000);

  it('o que foi guardado volta INTEIRO para assinar', async () => {
    const cert = certificadoParaAssinar(await obterCredencial(db, tenant, unidade));
    expect(cert.cnpj).toBe(CNPJ);
    expect(cert.chavePrivadaPem).toContain('PRIVATE KEY');
  }, 60000);

  it('o TESTE do certificado guardado assina e confere — e não devolve segredo', async () => {
    const r = await testarAssinatura(db, tenant, unidade);
    expect(r.ok).toBe(true);
    expect(r.cnpj).toBe(CNPJ);
    expect(r.avisos).toEqual([]);
    const txt = JSON.stringify(r);
    expect(txt).not.toContain(SENHA);
    expect(txt).not.toMatch(/PRIVATE KEY|<Signature|v1:/);
  }, 60000);

  it('com a chave do servidor TROCADA, o teste avisa em vez de assinar', async () => {
    const k = process.env.SEGREDOS_CHAVE;
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    try {
      await expect(testarAssinatura(db, tenant, unidade)).rejects.toThrow(/chave diferente/);
    } finally {
      process.env.SEGREDOS_CHAVE = k;
    }
  }, 60000);

  it('certificado de OUTRA empresa não é guardado', async () => {
    await expect(
      salvarCertificado(db, tenant, unidade, {
        pfxBase64: pfxDeTeste('99999999000100', 'x').toString('base64'),
        senha: 'x',
      }),
    ).rejects.toThrow(/raiz do CNPJ/);
    // O que estava lá continua sendo o certificado certo.
    const pub = resumoPublico(await obterCredencial(db, tenant, unidade));
    expect(pub.certificado?.cnpj).toBe(CNPJ);
  }, 60000);

  it('senha errada não guarda nada', async () => {
    await expect(
      salvarCertificado(db, tenant, unidade, { pfxBase64: pfx.toString('base64'), senha: 'errada' }),
    ).rejects.toThrow(/senha do certificado incorreta/i);
  }, 60000);

  it('SEM chave de proteção neste servidor: recusa ANTES de abrir o arquivo', async () => {
    const k = process.env.SEGREDOS_CHAVE;
    delete process.env.SEGREDOS_CHAVE;
    try {
      await expect(
        salvarCertificado(db, tenant, unidade, { pfxBase64: pfx.toString('base64'), senha: SENHA }),
      ).rejects.toThrow(/SEGREDOS_CHAVE/);
      expect(resumoPublico(undefined).protecaoConfigurada).toBe(false);
    } finally {
      process.env.SEGREDOS_CHAVE = k;
    }
  }, 60000);

  it('cada ambiente tem o SEU CSC, e a emissão pega o do ambiente da config', async () => {
    const cscTeste = 'AAAA1111-BBBB-2222-CCCC-3333DDDD4444';
    const cscProd = 'EEEE5555-FFFF-6666-0000-7777AAAA8888';
    await salvarCsc(db, tenant, unidade, { ambiente: '2', cscId: '000001', csc: cscTeste });
    await salvarCsc(db, tenant, unidade, { ambiente: '1', cscId: '000002', csc: cscProd });

    const linha = await obterCredencial(db, tenant, unidade);
    expect(JSON.stringify(linha)).not.toContain(cscTeste);
    expect(JSON.stringify(linha)).not.toContain(cscProd);

    expect(credencialParaEmissao(linha, '2')).toMatchObject({ cscId: '000001', cscToken: cscTeste });
    expect(credencialParaEmissao(linha, '1')).toMatchObject({ cscId: '000002', cscToken: cscProd });
    // Gravar um ambiente não apagou o outro, nem o certificado.
    expect(credencialParaEmissao(linha, '1').certRef).toBe('credencial');
  }, 60000);

  it('CSC exige ambiente explícito e formato válido', async () => {
    await expect(salvarCsc(db, tenant, unidade, { cscId: '1', csc: 'A'.repeat(20) })).rejects.toThrow(
      /ambiente/,
    );
    await expect(
      salvarCsc(db, tenant, unidade, { ambiente: '2', cscId: '1234567', csc: 'A'.repeat(20) }),
    ).rejects.toThrow(/até 6 dígitos/);
    await expect(salvarCsc(db, tenant, unidade, { ambiente: '2', cscId: '1', csc: 'curto' })).rejects.toThrow(
      /CSC inválido/,
    );
  }, 60000);

  it('credencial da REDE (sem loja) vale para a loja que não tem a sua', async () => {
    const outra = (
      await pool.query(`insert into unidade (tenant_id, nome) values ($1,'Loja 2') returning id`, [tenant])
    ).rows[0].id;
    // A loja 2 não tem credencial própria; a da loja 1 não serve para ela.
    expect(await obterCredencial(db, tenant, outra)).toBeUndefined();
    await salvarCsc(db, tenant, null, { ambiente: '2', cscId: '000009', csc: 'REDE0000-1111-2222-3333-444455556666' });
    expect(credencialParaEmissao(await obterCredencial(db, tenant, outra), '2').cscId).toBe('000009');
    // E a loja 1 continua com a SUA (a da loja tem prioridade sobre a da rede).
    expect(credencialParaEmissao(await obterCredencial(db, tenant, unidade), '2').cscId).toBe('000001');
  }, 60000);
});
