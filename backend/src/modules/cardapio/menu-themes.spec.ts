import { MENU_THEMES, TIPOS_EVENTO_FUNIL, menuThemeValido, proximaAberturaDe } from './menu-themes';

describe('layouts do cardápio', () => {
  it('aceita os templates novos e os layouts antigos; recusa o resto', () => {
    for (const t of ['galeria', 'balcao', 'oferta', 'fluxo', 'classic', 'fastfood', 'grid']) expect(menuThemeValido(t)).toBe(true);
    for (const t of ['', 'Fluxo', 'outro', null, undefined, 3, {}]) expect(menuThemeValido(t)).toBe(false);
    expect(MENU_THEMES).toHaveLength(7);
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
