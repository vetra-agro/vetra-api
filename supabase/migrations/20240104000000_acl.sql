-- ============================================================
-- Vetra — Perfis de Acesso (ACL) — permissões por ação
-- Executar após a migration de menus (20240103000000)
-- ============================================================

-- ── Enum de ações disponíveis ────────────────────────────────
CREATE TYPE acl_action AS ENUM (
  'view',     -- visualizar registros
  'create',   -- criar novos registros
  'edit',     -- editar registros existentes
  'delete',   -- excluir registros
  'export',   -- exportar dados (PDF, Excel, CSV)
  'approve',  -- aprovar fluxos (compras, pedidos, OS)
  'print',    -- imprimir documentos
  'admin'     -- acesso administrativo ao módulo (configurações)
);

-- ── Tabela de permissões por perfil e módulo ─────────────────
CREATE TABLE acl_permissions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role        user_role  NOT NULL,
  module_key  VARCHAR(50) NOT NULL,   -- chave do módulo (ex: 'financial')
  action      acl_action NOT NULL,
  allowed     BOOLEAN    NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  UUID REFERENCES auth.users(id),
  UNIQUE (role, module_key, action)
);

CREATE INDEX acl_role_idx       ON acl_permissions (role);
CREATE INDEX acl_module_idx     ON acl_permissions (module_key);
CREATE INDEX acl_role_module_idx ON acl_permissions (role, module_key);

-- Trigger updated_at
CREATE TRIGGER trg_acl_updated_at
  BEFORE UPDATE ON acl_permissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS (somente service_role acessa — gerido pela API admin)
ALTER TABLE acl_permissions ENABLE ROW LEVEL SECURITY;

-- ── View: matriz completa de permissões ──────────────────────
-- Útil para a tela de ACL e para verificações na API
CREATE VIEW acl_matrix AS
SELECT
  role,
  module_key,
  BOOL_OR(CASE WHEN action = 'view'    THEN allowed ELSE FALSE END) AS can_view,
  BOOL_OR(CASE WHEN action = 'create'  THEN allowed ELSE FALSE END) AS can_create,
  BOOL_OR(CASE WHEN action = 'edit'    THEN allowed ELSE FALSE END) AS can_edit,
  BOOL_OR(CASE WHEN action = 'delete'  THEN allowed ELSE FALSE END) AS can_delete,
  BOOL_OR(CASE WHEN action = 'export'  THEN allowed ELSE FALSE END) AS can_export,
  BOOL_OR(CASE WHEN action = 'approve' THEN allowed ELSE FALSE END) AS can_approve,
  BOOL_OR(CASE WHEN action = 'print'   THEN allowed ELSE FALSE END) AS can_print,
  BOOL_OR(CASE WHEN action = 'admin'   THEN allowed ELSE FALSE END) AS can_admin
FROM acl_permissions
GROUP BY role, module_key
ORDER BY role, module_key;

-- ── Função helper para verificar permissão ───────────────────
CREATE OR REPLACE FUNCTION check_acl(
  p_role      user_role,
  p_module    VARCHAR,
  p_action    acl_action
) RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT allowed FROM acl_permissions
     WHERE role = p_role AND module_key = p_module AND action = p_action),
    FALSE
  );
$$ LANGUAGE SQL STABLE;

-- ============================================================
-- SEED: permissões padrão por perfil
-- ============================================================

-- Módulos disponíveis
DO $$
DECLARE
  modules TEXT[] := ARRAY[
    'admin','farm','financial','accounting','purchasing',
    'sales','logistics','fiscal','maintenance','inventory',
    'production','services','analytics'
  ];
  actions acl_action[] := ARRAY[
    'view','create','edit','delete','export','approve','print','admin'
  ]::acl_action[];
  m TEXT;
  a acl_action;
BEGIN

