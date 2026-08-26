'use client';

import Link from 'next/link';
import { RegemMark } from '@/components/brand/regem-mark';

// Identificação do controlador. A RAZÃO SOCIAL é o que vale num documento legal —
// "DMS Tecnologias" é o nome fantasia (e o nome do portfólio no Meta Business).
const RAZAO_SOCIAL = 'SISTER TECNOLOGIA LTDA';
const NOME_FANTASIA = 'DMS Tecnologias';
const ENDERECO = 'R. Visconde de Pirajá, 414, sala 718 — Rio de Janeiro/RJ, CEP 22.410-905';
// ⚠️ PREENCHA antes de divulgar a página: CNPJ da SISTER TECNOLOGIA LTDA.
// Sem valor, a linha do CNPJ simplesmente não aparece (melhor omitir do que
// publicar um número errado num documento legal).
const CNPJ = '';
// Data da última revisão do texto. Atualize ao mexer no conteúdo.
const ATUALIZADO_EM = '26 de agosto de 2026';
const CONTATO = 'suporte@dmsregem.com';

// Política de Privacidade pública (LGPD). Mesmo padrão visual das outras páginas
// públicas (ver /como-funciona): CSS escopado, tema navy + âmbar da marca.
const CSS = `
.pv{font-family:var(--font-sans);background:#0D1A2B;color:#F2F5F9;min-height:100dvh}
.pv a{color:inherit;text-decoration:none}
.pv .wrap{max-width:820px;margin:0 auto;padding:0 24px}
.pv header{display:flex;align-items:center;gap:12px;padding:20px 24px;border-bottom:1px solid #1A3050}
.pv header .logo{display:flex;align-items:center;gap:10px;font-family:var(--font-display);font-weight:800;font-size:19px}
.pv header nav{margin-left:auto;display:flex;gap:22px;font-size:14.5px;color:#9FB2C8;align-items:center;flex-wrap:wrap}
.pv header nav a:hover{color:#F2F5F9}
.pv .btn{background:#E8A845;color:#2A1D06;padding:10px 20px;border-radius:999px;font-weight:700;font-size:14.5px}
.pv .hero{text-align:center;padding:56px 24px 8px}
.pv .eyebrow{font-family:var(--font-mono);font-size:12px;letter-spacing:.3em;color:#E8A845;text-transform:uppercase}
.pv h1{font-family:var(--font-display);font-weight:800;font-size:clamp(30px,5vw,44px);letter-spacing:-.02em;margin:14px 0 12px}
.pv .lead{color:#9FB2C8;font-size:16.5px;max-width:600px;margin:0 auto;line-height:1.55}
.pv .selo{font-family:var(--font-mono);font-size:12.5px;color:#7C8CA3;margin-top:18px}
.pv .sumario{background:#12233A;border:1px solid #1A3050;border-radius:16px;padding:20px 24px;margin:36px 0 8px}
.pv .sumario h2{font-family:var(--font-display);font-size:15px;font-weight:700;color:#E8A845;margin:0 0 12px;text-transform:uppercase;letter-spacing:.06em}
.pv .sumario ol{margin:0;padding-left:20px;display:grid;grid-template-columns:1fr 1fr;gap:7px 24px;color:#C4D0DE;font-size:14.5px}
.pv .sumario a:hover{color:#E8A845;text-decoration:underline}
.pv section{margin:40px 0}
.pv section h2{font-family:var(--font-display);font-size:22px;font-weight:700;margin:0 0 14px;scroll-margin-top:24px}
.pv section h2 .n{font-family:var(--font-mono);font-size:15px;color:#E8A845;margin-right:10px}
.pv h3{font-family:var(--font-display);font-size:16px;font-weight:700;color:#E8A845;margin:22px 0 8px}
.pv p{color:#C4D0DE;font-size:15.5px;line-height:1.68;margin:0 0 14px}
.pv ul{margin:0 0 14px;padding-left:20px;display:flex;flex-direction:column;gap:8px;color:#C4D0DE;font-size:15.5px;line-height:1.6}
.pv strong{color:#F2F5F9;font-weight:700}
.pv .tabela{overflow-x:auto;margin:0 0 16px;border:1px solid #1A3050;border-radius:12px}
.pv table{width:100%;border-collapse:collapse;font-size:14.5px;min-width:520px}
.pv caption{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.pv th,.pv td{text-align:left;padding:11px 16px;border-bottom:1px solid #1A3050;vertical-align:top;color:#C4D0DE}
.pv th{background:#12233A;color:#F2F5F9;font-weight:700;font-size:13.5px;text-transform:uppercase;letter-spacing:.04em}
.pv tr:last-child td{border-bottom:none}
.pv .nota{background:rgba(232,168,69,.08);border:1px solid rgba(232,168,69,.25);border-radius:12px;padding:14px 18px;color:#E7C79A;font-size:14.5px;line-height:1.6;margin:0 0 16px}
.pv .contato{background:#12233A;border:1px solid #1A3050;border-radius:16px;padding:22px 24px;margin:8px 0 56px}
.pv .contato p{margin-bottom:8px}
.pv .contato a{color:#E8A845;font-weight:700}
.pv footer{border-top:1px solid #1A3050;padding:24px;text-align:center;color:#7C8CA3;font-size:13px}
@media(max-width:640px){.pv .sumario ol{grid-template-columns:1fr}}
`;

