-- ============================================================
-- Vetra — Configurações Gerais do Sistema (key-value tipado)
-- ============================================================

-- ── Enum de tipos de valor ────────────────────────────────────
CREATE TYPE setting_type AS ENUM (
  'string',    -- texto livre
  'number',    -- número
  'boolean',   -- verdadeiro/falso
  'select',    -- seleção de opções predefinidas
  'json',      -- objeto JSON
  'email',     -- e-mail validado
  'url',       -- URL validada
  'phone',     -- telefone
  'secret'     -- valor sensível (exibido mascarado)
);

-- ── Tabela de configurações ───────────────────────────────────
CREATE TABLE settings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  -- Identificação
  key           VARCHAR(100) NOT NULL,
  group_name    VARCHAR(50)  NOT NULL,   -- 'company','fiscal','notifications','integrations','backup','modules'
  label         VARCHAR(200) NOT NULL,
  description   TEXT,
  -- Valor
  type          setting_type NOT NULL DEFAULT 'string',
  value         TEXT,                    -- valor atual (serializado)
  default_value TEXT,                    -- valor padrão
  options       JSONB,                   -- opções para type='select' [{"value":"br","label":"Brasil"}]
  -- Controle
  is_required   BOOLEAN DEFAULT FALSE,
  is_public     BOOLEAN DEFAULT FALSE,   -- visível para usuários não-admin
  is_system     BOOLEAN DEFAULT FALSE,   -- não pode ser excluído
  sort_order    INTEGER DEFAULT 0,
  -- Auditoria
  updated_by    UUID REFERENCES auth.users(id),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, key)
);

CREATE INDEX settings_tenant_idx    ON settings (tenant_id);
CREATE INDEX settings_group_idx     ON settings (tenant_id, group_name);
CREATE INDEX settings_key_idx       ON settings (key);

CREATE TRIGGER trg_settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY settings_tenant ON settings
  FOR ALL USING (
    tenant_id IN (
      SELECT l.tenant_id FROM licenses l
      JOIN profiles p ON p.id = auth.uid()
      WHERE l.status IN ('active','trial')
    )
  );

-- ── Função: buscar configuração por chave ─────────────────────
CREATE OR REPLACE FUNCTION get_setting(
  p_tenant_id UUID,
  p_key       VARCHAR
) RETURNS TEXT AS $$
  SELECT COALESCE(
    (SELECT value FROM settings WHERE tenant_id = p_tenant_id AND key = p_key),
    (SELECT default_value FROM settings WHERE key = p_key AND tenant_id IS NULL)
  );
$$ LANGUAGE SQL STABLE;

-- ============================================================
-- SEED: configurações padrão do sistema (tenant_id = NULL)
-- Cada tenant herda esses defaults e pode sobrescrever
-- ============================================================
INSERT INTO settings
  (tenant_id, key, group_name, label, description, type, default_value, options, is_required, is_system, sort_order)
VALUES

-- ── Grupo: Empresa ────────────────────────────────────────────
(NULL,'company_name',       'company','Razão social','Nome oficial da empresa',               'string',NULL,NULL,TRUE,TRUE,1),
(NULL,'company_trade_name', 'company','Nome fantasia','Nome de exibição no sistema',           'string',NULL,NULL,FALSE,TRUE,2),
(NULL,'company_document',   'company','CNPJ / CPF',  'Documento principal da empresa',        'string',NULL,NULL,TRUE,TRUE,3),
(NULL,'company_email',      'company','E-mail',       'E-mail principal de contato',           'email', NULL,NULL,FALSE,TRUE,4),
(NULL,'company_phone',      'company','Telefone',     'Telefone principal',                    'phone', NULL,NULL,FALSE,TRUE,5),
(NULL,'company_address',    'company','Endereço',     'Endereço completo da sede',             'string',NULL,NULL,FALSE,TRUE,6),
(NULL,'company_city',       'company','Cidade / UF',  'Cidade e estado da sede',               'string',NULL,NULL,FALSE,TRUE,7),
(NULL,'company_logo_url',   'company','URL do logotipo','Link para imagem do logotipo',       'url',   NULL,NULL,FALSE,TRUE,8),

-- ── Grupo: Regional ───────────────────────────────────────────
(NULL,'regional_timezone',   'regional','Fuso horário','Fuso horário padrão do sistema',      'select','America/Cuiaba',
  '[{"value":"America/Sao_Paulo","label":"Brasília (UTC-3)"},{"value":"America/Cuiaba","label":"Cuiabá / MT (UTC-4)"},{"value":"America/Manaus","label":"Manaus / AM (UTC-4)"},{"value":"America/Belem","label":"Belém / PA (UTC-3)"},{"value":"America/Fortaleza","label":"Fortaleza / CE (UTC-3)"}]',
  TRUE,TRUE,1),
