-- 180_impressora_linguagem_etiqueta.sql — modelo/linguagem da impressora de etiqueta.
-- Cada loja pode usar uma etiquetadora diferente. A impressão RAW precisa falar a
-- linguagem certa: 'escpos' (térmica de bobina 58/80mm, padrão), 'zpl' (Zebra e
-- compatíveis: Elgin L42, Argox…) ou 'epl' (EPL2/PPLB). O tamanho da etiqueta vem
-- do modelo (etiqueta_template.tamanho) e é aplicado nas etiquetadoras ZPL/EPL.
--
-- NÃO é @cloud-only: `equipamento` existe no edge e o worker de impressão lê isto.
alter table equipamento add column if not exists linguagem_etiqueta text not null default 'escpos';
