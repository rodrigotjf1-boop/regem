import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ChaveSegredosAusente,
  chaveSegredosDisponivel,
  cifrar,
  decifrar,
  decifrarBytes,
} from '../../common/cifra-segredo';
import {
  CertificadoA1,
  CertificadoInvalido,
  diasParaVencer,
  lerCertificadoA1,
  problemasDoCertificado,
} from './certificado';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CREDENCIAIS FISCAIS DA LOJA: certificado A1 e CSC, sempre CIFRADOS (mig 279).
//
// Regras deste arquivo:
//   • nenhuma função devolve coluna cifrada nem valor decifrado para fora do processo — a tela
//     recebe só o `resumoPublico` (titular, CNPJ, validade, IDs de CSC);
//   • sem `SEGREDOS_CHAVE` nada é guardado (a cifra recusa) — nunca "guarda em texto puro";
//   • a credencial vale para a LOJA ou para a REDE: o CSC e o certificado são da EMPRESA (o
//     próprio portal da SEFAZ-RJ diz "o CSC é único para empresa, não por estabelecimento"),
//     então cadastrar uma vez sem loja serve para todas. A da loja, se existir, tem prioridade.

const linhas = (r: any) => (r?.rows ?? r) as any[];

/** Linha da credencial: a da loja, senão a da rede. */
export async function obterCredencial(db: any, tenantId: string, unidadeId: string | null) {
  const r = await db.execute(sql`
    select * from fiscal_credencial
     where tenant_id = ${tenantId}
       and (unidade_id is not distinct from ${unidadeId ?? null} or unidade_id is null)
     order by (unidade_id is null)
     limit 1`);
  return linhas(r)[0] as any | undefined;
}

/** O que a TELA pode ver. Nunca inclui segredo. */
export function resumoPublico(row: any | undefined) {
  const cert = row?.cert_pfx_cifrado
    ? {
        titular: row.cert_titular,
        cnpj: row.cert_cnpj,
        serial: row.cert_serial,
        validoDe: row.cert_valido_de,
        validoAte: row.cert_valido_ate,
        diasParaVencer: row.cert_valido_ate ? diasParaVencer(new Date(row.cert_valido_ate)) : null,
      }
    : null;
  return {
    // Sem a chave neste servidor a tela avisa ANTES de o usuário mandar o certificado.
    protecaoConfigurada: chaveSegredosDisponivel(),
    certificado: cert,
    csc: {
      homologacao: row?.csc_homolog_cifrado ? { id: row.csc_id_homolog } : null,
      producao: row?.csc_prod_cifrado ? { id: row.csc_id_prod } : null,
    },
  };
}

// Traduz os erros previsíveis em 400 com a mensagem certa (e nada de 500 genérico).
function comoRequisicaoInvalida<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e: any) {
    if (e instanceof ChaveSegredosAusente || e instanceof CertificadoInvalido)
      throw new BadRequestException(e.message);
    throw e;
  }
}

/**
 * Guarda o certificado A1. Confere ANTES de guardar: senha, se é e-CNPJ, se a raiz do CNPJ é a
 * do emitente configurado e se está na validade. Devolve só o resumo público.
 */
export async function salvarCertificado(
  db: any,
  tenantId: string,
  unidadeId: string | null,
  dto: { pfxBase64?: string; senha?: string },
) {
  const b64 = String(dto?.pfxBase64 ?? '').replace(/^data:[^,]*,/, '').trim();
  if (!b64) throw new BadRequestException('Envie o arquivo do certificado (.pfx).');
  if (typeof dto?.senha !== 'string' || !dto.senha)
    throw new BadRequestException('Informe a senha do certificado.');
  const pfx = Buffer.from(b64, 'base64');
  // Um A1 tem poucos KB; um arquivo grande aqui não é certificado (e não deve ir ao banco).
  if (pfx.length > 64 * 1024)
    throw new BadRequestException('Arquivo grande demais para ser um certificado A1 (.pfx).');

  // A chave de proteção tem de existir ANTES de abrir o arquivo — senão teríamos o
  // certificado aberto em memória sem ter onde guardá-lo com segurança.
  if (!chaveSegredosDisponivel()) {
    try {
      cifrar('');
    } catch (e: any) {
      // Ausente ou de tamanho errado: a mensagem da própria cifra diz qual e como resolver.
      throw new BadRequestException(e?.message ?? 'Proteção de segredos indisponível.');
    }
  }

  const cert: CertificadoA1 = comoRequisicaoInvalida(() => lerCertificadoA1(pfx, dto.senha!));

  const cfg = linhas(
    await db.execute(sql`
      select cnpj from fiscal_config
       where tenant_id = ${tenantId}
         and (unidade_id is not distinct from ${unidadeId ?? null} or unidade_id is null)
       order by (unidade_id is null) limit 1`),
  )[0];
  const problemas = problemasDoCertificado(cert, cfg?.cnpj ?? null);
  if (problemas.length) throw new BadRequestException(problemas.join(' '));

  const pfxCifrado = cifrar(pfx);
  const senhaCifrada = cifrar(dto.senha);
  await db.execute(sql`
    insert into fiscal_credencial
      (tenant_id, unidade_id, cert_pfx_cifrado, cert_senha_cifrada, cert_titular, cert_cnpj,
       cert_serial, cert_valido_de, cert_valido_ate)
    values (${tenantId}, ${unidadeId ?? null}, ${pfxCifrado}, ${senhaCifrada}, ${cert.titular},
       ${cert.cnpj}, ${cert.serial}, ${cert.validoDe.toISOString()}, ${cert.validoAte.toISOString()})
    on conflict (tenant_id, (coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update set
      cert_pfx_cifrado = excluded.cert_pfx_cifrado,
      cert_senha_cifrada = excluded.cert_senha_cifrada,
      cert_titular = excluded.cert_titular,
      cert_cnpj = excluded.cert_cnpj,
      cert_serial = excluded.cert_serial,
      cert_valido_de = excluded.cert_valido_de,
      cert_valido_ate = excluded.cert_valido_ate,
      updated_at = now()`);
  return { titular: cert.titular, cnpj: cert.cnpj, serial: cert.serial, validoAte: cert.validoAte };
}

