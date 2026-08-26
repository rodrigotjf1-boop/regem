'use client';

import Link from 'next/link';
import { RegemMark } from '@/components/brand/regem-mark';

// Identificação do contratado. A RAZÃO SOCIAL é o que vale num documento legal —
// "DMS Tecnologias" é o nome fantasia (e o nome do portfólio no Meta Business).
const RAZAO_SOCIAL = 'SISTER TECNOLOGIA LTDA';
const NOME_FANTASIA = 'DMS Tecnologias';
const CNPJ = '67.748.508/0001-43';
const ENDERECO = 'R. Visconde de Pirajá, 414, sala 718 — Rio de Janeiro/RJ, CEP 22.410-905';
const FORO = 'Rio de Janeiro/RJ';
const CONTATO = 'suporte@dmsregem.com';
// Data da última revisão do texto. Atualize ao mexer no conteúdo.
const ATUALIZADO_EM = '26 de agosto de 2026';

// Termos de Uso públicos. Mesmo padrão visual das outras páginas públicas
// (ver /privacidade e /como-funciona): CSS escopado, tema navy + âmbar da marca.
const CSS = `
.tm{font-family:var(--font-sans);background:#0D1A2B;color:#F2F5F9;min-height:100dvh}
.tm a{color:inherit;text-decoration:none}
.tm .wrap{max-width:820px;margin:0 auto;padding:0 24px}
.tm header{display:flex;align-items:center;gap:12px;padding:20px 24px;border-bottom:1px solid #1A3050}
.tm header .logo{display:flex;align-items:center;gap:10px;font-family:var(--font-display);font-weight:800;font-size:19px}
.tm header nav{margin-left:auto;display:flex;gap:22px;font-size:14.5px;color:#9FB2C8;align-items:center;flex-wrap:wrap}
.tm header nav a:hover{color:#F2F5F9}
.tm .btn{background:#E8A845;color:#2A1D06;padding:10px 20px;border-radius:999px;font-weight:700;font-size:14.5px}
.tm .hero{text-align:center;padding:56px 24px 8px}
.tm .eyebrow{font-family:var(--font-mono);font-size:12px;letter-spacing:.3em;color:#E8A845;text-transform:uppercase}
.tm h1{font-family:var(--font-display);font-weight:800;font-size:clamp(30px,5vw,44px);letter-spacing:-.02em;margin:14px 0 12px}
.tm .lead{color:#9FB2C8;font-size:16.5px;max-width:620px;margin:0 auto;line-height:1.55}
.tm .selo{font-family:var(--font-mono);font-size:12.5px;color:#7C8CA3;margin-top:18px}
.tm .sumario{background:#12233A;border:1px solid #1A3050;border-radius:16px;padding:20px 24px;margin:36px 0 8px}
.tm .sumario h2{font-family:var(--font-display);font-size:15px;font-weight:700;color:#E8A845;margin:0 0 12px;text-transform:uppercase;letter-spacing:.06em}
.tm .sumario ol{margin:0;padding-left:20px;display:grid;grid-template-columns:1fr 1fr;gap:7px 24px;color:#C4D0DE;font-size:14.5px}
.tm .sumario a:hover{color:#E8A845;text-decoration:underline}
.tm section{margin:40px 0}
.tm section h2{font-family:var(--font-display);font-size:22px;font-weight:700;margin:0 0 14px;scroll-margin-top:24px}
.tm section h2 .n{font-family:var(--font-mono);font-size:15px;color:#E8A845;margin-right:10px}
.tm h3{font-family:var(--font-display);font-size:16px;font-weight:700;color:#E8A845;margin:22px 0 8px}
.tm p{color:#C4D0DE;font-size:15.5px;line-height:1.68;margin:0 0 14px}
.tm ul{margin:0 0 14px;padding-left:20px;display:flex;flex-direction:column;gap:8px;color:#C4D0DE;font-size:15.5px;line-height:1.6}
.tm strong{color:#F2F5F9;font-weight:700}
.tm .tabela{overflow-x:auto;margin:0 0 16px;border:1px solid #1A3050;border-radius:12px}
.tm table{width:100%;border-collapse:collapse;font-size:14.5px;min-width:520px}
.tm caption{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.tm th,.tm td{text-align:left;padding:11px 16px;border-bottom:1px solid #1A3050;vertical-align:top;color:#C4D0DE}
.tm th{background:#12233A;color:#F2F5F9;font-weight:700;font-size:13.5px;text-transform:uppercase;letter-spacing:.04em}
.tm tr:last-child td{border-bottom:none}
.tm .nota{background:rgba(232,168,69,.08);border:1px solid rgba(232,168,69,.25);border-radius:12px;padding:14px 18px;color:#E7C79A;font-size:14.5px;line-height:1.6;margin:0 0 16px}
.tm .contato{background:#12233A;border:1px solid #1A3050;border-radius:16px;padding:22px 24px;margin:8px 0 56px}
.tm .contato p{margin-bottom:8px}
.tm .contato a{color:#E8A845;font-weight:700}
.tm footer{border-top:1px solid #1A3050;padding:24px;text-align:center;color:#7C8CA3;font-size:13px}
@media(max-width:640px){.tm .sumario ol{grid-template-columns:1fr}}
`;

