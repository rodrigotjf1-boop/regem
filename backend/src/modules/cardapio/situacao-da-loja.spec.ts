import { aplicarNoResumo, sinalDoServidor, vereditoDaLoja, type SinalDoCanal } from './situacao-da-loja';
import { instrucoesDoDirect, instrucoesDoMessenger, instrucoesDoRobo, instrucoesDosComentarios } from './robo-instrucoes';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A LOJA ESTÁ ATENDENDO AGORA? — o veredito do consultar_loja (15/11/2026). Na quinta, sem luz, o dono fechou os aplicativos
// e o atendente do Instagram dizia "estamos abertos" (só olhava o horário do cardápio digital).
const AGORA = new Date('2026-11-13T22:30:00Z'); // 19:30 em São Paulo
const da99 = (estado: SinalDoCanal['estado'], p: Partial<SinalDoCanal> = {}): SinalDoCanal => ({ nome: '99', estado, motivo: null, ate: null, fonte: 'plataforma', ...p });

describe('a loja está atendendo agora? (veredito conferido)', () => {
  it('a quinta sem luz: cardápio "aberto", a 99 fechada e o servidor da loja sem sinal → FECHADA, com o imprevisto', () => {
    const s = vereditoDaLoja({ cardapioAberto: true, canais: [da99('desconectada')], servidor: 'sem_sinal', agora: AGORA });
    expect(s.veredito).toBe('fechada');
    expect(s.motivo).toBe('um imprevisto na loja');
    expect(s.ate).toBeNull();
    expect(s.comoResponder).toContain('Nunca diga que estamos abertos');
    expect(s.comoResponder).toContain('Não prometa hora de volta');
    expect(s.canais).toEqual([{ nome: '99', situacao: 'sem conexão (o aparelho da loja caiu)' }]);
  });

  // ERR-631 (teste do dono, 27/11): o horário do Regem estendido para um pedido de teste e a 99 fora do horário DELA — o
  // atendente dizia "não estamos recebendo pedidos" com o cardápio aberto. O horário da plataforma não fecha a loja.
  it('a 99 fora do horário dela não fecha a loja: o horário do Regem vale (e ela continua na lista)', () => {
    const s = vereditoDaLoja({ cardapioAberto: true, canais: [da99('fora_do_horario')], servidor: 'ok', agora: AGORA });
    expect(s.veredito).toBe('aberta');
    expect(s.comoResponder).toBeNull();
    expect(s.canais).toEqual([{ nome: '99', situacao: 'fora do horário' }]);
    // fora do horário + uma fechada à mão: a fechada conta (a quinta sem luz continua protegida)
    const ifoodPausado: SinalDoCanal = { nome: 'iFood', estado: 'pausada', motivo: null, ate: null, fonte: 'regem' };
    expect(vereditoDaLoja({ cardapioAberto: true, canais: [da99('fora_do_horario'), ifoodPausado], servidor: 'ok', agora: AGORA }).veredito).toBe('fechada');
    // só fora do horário e o servidor da loja sem sinal: incerta (não afirma), como sem aplicativo nenhum
    expect(vereditoDaLoja({ cardapioAberto: true, canais: [da99('fora_do_horario')], servidor: 'sem_sinal', agora: AGORA }).veredito).toBe('incerta');
  });

  it('o motivo que a plataforma diz vence o genérico', () => {
    const s = vereditoDaLoja({ cardapioAberto: true, canais: [da99('pausada', { motivo: 'problema de equipamento ou falta de energia' })], servidor: 'ok', agora: AGORA });
    expect(s).toMatchObject({ veredito: 'fechada', motivo: 'problema de equipamento ou falta de energia' });
  });

  it('um aplicativo aberto basta: aberta (fechar só o iFood no pico não fecha a loja)', () => {
    const ifood: SinalDoCanal = { nome: 'iFood', estado: 'pausada', motivo: 'Muitos pedidos agora', ate: '2026-11-13T23:00:00Z', fonte: 'regem' };
    expect(vereditoDaLoja({ cardapioAberto: true, canais: [ifood, da99('aberta')], servidor: 'sem_sinal', agora: AGORA }).veredito).toBe('aberta');
  });

  it('todos pausados com a volta dita: fechada, com a volta mais tarde em palavras (no fuso da loja)', () => {
    const s = vereditoDaLoja({
      cardapioAberto: true,
      canais: [
        { nome: 'iFood', estado: 'pausada', motivo: 'Muitos pedidos agora', ate: '2026-11-13T23:00:00Z', fonte: 'regem' },
        da99('pausada', { ate: '2026-11-13T23:10:00Z' }),
      ],
      servidor: 'ok',
      agora: AGORA,
    });
    expect(s).toMatchObject({ veredito: 'fechada', ate: 'às 20:10', motivo: 'Muitos pedidos agora' });
    expect(s.canais[0]).toEqual({ nome: 'iFood', situacao: 'pausada pelo Regem, volta às 20:00' });
    expect(s.comoResponder).toContain('Pode dizer até quando');
  });

  it('um sem a volta: não promete volta nenhuma', () => {
    const s = vereditoDaLoja({ cardapioAberto: true, canais: [da99('fechada'), { nome: 'iFood', estado: 'pausada', motivo: null, ate: '2026-11-13T23:00:00Z', fonte: 'regem' }], servidor: 'ok', agora: AGORA });
    expect(s).toMatchObject({ veredito: 'fechada', ate: null });
  });

  it('nenhum aplicativo conhecido e o servidor sem sinal: INCERTA (não afirma, confere com a equipe)', () => {
    const s = vereditoDaLoja({ cardapioAberto: true, canais: [], servidor: 'sem_sinal', agora: AGORA });
    expect(s.veredito).toBe('incerta');
    expect(s.comoResponder).toContain('Não afirme');
  });

  it('nada a dizer contra: aberta, como hoje; e o cardápio fechado (horário) não muda nada', () => {
    expect(vereditoDaLoja({ cardapioAberto: true, canais: [], servidor: 'ok', agora: AGORA }).veredito).toBe('aberta');
    expect(vereditoDaLoja({ cardapioAberto: true, canais: [], servidor: null, agora: AGORA }).veredito).toBe('aberta');
    expect(vereditoDaLoja({ cardapioAberto: false, canais: [da99('aberta')], servidor: 'ok', agora: AGORA }).veredito).toBeNull();
  });

  it('o servidor da loja: sem linha = não tem; batida de 9 min = ok; de 11 min = sem sinal', () => {
    expect(sinalDoServidor(null, AGORA)).toBeNull();
    expect(sinalDoServidor(new Date(AGORA.getTime() - 9 * 60_000), AGORA)).toBe('ok');
    expect(sinalDoServidor(new Date(AGORA.getTime() - 11 * 60_000).toISOString(), AGORA)).toBe('sem_sinal');
  });

  it('no resumo: fechada apaga o "aberta agora" de tudo e o "abre às…"; aberta e incerta só acrescentam o campo', () => {
    const resumo: any = { abertaAgora: true, proximaAbertura: { entrega: null }, atende: { entrega: { abertaAgora: true, tempoMin: 40 }, retirada: null } };
    const fechada = aplicarNoResumo(resumo, vereditoDaLoja({ cardapioAberto: true, canais: [da99('fechada')], servidor: 'ok', agora: AGORA })) as any;
    expect(fechada).toMatchObject({ abertaAgora: false, proximaAbertura: null, atende: { entrega: { abertaAgora: false, tempoMin: 40 }, retirada: null } });
    expect(fechada.situacaoConferida.veredito).toBe('fechada');
    const incerta = aplicarNoResumo(resumo, vereditoDaLoja({ cardapioAberto: true, canais: [], servidor: 'sem_sinal', agora: AGORA })) as any;
    expect(incerta.abertaAgora).toBe(true);
    expect(incerta.situacaoConferida.veredito).toBe('incerta');
  });

  it('as instruções mandam seguir o veredito conferido (WhatsApp, Direct, Messenger e comentários)', () => {
    const loja = { loja: { nome: 'Loja' } } as any;
    for (const texto of [instrucoesDoRobo(loja, '2').texto, instrucoesDoDirect(loja, '2').texto, instrucoesDoMessenger(loja, '2').texto]) {
      expect(texto).toContain('siga SEMPRE abertaAgora e situacaoConferida');
      expect(texto).toContain('Nunca diga que estamos abertos com abertaAgora = false nem com situacaoConferida.veredito = "incerta"');
    }
    expect(instrucoesDosComentarios(loja, '2').texto).toContain('siga abertaAgora e situacaoConferida');
  });
});