/** Guarda o CSC de UM ambiente ('2' homologação, '1' produção). */
export async function salvarCsc(
  db: any,
  tenantId: string,
  unidadeId: string | null,
  dto: { ambiente?: string; cscId?: string; csc?: string },
) {
  const ambiente = String(dto?.ambiente ?? '');
  // Sem padrão: gravar o CSC de produção no lugar do de teste (ou o inverso) é erro que só
  // aparece como rejeição do QR — então o ambiente é obrigatório e explícito.
  if (ambiente !== '1' && ambiente !== '2')
    throw new BadRequestException('Informe o ambiente do CSC: 2 (homologação) ou 1 (produção).');
  const cscId = String(dto?.cscId ?? '').replace(/\D/g, '');
  if (!cscId || cscId.length > 6)
    throw new BadRequestException('ID do CSC inválido: são até 6 dígitos (ex.: 000001).');
  const csc = String(dto?.csc ?? '').trim();
  // O CSC é alfanumérico, de 16 a 36 caracteres (manual da NFC-e); o do RJ vem com hífens.
  if (!/^[A-Za-z0-9-]{16,40}$/.test(csc))
    throw new BadRequestException('CSC inválido: confira o código copiado do portal da SEFAZ.');

  const cifrado = comoRequisicaoInvalida(() => cifrar(csc));
  const prod = ambiente === '1';
  await db.execute(sql`
    insert into fiscal_credencial (tenant_id, unidade_id, csc_id_homolog, csc_homolog_cifrado,
                                   csc_id_prod, csc_prod_cifrado)
    values (${tenantId}, ${unidadeId ?? null},
            ${prod ? null : cscId}, ${prod ? null : cifrado},
            ${prod ? cscId : null}, ${prod ? cifrado : null})
    on conflict (tenant_id, (coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update set
      csc_id_homolog      = coalesce(excluded.csc_id_homolog, fiscal_credencial.csc_id_homolog),
      csc_homolog_cifrado = coalesce(excluded.csc_homolog_cifrado, fiscal_credencial.csc_homolog_cifrado),
      csc_id_prod         = coalesce(excluded.csc_id_prod, fiscal_credencial.csc_id_prod),
      csc_prod_cifrado    = coalesce(excluded.csc_prod_cifrado, fiscal_credencial.csc_prod_cifrado),
      updated_at = now()`);
  return { ambiente, id: cscId };
}

/**
 * O que a EMISSÃO precisa desta credencial, já decifrado, para o ambiente da config. Fica em
 * memória só durante a emissão. `certRef` diz ao transmissor que há certificado.
 */
export function credencialParaEmissao(row: any | undefined, ambiente: string) {
  const prod = String(ambiente) === '1';
  const idCampo = prod ? row?.csc_id_prod : row?.csc_id_homolog;
  const cifrado = prod ? row?.csc_prod_cifrado : row?.csc_homolog_cifrado;
  let cscToken: string | null = null;
  if (cifrado) {
    try {
      cscToken = decifrar(cifrado);
    } catch (e: any) {
      throw new BadRequestException(
        `Não consegui abrir o CSC guardado: ${e?.message ?? 'falha'}. Cadastre o CSC de novo.`,
      );
    }
  }
  return {
    cscId: cscToken ? idCampo ?? null : null,
    cscToken,
    certRef: row?.cert_pfx_cifrado ? 'credencial' : null,
  };
}

/** Abre o certificado guardado para ASSINAR (etapa B). Só em memória. */
export function certificadoParaAssinar(row: any | undefined): CertificadoA1 {
  if (!row?.cert_pfx_cifrado || !row?.cert_senha_cifrada)
    throw new BadRequestException('Nenhum certificado digital cadastrado para esta loja.');
  return comoRequisicaoInvalida(() =>
    lerCertificadoA1(decifrarBytes(row.cert_pfx_cifrado), decifrar(row.cert_senha_cifrada)),
  );
}
