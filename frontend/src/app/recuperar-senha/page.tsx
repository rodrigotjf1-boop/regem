'use client';

import Link from 'next/link';

// Recuperação de senha. Enquanto não há infraestrutura de e-mail, a redefinição
// é feita pelo gestor (presidente/gerente) em Cadastros → Pessoas. Página honesta,
// sem prometer link por e-mail que não existe.
const CSS = `
.rc{font-family:var(--font-sans);background:#0D1A2B;color:#F2F5F9;min-height:100dvh;display:grid;place-items:center;padding:32px 20px}
.rc a{color:#E8A845;text-decoration:none;font-weight:600}
.rc .card{width:100%;max-width:440px}
.rc .logo-mark{width:44px;height:44px;border-radius:50%;border:2.5px solid #E8A845;display:grid;place-items:center;color:#E8A845;font-size:19px;font-weight:800;margin:0 auto 18px}
.rc h1{font-family:var(--font-display);font-weight:800;font-size:22px;text-align:center}
.rc p.sub{color:#9FB2C8;font-size:14px;text-align:center;margin:8px 0 24px}
.rc .step{display:flex;gap:12px;background:#12233A;border:1px solid #1A3050;border-radius:14px;padding:14px 16px;margin-bottom:12px}
.rc .step .n{flex:none;width:26px;height:26px;border-radius:50%;background:#E8A845;color:#2A1D06;font-weight:800;display:grid;place-items:center;font-size:13px}
.rc .step b{font-size:14px}
.rc .step small{display:block;color:#9FB2C8;font-size:12.5px;margin-top:3px;line-height:1.5}
.rc .back{display:block;text-align:center;margin-top:22px;font-size:14px}
`;

export default function RecuperarSenhaPage() {
  return (
    <div className="rc">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="card">
        <div className="logo-mark">R</div>
        <h1>Recuperar acesso</h1>
        <p className="sub">Veja como redefinir a sua senha do Regem.</p>

        <div className="step">
          <span className="n">1</span>
          <div>
            <b>Você é da equipe?</b>
            <small>
              Peça ao responsável pela conta (presidente ou gerente) para redefinir
              a sua senha de acesso.
            </small>
          </div>
        </div>

        <div className="step">
          <span className="n">2</span>
          <div>
            <b>Você é o responsável / gestor?</b>
            <small>
              Ao entrar, vá em <b>Pessoas → Acesso &amp; senha</b> para definir ou
              redefinir a senha de qualquer colaborador (a ação fica registrada na
              auditoria).
            </small>
          </div>
        </div>

        <div className="step">
          <span className="n">3</span>
          <div>
            <b>Perdeu o acesso da conta principal?</b>
            <small>
              A recuperação automática por e-mail ainda não está disponível — fale
              com o suporte para restabelecer o acesso do responsável com segurança.
            </small>
          </div>
        </div>

        <Link className="back" href="/entrar">
          ← Voltar para o login
        </Link>
      </div>
    </div>
  );
}
