import { TEMPLATES_CARDAPIO, TEMPLATE_PADRAO, TIPOS_EVENTO_FUNIL, ehTemplateCardapio, proximaAberturaDe, templateDoCardapio } from './menu-themes';

describe('templates do cardápio', () => {
  it('só os quatro templates são aceitos na gravação', () => {
    for (const t of ['galeria', 'balcao', 'oferta', 'fluxo']) expect(ehTemplateCardapio(t)).toBe(true);
    // Layout antigo (tela desatualizada) e lixo não trocam o que está gravado.
    for (const t of ['classic', 'fastfood', 'grid', '', 'Fluxo', 'outro', null, undefined, 3, {}]) expect(ehTemplateCardapio(t)).toBe(false);
    expect(TEMPLATES_CARDAPIO).toHaveLength(4);
  });

  it('loja com layout antigo gravado abre no template padrão (Regem Fluxo)', () => {
    expect(TEMPLATE_PADRAO).toBe('fluxo');
    for (const t of ['classic', 'fastfood', 'grid', '', null, undefined]) expect(templateDoCardapio(t)).toBe('fluxo');
    for (const t of ['galeria', 'balcao', 'oferta', 'fluxo']) expect(templateDoCardapio(t)).toBe(t);
  });

  it('o funil aceita as etapas novas sem perder as antigas', () => {
    expect(TIPOS_EVENTO_FUNIL).toEqual(expect.arrayContaining(['view_menu', 'add_carrinho', 'checkout', 'pagamento', 'pedido', 'etapa_entrega', 'etapa_dados']));
  });
});

describe('proximaAberturaDe', () => {
  const seg = (abre: string, fecha: string, dia = 1) => ({ dia, ativo: true, abre, fecha });

  it('hoje mais tarde: só a hora', () => {
    expect(proximaAberturaDe([seg('18:00', '23:00')], { dia: 1, hhmm: '10:30' })).toBe('18:00');
  });

  it('pega a primeira janela do dia que ainda não abriu', () => {
    const hs = [seg('18:00', '23:00'), seg('11:00', '15:00')];
    expect(proximaAberturaDe(hs, { dia: 1, hhmm: '09:00' })).toBe('11:00');
    expect(proximaAberturaDe(hs, { dia: 1, hhmm: '16:00' })).toBe('18:00');
  });

  it('já passou hoje: o próximo dia com horário, com o dia abreviado', () => {
    const hs = [seg('18:00', '23:00', 1), seg('18:00', '23:00', 5)];
    expect(proximaAberturaDe(hs, { dia: 1, hhmm: '23:30' })).toBe('sex 18:00');
    // De sábado, o próximo é a segunda da semana seguinte.
    expect(proximaAberturaDe(hs, { dia: 6, hhmm: '12:00' })).toBe('seg 18:00');
  });

  it('ignora janela desligada ou incompleta', () => {
    const hs = [{ dia: 1, ativo: false, abre: '08:00', fecha: '12:00' }, { dia: 1, ativo: true, abre: '', fecha: '12:00' }, seg('19:00', '22:00', 2)];
    expect(proximaAberturaDe(hs, { dia: 1, hhmm: '07:00' })).toBe('ter 19:00');
  });

  it('sem horário cadastrado: nulo', () => {
    expect(proximaAberturaDe([], { dia: 1, hhmm: '10:00' })).toBeNull();
    expect(proximaAberturaDe(null, { dia: 1, hhmm: '10:00' })).toBeNull();
  });
});
