'use client';

import Link from 'next/link';
import { RegemMark } from '@/components/brand/regem-mark';

const CSS = `
.cf{font-family:var(--font-sans);background:#0D1A2B;color:#F2F5F9;min-height:100dvh}
.cf a{color:inherit;text-decoration:none}
.cf .wrap{max-width:820px;margin:0 auto;padding:0 24px}
.cf header{display:flex;align-items:center;gap:12px;padding:20px 24px;border-bottom:1px solid #1A3050}
.cf header .logo{display:flex;align-items:center;gap:10px;font-family:var(--font-display);font-weight:800;font-size:19px}
.cf header nav{margin-left:auto;display:flex;gap:22px;font-size:14.5px;color:#9FB2C8;align-items:center}
.cf header nav a:hover{color:#F2F5F9}
.cf .btn{background:#E8A845;color:#2A1D06;padding:10px 20px;border-radius:999px;font-weight:700;font-size:14.5px}
.cf .hero{text-align:center;padding:56px 24px 12px}
.cf .eyebrow{font-family:var(--font-mono);font-size:12px;letter-spacing:.3em;color:#E8A845;text-transform:uppercase}
.cf h1{font-family:var(--font-display);font-weight:800;font-size:clamp(30px,5vw,46px);letter-spacing:-.02em;margin:14px 0 12px}
.cf .lead{color:#9FB2C8;font-size:17px;max-width:560px;margin:0 auto;line-height:1.55}
.cf .steps{margin:40px 0 24px;display:flex;flex-direction:column;gap:16px}
.cf .step{background:#12233A;border:1px solid #1A3050;border-radius:16px;padding:22px 24px;display:grid;grid-template-columns:auto 1fr;gap:18px}
.cf .num{width:38px;height:38px;border-radius:11px;background:#E8A845;color:#2A1D06;display:grid;place-items:center;font-family:var(--font-mono);font-weight:800;font-size:17px}
.cf .step h3{font-family:var(--font-display);font-size:19px;font-weight:700;margin:2px 0 8px}
.cf .step p{color:#C4D0DE;font-size:15px;line-height:1.6;margin:0 0 6px}
.cf .step ul{margin:8px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:6px;color:#C4D0DE;font-size:14.5px}
.cf .step code{font-family:var(--font-mono);font-size:13px;background:#0D1A2B;border:1px solid #1A3050;border-radius:6px;padding:1px 7px;color:#F2F5F9}
.cf .step .sub{margin-top:12px;padding-left:2px}
.cf .step .sub h4{font-family:var(--font-display);font-size:14px;font-weight:700;color:#E8A845;margin:0 0 4px}
.cf .step .sub ul{margin-top:2px}
.cf .tag{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;background:rgba(232,168,69,.15);color:#E8A845;border:1px solid rgba(232,168,69,.4);padding:2px 9px;border-radius:999px;margin-left:8px;vertical-align:middle}
.cf .nota{background:rgba(232,168,69,.08);border:1px solid rgba(232,168,69,.25);border-radius:12px;padding:14px 18px;color:#E7C79A;font-size:14px;margin-top:10px}
.cf .cta{text-align:center;margin:40px 0 64px}
.cf footer{border-top:1px solid #1A3050;padding:24px;text-align:center;color:#7C8CA3;font-size:13px}
@media(max-width:560px){.cf .step{grid-template-columns:1fr}.cf .num{width:34px;height:34px}}
`;

type Step = {
  t: string;
  p: string;
  tag?: string;
  ul?: string[];
  sub?: { titulo: string; itens: string[] }[];
};

