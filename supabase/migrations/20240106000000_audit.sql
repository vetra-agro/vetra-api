-- ============================================================
-- Vetra — Auditoria de Acessos e Logs de Sistema
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────
CREATE TYPE audit_event_type AS ENUM (
  -- Acessos
  'login_success',
  'login_failed',
  'logout',
  'password_reset',
  'token_refresh',
  -- Operações CRUD
  'record_created',
  'record_updated',
  'record_deleted',
  'record_viewed',
  -- Operações de negócio
  'approved',
  'rejected',
  'exported',
  'printed',
  'imported',
  -- Sistema
  'module_activated',
  'module_deactivated',
  'license_changed',
  'permission_changed',
  'settings_changed'
);

-- ── Tabela principal de auditoria ────────────────────────────
CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Quem
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name     VARCHAR(200),        -- snapshot do nome no momento
  user_email    VARCHAR(200),        -- snapshot do email
  user_role     VARCHAR(50),         -- snapshot do perfil
  tenant_id     UUID REFERENCES tenants(id) ON DELETE SET NULL,
  -- O quê
  event_type    audit_event_type NOT NULL,
  module        VARCHAR(50),         -- ex: 'farm', 'financial', 'admin'
  entity        VARCHAR(100),        -- ex: 'farms', 'transactions', 'users'
  entity_id     UUID,                -- ID do registro afetado
  entity_label  VARCHAR(300),        -- descrição legível ex: 'Fazenda Santa Fé'
  -- Detalhes
  description   TEXT NOT NULL,       -- texto legível do evento
  old_values    JSONB,               -- valores anteriores (para updates)
  new_values    JSONB,               -- valores novos
  metadata      JSONB,               -- dados extras (filtros, parâmetros)
  -- Contexto técnico
  ip_address    INET,
  user_agent    TEXT,
  request_id    UUID,                -- correlação de requisições
  -- Status
  success       BOOLEAN NOT NULL DEFAULT TRUE,
  error_message TEXT,
  -- Tempo
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Índices para performance de consulta ─────────────────────
CREATE INDEX audit_user_idx      ON audit_logs (user_id);
CREATE INDEX audit_tenant_idx    ON audit_logs (tenant_id);
CREATE INDEX audit_event_idx     ON audit_logs (event_type);
CREATE INDEX audit_module_idx    ON audit_logs (module);
CREATE INDEX audit_entity_idx    ON audit_logs (entity, entity_id);
CREATE INDEX audit_created_idx   ON audit_logs (created_at DESC);
CREATE INDEX audit_success_idx   ON audit_logs (success);

-- Índice composto para filtros mais comuns
CREATE INDEX audit_combined_idx  ON audit_logs (tenant_id, module, created_at DESC);

-- ── Particionamento por mês (opcional — habilitar em produção)
-- Para volumes altos, particionar por created_at melhora performance
-- CREATE TABLE audit_logs_2024_01 PARTITION OF audit_logs
--   FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
-- Somente service_role acessa — leitura via API admin

-- ── View: acessos recentes (últimas 24h) ──────────────────────
CREATE VIEW recent_access_logs AS
SELECT
  id, user_id, user_name, user_email, user_role,
  tenant_id, event_type, description,
  ip_address, user_agent, success, error_message,
  created_at
FROM audit_logs
WHERE event_type IN ('login_success','login_failed','logout','password_reset','token_refresh')
  AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- ── View: operações críticas recentes ─────────────────────────
CREATE VIEW recent_critical_logs AS
SELECT *
FROM audit_logs
WHERE event_type IN (
  'record_deleted','permission_changed','license_changed',
  'module_activated','module_deactivated','settings_changed'
)
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- ── View: resumo de atividade por usuário (últimos 30 dias) ───
CREATE VIEW user_activity_summary AS
SELECT
  user_id,
  user_name,
  user_email,
  user_role,
  tenant_id,
  COUNT(*)                                        AS total_events,
  COUNT(*) FILTER (WHERE success = TRUE)          AS success_count,
  COUNT(*) FILTER (WHERE success = FALSE)         AS error_count,
  COUNT(*) FILTER (WHERE event_type = 'login_success') AS login_count,
  MAX(created_at)                                 AS last_activity,
  MIN(created_at)                                 AS first_activity
FROM audit_logs
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND user_id IS NOT NULL
GROUP BY user_id, user_name, user_email, user_role, tenant_id
ORDER BY last_activity DESC;

-- ── Função: registrar evento de auditoria ─────────────────────
-- Chamada pela API NestJS em cada operação relevante
CREATE OR REPLACE FUNCTION log_audit_event(
  p_user_id     UUID,
  p_user_name   VARCHAR,
  p_user_email  VARCHAR,
  p_user_role   VARCHAR,
  p_tenant_id   UUID,
  p_event_type  audit_event_type,
  p_module      VARCHAR,
  p_entity      VARCHAR,
  p_entity_id   UUID,
  p_entity_label VARCHAR,
  p_description TEXT,
  p_old_values  JSONB DEFAULT NULL,
  p_new_values  JSONB DEFAULT NULL,
  p_metadata    JSONB DEFAULT NULL,
  p_ip_address  INET  DEFAULT NULL,
  p_success     BOOLEAN DEFAULT TRUE,
  p_error_msg   TEXT  DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO audit_logs (
    user_id, user_name, user_email, user_role,
    tenant_id, event_type, module, entity, entity_id,
    entity_label, description, old_values, new_values,
    metadata, ip_address, success, error_message
  ) VALUES (
    p_user_id, p_user_name, p_user_email, p_user_role,
    p_tenant_id, p_event_type, p_module, p_entity, p_entity_id,
    p_entity_label, p_description, p_old_values, p_new_values,
    p_metadata, p_ip_address, p_success, p_error_msg
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Trigger genérico de auditoria para tabelas críticas ───────
-- Exemplo: aplicar em farms, transactions, profiles, etc.
CREATE OR REPLACE FUNCTION audit_table_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_event    audit_event_type;
  v_old_vals JSONB := NULL;
  v_new_vals JSONB := NULL;
  v_desc     TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event    := 'record_created';
    v_new_vals := to_jsonb(NEW);
    v_desc     := format('Registro criado em %s', TG_TABLE_NAME);
  ELSIF TG_OP = 'UPDATE' THEN
    v_event    := 'record_updated';
    v_old_vals := to_jsonb(OLD);
    v_new_vals := to_jsonb(NEW);
    v_desc     := format('Registro atualizado em %s', TG_TABLE_NAME);
  ELSIF TG_OP = 'DELETE' THEN
    v_event    := 'record_deleted';
    v_old_vals := to_jsonb(OLD);
    v_desc     := format('Registro removido de %s', TG_TABLE_NAME);
  END IF;

  INSERT INTO audit_logs (
    event_type, module, entity, description,
    old_values, new_values, success
  ) VALUES (
    v_event, TG_TABLE_NAME, TG_TABLE_NAME, v_desc,
    v_old_vals, v_new_vals, TRUE
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Aplicar trigger nas tabelas críticas ──────────────────────
CREATE TRIGGER audit_farms_changes
  AFTER INSERT OR UPDATE OR DELETE ON farms
  FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

CREATE TRIGGER audit_profiles_changes
  AFTER INSERT OR UPDATE OR DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

CREATE TRIGGER audit_licenses_changes
  AFTER INSERT OR UPDATE OR DELETE ON licenses
  FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

CREATE TRIGGER audit_acl_changes
  AFTER INSERT OR UPDATE OR DELETE ON acl_permissions
  FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

-- ── Política de retenção (executar via cron/pg_cron) ──────────
-- DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '2 years';
