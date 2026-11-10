'use client';

import { useRef, useState } from 'react';
import { mascaraCep } from '@/lib/br';
import { brl, mascaraReais, MEIO_ICONE, MEIO_ROTULO, reais, temPublico, temUber, UBER_ROTULO } from '@/lib/vagas-ficha';
import { doMapa, Escolhas, Grupo, Texto } from './campos';
import type { PropsEtapa } from './tipos';

// Etapa 6 — Onde mora e como chega. O CEP preenche rua, bairro e cidade pelo ViaCEP (do navegador; falhou → a pessoa
// digita). Transporte: vários de uma vez; Uber pede o motivo; o VALOR da condução (ida e volta) é o candidato que informa
// — o sistema não calcula (dono, 10/11/2026). A estimativa de conduções pelo Google chega na F2.
const SUBS: Record<string, string> = { publico: 'Preciso de condução', uber: 'Uber, 99 ou parecido', pe: 'Moro perto', bike: 'Vou pedalando', proprio: 'Tenho o meu' };

export function EtapaEndereco({ f, muda, erros }: PropsEtapa) {
  const [statusCep, setStatusCep] = useState('');
  const ultimo = useRef('');
  const aoMudarCep = async (bruto: string) => {
    const cep = mascaraCep(bruto);
    muda('cep', cep);
    const d = cep.replace(/\D/g, '');
    if (d.length !== 8 || d === ultimo.current) return;
    ultimo.current = d;
    setStatusCep('Buscando o endereço…');
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { signal: ctrl.signal });
      clearTimeout(t);
      const j = await r.json();
      if (j?.erro) throw new Error('cep');
      if (j.logradouro) muda('rua', j.logradouro);
      if (j.bairro) muda('bairro', j.bairro);
      if (j.localidade) muda('cidade', j.uf ? `${j.localidade} – ${j.uf}` : j.localidade);
      setStatusCep('Endereço encontrado ✓ Confira e coloque o número.');
      document.getElementById('vg-num')?.focus();
    } catch {
      setStatusCep('Não achamos esse CEP agora. Preencha a rua, o bairro e a cidade.');
    }
  };
  const total = reais(f.valor_ida) + reais(f.valor_volta);
  return (
    <>
      <Grupo campo="cep" erros={erros}>
        <Texto id="vg-cep" rotulo="CEP" modo="numeric" auto="postal-code" max={9} valor={f.cep} aoMudar={aoMudarCep} placeholder="00000-000" />
        <p className="vg-dica" aria-live="polite">
          {statusCep}
        </p>
        <a className="vg-link" href="https://buscacepinter.correios.com.br/app/endereco/index.php" target="_blank" rel="noopener noreferrer">
          Não sei meu CEP ↗
        </a>
      </Grupo>
      <Grupo campo="rua" erros={erros}>
        <Texto id="vg-rua" rotulo="Rua" auto="address-line1" max={120} valor={f.rua} aoMudar={(v) => muda('rua', v)} placeholder="Preenche sozinho pelo CEP" />
      </Grupo>
      <div className="vg-duo">
        <Grupo campo="numero" erros={erros}>
          <Texto id="vg-num" rotulo="Número" modo="numeric" max={10} valor={f.numero} aoMudar={(v) => muda('numero', v)} placeholder="Ex.: 120" />
        </Grupo>
        <Grupo campo="complemento" erros={erros}>
          <Texto id="vg-comp" rotulo="Complemento" opcional max={60} valor={f.complemento} aoMudar={(v) => muda('complemento', v)} placeholder="Casa 2, apto…" />
        </Grupo>
      </div>
      <div className="vg-duo">
        <Grupo campo="bairro" erros={erros}>
          <Texto id="vg-bairro" rotulo="Bairro" max={80} valor={f.bairro} aoMudar={(v) => muda('bairro', v)} />
        </Grupo>
        <Grupo campo="cidade" erros={erros}>
          <Texto id="vg-cidade" rotulo="Cidade" max={80} valor={f.cidade} aoMudar={(v) => muda('cidade', v)} />
        </Grupo>
      </div>
      <Grupo campo="meio" erros={erros}>
        <span className="vg-perg">Como você viria para o trabalho?</span>
        <p className="vg-dica" style={{ margin: '-4px 0 10px' }}>
          Pode marcar mais de um (ex.: ônibus na ida e Uber na volta).
        </p>
        <Escolhas
          rotulo="Como viria para o trabalho"
          tipo="opcao"
          multi
          opcoes={Object.keys(MEIO_ROTULO).map((v) => ({ v, icone: MEIO_ICONE[v], rotulo: MEIO_ROTULO[v], sub: SUBS[v] }))}
          valor={f.meio}
          aoMudar={(v) => muda('meio', v)}
        />
      </Grupo>
      {temPublico(f) && (
        <Grupo campo="conducoes" erros={erros}>
          <span className="vg-perg">Quantas conduções você pega para vir?</span>
          <Escolhas
            rotulo="Quantas conduções"
            opcoes={[
              { v: '1', rotulo: '1' },
              { v: '2', rotulo: '2' },
              { v: '3', rotulo: '3' },
              { v: '4', rotulo: '4 ou mais' },
            ]}
            valor={f.conducoes}
            aoMudar={(v) => muda('conducoes', v)}
          />
        </Grupo>
      )}
      {temUber(f) && (
        <Grupo campo="uber_motivo" erros={erros}>
          <span className="vg-perg">Por que você usaria Uber?</span>
          <Escolhas rotulo="Motivo do Uber" opcoes={doMapa(UBER_ROTULO)} valor={f.uber_motivo} aoMudar={(v) => muda('uber_motivo', v)} />
          <Texto
            id="vg-uber-obs"
            classeRotulo="vg-perg-p"
            rotulo="Conte mais"
            opcional={f.uber_motivo !== 'outro'}
            area
            max={200}
            valor={f.uber_obs}
            aoMudar={(v) => muda('uber_obs', v)}
            placeholder="Ex.: na minha rua não passa ônibus depois das 23h"
          />
        </Grupo>
      )}
      {(temPublico(f) || temUber(f)) && (
        <Grupo campo="valor" erros={erros}>
          <span className="vg-perg">Quanto você gasta de condução?</span>
          <p className="vg-dica" style={{ margin: '-4px 0 10px' }}>
            Some tudo o que você paga no caminho — passagens e, se usar, o Uber.
          </p>
          <div className="vg-duo">
            <div>
              <Texto id="vg-ida" classeRotulo="vg-perg-p" rotulo="Ida (R$)" modo="numeric" valor={f.valor_ida} aoMudar={(v) => muda('valor_ida', mascaraReais(v))} placeholder="0,00" />
            </div>
            <div>
              <Texto id="vg-volta" classeRotulo="vg-perg-p" rotulo="Volta (R$)" modo="numeric" valor={f.valor_volta} aoMudar={(v) => muda('valor_volta', mascaraReais(v))} placeholder="0,00" />
            </div>
          </div>
          {total > 0 && (
            <p className="vg-dica" aria-live="polite">
              Total por dia de trabalho: {brl(total)}
            </p>
          )}
        </Grupo>
      )}
      <p className="vg-dica">🔒 O endereço serve só para saber como você chega à loja e para o vale-transporte.</p>
    </>
  );
}
