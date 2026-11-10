// VAGAS E CANDIDATOS (F1, mig 389) — as regras da ficha do candidato no NAVEGADOR: o que cada etapa pede, os nomes de
// cada opção (a tela da loja usa os mesmos) e o corpo que vai ao servidor. É espelho de `backend/src/modules/vagas/
// vagas.ts`: a tela avisa antes de enviar; quem decide é o servidor (mudou lá, muda aqui). Arquivo puro (sem React) —
// conferido por `scripts/check-vagas.mjs`.

export const SETOR_ROTULO: Record<string, string> = {
  chapa: '🔥 Chapa', fritadeira: '🍟 Fritadeira', montagem: '🍔 Montagem', producao: '🥬 Produção',
  atendimento: '🙋 Atendimento', delivery: '🛵 Delivery', nenhum: 'Ainda não tenho prática',
};
export const DIA_ROTULO: Record<string, string> = { seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb', dom: 'Dom' };
export const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
export const TEMPO_ROTULO: Record<string, string> = { ate6m: 'Menos de 6 meses', '6m1a': '6 meses a 1 ano', '1a2a': '1 a 2 anos', '2a': 'Mais de 2 anos' };
export const VINCULO_ROTULO: Record<string, string> = { carteira: 'Carteira assinada', informal: 'Informal (sem carteira)' };
export const CARGO_ROTULO: Record<string, string> = { lider_turno: 'Líder de turno', supervisor: 'Supervisor(a)', gerente: 'Gerente', outro: 'Outro' };
export const EQUIPE_ROTULO: Record<string, string> = { ate5: 'Até 5', '6a15': '6 a 15', '16': 'Mais de 15' };
export const GRAU_ATUAL_ROTULO: Record<string, string> = {
  fundamental: 'Ensino fundamental', medio: 'Ensino médio', eja: 'Supletivo (EJA)', tecnico: 'Curso técnico', faculdade: 'Faculdade', pos: 'Pós-graduação',
};
export const GRAU_FINAL_ROTULO: Record<string, string> = {
  fund_inc: 'Fundamental incompleto', fund: 'Fundamental completo', medio_inc: 'Médio incompleto', medio: 'Médio completo',
  tecnico: 'Técnico completo', sup_inc: 'Faculdade incompleta', superior: 'Faculdade completa',
};
export const TURNO_ESTUDO_ROTULO: Record<string, string> = { manha: '☀️ Manhã', tarde: '🌤️ Tarde', noite: '🌙 Noite', ead: '💻 On-line (EAD)' };
export const MEIO_ROTULO: Record<string, string> = {
  publico: 'Ônibus, trem, metrô ou BRT', uber: 'Uber ou app de corrida', pe: 'A pé', bike: 'Bicicleta', proprio: 'Moto ou carro',
};
export const MEIO_ICONE: Record<string, string> = { publico: '🚌', uber: '🚗', pe: '🚶', bike: '🚲', proprio: '🏍️' };
export const UBER_ROTULO: Record<string, string> = {
  sem_onibus: 'Não passa ônibus perto', madrugada: 'Para voltar de madrugada', rapido: 'É mais rápido', seguranca: 'Por segurança', outro: 'Outro motivo',
};
export const COMECA_ROTULO: Record<string, string> = { imediato: 'Imediatamente', '15d': 'Em até 15 dias', '30d': 'Em até 30 dias', aviso: 'Depois do aviso prévio' };
export const SEXO_ROTULO: Record<string, string> = { feminino: 'Feminino', masculino: 'Masculino', outro: 'Outro', nao_informar: 'Prefiro não dizer' };
export const ORIGEM_ROTULO: Record<string, string> = { qr_loja: 'QR code na loja', instagram: 'Instagram', whatsapp: 'WhatsApp', indicacao: 'Indicação', outro: 'Outro' };
export const CURSO_SITUACAO_ROTULO: Record<string, string> = { fazendo: 'Fazendo agora', concluido: 'Concluído', parou: 'Não terminei' };
export const SITUACAO_ROTULO: Record<string, string> = {
  novo: 'Novo', analise: 'Em análise', entrevista: 'Entrevista', aprovado: 'Aprovado', contratado: 'Contratado', banco: 'Banco de talentos', reprovado: 'Não seguiu',
};
/** Os nomes das funções que a página traz de fábrica — reserva da lista quando os ajustes da loja não carregam (presidente
 *  na visão da rede). Função criada pela loja, sem os ajustes à mão, vira o código legível. */
export const FUNCAO_PADRAO_ROTULO: Record<string, string> = {
  chapeiro: 'Chapeiro(a)', auxiliar: 'Auxiliar de cozinha', atendimento: 'Atendimento', supervisao: 'Supervisor(a) de cozinha', gerencia: 'Gerência',
};
const legivel = (codigo: string) => {
  const t = codigo.replace(/[-_]/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
export function nomeDaFuncao(codigo: string, nomes: Record<string, string>): string {
  return nomes[codigo] ?? FUNCAO_PADRAO_ROTULO[codigo] ?? legivel(codigo);
}
/** De onde a ficha veio: o nome do QR da loja; sem QR, o caminho conhecido (robô, indicação, link) ou o código legível. */
export const ORIGEM_LINK_ROTULO: Record<string, string> = { robo: 'Robô do WhatsApp', indicacao: 'Indicação', link: 'Link da vaga' };
export function nomeDaOrigem(codigo: string | null, nomeDoQr: string | null | undefined): string {
  if (!codigo) return '';
  return nomeDoQr || ORIGEM_LINK_ROTULO[codigo] || legivel(codigo);
}
export const SUGESTOES_DE_CURSO =['Boas práticas / manipulação de alimentos', 'Cozinha', 'Atendimento ao cliente', 'Barista', 'Informática'];

export interface HorarioPublico { ativa: boolean; inicio: string; fim: string }
export interface PaginaPublica {
  loja: { nome: string; logoRef: string | null; logoEmoji: string | null };
  cores: { principal: string | null; destaque: string | null };
  pagina: {
    titulo: string;
    frase: string;
    funcoes: { codigo: string; nome: string; salario: string; lideranca: boolean }[];
    beneficios: string[];
    vagaFixa: boolean;
    horista: boolean;
    horarios: { '12x36': HorarioPublico; '5x2': HorarioPublico; horista: HorarioPublico & { dias: string[] } };
    idadeMinima: number;
    guardaMeses: number;
    perguntas: Record<string, boolean>;
  };
  termos: { guarda: string; comunicacao: { resumo: string; texto: string[] } };
}

export interface ExperienciaForm { id: string; empresa: string; funcao: string; tempo: string; vinculo: string; atual: boolean; descricao: string }
export interface LiderancaForm { id: string; cargo: string; empresa: string; equipe: string; tempo: string; vinculo: string; descricao: string }
export interface CursoForm { id: string; nome: string; onde: string; situacao: string }
export interface FichaForm {
  nome: string; nascimento: string; sexo: string; whatsapp: string; email: string;
  funcoes: string[]; setores: string[];
  tipo: string; escala: string; dias: string[]; obs_horarios: string;
  experiencia: string; exps: ExperienciaForm[]; liderou: string; lids: LiderancaForm[];
  estuda: string; grau_atual: string; grau_final: string; escola: string; turno_estudo: string;
  cursos_sit: string; cursos: CursoForm[];
  cep: string; rua: string; numero: string; complemento: string; bairro: string; cidade: string;
  meio: string[]; conducoes: string; uber_motivo: string; uber_obs: string; valor_ida: string; valor_volta: string;
  trabalhando: string; comeca: string; cnh: string; moto: string; feriados: string; ja_trabalhou: string;
  origem_declarada: string; indicado_por: string; sobre: string;
  consentimento: boolean; comunicacao: boolean;
  site: string; // campo-isca: escondido de gente, robô preenche
}

export function fichaVazia(origemDeclarada = ''): FichaForm {
  return {
    nome: '', nascimento: '', sexo: '', whatsapp: '', email: '', funcoes: [], setores: [],
    tipo: '', escala: '', dias: [], obs_horarios: '',
    experiencia: '', exps: [], liderou: '', lids: [],
    estuda: '', grau_atual: '', grau_final: '', escola: '', turno_estudo: '', cursos_sit: '', cursos: [],
    cep: '', rua: '', numero: '', complemento: '', bairro: '', cidade: '',
    meio: [], conducoes: '', uber_motivo: '', uber_obs: '', valor_ida: '', valor_volta: '',
    trabalhando: '', comeca: '', cnh: '', moto: '', feriados: '', ja_trabalhou: '',
    origem_declarada: origemDeclarada, indicado_por: '', sobre: '', consentimento: false, comunicacao: false, site: '',
  };
}

/** A origem marcada pelo link (`?o=`) vira a resposta "como ficou sabendo" já marcada. O link dos anúncios vai para
 *  vários lugares (grupos, sites de vaga): fica sem marcar e o candidato escolhe. Outra marca é um QR impresso na loja. */
export function origemDeclaradaDoLink(o: string | null | undefined): string {
  const s = String(o ?? '').toLowerCase();
  if (!s || s === 'anuncios') return '';
  if (s === 'instagram') return 'instagram';
  if (['whatsapp', 'robo', 'direct', 'messenger'].includes(s)) return 'whatsapp';
  if (s === 'indicacao') return 'indicacao';
  return 'qr_loja';
}

export const TOTAL_ETAPAS = 7;
export const ETAPAS: { titulo: string; sub: string }[] = [
  { titulo: 'Sobre você', sub: 'Para a gente saber quem é você e como te chamar.' },
  { titulo: 'A vaga que você quer', sub: 'Pode marcar mais de uma função.' },
  { titulo: 'Seus horários', sub: 'Assim a gente encaixa você na escala certa.' },
  { titulo: 'Sua experiência', sub: 'Não tem experiência? Sem problema — conta pra gente mesmo assim.' },
  { titulo: 'Estudos e cursos', sub: 'Onde você estuda ou estudou, e os cursos que fez.' },
  { titulo: 'Onde você mora', sub: 'Para saber como você chega até a loja.' },
  { titulo: 'Para terminar', sub: 'Últimas perguntas — falta pouco!' },
];

/** Idade completa em `hoje` (YYYY-MM-DD). */
export function idadeEm(nascimento: string, hoje: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nascimento)) return null;
  const [an, mn, dn] = nascimento.split('-').map(Number);
  const [ah, mh, dh] = hoje.split('-').map(Number);
  let idade = ah - an;
  if (mh < mn || (mh === mn && dh < dn)) idade--;
  return idade;
}

/** Valor em reais digitado só com números: 470 → "4,70". */
export function mascaraReais(v: string): string {
  const d = String(v ?? '').replace(/\D/g, '').replace(/^0+/, '').slice(0, 6);
  return d ? (Number(d) / 100).toFixed(2).replace('.', ',') : '';
}
export function reais(v: string | number | null | undefined): number {
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
export function brl(n: number): string {
  return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

const digitos = (v: string) => String(v ?? '').replace(/\D/g, '');
/** Sem o 55 do país (mesma regra do servidor, `telefoneCadastro`). */
export function telefoneSem55(v: string): string {
  let d = digitos(v);
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  return d;
}
export function telefoneOk(v: string): boolean {
  const t = telefoneSem55(v);
  if (!/^\d{10,11}$/.test(t)) return false;
  if (Number(t.slice(0, 2)) < 11) return false;
  if (t.length === 11 && t[2] !== '9') return false;
  return true;
}

export interface Erro { campo: string; msg: string }

/** Quem marcou uma função de liderança vê a pergunta de liderança na experiência. */
export function marcouLideranca(f: FichaForm, p: PaginaPublica): boolean {
  return f.funcoes.some((c) => p.pagina.funcoes.find((x) => x.codigo === c)?.lideranca);
}
export const temPublico = (f: FichaForm) => f.meio.includes('publico');
export const temUber = (f: FichaForm) => f.meio.includes('uber');

/** O que falta na etapa `n` (1 a 7). Vazio = pode seguir. */
export function errosDaEtapa(n: number, f: FichaForm, p: PaginaPublica, hoje: string): Erro[] {
  const e: Erro[] = [];
  const pg = p.pagina;
  if (n === 1) {
    if (f.nome.trim().split(/\s+/).filter(Boolean).length < 2) e.push({ campo: 'nome', msg: 'Escreva seu nome e sobrenome.' });
    const idade = idadeEm(f.nascimento, hoje);
    if (idade === null) e.push({ campo: 'nascimento', msg: 'Escolha sua data de nascimento.' });
    else if (idade < pg.idadeMinima) e.push({ campo: 'nascimento', msg: `As vagas desta página são para quem tem ${pg.idadeMinima} anos ou mais.` });
    else if (idade > 90) e.push({ campo: 'nascimento', msg: 'Confira a data de nascimento.' });
    if (!telefoneOk(f.whatsapp)) e.push({ campo: 'whatsapp', msg: 'Digite o número com DDD. Ex.: (21) 9XXXX-XXXX.' });
    if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) e.push({ campo: 'email', msg: 'Confira o e-mail (ou deixe em branco).' });
  }
  if (n === 2) {
    if (!f.funcoes.length) e.push({ campo: 'funcoes', msg: 'Escolha pelo menos uma função.' });
    if (!f.setores.length) e.push({ campo: 'setores', msg: 'Marque pelo menos um setor (ou "Ainda não tenho prática").' });
  }
  if (n === 3) {
    if (!f.tipo) e.push({ campo: 'tipo', msg: 'Escolha o tipo de vaga.' });
    if ((f.tipo === 'fixa' || f.tipo === 'tanto') && !f.escala) e.push({ campo: 'escala', msg: 'Escolha a escala.' });
    if ((f.tipo === 'horista' || f.tipo === 'tanto') && !f.dias.length) e.push({ campo: 'dias', msg: 'Marque os dias em que você pode trabalhar.' });
  }
  if (n === 4) {
    if (!f.experiencia) e.push({ campo: 'experiencia', msg: 'Responda sobre sua experiência.' });
    if (f.experiencia === 'sim' || f.experiencia === 'outra') {
      if (!f.exps.length) e.push({ campo: 'exps', msg: 'Adicione pelo menos uma experiência.' });
      f.exps.forEach((x, i) => {
        if (!x.empresa.trim() || !x.funcao.trim() || !x.tempo || !x.vinculo)
          e.push({ campo: 'exps', msg: `Experiência ${i + 1}: falta onde, função, tempo ou vínculo.` });
      });
    }
    if (marcouLideranca(f, p)) {
      if (!f.liderou) e.push({ campo: 'liderou', msg: 'Responda se já trabalhou em liderança.' });
      else if (f.liderou === 'sim') {
        if (!f.lids.length) e.push({ campo: 'lids', msg: 'Adicione pelo menos uma experiência de liderança.' });
        f.lids.forEach((x, i) => {
          if (!x.cargo || !x.empresa.trim() || !x.equipe || !x.tempo || !x.vinculo || !x.descricao.trim())
            e.push({ campo: 'lids', msg: `Liderança ${i + 1}: falta cargo, empresa, equipe, tempo, vínculo ou o que você fazia.` });
        });
      }
    }
  }
  if (n === 5) {
    if (!f.estuda) e.push({ campo: 'estuda', msg: 'Responda se você ainda estuda.' });
    else {
      if (f.estuda === 'sim' && !f.grau_atual) e.push({ campo: 'grau_atual', msg: 'Escolha o que você está cursando.' });
      if (f.estuda === 'nao' && !f.grau_final) e.push({ campo: 'grau_final', msg: 'Escolha até onde você estudou.' });
      if (!f.escola.trim()) e.push({ campo: 'escola', msg: f.estuda === 'sim' ? 'Escreva onde você estuda.' : 'Escreva onde você estudou por último.' });
      if (f.estuda === 'sim' && !f.turno_estudo) e.push({ campo: 'turno_estudo', msg: 'Escolha o turno da sua aula.' });
    }
    if (!f.cursos_sit) e.push({ campo: 'cursos_sit', msg: 'Responda sobre cursos.' });
    else if (f.cursos_sit !== 'nunca') {
      if (!f.cursos.length) e.push({ campo: 'cursos', msg: 'Adicione pelo menos um curso.' });
      f.cursos.forEach((x, i) => {
        if (!x.nome.trim() || !x.onde.trim() || !x.situacao) e.push({ campo: 'cursos', msg: `Curso ${i + 1}: falta qual curso, onde ou a situação.` });
      });
    }
  }
  if (n === 6) {
    if (digitos(f.cep).length !== 8) e.push({ campo: 'cep', msg: 'Digite o CEP com 8 números.' });
    if (!f.numero.trim()) e.push({ campo: 'numero', msg: 'Coloque o número da casa.' });
    if (!f.bairro.trim()) e.push({ campo: 'bairro', msg: 'Coloque o bairro.' });
    if (!f.cidade.trim()) e.push({ campo: 'cidade', msg: 'Coloque a cidade.' });
    if (!f.meio.length) e.push({ campo: 'meio', msg: 'Conte como você viria para o trabalho.' });
    if (temPublico(f) && !f.conducoes) e.push({ campo: 'conducoes', msg: 'Diga quantas conduções você pega.' });
    if (temUber(f)) {
      if (!f.uber_motivo) e.push({ campo: 'uber_motivo', msg: 'Conte por que usaria Uber.' });
      else if (f.uber_motivo === 'outro' && !f.uber_obs.trim()) e.push({ campo: 'uber_motivo', msg: 'Escreva o motivo.' });
    }
    if ((temPublico(f) || temUber(f)) && (!reais(f.valor_ida) || !reais(f.valor_volta)))
      e.push({ campo: 'valor', msg: 'Informe quanto gasta na ida e na volta.' });
  }
  if (n === 7) {
    if (!f.trabalhando) e.push({ campo: 'trabalhando', msg: 'Responda se está trabalhando agora.' });
    if (!f.comeca) e.push({ campo: 'comeca', msg: 'Escolha quando pode começar.' });
    if (pg.perguntas.cnh && f.setores.includes('delivery')) {
      if (!f.cnh) e.push({ campo: 'cnh', msg: 'Responda sobre a CNH.' });
      if (!f.moto) e.push({ campo: 'moto', msg: 'Responda sobre a moto.' });
    }
    if (!f.consentimento) e.push({ campo: 'consentimento', msg: 'Para enviar, marque que concorda com a guarda dos dados.' });
  }
  return e;
}

/** O item da lista sem o `id` que só a tela usa (para a chave do React). */
function semId<T extends { id: string }>(o: T): Omit<T, 'id'> {
  const copia: Partial<T> = { ...o };
  delete copia.id;
  return copia as Omit<T, 'id'>;
}

/** O corpo que vai a `POST /publico/vagas/:codigo/ficha` (o formato que o servidor lê). */
export function corpoDoEnvio(f: FichaForm, origem: string | null): Record<string, unknown> {
  const fixa = f.tipo !== 'horista';
  const horista = f.tipo !== 'fixa';
  const comExp = f.experiencia === 'sim' || f.experiencia === 'outra';
  const transporte = temPublico(f) || temUber(f);
  return {
    nome: f.nome.trim(), nascimento: f.nascimento, sexo: f.sexo || null, whatsapp: f.whatsapp, email: f.email.trim(),
    funcoes: f.funcoes, setores: f.setores, tipo: f.tipo, escala: fixa ? f.escala : null, dias: horista ? f.dias : [],
    obs_horarios: horista ? f.obs_horarios : '',
    experiencia: f.experiencia,
    exps: comExp ? f.exps.map(semId) : [],
    liderou: f.liderou === 'sim' ? true : f.liderou === 'nao' ? false : undefined,
    lids: f.liderou === 'sim' ? f.lids.map(semId) : [],
    estuda: f.estuda === 'sim', grau_atual: f.estuda === 'sim' ? f.grau_atual : undefined, grau_final: f.estuda === 'nao' ? f.grau_final : undefined,
    escola: f.escola.trim(), turno_estudo: f.estuda === 'sim' ? f.turno_estudo : undefined,
    cursos_sit: f.cursos_sit, cursos: f.cursos_sit !== 'nunca' ? f.cursos.map(semId) : [],
    cep: f.cep, rua: f.rua, numero: f.numero, complemento: f.complemento, bairro: f.bairro, cidade: f.cidade,
    meio: f.meio, conducoes: temPublico(f) ? Number(f.conducoes) : undefined,
    uber_motivo: temUber(f) ? f.uber_motivo : undefined, uber_obs: temUber(f) ? f.uber_obs : undefined,
    valor_ida: transporte ? f.valor_ida : undefined, valor_volta: transporte ? f.valor_volta : undefined,
    trabalhando: f.trabalhando, comeca: f.comeca,
    cnh: f.setores.includes('delivery') ? f.cnh : undefined, moto: f.setores.includes('delivery') ? f.moto : undefined,
    feriados: f.feriados || undefined, ja_trabalhou: f.ja_trabalhou || undefined,
    origem_declarada: f.origem_declarada || undefined, indicado_por: f.origem_declarada === 'indicacao' ? f.indicado_por : undefined,
    sobre: f.sobre || undefined, consentimento: f.consentimento, comunicacao: f.comunicacao,
    origem, site: f.site,
  };
}

/** O horário da vaga sai da escala (12x36 das 15h às 3h; 5x2 e horista das 19h às 3h — ajustes da loja). */
export function horarioTexto(h: HorarioPublico | undefined): string {
  if (!h) return '';
  const hora = (s: string) => {
    const [hh, mm] = s.split(':');
    return mm === '00' ? `${Number(hh)}h` : `${Number(hh)}h${mm}`;
  };
  return `das ${hora(h.inicio)} às ${hora(h.fim)}`;
}
