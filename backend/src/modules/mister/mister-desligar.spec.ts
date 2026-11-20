import { DIAS_SEM_CONVERSA, TEXTOS, textoDoTelefoneDesligado } from './mister.regras';
import { MOTIVO_NA_TELA, MOTIVOS_DO_DESLIGAMENTO, ehMotivoDoDesligamento } from './mister-desligar';
import {
  AVISOS_DE_SEGURANCA,
  PREFIXO_NAO_RECONHECO,
  TIPOS_DE_AVISO,
  TIPOS_DE_SEGURANCA,
  botoesDoTelefoneLigado,
  ehAvisoDeSeguranca,
  lerNaoReconheco,
  situacaoDoTelefoneLigado,
} from './mister-avisos.regras';
import { grupoEscritoDoTipo } from './mister-avisos-escritos';

// Versão 6, M6a (mig 468; `mockups/regem-mister-v6.html`, "Segurança"): o motivo do desligamento, a frase a quem escreve
// de um telefone que saiu, o aviso de telefone ligado aos presidentes e o botão "Não reconheço" — as partes sem banco.

const COLAB = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const LIGADO_EM = '2026-11-20T17:22:05.123Z';

describe('o desligamento e a frase a quem escreve depois', () => {
  it('60 dias sem conversa é a decisão V6-3', () => {
    expect(DIAS_SEM_CONVERSA).toBe(60);
    expect(TEXTOS.vencido).toContain('60 dias sem conversa');
  });

  it('cada motivo tem o texto da parte "Pessoas" e só os cinco valem', () => {
    for (const m of MOTIVOS_DO_DESLIGAMENTO) expect(MOTIVO_NA_TELA[m]).toBeTruthy();
    expect(MOTIVO_NA_TELA.vencido).toBe('60 dias sem conversa');
    expect(ehMotivoDoDesligamento('vencido')).toBe(true);
    expect(ehMotivoDoDesligamento('perdi')).toBe(false);
    expect(ehMotivoDoDesligamento(null)).toBe(false);
  });

  it('a frase pelo motivo: vencido, desligado por alguém ou nunca ligado', () => {
    expect(textoDoTelefoneDesligado('vencido')).toBe(TEXTOS.vencido);
    for (const m of ['pessoa', 'presidente', 'dms', 'nao_reconheco']) expect(textoDoTelefoneDesligado(m)).toBe(TEXTOS.desligado);
    expect(textoDoTelefoneDesligado(null)).toBe(TEXTOS.desconhecido);
    expect(textoDoTelefoneDesligado('')).toBe(TEXTOS.desconhecido);
  });

  it('a frase de ligado diz o final do número antigo só quando houve troca', () => {
    expect(TEXTOS.ligado('Ana', 'Loja Centro', '4321')).toContain('O número antigo (final 4321) foi desligado do Mister.');
    expect(TEXTOS.ligado('Ana', 'Loja Centro')).not.toContain('número antigo');
  });
});

describe('o aviso de segurança: telefone ligado', () => {
  const s = situacaoDoTelefoneLigado({
    tenantId: 'T',
    vinculoId: 'V1',
    colaboradorId: COLAB,
    nome: 'Carlos Lima',
    nivel: 'gerente',
    loja: 'Loja Centro',
    telefone: '5521977887788',
    ligadoEm: LIGADO_EM,
    hora: '14:22',
  });

  it('um aviso por ligação, com o final, quem, a hora e o "Não reconheço" no texto', () => {
    expect(s.tipo).toBe('telefone_ligado');
    expect(s.chave).toBe(`vinculo:V1:${LIGADO_EM}`);
    expect(s.titulo).toBe('WhatsApp final 7788 ligado ao Mister');
    expect(s.detalhe).toContain('às 14:22 a Carlos (gerente · Loja Centro)');
    expect(s.detalhe).toContain('"Não reconheço"');
    // o número inteiro nunca vai no aviso
    expect(JSON.stringify(s)).not.toContain('5521977887788');
  });

  it('a regra é fixa, para os presidentes, fora da lista de ajustes da loja e sempre com o texto fixo', () => {
    expect(TIPOS_DE_SEGURANCA).toEqual(['telefone_ligado']);
    expect(AVISOS_DE_SEGURANCA.telefone_ligado).toMatchObject({ ligado: true, destinos: ['presidente'] });
    expect(TIPOS_DE_AVISO.some((t) => (t.tipo as string) === 'telefone_ligado')).toBe(false);
    expect(ehAvisoDeSeguranca('telefone_ligado')).toBe(true);
    expect(ehAvisoDeSeguranca('impressora')).toBe(false);
    // nunca escrito pela IA (o grupo dos avisos escritos não o conhece)
    expect(grupoEscritoDoTipo('telefone_ligado')).toBeNull();
  });

  it('o botão "Não reconheço" leva a pessoa e o instante da ligação, e cabe no limite da Meta', () => {
    const [b] = botoesDoTelefoneLigado(s.dados);
    expect(b.titulo).toBe('Não reconheço');
    expect(b.titulo.length).toBeLessThanOrEqual(20);
    expect(b.id.startsWith(PREFIXO_NAO_RECONHECO)).toBe(true);
    expect(lerNaoReconheco(b.id)).toEqual({ colaboradorId: COLAB, ligadoEm: LIGADO_EM });
    expect(botoesDoTelefoneLigado({})).toEqual([]);
  });

  it('o id torto do botão não é lido', () => {
    expect(lerNaoReconheco('vinc:nao:nao-e-uuid:2026')).toBeNull();
    expect(lerNaoReconheco(`vinc:nao:${COLAB}`)).toBeNull();
    expect(lerNaoReconheco(`doc:pago:${COLAB}`)).toBeNull();
    expect(lerNaoReconheco(null)).toBeNull();
  });
});
