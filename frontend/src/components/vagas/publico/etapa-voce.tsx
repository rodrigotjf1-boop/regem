'use client';

import { mascaraTelefone } from '@/lib/br';
import { idadeEm, SEXO_ROTULO } from '@/lib/vagas-ficha';
import { doMapa, Escolhas, Grupo, Texto } from './campos';
import type { PropsEtapa } from './tipos';

// Etapa 1 — Sobre você: nome, nascimento (mostra a idade; abaixo da mínima da página não segue), sexo (opcional),
// WhatsApp e e-mail (opcional).
export function EtapaVoce({ f, muda, p, erros, hoje }: PropsEtapa) {
  const idade = idadeEm(f.nascimento, hoje);
  return (
    <>
      <Grupo campo="nome" erros={erros}>
        <Texto id="vg-nome" rotulo="Nome completo" valor={f.nome} aoMudar={(v) => muda('nome', v)} auto="name" max={120} placeholder="Seu nome e sobrenome" />
      </Grupo>
      <Grupo campo="nascimento" erros={erros}>
        <Texto id="vg-nasc" rotulo="Data de nascimento" tipo="date" valor={f.nascimento} aoMudar={(v) => muda('nascimento', v)} />
        {idade !== null && idade >= 0 && <p className="vg-dica">Você tem {idade} anos.</p>}
        {idade !== null && idade < p.pagina.idadeMinima && (
          <p className="vg-nota">
            As vagas desta página são para quem tem {p.pagina.idadeMinima} anos ou mais. Guarde o link: quando abrirmos vaga para a sua idade, ela
            aparece aqui.
          </p>
        )}
      </Grupo>
      <Grupo campo="sexo" erros={erros}>
        <span className="vg-perg">
          Sexo <em>(opcional)</em>
        </span>
        <Escolhas rotulo="Sexo" opcoes={doMapa(SEXO_ROTULO)} valor={f.sexo} aoMudar={(v) => muda('sexo', v)} opcional />
      </Grupo>
      <Grupo campo="whatsapp" erros={erros}>
        <Texto
          id="vg-zap"
          rotulo="WhatsApp para contato"
          tipo="tel"
          modo="tel"
          auto="tel"
          valor={f.whatsapp}
          aoMudar={(v) => muda('whatsapp', mascaraTelefone(v))}
          placeholder="(21) 9XXXX-XXXX"
        />
        <p className="vg-dica">É por aqui que a gerência fala com você.</p>
      </Grupo>
      <Grupo campo="email" erros={erros}>
        <Texto id="vg-email" rotulo="E-mail" opcional tipo="email" modo="email" auto="email" max={160} valor={f.email} aoMudar={(v) => muda('email', v)} placeholder="seuemail@exemplo.com" />
      </Grupo>
    </>
  );
}
