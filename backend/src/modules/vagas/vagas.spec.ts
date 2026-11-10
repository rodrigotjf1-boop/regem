import { BadRequestException } from '@nestjs/common';
import {
  gerarProtocolo,
  idadeEm,
  lerFicha,
  lerOrigem,
  lerPagina,
  lerSituacao,
  paginaDaLinha,
  paginaPadrao,
  slug,
  termoDaComunicacao,
} from './vagas';
import { fichaValida } from './vagas-exemplo-spec';

/* eslint-disable @typescript-eslint/no-explicit-any */

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
