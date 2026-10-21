-- Cozinha em estações, entrega 4 — a TELA DE SENHAS (a TV do balcão, em /senhas), pareada sem login como os outros
-- equipamentos (decisões do dono, 21/10/2026). Os ajustes dela:
--   1. o TAMANHO DAS LETRAS é de cada TV (Pronto, Preparando, nome da loja e títulos), em % — 60 a 160, padrão 100.
--      Fica no cadastro da TV: como o KDS, ela se configura no servidor da loja quando ele está ligado, e a TV não
--      grava "último uso" a cada leitura — nada do outro lado desfaz o ajuste pelo sincronismo (ERR-235).
--   2. o TEMPO DA SENHA EM PRONTO (minutos; 0 = "até o balcão entregar") e o AVISO SONORO valem para TODAS as telas, no
--      ajuste do KDS (que sincroniza nos dois sentidos): a gaveta grava na linha da EMPRESA, como a tela de ajustes do
--      KDS. Vazio = herda: loja → empresa → padrão (10 minutos, aviso ligado), lido campo a campo como o período da
--      senha (mig 332) — criar a linha da loja só para isso trocaria as cores do KDS dela.
-- Nas duas pontas (nuvem e servidor da loja). Quem ainda não tem as colunas ignora os campos no sincronismo.
alter table equipamento add column if not exists tela_tamanhos jsonb;
alter table kds_cor_config add column if not exists tela_pronto_min integer;
alter table kds_cor_config add column if not exists tela_som boolean;