-- ── owner: acesso total a tudo ───────────────────────────────
FOREACH m IN ARRAY modules LOOP
  FOREACH a IN ARRAY actions LOOP
    INSERT INTO acl_permissions (role, module_key, action, allowed)
    VALUES ('owner', m, a, TRUE)
    ON CONFLICT (role, module_key, action) DO UPDATE SET allowed = TRUE;
  END LOOP;
END LOOP;

-- ── manager: tudo exceto admin do sistema ────────────────────
FOREACH m IN ARRAY modules LOOP
  FOREACH a IN ARRAY actions LOOP
    INSERT INTO acl_permissions (role, module_key, action, allowed)
    VALUES ('manager', m, a,
      CASE WHEN m = 'admin' AND a = 'admin' THEN FALSE ELSE TRUE END
    )
    ON CONFLICT (role, module_key, action) DO UPDATE SET allowed =
      CASE WHEN m = 'admin' AND a = 'admin' THEN FALSE ELSE TRUE END;
  END LOOP;
END LOOP;

-- ── agronomist: fazenda completa, outros só view/print/export
FOREACH m IN ARRAY modules LOOP
  FOREACH a IN ARRAY actions LOOP
    INSERT INTO acl_permissions (role, module_key, action, allowed)
    VALUES ('agronomist', m, a,
      CASE
        WHEN m IN ('farm','inventory','production','maintenance')
          THEN a IN ('view','create','edit','export','print')
        WHEN m = 'analytics'
          THEN a IN ('view','export','print')
        ELSE a = 'view'
      END
    )
    ON CONFLICT (role, module_key, action) DO UPDATE SET allowed =
      CASE
        WHEN m IN ('farm','inventory','production','maintenance')
          THEN a IN ('view','create','edit','export','print')
        WHEN m = 'analytics'
          THEN a IN ('view','export','print')
        ELSE a = 'view'
      END;
  END LOOP;
END LOOP;

-- ── accountant: financeiro/contábil/fiscal completo, outros view
FOREACH m IN ARRAY modules LOOP
  FOREACH a IN ARRAY actions LOOP
    INSERT INTO acl_permissions (role, module_key, action, allowed)
    VALUES ('accountant', m, a,
      CASE
        WHEN m IN ('financial','accounting','fiscal')
          THEN a IN ('view','create','edit','export','print','approve')
        WHEN m = 'analytics'
          THEN a IN ('view','export','print')
        ELSE a = 'view'
      END
    )
    ON CONFLICT (role, module_key, action) DO UPDATE SET allowed =
      CASE
        WHEN m IN ('financial','accounting','fiscal')
          THEN a IN ('view','create','edit','export','print','approve')
        WHEN m = 'analytics'
          THEN a IN ('view','export','print')
        ELSE a = 'view'
      END;
  END LOOP;
END LOOP;

-- ── operator: apenas view+create em fazenda/inventário/manutenção
FOREACH m IN ARRAY modules LOOP
  FOREACH a IN ARRAY actions LOOP
    INSERT INTO acl_permissions (role, module_key, action, allowed)
    VALUES ('operator', m, a,
      CASE
        WHEN m IN ('farm','inventory','maintenance')
          THEN a IN ('view','create')
        ELSE FALSE
      END
    )
    ON CONFLICT (role, module_key, action) DO UPDATE SET allowed =
      CASE
        WHEN m IN ('farm','inventory','maintenance')
          THEN a IN ('view','create')
        ELSE FALSE
      END;
  END LOOP;
END LOOP;

-- ── viewer: somente view em farm e analytics
FOREACH m IN ARRAY modules LOOP
  FOREACH a IN ARRAY actions LOOP
    INSERT INTO acl_permissions (role, module_key, action, allowed)
    VALUES ('viewer', m, a,
      CASE
        WHEN m IN ('farm','analytics') THEN a = 'view'
        ELSE FALSE
      END
    )
    ON CONFLICT (role, module_key, action) DO UPDATE SET allowed =
      CASE
        WHEN m IN ('farm','analytics') THEN a = 'view'
        ELSE FALSE
      END;
  END LOOP;
END LOOP;

END $$;