(NULL,'regional_currency',   'regional','Moeda',       'Moeda padrão do sistema',              'select','BRL',
  '[{"value":"BRL","label":"Real Brasileiro (R$)"},{"value":"USD","label":"Dólar Americano ($)"},{"value":"EUR","label":"Euro (€)"}]',
  TRUE,TRUE,2),
(NULL,'regional_date_format','regional','Formato de data','Padrão de exibição de datas',      'select','DD/MM/YYYY',
  '[{"value":"DD/MM/YYYY","label":"DD/MM/AAAA (padrão Brasil)"},{"value":"YYYY-MM-DD","label":"AAAA-MM-DD (ISO)"},{"value":"MM/DD/YYYY","label":"MM/DD/AAAA (US)"}]',
  TRUE,TRUE,3),
(NULL,'regional_number_format','regional','Formato numérico','Separadores de milhar e decimal','select','pt-BR',
  '[{"value":"pt-BR","label":"1.234,56 (padrão Brasil)"},{"value":"en-US","label":"1,234.56 (US)"}]',
  TRUE,TRUE,4),
(NULL,'regional_language',   'regional','Idioma',      'Idioma padrão da interface',           'select','pt-BR',
  '[{"value":"pt-BR","label":"Português (Brasil)"},{"value":"en-US","label":"English (US)"}]',
  TRUE,TRUE,5),

-- ── Grupo: Fiscal ─────────────────────────────────────────────
(NULL,'fiscal_tax_regime',   'fiscal','Regime tributário','Regime fiscal da empresa',          'select',NULL,
  '[{"value":"simples","label":"Simples Nacional"},{"value":"lucro_presumido","label":"Lucro Presumido"},{"value":"lucro_real","label":"Lucro Real"},{"value":"mei","label":"MEI"}]',
  TRUE,TRUE,1),
(NULL,'fiscal_nfe_env',      'fiscal','Ambiente NF-e', 'Ambiente de emissão de NF-e',          'select','homologacao',
  '[{"value":"homologacao","label":"Homologação (testes)"},{"value":"producao","label":"Produção"}]',
  TRUE,TRUE,2),
(NULL,'fiscal_nfe_series',   'fiscal','Série NF-e',    'Série padrão para emissão de NF-e',   'number','1',NULL,TRUE,TRUE,3),
(NULL,'fiscal_nfe_number',   'fiscal','Próx. nº NF-e', 'Próximo número a ser emitido',         'number','1',NULL,TRUE,TRUE,4),
(NULL,'fiscal_cert_valid',   'fiscal','Validade cert. digital','Data de validade do certificado A1','string',NULL,NULL,FALSE,TRUE,5),
(NULL,'fiscal_state_reg',    'fiscal','Inscrição Estadual','IE da empresa',                   'string',NULL,NULL,FALSE,TRUE,6),
(NULL,'fiscal_municipal_reg','fiscal','Inscrição Municipal','IM da empresa',                  'string',NULL,NULL,FALSE,TRUE,7),

-- ── Grupo: Notificações ───────────────────────────────────────
(NULL,'notif_email_enabled',  'notifications','E-mail ativo',   'Habilitar envio de e-mails',  'boolean','true',NULL,FALSE,FALSE,1),
(NULL,'notif_email_sender',   'notifications','E-mail remetente','E-mail de envio das notificações','email',NULL,NULL,FALSE,FALSE,2),
(NULL,'notif_email_smtp',     'notifications','Servidor SMTP',  'Host do servidor SMTP',        'string',NULL,NULL,FALSE,FALSE,3),
(NULL,'notif_email_port',     'notifications','Porta SMTP',     'Porta do servidor SMTP',       'number','587',NULL,FALSE,FALSE,4),
(NULL,'notif_email_user',     'notifications','Usuário SMTP',   'Login do servidor SMTP',       'string',NULL,NULL,FALSE,FALSE,5),
(NULL,'notif_email_pass',     'notifications','Senha SMTP',     'Senha do servidor SMTP',       'secret',NULL,NULL,FALSE,FALSE,6),
(NULL,'notif_license_alert',  'notifications','Alerta licença', 'Dias antes do vencimento para alertar','number','30',NULL,FALSE,FALSE,7),
(NULL,'notif_stock_alert',    'notifications','Alerta estoque', 'Enviar e-mail em estoque mínimo','boolean','true',NULL,FALSE,FALSE,8),
(NULL,'notif_approval_alert', 'notifications','Alerta aprovação','Notificar aprovadores pendentes','boolean','true',NULL,FALSE,FALSE,9),

