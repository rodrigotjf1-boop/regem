import { BadRequestException } from '@nestjs/common';
import {
  buscasDoEndereco,
  conducaoDaPessoa,
  contratadoDaFicha,
  detalheDaVaga,
  mensagemDoAviso,
  motivoDeNaoAvisar,
  nomeDaFuncaoParaComparar,
  protocoloLegivel,
  textoDaConfirmacao,
  gerarProtocolo,
  idadeEm,
  kmDeMetros,
  lerFicha,
  lerOrigem,
  lerPagina,
  lerSituacao,
  origemQueConta,
  origensDasFichas,
  paginaDaLinha,
  paginaPadrao,
  slug,
  termoDaComunicacao,
  mensagemDoAvisoPeloMarketing,
  parametrosDoModeloDaVaga,
  respostaAoAviso,
  textoDaSaidaDosAvisos,
  textoDoInteresse,
  viaDoAviso,
  viaManda,
} from './vagas';

describe('F4b parte 2: as respostas ao aviso', () => {
  it('participar, sair dos avisos de vaga ou sair de tudo — e o resto não é resposta ao aviso', () => {
    for (const t of ['Tenho interesse', 'tenho interesse!', 'Sim', 'quero', 'Quero participar.']) expect([t, respostaAoAviso(t)]).toEqual([t, 'interesse']);
    for (const t of ['Não quero mais receber', 'nao quero receber']) expect([t, respostaAoAviso(t)]).toEqual([t, 'nao_quero']);
    for (const t of ['SAIR', 'parar', 'Sair das ofertas']) expect([t, respostaAoAviso(t)]).toEqual([t, 'sair']);
    for (const t of ['quanto paga?', 'sim, mas só à noite', 'cancelar', '', null]) expect([t, respostaAoAviso(t)]).toEqual([t, null]);
  });
  it('as frases das cenas 3 e 4 do protótipo (com a data em que a ficha se apaga)', () => {
    expect(textoDoInteresse('Juliana Souza', 'Burger da Praça')).toBe('Obrigado, Juliana! Avisamos a equipe da Burger da Praça. Eles chamam você por aqui para combinar a entrevista.');
    expect(textoDaSaidaDosAvisos('Marcos Lima', 'Burger da Praça', '2027-05-10')).toBe(
      'Pronto, Marcos. Você não recebe mais avisos de vaga da Burger da Praça. Sua ficha fica guardada até 10/05/2027 e depois é apagada.',
    );
    expect(textoDaSaidaDosAvisos('', 'Burger da Praça', null)).toBe('Pronto. Você não recebe mais avisos de vaga da Burger da Praça.');
  });
});
import { fichaValida } from './vagas-exemplo-spec';

