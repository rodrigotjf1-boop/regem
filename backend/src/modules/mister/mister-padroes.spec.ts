import { instanteDeSaoPaulo } from '../../common/pedido-agendado';
import { somarDias } from '../../common/data';
import { QuemFazARegra, conferirRegra } from './mister-regra';
import { textoDoRecado } from './mister-recado';
import {
  CALADO_DIAS,
  DadosDoPadrao,
  ParadaDaImpressora,
  botoesDoPadrao,
  lerBotaoDoPadrao,
  nomeDaImpressora,
  padraoDosAtrasos,
  padroesDaImpressora,
  recadoDaImpressora,
  regraDoPadrao,
  textoDaSugestao,
} from './mister-padroes';

// Versão 6, M6f parte 2 (mig 478): os padrões que o Mister percebe — as regras puras.

const SP = (diaHora: string) => instanteDeSaoPaulo(diaHora)!;
const HOJE = '2026-11-20';
const dia = (k: number) => somarDias(HOJE, -k);
// A loja abre todo dia das 18:00 às 23:30.
const HORARIO = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dia: d, ativo: true, abre: '18:00', fecha: '23:30' }));
const parada = (diaIso: string, ini: string, volta: string | null, chave = 'srv:1:impressora:coz', nome = 'Cozinha'): ParadaDaImpressora => ({
  chave,
  nome,
  inicio: SP(`${diaIso}T${ini}`),
  voltou: volta ? SP(volta.includes('T') ? volta : `${diaIso}T${volta}`) : null,
});

const presidente: QuemFazARegra = { presidente: true, pode: () => true, verValores: true };
const gerenteSemDelivery: QuemFazARegra = { presidente: false, pode: () => false, verValores: false };
const substituivel = (t: string) => ['pedido_parado', 'impressora'].includes(t);

describe('Mister · padrões — a impressora desligada antes do fechamento', () => {
  it('4 dias parada dentro do horário e sem voltar até fechar → o padrão, com a faixa das horas', () => {
    const paradas = [
      parada(dia(1), '22:30', null),
      parada(dia(3), '23:10', `${dia(2)}T09:00`), // voltou no dia seguinte, depois de fechar
      parada(dia(6), '22:45', null),
      parada(dia(9), '22:50', null),
    ];
    expect(padroesDaImpressora(paradas, HORARIO, HOJE)).toEqual([{ chave: 'srv:1:impressora:coz', nome: 'Cozinha', dias: 4, de: '22:30', ate: '23:10' }]);
  });

  it('não conta: a que voltou antes de fechar, a que começou fora do horário, a de hoje e a de mais de 14 dias', () => {
    const paradas = [
      parada(dia(1), '22:30', '23:00'), // voltou às 23:00, antes das 23:30
      parada(dia(2), '10:00', null), // de manhã, com a loja fechada
      parada(HOJE, '22:30', null), // hoje ainda não fechou
      parada(dia(15), '22:30', null), // fora dos 14 dias
      parada(dia(4), '22:30', null),
      parada(dia(5), '22:40', null),
    ];
    expect(padroesDaImpressora(paradas, HORARIO, HOJE)).toEqual([]); // só 2 dias valem
  });

  it('duas paradas no mesmo dia contam um dia; cada impressora é um padrão', () => {
    const paradas = [
      parada(dia(1), '22:30', null),
      parada(dia(1), '22:50', null),
      parada(dia(2), '22:35', null),
      parada(dia(3), '22:40', null),
      parada(dia(1), '22:00', null, 'srv:1:impressora:bar', 'Bar'),
    ];
    const r = padroesDaImpressora(paradas, HORARIO, HOJE);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ nome: 'Cozinha', dias: 3, de: '22:30', ate: '22:40' });
  });

  it('o horário que vira a noite (18:00 às 02:00): a parada da 01:00 que não voltou até as 02:00 conta', () => {
    const virando = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dia: d, ativo: true, abre: '18:00', fecha: '02:00' }));
    const paradas = [1, 2, 3].map((k) => parada(dia(k), '01:00', null));
    expect(padroesDaImpressora(paradas, virando, HOJE)).toEqual([expect.objectContaining({ dias: 3, de: '01:00', ate: '01:00' })]);
  });

  it('a faixa que atravessa a meia-noite fica na ordem do expediente (das 22:30 à 01:00)', () => {
    const virando = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dia: d, ativo: true, abre: '18:00', fecha: '02:00' }));
    const paradas = [parada(dia(2), '01:00', null), parada(dia(4), '22:30', null), parada(dia(6), '23:45', null)];
    expect(padroesDaImpressora(paradas, virando, HOJE)).toEqual([expect.objectContaining({ dias: 3, de: '22:30', ate: '01:00' })]);
  });

  it('sem horário cadastrado não há "antes do fechamento"', () => {
    const paradas = [1, 2, 3, 4].map((k) => parada(dia(k), '22:30', null));
    expect(padroesDaImpressora(paradas, [], HOJE)).toEqual([]);
    expect(padroesDaImpressora(paradas, null, HOJE)).toEqual([]);
  });

  it('o nome da impressora é o mesmo da fonte das regras', () => {
    expect(nomeDaImpressora({ impressora: ' Cozinha ' })).toBe('Cozinha');
    expect(nomeDaImpressora({ nome: 'Bar' })).toBe('Bar');
    expect(nomeDaImpressora(null)).toBe('impressora');
  });
});