type Secao = { id: string; t: string; corpo: React.ReactNode };

const SECOES: Secao[] = [
  {
    id: 'aceitacao',
    t: 'Quem contrata e o que você está aceitando',
    corpo: (
      <>
        <p>
          Estes Termos regem o uso do <strong>Regem</strong>, plataforma de gestão operacional
          desenvolvida e operada por <strong>{RAZAO_SOCIAL}</strong>, que atua sob o nome{' '}
          <strong>{NOME_FANTASIA}</strong> — CNPJ {CNPJ}, com sede em {ENDERECO}.
        </p>
        <p>
          Ao criar uma conta ou usar a plataforma, a <strong>empresa assinante</strong> aceita
          estes Termos. Quem realiza o cadastro declara ter poderes para obrigar a empresa que
          representa.
        </p>
        <p>
          Colaboradores e clientes finais que usam o sistema o fazem sob a conta da empresa
          assinante, e é ela quem responde pelo uso que fazem.
        </p>
      </>
    ),
  },
  {
    id: 'servico',
    t: 'O que o Regem faz',
    corpo: (
      <>
        <p>
          O Regem é software como serviço (SaaS) para gestão operacional de empresas: escala de
          trabalho, tarefas e checklists, estoque, fichas técnicas, ponto, pedidos, delivery,
          financeiro e integrações com canais de venda.
        </p>
        <p>
          Parte dos recursos é <strong>ativável</strong> pela empresa assinante (terminal de ponto,
          KDS, app do colaborador, robô de atendimento, entre outros). Recursos desativados deixam
          de ser acessíveis imediatamente.
        </p>
        <h3>Servidor local</h3>
        <p>
          O Regem pode operar com um <strong>servidor local</strong> instalado no computador da
          loja, para que a operação continue funcionando sem internet, sincronizando com a nuvem ao
          reconectar. A empresa assinante é responsável pelo equipamento, pela rede e pela energia
          desse computador — falhas de infraestrutura local não são falhas do serviço.
        </p>
      </>
    ),
  },
  {
    id: 'conta',
    t: 'Conta, acessos e responsabilidade',
    corpo: (
      <>
        <ul>
          <li>
            A empresa assinante é responsável por manter <strong>corretos e atualizados</strong> os
            dados de cadastro.
          </li>
          <li>
            <strong>Credenciais são pessoais e intransferíveis.</strong> Senhas de gestão e PINs de
            operação não devem ser compartilhados. O que é feito com uma credencial é atribuído ao
            seu titular na trilha de auditoria.
          </li>
          <li>
            Cabe à empresa definir os <strong>perfis de acesso</strong> de cada pessoa. Conceder a
            alguém um perfil mais amplo do que o necessário é decisão — e responsabilidade — da
            empresa.
          </li>
          <li>
            Suspeita de acesso indevido deve ser comunicada imediatamente a{' '}
            <strong>{CONTATO}</strong>, para que possamos ajudar a conter.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'planos',
    t: 'Planos, teste gratuito e pagamento',
    corpo: (
      <>
        <ul>
          <li>
            Novas empresas iniciam com <strong>período de teste gratuito</strong>, conforme
            anunciado no momento da contratação, sem exigência de cartão.
          </li>
          <li>
            Encerrado o teste, o uso continuado depende da contratação de um plano. Sem contratação,
            o acesso é suspenso e os dados permanecem disponíveis para exportação pelo prazo da
            seção <a href="#encerramento">Encerramento</a>.
          </li>
          <li>
            Os valores vigentes são os divulgados na página de planos no momento da contratação ou
            renovação. <strong>Reajustes serão comunicados com antecedência mínima de 30 dias</strong>,
            e você pode cancelar antes que passem a valer.
          </li>
          <li>
            Atraso no pagamento pode levar à suspensão do acesso, sempre com aviso prévio pelos
            canais de contato cadastrados.
          </li>
        </ul>
        <div className="nota">
          Custos cobrados por terceiros — como mensagens da API oficial do WhatsApp, taxas de
          gateways de pagamento ou comissões de plataformas de delivery — <strong>não estão
          incluídos</strong> na assinatura e são pagos diretamente aos respectivos fornecedores. Veja a
          seção <a href="#canais">Canais de terceiros</a>.
        </div>
      </>
    ),
  },
  {
    id: 'canais',
    t: 'Canais de terceiros, WhatsApp e responsabilidade',
    corpo: (
      <>
        <p>
          O Regem integra canais operados por terceiros — WhatsApp, plataformas de delivery,
          gateways de pagamento. Esses canais têm regras próprias, definidas por quem os opera, e
          podem mudar sem aviso.
        </p>
        <h3>Conexão de WhatsApp por leitura de QR Code (não oficial)</h3>
        <p>
          A empresa assinante pode optar por conectar seu WhatsApp por leitura de QR Code. Essa
          modalidade <strong>não é oficial nem homologada pela Meta</strong>. Ao escolhê-la, a
          empresa reconhece que:
        </p>
        <ul>
          <li>
            o número pode ser <strong>bloqueado ou banido pela Meta a qualquer momento, sem aviso
            prévio e sem direito a recurso</strong>;
          </li>
          <li>
            a recuperação do número depende exclusivamente da Meta, e não temos como intervir;
          </li>
          <li>
            a escolha é <strong>de uso e responsabilidade exclusivos da empresa assinante</strong>,
            que assume o risco de indisponibilidade e de perda do número.
          </li>
        </ul>
        <h3>API oficial do WhatsApp (Meta)</h3>
        <p>
          Na modalidade oficial, a conta do WhatsApp Business pertence à empresa assinante, que
          cadastra o próprio meio de pagamento junto à Meta. <strong>Os custos por mensagem são
          cobrados pela Meta diretamente da empresa assinante</strong>, segundo a tabela e as
          categorias definidas pela Meta, que podem mudar a qualquer tempo. Não intermediamos nem
          revendemos esse valor.
        </p>
        <h3>Regras de envio</h3>
        <p>
          A empresa assinante é a única responsável pelo conteúdo que envia e por obter o
          consentimento de quem recebe.{' '}
          <strong>É vedado usar a plataforma para envio de mensagens não solicitadas</strong>{' '}
          (spam), para listas compradas ou obtidas sem consentimento, ou em violação das políticas
          do canal utilizado. Reservamo-nos o direito de suspender recursos de envio diante de
          indícios de uso abusivo.
        </p>
        <p>
          Indisponibilidade, mudança de regras, alteração de preço ou bloqueio impostos por esses
          terceiros não constituem falha do Regem.
        </p>
      </>
    ),
  },
  {
    id: 'uso',
    t: 'Uso proibido',
    corpo: (
      <>
        <p>Ao usar a plataforma, você concorda em não:</p>
        <ul>
          <li>violar lei aplicável ou direitos de terceiros;</li>
          <li>
            tentar acessar dados de outra empresa assinante, burlar controles de acesso ou explorar
            vulnerabilidades;
          </li>
          <li>
            fazer engenharia reversa, descompilar ou copiar o software, no todo ou em parte, salvo
            no que a lei expressamente permitir;
          </li>
          <li>
            <strong>revender, sublicenciar ou disponibilizar o acesso a terceiros</strong> sem
            autorização escrita nossa;
          </li>
          <li>
            usar a plataforma para envio de spam, fraude, ou qualquer prática que possa
            comprometer a reputação dos canais integrados;
          </li>
          <li>
            sobrecarregar deliberadamente a infraestrutura, com automações abusivas ou volume
            artificial.
          </li>
        </ul>
        <p>
          Violação a esta seção pode levar à suspensão imediata do acesso, com comunicação à
          empresa assinante.
        </p>
      </>
    ),
  },
  {
    id: 'dados',
    t: 'Dados, privacidade e propriedade',
    corpo: (
      <>
        <ul>
          <li>
            <strong>Os dados operacionais são da empresa assinante.</strong> Nós os tratamos como{' '}
            <strong>operador</strong>, seguindo as instruções dela e para fazer o serviço
            funcionar. Não vendemos, não alugamos e não usamos esses dados para publicidade, nem
            para treinar modelos de inteligência artificial.
          </li>
          <li>
            <strong>O software, a marca e o design são nossos.</strong> A assinatura concede
            licença de uso durante sua vigência — não transfere propriedade.
          </li>
          <li>
            Podemos usar <strong>dados agregados e anonimizados</strong> (que não identificam
            empresa nem pessoa) para melhorar o produto.
          </li>
        </ul>
        <p>
          O tratamento de dados pessoais está detalhado na{' '}
          <Link href="/privacidade" style={{ color: '#E8A845', fontWeight: 700 }}>
            Política de Privacidade
          </Link>
          , que integra estes Termos. Pedidos de acesso, correção ou exclusão de dados seguem o
          procedimento descrito em{' '}
          <Link href="/privacidade#direitos" style={{ color: '#E8A845', fontWeight: 700 }}>
            Seus direitos
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: 'disponibilidade',
    t: 'Disponibilidade e suporte',
    corpo: (
      <>
        <p>
          Trabalhamos para manter a plataforma disponível de forma contínua, mas{' '}
          <strong>não garantimos operação ininterrupta ou livre de erros</strong>. Podem ocorrer
          paradas para manutenção — as programadas serão comunicadas com antecedência sempre que
          possível, e preferencialmente em horário de menor movimento.
        </p>
        <p>
          O suporte é prestado por <strong>{CONTATO}</strong> e pelos canais indicados na
          plataforma, em dias úteis. Também não respondemos por indisponibilidade causada por
          fatores fora do nosso controle: falha de internet da loja, energia, equipamento local,
          ou instabilidade de serviços de terceiros.
        </p>
      </>
    ),
  },
  {
    id: 'encerramento',
    t: 'Encerramento',
    corpo: (
      <>
        <ul>
          <li>
            A empresa assinante pode <strong>cancelar a qualquer momento</strong>, pelos canais de
            atendimento. O cancelamento produz efeitos ao fim do ciclo já pago.
          </li>
          <li>
            Podemos encerrar o contrato em caso de violação destes Termos, inadimplência
            persistente, ou por descontinuidade do serviço — neste último caso, com{' '}
            <strong>aviso prévio de ao menos 60 dias</strong>.
          </li>
          <li>
            Após o encerramento, a empresa terá um <strong>prazo de 30 dias para exportar seus
            dados</strong>. Findo esse prazo, os dados são eliminados ou anonimizados, ressalvado o
            que precisar ser mantido por obrigação legal — como registros de ponto e documentos
            fiscais.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'responsabilidade',
    t: 'Limitação de responsabilidade',
    corpo: (
      <>
        <p>
          O Regem é uma ferramenta de apoio à gestão. <strong>As decisões operacionais,
          trabalhistas, fiscais e comerciais são da empresa assinante</strong>, assim como a
          conferência dos dados que insere e dos resultados que utiliza.
        </p>
        <p>
          Na medida máxima permitida em lei, nossa responsabilidade total, por qualquer causa,
          fica limitada ao <strong>valor pago pela empresa assinante nos 12 meses anteriores</strong>{' '}
          ao evento. Não respondemos por lucros cessantes, perda de oportunidade ou danos
          indiretos.
        </p>
        <p>
          Nada nesta seção afasta responsabilidades que a lei não permita limitar, inclusive as
          previstas no Código de Defesa do Consumidor quando aplicável.
        </p>
      </>
    ),
  },
  {
    id: 'alteracoes',
    t: 'Alterações destes Termos',
    corpo: (
      <>
        <p>
          Podemos atualizar estes Termos para refletir mudanças no serviço ou na legislação. A data
          de revisão no topo indica a versão vigente. <strong>Mudanças relevantes serão
          comunicadas com antecedência mínima de 30 dias</strong> pelos canais de contato
          cadastrados; se você não concordar, pode cancelar antes que passem a valer.
        </p>
      </>
    ),
  },
  {
    id: 'foro',
    t: 'Lei aplicável e foro',
    corpo: (
      <>
        <p>
          Estes Termos são regidos pelas leis brasileiras. Fica eleito o foro da comarca de{' '}
          <strong>{FORO}</strong> para dirimir controvérsias, ressalvada, quando aplicável, a
          faculdade do consumidor de demandar no foro de seu domicílio.
        </p>
      </>
    ),
  },
];

export default function TermosPage() {
  return (
    <div className="tm">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header>
        <Link className="logo" href="/">
          <RegemMark className="h-8 w-8 text-[#F2F5F9]" /> Regem
        </Link>
        <nav>
          <a href="/">Início</a>
          <Link href="/privacidade">Privacidade</Link>
          <Link className="btn" href="/criar-conta">
            Testar grátis
          </Link>
        </nav>
      </header>

      <div className="hero">
        <div className="eyebrow">Termos de uso</div>
        <h1>Termos de Uso</h1>
        <p className="lead">
          As regras da relação entre a sua empresa e o Regem: o que contratamos, o que cada lado
          responde, e o que acontece quando algo dá errado.
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
          <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>Falar com a gente</h2>
          <p>Dúvidas sobre estes Termos, sobre a assinatura ou sobre o serviço:</p>
          <p>
            <a href={`mailto:${CONTATO}`}>{CONTATO}</a>
          </p>
          <p style={{ marginBottom: 0, fontSize: 14, color: '#9FB2C8' }}>
            {RAZAO_SOCIAL} ({NOME_FANTASIA}) · CNPJ {CNPJ} — desenvolvedora e operadora do Regem.{' '}
            {ENDERECO}.
          </p>
        </div>
      </div>

      <footer>Regem · no comando de todo o negócio — do balcão ao balanço</footer>
    </div>
  );
}
