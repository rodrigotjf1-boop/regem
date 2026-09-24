import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ContingenciaIndisponivel } from './contingencia';
import {
  REJEICOES_DO_EMITENTE,
  classificarFalhaNfce,
  erroDaVendaDesfeita,
  motivoVendaDesfeita,
  nfceEmitidaParaTotem,
  nfceNaoEmitida,
  repeteNaProxima,
} from './nfce-totem';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CONTRATO DO `nfce` NA VENDA DO TOTEM — o GoGeM é feito contra estes nomes. Um nome trocado
// aqui quebra o outro lado sem nenhum erro de compilação: por isso cada campo é conferido.

const comNota = (e: Error, nota: any) => Object.assign(e, { nota });

describe('a falha da emissão vira a etapa certa do contrato', () => {
  it('pré-voo (sem nota gravada) é CONFIGURAÇÃO — e a próxima venda falha igual', () => {
    const e = classificarFalhaNfce(new BadRequestException('Produto(s) sem NCM (obrigatório p/ NFC-e): X-Burguer'));
    expect(e).toEqual({
      etapa: 'configuracao',
      codigo: null,
      motivo: 'Produto(s) sem NCM (obrigatório p/ NFC-e): X-Burguer',
      repete: true,
    });
  });

  it('a SEFAZ REJEITOU: etapa rejeitada com o cStat; rejeição da venda não repete', () => {
    const e = classificarFalhaNfce(
      comNota(new BadRequestException('NFC-e rejeitada pela SEFAZ: 225 - Falha no Schema'), {
        status: 'rejeitada', cstat: '225',
      }),
    );
    expect(e.etapa).toBe('rejeitada');
    expect(e.codigo).toBe('225');
    expect(e.repete).toBe(false);
  });

  it('rejeição do EMITENTE repete: 781 (não habilitado), certificado vencido (281/291), CNPJ-base (213)', () => {
    for (const cStat of ['781', '281', '291', '213', '230']) {
      const e = classificarFalhaNfce(comNota(new BadRequestException('rejeitada'), { status: 'rejeitada', cstat: cStat }));
      expect({ cStat, repete: e.repete }).toEqual({ cStat, repete: true });
    }
  });

  it('"erro no acesso a LCR" (286/296) é passageiro da SEFAZ — NÃO repete', () => {
    expect(REJEICOES_DO_EMITENTE).not.toHaveProperty('286');
    expect(REJEICOES_DO_EMITENTE).not.toHaveProperty('296');
    expect(repeteNaProxima('rejeitada', '286')).toBe(false);
  });

  it('DENEGADA (301, emitente irregular): etapa própria, sempre repete', () => {
    const e = classificarFalhaNfce(comNota(new BadRequestException('NFC-e DENEGADA'), { status: 'denegada', cstat: '301' }));
    expect(e).toMatchObject({ etapa: 'denegada', codigo: '301', repete: true });
  });

  it('a SEFAZ CALOU e a contingência não saiu: sem_contingencia — nos dois jeitos em que isso chega', () => {
    // 1) já em contingência, e ela não tem como sair (UF só com QR v2, sem certificado)
    expect(classificarFalhaNfce(new ContingenciaIndisponivel('QR v2 off-line não implementado')).etapa).toBe(
      'sem_contingencia',
    );
    // 2) a nota foi à SEFAZ, ficou sem resposta, e a entrada em contingência falhou
    const e = classificarFalhaNfce(comNota(new ServiceUnavailableException('timeout'), { status: 'pendente' }));
    expect(e).toMatchObject({ etapa: 'sem_contingencia', codigo: null, repete: true });
  });

  it('o resto (banco, bug, comanda sumida) é INTERNO — e não repete por definição', () => {
    expect(classificarFalhaNfce(new Error('connection terminated'))).toMatchObject({ etapa: 'interno', repete: false });
    expect(classificarFalhaNfce(new NotFoundException('Comanda não encontrada')).etapa).toBe('interno');
  });

  it('o motivo nunca passa de 400 caracteres (vai para o relatório do totem)', () => {
    expect(classificarFalhaNfce(new BadRequestException('x'.repeat(900))).motivo).toHaveLength(400);
  });
});

describe('o formato do nfce devolvido ao totem', () => {
  const nota = {
    status: 'autorizada', chave: '3'.repeat(44), numero: 7, serie: 51, protocolo: '333260002547395',
    qrcode: 'https://qr', ambiente: '2', simulada: false, emitidaEm: new Date('2026-09-24T12:00:00Z'),
    danfeTexto: 'DANFE NFC-e\n...',
  };

  it('autorizada: resumo completo, danfe e viaEstabelecimento FALSE (mesmo com a 2ª via ligada)', () => {
    const r = nfceEmitidaParaTotem(nota, true);
    expect(r).toMatchObject({
      status: 'autorizada', protocolo: '333260002547395', danfe: 'DANFE NFC-e\n...',
      viaEstabelecimento: false, contingencia: false,
    });
  });

  it('contingência: protocolo NULL (a autorização vem depois) e a 2ª via conforme a configuração', () => {
    const c = { ...nota, status: 'contingencia', protocolo: 'lixo-que-nao-pode-ir' };
    expect(nfceEmitidaParaTotem(c, false)).toMatchObject({
      status: 'contingencia', protocolo: null, contingencia: true, viaEstabelecimento: false,
    });
    expect(nfceEmitidaParaTotem(c, true).viaEstabelecimento).toBe(true);
  });

  it('não emitida: exatamente {status, danfe:null, erro}', () => {
    const erro = { etapa: 'rejeitada' as const, codigo: '225', motivo: 'Falha no Schema', repete: false };
    expect(nfceNaoEmitida(erro)).toEqual({ status: 'nao_emitida', danfe: null, erro });
  });
});

describe('a venda desfeita guarda o motivo — e a repetição reconstrói o MESMO erro', () => {
  const casos = [
    { etapa: 'configuracao' as const, codigo: null, motivo: 'Produto(s) sem NCM: X', repete: true },
    { etapa: 'rejeitada' as const, codigo: '225', motivo: 'NFC-e rejeitada pela SEFAZ: 225 - Falha no Schema', repete: false },
    { etapa: 'rejeitada' as const, codigo: '781', motivo: 'Emissor não habilitado', repete: true },
    { etapa: 'denegada' as const, codigo: '301', motivo: 'Uso Denegado: Irregularidade fiscal do emitente', repete: true },
    { etapa: 'sem_contingencia' as const, codigo: null, motivo: 'A SEFAZ não respondeu: ETIMEDOUT', repete: true },
    { etapa: 'interno' as const, codigo: null, motivo: 'connection terminated\nna segunda linha', repete: false },
  ];

  it.each(casos)('$etapa $codigo: texto legível para a loja e ida-e-volta exata', (erro) => {
    const texto = motivoVendaDesfeita(erro);
    expect(texto.startsWith('NFC-e não emitida (')).toBe(true);
    expect(erroDaVendaDesfeita(texto)).toEqual(erro);
  });

  it('cancelamento por OUTRO motivo não vira erro fiscal inventado', () => {
    expect(erroDaVendaDesfeita('Cupom fiscal não impresso no totem')).toBeNull();
    expect(erroDaVendaDesfeita(null)).toBeNull();
    expect(erroDaVendaDesfeita('NFC-e não emitida (inventada): x')).toBeNull();
  });
});