describe('F4b parte 2: o aviso pelo número de marketing', () => {
  const dados = { nome: 'Juliana Souza', loja: 'Burger da Praça', funcao: 'Chapeiro(a)', detalhe: '12x36, das 18h às 6h · R$ 1.900,00' };
  it('a via pelo número de marketing e pela situação do modelo na Meta; só o aprovado e o Evolution mandam', () => {
    expect(viaDoAviso(null, null)).toBe('sem');
    expect(viaDoAviso({ provedor: 'evolution', vinculado: false }, null)).toBe('sem');
    expect(viaDoAviso({ provedor: 'evolution', vinculado: true }, 'aprovado')).toBe('evolution');
    expect(viaDoAviso({ provedor: 'cloud', vinculado: true }, 'aprovado')).toBe('oficial_aprovado');
    expect(viaDoAviso({ provedor: 'cloud', vinculado: true }, 'pendente')).toBe('oficial_analise');
    expect(viaDoAviso({ provedor: 'cloud', vinculado: true }, 'rejeitado')).toBe('oficial_recusado');
    expect(viaDoAviso({ provedor: 'cloud', vinculado: true }, 'pausado')).toBe('oficial_recusado');
    expect(viaDoAviso({ provedor: 'cloud', vinculado: true }, 'rascunho')).toBe('oficial_sem_modelo');
    expect(viaDoAviso({ provedor: 'cloud', vinculado: true }, null)).toBe('oficial_sem_modelo');
    expect(['oficial_aprovado', 'evolution', 'oficial_analise', 'oficial_sem_modelo', 'oficial_recusado', 'sem'].filter((v: any) => viaManda(v))).toEqual([
      'oficial_aprovado',
      'evolution',
    ]);
  });
  it('os 4 parâmetros do modelo vaga_aberta (o primeiro nome) e o texto do Evolution com as duas respostas escritas', () => {
    expect(parametrosDoModeloDaVaga(dados)).toEqual(['Juliana', 'Burger da Praça', 'Chapeiro(a)', '12x36, das 18h às 6h · R$ 1.900,00']);
    // A Meta recusa parâmetro vazio: sem nome e sem detalhe, um texto que cabe na frase.
    expect(parametrosDoModeloDaVaga({ ...dados, nome: ' ', detalhe: '' })).toEqual(['tudo bem', 'Burger da Praça', 'Chapeiro(a)', 'detalhes na página de vagas']);
    expect(mensagemDoAvisoPeloMarketing(dados)).toBe(
      'Olá, Juliana! A Burger da Praça abriu vaga de Chapeiro(a) (12x36, das 18h às 6h · R$ 1.900,00). Você deixou sua ficha no nosso banco de talentos. Quer participar da seleção?\n\n' +
        'Responda *Tenho interesse* para participar, ou SAIR para não receber mais.',
    );
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('vagas · avisar o banco de talentos (F4b, parte 1)', () => {
  it('a vaga numa linha: as escalas ligadas da página e o salário da função', () => {
    const p = paginaPadrao();
    expect(detalheDaVaga(p, { salario: 'R$ 1.900,00' })).toBe('12x36, das 15h às 3h · 5x2, das 19h às 3h · horista (sex, sáb, dom) · R$ 1.900,00');
    expect(detalheDaVaga({ ...p, horista: false }, { salario: '' })).toBe('12x36, das 15h às 3h · 5x2, das 19h às 3h');
    expect(detalheDaVaga({ ...p, vagaFixa: false, horarios: { ...p.horarios, horista: { ...p.horarios.horista, inicio: '19:30' } } }, { salario: '' })).toBe('horista (sex, sáb, dom)');
  });
  it('a mensagem pronta: primeiro nome, loja, função e a vaga — sem o "SAIR" (a resposta volta a quem avisou)', () => {
    const m = mensagemDoAviso({ nome: 'Juliana Souza', loja: 'Burger da Praça', funcao: 'Chapeiro', detalhe: '12x36, das 15h às 3h · R$ 1.900,00' });
    expect(m).toBe(
      'Olá, Juliana! A Burger da Praça abriu vaga de Chapeiro (12x36, das 15h às 3h · R$ 1.900,00). Você deixou sua ficha no nosso banco de talentos. Quer participar da seleção?\n\nSe não quiser mais receber avisos de vaga, é só responder dizendo.',
    );
    expect(m).not.toContain('SAIR');
    expect(mensagemDoAviso({ nome: '', loja: 'X', funcao: 'Atendente', detalhe: '' })).toMatch(/^Olá! A X abriu vaga de Atendente\. /);
  });
  it('quem não recebe: saiu das mensagens, não autorizou, ou foi avisado desta função há menos de 30 dias', () => {
    const hoje = '2026-11-16';
    expect(motivoDeNaoAvisar({ aceitaEm: '2026-11-01', canceladaEm: null, avisadoEm: null }, hoje)).toBeNull();
    expect(motivoDeNaoAvisar({ aceitaEm: '2026-11-01', canceladaEm: '2026-11-05', avisadoEm: null }, hoje)).toBe('pediu para não receber mensagens em 05/11');
    expect(motivoDeNaoAvisar({ aceitaEm: null, canceladaEm: null, avisadoEm: null }, hoje)).toBe('não autorizou mensagens na ficha');
    expect(motivoDeNaoAvisar({ aceitaEm: '2026-10-01', canceladaEm: null, avisadoEm: '2026-11-12' }, hoje)).toBe('já foi avisada desta função em 12/11 (de novo a partir de 12/12)');
    // 30 dias depois, de novo
    expect(motivoDeNaoAvisar({ aceitaEm: '2026-10-01', canceladaEm: null, avisadoEm: '2026-10-17' }, hoje)).toBeNull();
    expect(motivoDeNaoAvisar({ aceitaEm: '2026-10-01', canceladaEm: null, avisadoEm: '2026-10-18' }, hoje)).toMatch(/de novo a partir de 17\/11/);
  });
});

describe('vagas · de onde vêm as fichas (F5a)', () => {
  const qrs = new Set(['salao', 'balcao']);
  it('a origem que conta: um QR da loja ou um canal do robô; o resto vira "sem origem"', () => {
    expect(origemQueConta('salao', qrs)).toBe('salao');
    expect(origemQueConta(' Balcao ', qrs)).toBe('balcao');
    expect(origemQueConta('whatsapp', qrs)).toBe('whatsapp');
    expect(origemQueConta('direct', new Set())).toBe('direct');
    expect(origemQueConta('fachada', qrs)).toBe(''); // QR apagado ou inventado
    expect(origemQueConta('<script>', qrs)).toBe('');
    expect(origemQueConta(null, qrs)).toBe('');
    expect(origemQueConta('', qrs)).toBe('');
  });
  it('junta aberturas e fichas por origem: todo QR aparece, o robô e o sem origem só com número; ordem por fichas', () => {
    const r = origensDasFichas(
      [{ codigo: 'salao', nome: 'Salão' }, { codigo: 'balcao', nome: 'Balcão' }, { codigo: 'fachada', nome: 'Fachada' }],
      [{ origem: 'salao', n: 64 }, { origem: 'balcao', n: 180 }, { origem: 'whatsapp', n: 38 }, { origem: '', n: 8 }, { origem: 'apagado', n: 2 }],
      [{ origem: 'balcao', n: 21 }, { origem: 'salao', n: 5 }, { origem: 'whatsapp', n: 4 }, { origem: null, n: 1 }, { origem: 'apagado', n: 1 }],
    );
    expect(r).toEqual([
      { origem: 'balcao', nome: 'Balcão', tipo: 'qr', aberturas: 180, fichas: 21 },
      { origem: 'salao', nome: 'Salão', tipo: 'qr', aberturas: 64, fichas: 5 },
      { origem: 'whatsapp', nome: 'Robô no WhatsApp', tipo: 'robo', aberturas: 38, fichas: 4 },
      // o "apagado" (QR que não existe mais) soma no link sem origem: 8 + 2 aberturas, 1 + 1 fichas
      { origem: '', nome: 'Link sem origem', tipo: 'link', aberturas: 10, fichas: 2 },
      { origem: 'fachada', nome: 'Fachada', tipo: 'qr', aberturas: 0, fichas: 0 },
    ]);
    // Sem nada: só os QR, zerados (o direct e o sem origem não aparecem).
    expect(origensDasFichas([{ codigo: 'salao', nome: 'Salão' }], [], [])).toEqual([{ origem: 'salao', nome: 'Salão', tipo: 'qr', aberturas: 0, fichas: 0 }]);
  });
});

describe('vagas · a condução dos aprovados (F5b)', () => {
  const base = { valorIda: 4.7, valorVolta: 18, tipoVaga: 'fixa', escala: '12x36', dias: [] as string[] };
  it('o valor de ida e volta × os dias da escala: 12x36 = 15, 5x2 = 22, 6x1 = 26', () => {
    expect(conducaoDaPessoa(base)).toEqual({ porDia: 22.7, diasNoMes: 15, porMes: 340.5, escala: '12x36', motivo: null });
    expect(conducaoDaPessoa({ ...base, escala: '5x2' }).porMes).toBe(499.4);
    expect(conducaoDaPessoa({ ...base, escala: null, jornadaDoColaborador: '6x1' })).toMatchObject({ diasNoMes: 26, escala: '6x1' });
  });
  it('horista: os dias marcados × 4,3 semanas; sem dias, escala a definir', () => {
    expect(conducaoDaPessoa({ ...base, tipoVaga: 'horista', escala: null, dias: ['sex', 'sab', 'dom'] })).toMatchObject({ diasNoMes: 12.9, porMes: 292.83, escala: 'horista' });
    expect(conducaoDaPessoa({ ...base, tipoVaga: 'horista', escala: null, dias: [] })).toMatchObject({ porMes: null, motivo: 'escala_a_definir' });
  });
  it('a jornada do colaborador (contratado) vale sobre a escala da ficha; "outro" não conta', () => {
    expect(conducaoDaPessoa({ ...base, jornadaDoColaborador: '5x2' })).toMatchObject({ diasNoMes: 22, escala: '5x2' });
    expect(conducaoDaPessoa({ ...base, jornadaDoColaborador: 'horista', dias: ['sab'] })).toMatchObject({ diasNoMes: 4.3, escala: 'horista' });
    expect(conducaoDaPessoa({ ...base, jornadaDoColaborador: 'outro' })).toMatchObject({ diasNoMes: 15, escala: '12x36' });
  });
  it('sem o valor, ou com a escala "12x36 ou 5x2", fica fora da soma com o motivo', () => {
    expect(conducaoDaPessoa({ ...base, valorIda: null })).toMatchObject({ porDia: null, porMes: null, motivo: 'sem_valor' });
    expect(conducaoDaPessoa({ ...base, escala: 'tanto' })).toMatchObject({ porDia: 22.7, porMes: null, motivo: 'escala_a_definir' });
  });
});

// As regras puras da ficha e da página de vagas (F1, mig 389).

const HOJE = '2026-11-10';
const recusa = (fn: () => unknown): { message: string; campo: string | null } => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    const r: any = (e as BadRequestException).getResponse();
    return { message: r.message, campo: r.campo };
  }
  throw new Error('esperava recusa');
};

describe('vagas · lerFicha', () => {
  const pagina = paginaPadrao();

  it('lê a ficha completa do protótipo', () => {
    const f = lerFicha(fichaValida(), pagina, HOJE);
    expect(f.telefone).toBe('2133330000');
    expect(f.idade).toBe(26);
    expect(f.funcoes).toEqual(['chapeiro', 'supervisao']);
    expect(f.experiencias.map((x) => x.tipo)).toEqual(['trabalho', 'lideranca']);
    expect(f.valorIda).toBe(4.7);
    expect(f.valorVolta).toBe(18);
    expect(f.respostas).toEqual({ cnh: 'sim', moto: 'sim' });
    expect(f.grauEstudo).toBe('tecnico');
    expect(f.comunicacao).toBe(false);
  });

  it('o WhatsApp com o 55 vira o mesmo número do cadastro (ERR-135)', () => {
    expect(lerFicha(fichaValida({ whatsapp: '+55 21 3333-0000' }), pagina, HOJE).telefone).toBe('2133330000');
  });

  it('recusa abaixo da idade mínima da página', () => {
    expect(recusa(() => lerFicha(fichaValida({ nascimento: '2010-01-01' }), pagina, HOJE))).toEqual({
      message: 'As vagas desta página são para quem tem 18 anos ou mais.',
      campo: 'nascimento',
    });
  });

  it('recusa função FECHADA na página (a tela não oferece, o servidor confere)', () => {
    const p = paginaPadrao();
    p.funcoes = p.funcoes.map((f) => (f.codigo === 'chapeiro' ? { ...f, aberta: false } : f));
    expect(recusa(() => lerFicha(fichaValida(), p, HOJE)).campo).toBe('funcoes');
  });

  it('liderança marcada exige a resposta e a descrição', () => {
    expect(recusa(() => lerFicha(fichaValida({ liderou: undefined }), pagina, HOJE)).campo).toBe('liderou');
    const semDescricao = fichaValida({ lids: [{ cargo: 'gerente', empresa: 'X', equipe: 'ate5', tempo: '2a', vinculo: 'carteira', descricao: ' ' }] });
    expect(recusa(() => lerFicha(semDescricao, pagina, HOJE)).message).toContain('conte o que você fazia');
    // Sem cargo de liderança marcado, a pergunta não existe.
    expect(lerFicha(fichaValida({ funcoes: ['chapeiro'], liderou: undefined, lids: undefined }), pagina, HOJE).liderou).toBeNull();
  });

  it('horista pede os dias; vaga fixa pede a escala ativa', () => {
    expect(recusa(() => lerFicha(fichaValida({ tipo: 'horista', dias: [] }), pagina, HOJE)).campo).toBe('dias');
    const p = paginaPadrao();
    p.horarios['12x36'].ativa = false;
    expect(recusa(() => lerFicha(fichaValida({ tipo: 'fixa' }), p, HOJE)).campo).toBe('escala');
    expect(lerFicha(fichaValida({ tipo: 'fixa', escala: '5x2' }), p, HOJE).escala).toBe('5x2');
  });

  it('transporte público pede as conduções; Uber "outro" pede o texto; os dois pedem o valor', () => {
    expect(recusa(() => lerFicha(fichaValida({ conducoes: 0 }), pagina, HOJE)).campo).toBe('conducoes');
    expect(recusa(() => lerFicha(fichaValida({ uber_motivo: 'outro' }), pagina, HOJE)).message).toBe('Escreva o motivo do Uber.');
    expect(recusa(() => lerFicha(fichaValida({ valor_volta: '' }), pagina, HOJE)).campo).toBe('valor');
    const aPe = lerFicha(fichaValida({ meio: ['pe'], valor_ida: '', valor_volta: '' }), pagina, HOJE);
    expect([aPe.conducoes, aPe.valorIda, aPe.valorVolta]).toEqual([null, null, null]);
  });

  it('estudos: quem estuda diz o turno; quem encerrou diz até onde', () => {
    expect(recusa(() => lerFicha(fichaValida({ turno_estudo: '' }), pagina, HOJE)).campo).toBe('turno_estudo');
    const encerrou = lerFicha(fichaValida({ estuda: false, grau_final: 'medio', turno_estudo: undefined }), pagina, HOJE);
    expect([encerrou.grauEstudo, encerrou.turnoEstudo]).toEqual(['medio', null]);
    expect(recusa(() => lerFicha(fichaValida({ cursos: [{ nome: 'Barista', onde: '', situacao: 'fazendo' }] }), pagina, HOJE)).campo).toBe('cursos');
  });

  it('sem o consentimento da guarda não envia; o termo de mensagens é opcional', () => {
    expect(recusa(() => lerFicha(fichaValida({ consentimento: false }), pagina, HOJE)).campo).toBe('consentimento');
    expect(lerFicha(fichaValida({ comunicacao: true }), pagina, HOJE).comunicacao).toBe(true);
  });

  it('"depois do aviso prévio" só para quem trabalha; delivery pede CNH e moto', () => {
    expect(recusa(() => lerFicha(fichaValida({ trabalhando: 'nao' }), pagina, HOJE)).campo).toBe('comeca');
    expect(recusa(() => lerFicha(fichaValida({ cnh: undefined }), pagina, HOJE)).campo).toBe('cnh');
    const semDelivery = lerFicha(fichaValida({ setores: ['chapa'], cnh: undefined, moto: undefined }), pagina, HOJE);
    expect(semDelivery.respostas).toEqual({});
  });
});

describe('vagas · lerPagina', () => {
  it('o que não vem fica como está (V16)', () => {
    const p = lerPagina({ titulo: 'Trabalhe com a gente' }, paginaPadrao());
    expect(p.titulo).toBe('Trabalhe com a gente');
    expect(p.funcoes).toEqual(paginaPadrao().funcoes);
  });

  it('liga/desliga só com booleano (V15)', () => {
    expect(() => lerPagina({ ligada: 'sim' }, paginaPadrao())).toThrow(BadRequestException);
    expect(lerPagina({ ligada: true }, paginaPadrao()).ligada).toBe(true);
  });

  it('não liga sem função aberta', () => {
    const fechadas = paginaPadrao().funcoes.map((f) => ({ ...f, aberta: false }));
    expect(recusa(() => lerPagina({ ligada: true, funcoes: fechadas }, paginaPadrao())).campo).toBe('funcoes');
  });

  it('horário em HH:MM e cor em #RRGGBB', () => {
    expect(recusa(() => lerPagina({ horarios: { '12x36': { inicio: '25:00' } } }, paginaPadrao())).campo).toBe('horarios');
    expect(recusa(() => lerPagina({ corPrincipal: 'verde' }, paginaPadrao())).campo).toBe('corPrincipal');
    expect(lerPagina({ corPrincipal: '#126b31' }, paginaPadrao()).corPrincipal).toBe('#126B31');
  });

  it('a página da linha do banco completa o que faltar com o padrão', () => {
    const p = paginaDaLinha({ ligada: true, horarios: { '5x2': { ativa: false, inicio: '18:00', fim: '02:00' } }, funcoes: [] });
    expect(p.horarios['5x2']).toEqual({ ativa: false, inicio: '18:00', fim: '02:00' });
    expect(p.horarios['12x36']).toEqual({ ativa: true, inicio: '15:00', fim: '03:00' });
    expect(p.funcoes).toEqual([]);
  });
});

describe('vagas · pequenas regras', () => {
  it('idade completa considera o aniversário', () => {
    expect(idadeEm('2000-11-11', '2026-11-10')).toBe(25);
    expect(idadeEm('2000-11-10', '2026-11-10')).toBe(26);
  });

  it('slug do endereço público e marca de origem', () => {
    expect(slug('Casa do Lanche Teste — Centro')).toBe('casa-do-lanche-teste-centro');
    expect(slug('Zé')).toBe('vagas-ze');
    expect(lerOrigem('Balcao')).toBe('balcao');
    expect(lerOrigem('../x')).toBeNull();
  });

  it('protocolo sem letras que confundem', () => {
    for (let i = 0; i < 200; i++) expect(gerarProtocolo()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
  });

  it('situação só da lista; o termo de mensagens fala em cancelar com SAIR', () => {
    expect(lerSituacao('entrevista')).toBe('entrevista');
    expect(() => lerSituacao('demitido')).toThrow(BadRequestException);
    expect(termoDaComunicacao('Lanchonete Teste').texto.join(' ')).toContain('SAIR');
  });
});

describe('vagas · F2, a distância até a loja', () => {
  it('as buscas do endereço no mapa: da exata (rua e número) à larga (bairro e cidade), sem repetir', () => {
    expect(buscasDoEndereco({ rua: 'Rua Teste', numero: '120', bairro: 'Centro', cidade: 'Rio de Janeiro – RJ' })).toEqual([
      'Rua Teste, 120, Centro, Rio de Janeiro, RJ, Brasil',
      'Centro, Rio de Janeiro, RJ, Brasil',
    ]);
    // sem rua o número não localiza nada: só a busca larga
    expect(buscasDoEndereco({ rua: '', numero: '120', bairro: 'Centro', cidade: 'Rio de Janeiro – RJ' })).toEqual(['Centro, Rio de Janeiro, RJ, Brasil']);
    expect(buscasDoEndereco({ rua: 'Rua Teste', numero: null, bairro: null, cidade: 'Niterói' })).toEqual(['Rua Teste, Niterói, Brasil']);
    expect(buscasDoEndereco({ rua: 'Rua Teste', numero: '1', bairro: 'Centro', cidade: '' })).toEqual([]); // sem cidade não busca
  });

  it('metros do OSRM viram km com uma casa', () => {
    expect([kmDeMetros(12345), kmDeMetros(950), kmDeMetros(0)]).toEqual([12.3, 1, 0]);
  });
});

// F4: Contratar — o colaborador nasce com o que a ficha tem.
describe('vagas · contratar (os dados do colaborador)', () => {
  const pagina = paginaPadrao().funcoes; // chapeiro = "Chapeiro(a)", supervisao = "Supervisor(a) de cozinha"
  const loja = [
    { id: 'f-chap', nome: 'Chapeiro' },
    { id: 'f-sup', nome: 'Supervisor de Cozinha' },
  ];
  const ficha = (o: Record<string, unknown> = {}) => ({ nome: ' Maria Teste ', telefone: '5521333300000', funcoes: ['chapeiro'], tipo_vaga: 'fixa', escala: '12x36', ...o }) as any;

  it('o nome da função para comparar: sem acento, minúsculas, sem o "(a)"', () => {
    expect(nomeDaFuncaoParaComparar('Chapeiro(a)')).toBe('chapeiro');
    expect(nomeDaFuncaoParaComparar('  Supervisor(a)  de   Cozinha ')).toBe('supervisor de cozinha');
    expect(nomeDaFuncaoParaComparar('Gerência')).toBe('gerencia');
    expect(nomeDaFuncaoParaComparar(null)).toBe('');
  });

  it('vaga fixa = CLT na escala da ficha; a função da loja de mesmo nome', () => {
    expect(contratadoDaFicha(ficha(), pagina, loja)).toEqual({ nome: 'Maria Teste', telefone: '5521333300000', vinculo: 'clt', jornadaTipo: '12x36', funcaoId: 'f-chap', funcaoDaFicha: 'Chapeiro(a)' });
    expect(contratadoDaFicha(ficha({ funcoes: ['supervisao'], escala: '5x2' }), pagina, loja)).toMatchObject({ jornadaTipo: '5x2', funcaoId: 'f-sup', funcaoDaFicha: 'Supervisor(a) de cozinha' });
  });

  it('horista = vínculo e jornada horista; "tanto faz" sem escala certa = CLT a definir ("outro")', () => {
    expect(contratadoDaFicha(ficha({ tipo_vaga: 'horista', escala: null }), pagina, loja)).toMatchObject({ vinculo: 'horista', jornadaTipo: 'horista' });
    expect(contratadoDaFicha(ficha({ tipo_vaga: 'tanto', escala: 'tanto' }), pagina, loja)).toMatchObject({ vinculo: 'clt', jornadaTipo: 'outro' });
  });

  it('sem a função na loja (ou sem função na ficha): sem função — escolhe-se no cadastro', () => {
    expect(contratadoDaFicha(ficha({ funcoes: ['atendimento'] }), pagina, loja)).toMatchObject({ funcaoId: null, funcaoDaFicha: 'Atendimento' });
    expect(contratadoDaFicha(ficha({ funcoes: [] }), pagina, loja)).toMatchObject({ funcaoId: null, funcaoDaFicha: null });
    // Código que a página não tem mais: o próprio código, sem casar.
    expect(contratadoDaFicha(ficha({ funcoes: ['pizzaiolo'] }), pagina, loja)).toMatchObject({ funcaoId: null, funcaoDaFicha: 'pizzaiolo' });
  });
});

// F3b: a confirmação da ficha no WhatsApp — só o primeiro nome e o protocolo, como a tela de ficha recebida mostra.
describe('vagas · a confirmação da ficha', () => {
  it('o protocolo em blocos e o texto com o primeiro nome', () => {
    expect(protocoloLegivel('K7Q2XD')).toBe('K7Q-2XD');
    expect(protocoloLegivel('ABC')).toBe('ABC');
    expect(textoDaConfirmacao('  Maria Teste da Silva ', 'K7Q2XD')).toBe('Recebemos sua ficha nº K7Q-2XD, Maria! A loja fala com você por este WhatsApp quando tiver uma vaga para o seu perfil.');
    expect(textoDaConfirmacao('', 'K7Q2XD')).toBe('Recebemos sua ficha nº K7Q-2XD! A loja fala com você por este WhatsApp quando tiver uma vaga para o seu perfil.');
  });
});