describe('Mister · padrões — os atrasos na mesma faixa', () => {
  it('as horas que chegam a 3 dias com 2 ou mais atrasos viram a faixa (de 20:00 às 22:00)', () => {
    const l = [
      ...[1, 2, 3, 4].map((k) => ({ dia: dia(k), hora: 20, n: 3 })),
      ...[2, 5, 6].map((k) => ({ dia: dia(k), hora: 21, n: 2 })),
      { dia: dia(7), hora: 21, n: 1 }, // um só não faz o dia
      { dia: dia(1), hora: 12, n: 5 }, // um dia só no almoço
    ];
    expect(padraoDosAtrasos(l)).toEqual({ de: '20:00', ate: '22:00', dias: 6 });
  });

  it('menos de 3 dias numa hora → nada', () => {
    expect(padraoDosAtrasos([{ dia: dia(1), hora: 20, n: 9 }, { dia: dia(2), hora: 20, n: 9 }])).toBeNull();
    expect(padraoDosAtrasos([])).toBeNull();
  });

  it('a faixa tem no máximo 3 horas: fica a janela com mais dias', () => {
    const l = [18, 19, 20, 21, 22].flatMap((h) => [1, 2, 3].map((k) => ({ dia: dia(h === 22 ? k + 3 : k), hora: h, n: 2 })));
    // 18–20 juntam os dias 1–3; 20–22 juntam 1–6 (a hora 22 trouxe os dias 4–6).
    expect(padraoDosAtrasos(l)).toEqual({ de: '20:00', ate: '23:00', dias: 6 });
  });

  it('a faixa que vai até a meia-noite termina às 23:59 (a hora da regra não aceita 24:00)', () => {
    expect(padraoDosAtrasos([1, 2, 3].map((k) => ({ dia: dia(k), hora: 23, n: 2 })))).toEqual({ de: '23:00', ate: '23:59', dias: 3 });
  });
});