-- ── Grupo: Integrações ────────────────────────────────────────
(NULL,'int_maps_provider',    'integrations','Provedor de mapas','Serviço de tiles para mapas', 'select','maptiler',
  '[{"value":"maptiler","label":"MapTiler (gratuito 100k/mês)"},{"value":"mapbox","label":"Mapbox"},{"value":"google","label":"Google Maps"}]',
  FALSE,FALSE,1),
(NULL,'int_maps_key',         'integrations','Chave API mapas','Chave de autenticação do mapa','secret',NULL,NULL,FALSE,FALSE,2),
(NULL,'int_weather_key',      'integrations','Chave API clima','Chave OpenWeatherMap',          'secret',NULL,NULL,FALSE,FALSE,3),
(NULL,'int_sentinel_key',     'integrations','Chave Sentinel Hub','Chave para imagens de satélite NDVI','secret',NULL,NULL,FALSE,FALSE,4),
(NULL,'int_bi_tool',          'integrations','Ferramenta BI',  'Ferramenta de BI integrada',    'select','superset',
  '[{"value":"superset","label":"Apache Superset"},{"value":"metabase","label":"Metabase"},{"value":"none","label":"Nenhuma"}]',
  FALSE,FALSE,5),
(NULL,'int_bi_url',           'integrations','URL do BI',      'URL base da instância de BI',   'url',   NULL,NULL,FALSE,FALSE,6),
(NULL,'int_storage_provider', 'integrations','Armazenamento',  'Provedor de arquivos/uploads',  'select','supabase',
  '[{"value":"supabase","label":"Supabase Storage"},{"value":"s3","label":"AWS S3"},{"value":"r2","label":"Cloudflare R2"}]',
  FALSE,FALSE,7),

-- ── Grupo: Backup ─────────────────────────────────────────────
(NULL,'backup_enabled',       'backup','Backup automático','Habilitar backup periódico',        'boolean','true',NULL,FALSE,FALSE,1),
(NULL,'backup_frequency',     'backup','Frequência',       'Periodicidade do backup',           'select','daily',
  '[{"value":"hourly","label":"A cada hora"},{"value":"daily","label":"Diário"},{"value":"weekly","label":"Semanal"}]',
  FALSE,FALSE,2),
(NULL,'backup_retention_days','backup','Retenção (dias)', 'Dias que os backups serão mantidos', 'number','30',NULL,FALSE,FALSE,3),
(NULL,'backup_storage_path',  'backup','Destino do backup','Bucket ou caminho de destino',      'string',NULL,NULL,FALSE,FALSE,4),
(NULL,'backup_last_run',      'backup','Último backup',   'Data/hora do último backup',         'string',NULL,NULL,FALSE,TRUE,5),

-- ── Grupo: Parâmetros por módulo ──────────────────────────────
(NULL,'mod_farm_ha_unit',       'modules','Unidade de área',      'Unidade padrão para hectares',       'select','ha',
  '[{"value":"ha","label":"Hectare (ha)"},{"value":"alq","label":"Alqueire"},{"value":"ac","label":"Acre"}]',FALSE,FALSE,1),
(NULL,'mod_farm_prod_unit',     'modules','Unidade de produção',  'Unidade padrão para produção',       'select','sc60',
  '[{"value":"sc60","label":"Saca 60kg"},{"value":"ton","label":"Tonelada"},{"value":"kg","label":"Kg"}]',FALSE,FALSE,2),
(NULL,'mod_financial_approval', 'modules','Limite aprovação financ.','Valor máximo sem aprovação (R$)', 'number','5000',NULL,FALSE,FALSE,3),
(NULL,'mod_purchase_approval',  'modules','Limite aprovação compras','Valor máximo sem aprovação (R$)', 'number','2000',NULL,FALSE,FALSE,4),
(NULL,'mod_stock_auto_alert',   'modules','Alerta automático estoque','Alertar estoque mínimo automaticamente','boolean','true',NULL,FALSE,FALSE,5),
(NULL,'mod_invoice_auto_send',  'modules','Envio automático NF-e', 'Enviar NF-e por e-mail automaticamente','boolean','false',NULL,FALSE,FALSE,6),
(NULL,'mod_field_book_sign',    'modules','Assinatura caderno campo','Exigir assinatura no caderno digital','boolean','true',NULL,FALSE,FALSE,7);
