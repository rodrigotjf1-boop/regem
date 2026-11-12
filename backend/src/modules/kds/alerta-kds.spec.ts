import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { avisoDaLinha, avisoDoFarol, duracaoDoAviso, kdsDoAviso } from './alerta-kds';
import { FarolAlertasService } from './farol-alertas.service';

// As regras dos avisos guardados do KDS (onda 3 da auditoria do KDS, mig 412), sem banco: o aviso que cada envio do
// CONTRATO do Farol vira na cozinha (a cópia dos exemplos em `transporte-dos-alertas.farol.json`), e a linha → a tela.

const envios: any[] = JSON.parse(readFileSync(join(__dirname, 'transporte-dos-alertas.farol.json'), 'utf8')).envios;
const LOJA = '3f2b8c1d-9e4a-4b7c-a1d2-5e6f7a8b9c0d';

describe('avisoDoFarol — os exemplos do contrato do Farol', () => {
  it('o agente caiu: emergência → urgente, fica até o "Ciente", sem lugar', () => {
    const a = avisoDoFarol(envios.find((e) => e.motivo === 'agente_caiu'));
    expect(a).toEqual({
      ok: true,
      regemLojaId: LOJA,
      titulo: 'Farol — O Farol parou de auditar esta loja',
      detalhe: 'O agente "PC da cozinha" parou de mandar sinal: esta loja não está sendo auditada.',
      prioridade: 'danger',
      fica: true,
      duracaoSeg: 120,
      origem: 'Farol · emergência',
      ref: 'farol:2d6b1f0e-8c4a-4f3b-9e21-6a7c5d4b3a10',
      ocorridoEm: '2026-11-11T22:40:00.000Z',
    });
  });

  it('um critério fora do combinado: o nome do critério com o lugar (canal › quadro), crítico e urgente', () => {
    const a = avisoDoFarol(envios.find((e) => e.motivo === 'evento'));
    expect(a).toMatchObject({
      ok: true,
      titulo: 'Farol — Touca na cozinha (Chapa › Bancada)',
      detalhe: 'Quem está na chapa está sem touca.',
      prioridade: 'danger',
      fica: true,
      origem: 'Farol · crítico',
    });
  });

  it('o computador do agente esquentando: crítico e urgente, o porquê no detalhe', () => {
    const a = avisoDoFarol(envios.find((e) => e.motivo === 'computador'));
    expect(a).toMatchObject({ ok: true, titulo: 'Farol — O computador do Farol está esquentando', prioridade: 'danger', fica: true });
    expect((a as any).detalhe).toMatch(/placa de vídeo passou de 83 °C/);
  });

  it('atenção e leve: alta, corre 2 min na faixa; informação: info', () => {
    const base = envios.find((e) => e.motivo === 'evento');
    const atencao = avisoDoFarol({ ...base, alerta: { ...base.alerta, severidade: 'atencao', prioridade: 'leve' } });
    expect(atencao).toMatchObject({ ok: true, prioridade: 'alta', fica: false, duracaoSeg: 120, origem: 'Farol · atenção' });
    const info = avisoDoFarol({ ...base, alerta: { ...base.alerta, severidade: 'info', prioridade: 'intermediaria' } });
    expect(info).toMatchObject({ ok: true, prioridade: 'info', fica: false });
    // a prioridade urgente segura no rodapé mesmo sem a severidade alta
    expect(avisoDoFarol({ ...base, alerta: { ...base.alerta, severidade: 'atencao', prioridade: 'urgente' } })).toMatchObject({ fica: true, prioridade: 'alta' });
  });

  it('sem o alerta, sem a loja do Regem ou sem id: não entrega, com o motivo', () => {
    const base = envios[0];
    expect(avisoDoFarol({ ...base, alerta: undefined })).toEqual({ ok: false, erro: expect.stringMatching(/sem o alerta/) });
    expect(avisoDoFarol({ ...base, alerta: { ...base.alerta, loja: { ...base.alerta.loja, regem_loja_id: null } } })).toEqual({
      ok: false,
      erro: expect.stringMatching(/sem a loja do Regem/),
    });
    expect(avisoDoFarol({ ...base, id: 'x' })).toEqual({ ok: false, erro: 'envio sem id' });
  });

  it('motivo que o Regem não conhece ainda aparece (o Farol já manda o alerta montado)', () => {
    const a = avisoDoFarol({ ...envios[0], motivo: 'novo_motivo', alerta: { ...envios[0].alerta, titulo: 'Aviso do Farol' } });
    expect(a).toMatchObject({ ok: true, titulo: 'Farol — Aviso do Farol' });
  });
});

describe('a linha guardada → o aviso da tela', () => {
  it('converte o que o banco devolve (snake_case) e o que o drizzle devolve (camelCase)', () => {
    const em = new Date('2026-11-12T01:00:00.000Z');
    const snake = avisoDaLinha({
      id: 'a1', titulo: 'Lavar as mãos', detalhe: null, prioridade: 'media', duracao_seg: 0, tipo: 'qualquer',
      kds_ids: ['c4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70', 'x'], fica: true, criado_em: em, origem: 'Alertas da loja · agendado',
    });
    expect(snake).toEqual({
      id: 'a1', titulo: 'Lavar as mãos', detalhe: '', prioridade: 'alta', duracaoSeg: 60, som: true, tipo: 'loja',
      kds: ['c4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70'], fica: true, em: '2026-11-12T01:00:00.000Z', origem: 'Alertas da loja · agendado',
    });
    const camel = avisoDaLinha({ id: 'a2', titulo: 'X', prioridade: 'danger', duracaoSeg: 10, tipo: 'farol', kdsIds: null, fica: false, criadoEm: em });
    expect(camel).toMatchObject({ prioridade: 'danger', duracaoSeg: 10, tipo: 'farol', kds: null, fica: false });
  });

  it('os KDS e a duração ficam nos limites', () => {
    expect(kdsDoAviso([])).toBeNull();
    expect(kdsDoAviso('x')).toBeNull();
    expect(duracaoDoAviso(1)).toBe(3);
    expect(duracaoDoAviso(99999)).toBe(3600);
  });
});

describe('a configuração do transporte do Farol', () => {
  it('desligado sem a URL ou sem o token fart_', () => {
    expect(FarolAlertasService.configuracao({})).toBeNull();
    expect(FarolAlertasService.configuracao({ FAROL_ALERTAS_URL: 'https://api.monitorfarol.com.br', FAROL_ALERTAS_TOKEN: 'outra-coisa' })).toBeNull();
    expect(FarolAlertasService.configuracao({ FAROL_ALERTAS_URL: 'api.monitorfarol.com.br', FAROL_ALERTAS_TOKEN: 'fart_x' })).toBeNull();
    expect(FarolAlertasService.configuracao({ FAROL_ALERTAS_URL: 'https://api.monitorfarol.com.br/', FAROL_ALERTAS_TOKEN: ' fart_abc ' })).toEqual({
      url: 'https://api.monitorfarol.com.br',
      token: 'fart_abc',
    });
  });
});