describe('Mister · padrões — a sugestão, os botões e a regra', () => {
  const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
  const impressora: DadosDoPadrao = { tipo: 'impressora_antes_do_fechamento', nome: 'Cozinha', dias: 4, de: '22:30', ate: '23:10' };
  const avisos: DadosDoPadrao = { tipo: 'avisos_sem_resposta', avisos: 14, parametro: 20 };
  const atrasos: DadosDoPadrao = { tipo: 'atrasos_na_faixa', parametro: 20, de: '20:00', ate: '22:00', dias: 5 };

  it('os botões: a impressora com o recado (só a quem pode), os outros com Quero; título de até 20 letras', () => {
    expect(botoesDoPadrao('impressora_antes_do_fechamento', ID, true).map((b) => b.titulo)).toEqual(['Escrever o recado', 'Avisar na hora', 'Não, deixa assim']);
    expect(botoesDoPadrao('impressora_antes_do_fechamento', ID, false).map((b) => b.titulo)).toEqual(['Avisar na hora', 'Não, deixa assim']);
    expect(botoesDoPadrao('avisos_sem_resposta', ID, true).map((b) => b.titulo)).toEqual(['Quero', 'Não, deixa assim']);
    for (const t of ['impressora_antes_do_fechamento', 'avisos_sem_resposta', 'atrasos_na_faixa'] as const)
      for (const b of botoesDoPadrao(t, ID, true)) {
        expect(b.titulo.length).toBeLessThanOrEqual(20);
        expect(lerBotaoDoPadrao(b.id)).toEqual({ padraoId: ID, acao: b.id.split(':')[1] });
      }
  });

  it('o botão de outro serviço ou com id torto não é daqui', () => {
    expect(lerBotaoDoPadrao(`regra:sim:${ID}`)).toBeNull();
    expect(lerBotaoDoPadrao('pad:regra:123')).toBeNull();
    expect(lerBotaoDoPadrao(`pad:apagar:${ID}`)).toBeNull();
    expect(lerBotaoDoPadrao(undefined)).toBeNull();
  });

  it('as frases levam os números do padrão e as do protótipo', () => {
    expect(textoDaSugestao(impressora, true)).toContain('A impressora Cozinha foi desligada antes do fechamento em 4 dos últimos 14 dias, sempre entre 22:30 e 23:10');
    expect(textoDaSugestao(impressora, true)).toContain('escrever um recado para o mural');
    expect(textoDaSugestao(impressora, false)).not.toContain('recado');
    expect(textoDaSugestao(avisos)).toBe(
      'Ontem você recebeu 14 avisos de pedido parado e não respondeu a nenhum. Quer que eu só avise quando forem 3 ou mais ao mesmo tempo, numa mensagem só?',
    );
    expect(textoDaSugestao(atrasos)).toContain('entre 20:00 e 22:00. Em 5 dos últimos 14 dias');
    expect(CALADO_DIAS).toBe(30);
  });

  it('a regra de cada padrão passa pela mesma conferência da conversa', () => {
    for (const d of [impressora, avisos, atrasos]) {
      const r = conferirRegra(regraDoPadrao(d), presidente, substituivel);
      expect('erro' in r ? r.erro : 'ok').toBe('ok');
    }
    const a = conferirRegra(regraDoPadrao(avisos), presidente, substituivel);
    expect('regra' in a && a.regra).toMatchObject({ medida: 'quantidade', condicao: { op: '>=', valor: 3 }, agrupar: true, substitui: ['pedido_parado'] });
    const f = conferirRegra(regraDoPadrao(atrasos), presidente, substituivel);
    expect('regra' in f && f.regra.quando).toEqual({ de: '20:00', ate: '22:00' });
  });

  it('o gerente sem o Delivery no perfil não recebe a sugestão dos pedidos (a regra não caberia); a da impressora, sim', () => {
    expect('erro' in conferirRegra(regraDoPadrao(avisos), gerenteSemDelivery, substituivel)).toBe(true);
    expect('erro' in conferirRegra(regraDoPadrao(atrasos), gerenteSemDelivery, substituivel)).toBe(true);
    expect('erro' in conferirRegra(regraDoPadrao(impressora), gerenteSemDelivery, substituivel)).toBe(false);
  });

  it('o recado da impressora passa pela régua do recado (sem link, até 500 letras)', () => {
    const t = textoDoRecado(recadoDaImpressora('Cozinha'));
    expect('texto' in t && t.texto.split('\n')[0]).toBe('Impressora Cozinha ligada até fechar');
  });
});