type Secao = { id: string; t: string; corpo: React.ReactNode };

const SECOES: Secao[] = [
  {
    id: 'quem-somos',
    t: 'Quem somos e a quem esta política se aplica',
    corpo: (
      <>
        <p>
          O <strong>Regem</strong> é uma plataforma de gestão operacional para empresas,
          desenvolvida e operada por <strong>{RAZAO_SOCIAL}</strong>, que atua sob o nome{' '}
          <strong>{NOME_FANTASIA}</strong>
          {CNPJ ? <> — CNPJ {CNPJ}</> : null}, com sede em {ENDERECO}. Esta política explica quais
          dados pessoais são tratados no Regem, com qual finalidade, por quanto tempo e quais são
          os seus direitos, nos termos da <strong>Lei nº 13.709/2018 (LGPD)</strong>.
        </p>
        <p>Ela se aplica a três grupos de pessoas:</p>
        <ul>
          <li>
            <strong>Empresas assinantes</strong> e as pessoas que administram a conta (sócios,
            gestores).
          </li>
          <li>
            <strong>Colaboradores</strong> das empresas assinantes, que usam o sistema para
            escala, tarefas, ponto e operação.
          </li>
          <li>
            <strong>Clientes finais</strong> dessas empresas, quando fazem pedidos pelo cardápio
            digital, delivery ou canais de atendimento.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'papeis',
    t: 'Nosso papel: operador, não dono dos seus dados',
    corpo: (
      <>
        <p>
          Essa distinção é a mais importante deste documento, porque define quem decide o que
          acontece com cada dado.
        </p>
        <ul>
          <li>
            Sobre os dados que a <strong>empresa assinante cadastra no sistema</strong> — seus
            colaboradores, seus clientes, seus pedidos — a empresa é a{' '}
            <strong>controladora</strong> e a {NOME_FANTASIA} atua como{' '}
            <strong>operadora</strong>: tratamos esses dados apenas seguindo as instruções da
            empresa e para fazer o serviço funcionar. Não vendemos, não alugamos e não usamos
            esses dados para publicidade.
          </li>
          <li>
            Sobre os dados da <strong>própria relação de assinatura</strong> — cadastro da
            empresa, dados de cobrança, registros de acesso e suporte — a {NOME_FANTASIA} é a{' '}
            <strong>controladora</strong>.
          </li>
        </ul>
        <p>
          Na prática: se você é colaborador ou cliente de uma loja que usa o Regem e quer excluir
          ou corrigir um dado, o pedido deve ser dirigido primeiro à empresa com quem você se
          relaciona. Também atendemos você diretamente e, quando necessário, acionamos a empresa
          responsável.
        </p>
      </>
    ),
  },
  {
    id: 'dados',
    t: 'Quais dados tratamos',
    corpo: (
      <>
        <div className="tabela">
          <table>
            <caption>Categorias de dados pessoais tratados pelo Regem</caption>
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Dados</th>
                <th>De onde vem</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Conta e acesso</td>
                <td>
                  Nome, e-mail, telefone, senha (armazenada com hash), PIN de operação, perfil de
                  acesso, registros de login
                </td>
                <td>Cadastro feito pela empresa</td>
              </tr>
              <tr>
                <td>Empresa assinante</td>
                <td>Razão social, CNPJ, endereço, dados de cobrança da assinatura</td>
                <td>Cadastro e consultas públicas de CNPJ</td>
              </tr>
              <tr>
                <td>Colaborador</td>
                <td>
                  Nome, função, setor, escala de trabalho, tarefas executadas, documentos com
                  ciência registrada
                </td>
                <td>Cadastro pela empresa</td>
              </tr>
              <tr>
                <td>Ponto eletrônico</td>
                <td>
                  Marcações de entrada e saída, NSR sequencial, comprovantes e arquivos AFD/AEJ;
                  foto do momento da marcação, quando a empresa ativa esse recurso
                </td>
                <td>Terminal de ponto / app do colaborador</td>
              </tr>
              <tr>
                <td>Cliente final</td>
                <td>
                  Nome, telefone, endereço de entrega, histórico de pedidos, saldo de cashback e
                  fidelidade
                </td>
                <td>Informado pelo próprio cliente ao pedir</td>
              </tr>
              <tr>
                <td>Atendimento</td>
                <td>Mensagens trocadas nos canais de atendimento, incluindo WhatsApp</td>
                <td>Conversa iniciada pelo cliente</td>
              </tr>
              <tr>
                <td>Entrega</td>
                <td>
                  Identificação do entregador e localização aproximada durante uma entrega em
                  andamento
                </td>
                <td>App do entregador</td>
              </tr>
              <tr>
                <td>Operação</td>
                <td>Fotos de vistoria, desperdício e conferência de estoque</td>
                <td>Registro feito pelo colaborador</td>
              </tr>
              <tr>
                <td>Registros técnicos</td>
                <td>
                  Endereço IP, data e hora, ações realizadas no sistema (trilha de auditoria),
                  erros e diagnósticos
                </td>
                <td>Gerado automaticamente pelo uso</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          O Regem <strong>não trata dados de crianças e adolescentes</strong> de forma
          intencional, e não solicita dados sensíveis (origem racial, convicção religiosa, opinião
          política, saúde, vida sexual, dado genético ou biométrico) para nenhuma funcionalidade.
        </p>
        <p>
          A <strong>pesquisa de clima organizacional é anônima</strong>: as respostas não são
          vinculadas ao colaborador, e a direção da empresa só enxerga o resultado consolidado.
        </p>
      </>
    ),
  },
  {
    id: 'finalidades',
    t: 'Para que usamos e com qual base legal',
    corpo: (
      <>
        <div className="tabela">
          <table>
            <caption>Finalidades de tratamento e respectivas bases legais</caption>
            <thead>
              <tr>
                <th>Finalidade</th>
                <th>Base legal (LGPD)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  Criar e manter a conta, autenticar o acesso e aplicar as permissões de cada
                  perfil
                </td>
                <td>Execução de contrato (art. 7º, V)</td>
              </tr>
              <tr>
                <td>
                  Operar as funcionalidades contratadas: escala, tarefas, estoque, pedidos,
                  entrega, financeiro
                </td>
                <td>Execução de contrato (art. 7º, V)</td>
              </tr>
              <tr>
                <td>
                  Registrar jornada de trabalho e emitir comprovantes e arquivos fiscais de ponto
                </td>
                <td>
                  Cumprimento de obrigação legal (art. 7º, II) — Portaria MTP nº 671/2021
                </td>
              </tr>
              <tr>
                <td>Emitir documentos fiscais e guardar registros contábeis</td>
                <td>Cumprimento de obrigação legal (art. 7º, II)</td>
              </tr>
              <tr>
                <td>Registrar foto no momento da marcação de ponto</td>
                <td>Consentimento específico do colaborador (art. 7º, I)</td>
              </tr>
              <tr>
                <td>Manter trilha de auditoria de quem fez o quê, quando e de onde</td>
                <td>Legítimo interesse — segurança e prevenção a fraude (art. 7º, IX)</td>
              </tr>
              <tr>
                <td>Enviar avisos operacionais sobre um pedido em andamento</td>
                <td>Execução de contrato / legítimo interesse (art. 7º, V e IX)</td>
              </tr>
              <tr>
                <td>Enviar comunicação promocional (campanhas, cupons)</td>
                <td>
                  Consentimento do destinatário (art. 7º, I), revogável a qualquer momento
                </td>
              </tr>
              <tr>
                <td>Prestar suporte técnico e investigar incidentes</td>
                <td>Legítimo interesse (art. 7º, IX)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <strong>Não usamos seus dados para treinar modelos de inteligência artificial</strong> nem
          os disponibilizamos para esse fim por terceiros.
        </p>
      </>
    ),
  },
  {
    id: 'fotos',
    t: 'Fotos, consentimento e expurgo',
    corpo: (
      <>
        <p>
          Fotos são o dado mais sensível que o Regem manipula, e por isso têm regra própria. Toda
          foto registrada no ponto, em vistoria ou em lançamento de desperdício é gravada com{' '}
          <strong>marcação de consentimento</strong> e <strong>data de expurgo</strong>: passado o
          prazo definido pela empresa, o arquivo é eliminado automaticamente.
        </p>
        <ul>
          <li>
            A captura de foto no ponto é <strong>opcional</strong> — a empresa liga ou desliga o
            recurso, e a marcação de ponto funciona sem ela.
          </li>
          <li>
            O colaborador pode <strong>revogar o consentimento</strong> a qualquer momento; a
            partir daí, novas fotos deixam de ser capturadas e as anteriores são eliminadas,
            ressalvado o que a empresa precise manter por obrigação legal.
          </li>
          <li>
            A foto <strong>não é usada como biometria</strong>: não há reconhecimento facial nem
            comparação automática de rostos. Ela serve apenas como comprovante visual da marcação.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'compartilhamento',
    t: 'Com quem compartilhamos',
    corpo: (
      <>
        <p>
          Não vendemos dados pessoais. Compartilhamos apenas o necessário para o serviço funcionar,
          com fornecedores que atuam como operadores e estão obrigados contratualmente a proteger
          essas informações:
        </p>
        <div className="tabela">
          <table>
            <caption>Fornecedores que podem tratar dados a nosso pedido</caption>
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>Para quê</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Provedores de nuvem e banco de dados</td>
                <td>Hospedagem da aplicação, do banco e dos arquivos enviados</td>
              </tr>
              <tr>
                <td>Cloudflare</td>
                <td>Proteção contra ataques e entrega do site</td>
              </tr>
              <tr>
                <td>Meta Platforms (WhatsApp Business)</td>
                <td>Envio e recebimento das mensagens de atendimento por WhatsApp</td>
              </tr>
              <tr>
                <td>Provedores de pagamento</td>
                <td>
                  Cobrança da assinatura e processamento de pagamentos de pedidos (PIX, cartão)
                </td>
              </tr>
              <tr>
                <td>Plataformas de delivery integradas</td>
                <td>Receber e atualizar pedidos originados nesses canais</td>
              </tr>
              <tr>
                <td>Provedor de modelo de linguagem</td>
                <td>
                  Gerar as respostas do robô de atendimento, quando a empresa ativa o recurso
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Também podemos compartilhar dados para <strong>cumprir ordem judicial</strong> ou
          requisição de autoridade competente, e para exercer ou defender direitos em processo.
        </p>
        <h3>Transferência internacional</h3>
        <p>
          Parte desses fornecedores mantém servidores fora do Brasil. Nesses casos, a transferência
          ocorre com as garantias exigidas pelo art. 33 da LGPD, por meio de cláusulas contratuais
          de proteção firmadas com cada fornecedor.
        </p>
      </>
    ),
  },
  {
    id: 'retencao',
    t: 'Por quanto tempo guardamos',
    corpo: (
      <>
        <ul>
          <li>
            <strong>Enquanto a conta estiver ativa:</strong> os dados operacionais ficam
            disponíveis para a empresa usar o sistema.
          </li>
          <li>
            <strong>Registros de ponto e documentos fiscais:</strong> pelo prazo exigido pela
            legislação trabalhista e fiscal, ainda que a conta seja encerrada.
          </li>
          <li>
            <strong>Fotos:</strong> até a data de expurgo definida pela empresa, quando são
            eliminadas automaticamente.
          </li>
          <li>
            <strong>Trilha de auditoria:</strong> mantida de forma imutável pelo tempo necessário à
            segurança e à comprovação de responsabilidade.
          </li>
          <li>
            <strong>Após o encerramento da assinatura:</strong> a empresa tem um período para
            exportar seus dados; depois disso, eles são eliminados ou anonimizados, exceto o que
            precisar ser guardado por obrigação legal.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'direitos',
    t: 'Seus direitos',
    corpo: (
      <>
        <p>O art. 18 da LGPD garante a você, a qualquer momento e sem custo, o direito de:</p>
        <ul>
          <li>
            confirmar se tratamos dados seus e <strong>acessar</strong> esses dados;
          </li>
          <li>
            <strong>corrigir</strong> dados incompletos, inexatos ou desatualizados;
          </li>
          <li>
            pedir <strong>anonimização, bloqueio ou eliminação</strong> de dados desnecessários,
            excessivos ou tratados em desconformidade com a lei;
          </li>
          <li>
            solicitar a <strong>portabilidade</strong> dos dados a outro fornecedor;
          </li>
          <li>
            pedir a <strong>eliminação</strong> dos dados tratados com base em consentimento;
          </li>
          <li>
            saber com quais entidades <strong>compartilhamos</strong> seus dados;
          </li>
          <li>
            <strong>revogar o consentimento</strong> a qualquer momento, e ser informado do que isso
            implica;
          </li>
          <li>
            <strong>opor-se</strong> a um tratamento feito com base em legítimo interesse.
          </li>
        </ul>
        <p>
          Para exercer qualquer um deles, escreva para <strong>{CONTATO}</strong>. Respondemos em
          até <strong>15 dias</strong>. Podemos pedir informações que confirmem a sua identidade — é
          uma proteção contra alguém se passar por você.
        </p>
        <div className="nota">
          Se o dado pertence a uma empresa que usa o Regem (por exemplo, seu registro de ponto ou
          seu histórico de pedidos numa loja), encaminhamos a solicitação a ela, que é a
          controladora, e acompanhamos o atendimento.
        </div>
      </>
    ),
  },
  {
    id: 'seguranca',
    t: 'Como protegemos',
    corpo: (
      <>
        <ul>
          <li>Tráfego criptografado em trânsito (HTTPS) em todos os acessos.</li>
          <li>Senhas guardadas com hash — nem nós conseguimos lê-las.</li>
          <li>
            Separação rigorosa por empresa: nenhuma consulta ao banco roda sem o filtro da empresa
            dona do dado.
          </li>
          <li>
            Controle de acesso por perfil aplicado no servidor: um perfil sem permissão não recebe o
            dado, não apenas deixa de ver a tela.
          </li>
          <li>
            Trilha de auditoria imutável de toda alteração relevante, com autor, ação, origem e
            horário.
          </li>
          <li>Limites de requisição e proteção contra tentativas de invasão e força bruta.</li>
        </ul>
        <p>
          Nenhum sistema é imune a incidentes. Se ocorrer um incidente de segurança que possa
          acarretar risco relevante aos titulares, comunicaremos os afetados e a{' '}
          <strong>Autoridade Nacional de Proteção de Dados (ANPD)</strong> nos prazos da lei.
        </p>
      </>
    ),
  },
  {
    id: 'cookies',
    t: 'Cookies',
    corpo: (
      <>
        <p>
          Usamos apenas os cookies necessários para o funcionamento: o que mantém você conectado
          após o login e os que guardam preferências da interface. Eles não servem para publicidade
          nem para acompanhar sua navegação em outros sites.
        </p>
        <p>
          Bloquear esses cookies no navegador impede o login de funcionar, já que é neles que a
          sessão se apoia.
        </p>
      </>
    ),
  },
  {
    id: 'alteracoes',
    t: 'Alterações nesta política',
    corpo: (
      <>
        <p>
          Podemos atualizar este documento para refletir mudanças no serviço ou na legislação. A
          data de revisão no topo sempre indica a versão vigente. Quando a mudança for relevante,
          avisamos as empresas assinantes pelos canais de contato cadastrados antes de ela passar a
          valer.
        </p>
      </>
    ),
  },
];

export default function PrivacidadePage() {
  return (
    <div className="pv">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header>
        <Link className="logo" href="/">
          <RegemMark className="h-8 w-8 text-[#F2F5F9]" /> Regem
        </Link>
        <nav>
          <a href="/">Início</a>
          <Link href="/como-funciona">Como funciona</Link>
          <Link className="btn" href="/criar-conta">
            Testar grátis
          </Link>
        </nav>
      </header>

      <div className="hero">
        <div className="eyebrow">Privacidade &amp; LGPD</div>
        <h1>Política de Privacidade</h1>
        <p className="lead">
          O que o Regem faz com dados pessoais, por que faz, por quanto tempo guarda e como você
          pede para mudar isso.
        </p>
        <div className="selo">Última atualização: {ATUALIZADO_EM}</div>
      </div>

      <div className="wrap">
        <div className="sumario">
          <h2>Nesta página</h2>
          <ol>
            {SECOES.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.t}</a>
              </li>
            ))}
          </ol>
        </div>

        {SECOES.map((s, i) => (
          <section key={s.id}>
            <h2 id={s.id}>
              <span className="n">{String(i + 1).padStart(2, '0')}</span>
              {s.t}
            </h2>
            {s.corpo}
          </section>
        ))}

        <div className="contato">
          <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>Encarregado de dados (DPO)</h2>
          <p>
            Dúvidas sobre esta política, pedidos de acesso, correção ou exclusão de dados, ou
            qualquer assunto de privacidade:
          </p>
          <p>
            <a href={`mailto:${CONTATO}`}>{CONTATO}</a>
          </p>
          <p style={{ marginBottom: 0, fontSize: 14, color: '#9FB2C8' }}>
            {RAZAO_SOCIAL} ({NOME_FANTASIA}){CNPJ ? ` · CNPJ ${CNPJ}` : ''} — desenvolvedora e
            operadora do Regem. {ENDERECO}.
          </p>
        </div>
      </div>

      <footer>Regem · no comando de todo o negócio — do balcão ao balanço</footer>
    </div>
  );
}
