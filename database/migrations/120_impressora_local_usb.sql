-- Impressora local (USB / instalada no Windows do PDV), além da de rede (IP:porta).
-- `conexao`='local' → o worker do edge imprime ESC/POS cru na impressora do Windows
-- pelo nome (`dispositivo`), via spooler; 'rede' mantém o TCP RAW 9100. Aditivo.
alter table equipamento add column if not exists conexao text not null default 'rede'; -- 'rede' | 'local'
alter table equipamento add column if not exists dispositivo text; -- nome da impressora no Windows (conexao='local')