const STEPS: Step[] = [
  {
    t: 'Crie sua conta',
    tag: '3 meses grátis',
    p: 'Na página inicial, clique em “Testar grátis” e preencha o CNPJ, seu nome, e-mail e senha. Sua empresa entra com 3 meses do sistema completo — sem cartão.',
  },
  {
    t: 'Configure sua loja',
    p: 'Logado no Regem, monte o essencial em Cadastros:',
    ul: ['Cadastre a unidade (sua loja) e o cardápio / produtos.', 'Adicione os usuários e as funções da equipe.', 'Ajuste horários, formas de pagamento e o que mais usar.'],
  },
  {
    t: 'Instale o servidor local',
    tag: 'opcional, recomendado',
    p: 'O servidor local deixa a loja operando mesmo sem internet. No menu Servidor local:',
    ul: [
      'Baixe o instalador e execute no PC da loja (se o Windows avisar, clique em Mais informações → Executar assim mesmo).',
      'Aceite o aviso de administrador.',
      'Entre com o mesmo e-mail e senha da sua conta — ele instala e ativa tudo sozinho.',
    ],
  },
  {
    t: 'Acesse e opere',
    p: 'Abra o Regem no navegador, na mesma rede da loja:',
    ul: [
      'No PC do servidor: https://localhost:3001',
      'Nos aparelhos (KDS/PDV/Ponto): https://regem.local:3001 (ou o IP que o instalador mostrou).',
      'Entre com a mesma conta. Os pedidos sobem para a nuvem quando há internet.',
    ],
  },
  {
    t: 'Confie o certificado nos aparelhos',
    p: 'A conexão local é protegida por um certificado próprio, então cada aparelho mostra um aviso na 1ª vez. Instale o certificado uma vez para tirar o aviso (e liberar a câmera do ponto e o modo offline). No PC do servidor isso já é automático — só nos tablets/aparelhos clientes.',
    ul: [
      'No aparelho, abra no navegador: https://SEU-IP:3001/ca.pem (troque SEU-IP pelo endereço que o instalador mostrou). Baixa o arquivo regem-ca.crt.',
    ],
    sub: [
      {
        titulo: 'No Windows (1 clique)',
        itens: [
          'Baixe o instalador do certificado: https://SEU-IP:3001/confiar-certificado.ps1',
          'Clique com o botão direito no arquivo → “Executar com o PowerShell” → aceite o aviso de administrador. Ele baixa e instala o certificado sozinho.',
          'Alternativa manual: abra o regem-ca.crt → Instalar Certificado → Máquina Local → Autoridades de Certificação Raiz Confiáveis → Concluir.',
        ],
      },
      {
        titulo: 'No Android (tablets)',
        itens: [
          'Ajustes → Segurança → Criptografia e credenciais → Instalar um certificado → Certificado CA.',
          'Selecione o regem-ca.crt baixado e confirme. (Em alguns aparelhos: Ajustes → busque por “certificado”.)',
        ],
      },
    ],
  },
  {
    t: 'Assine quando o teste acabar',
    p: 'Perto do fim dos 3 meses, um aviso aparece no topo. Em Planos, escolha o pacote (mensal, semestral ou anual) e pague com segurança. A operação continua sem interrupção.',
  },
];

export default function ComoFuncionaPage() {
  return (
    <div className="cf">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header>
        <Link className="logo" href="/">
          <RegemMark className="h-8 w-8 text-[#F2F5F9]" /> Regem
        </Link>
        <nav>
          <a href="/">Início</a>
          <Link className="btn" href="/criar-conta">Testar grátis</Link>
        </nav>
      </header>

      <div className="hero">
        <div className="eyebrow">Como funciona</div>
        <h1>Do cadastro à operação, em 6 passos</h1>
        <p className="lead">
          Você faz tudo sozinho — cria a conta, configura a loja, instala o servidor e começa a operar.
          Sem técnico, sem burocracia.
        </p>
      </div>

      <div className="wrap">
        <div className="steps">
          {STEPS.map((s, i) => (
            <div className="step" key={s.t}>
              <div className="num">{i + 1}</div>
              <div>
                <h3>
                  {s.t}
                  {s.tag && <span className="tag">{s.tag}</span>}
                </h3>
                <p>{s.p}</p>
                {s.ul && (
                  <ul>
                    {s.ul.map((li) => (
                      <li key={li}>{li}</li>
                    ))}
                  </ul>
                )}
                {s.sub?.map((g) => (
                  <div className="sub" key={g.titulo}>
                    <h4>{g.titulo}</h4>
                    <ul>
                      {g.itens.map((li) => (
                        <li key={li}>{li}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="nota">
          Dúvidas em qualquer passo? Fale com a gente no WhatsApp (botão no canto da tela) — a gente
          acompanha sua instalação.
        </div>

        <div className="cta">
          <Link className="btn" href="/criar-conta" style={{ padding: '14px 30px', fontSize: 16 }}>
            Começar agora — 3 meses grátis
          </Link>
        </div>
      </div>

      <footer>Regem · no comando de todo o negócio — do balcão ao balanço</footer>
    </div>
  );
}
