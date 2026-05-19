-- ============================================================
-- Vetra — Módulo de Manutenção
-- Planos, agendamentos, OS, checklists e histórico por ativo
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE maintenance_type AS ENUM (
    'preventive',   -- manutenção preventiva (plano)
    'corrective',   -- manutenção corretiva (quebra)
    'predictive',   -- manutenção preditiva (monitoramento)
    'inspection'    -- inspeção / checklist
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE os_status AS ENUM (
    'open',         -- OS aberta
    'assigned',     -- atribuída a técnico
    'in_progress',  -- em execução
    'waiting_part', -- aguardando peça
    'done',         -- concluída
    'cancelled'     -- cancelada
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE schedule_status AS ENUM (
    'scheduled',    -- agendado
    'confirmed',    -- confirmado
    'done',         -- realizado
    'overdue',      -- vencido
    'cancelled'     -- cancelado
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE priority_level AS ENUM (
    'low', 'medium', 'high', 'critical'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Plano de Manutenção Preventiva ────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_plans (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  farm_id         UUID REFERENCES farms(id)              ON DELETE SET NULL,
  machinery_id    UUID REFERENCES machinery(id)          ON DELETE SET NULL,

  name            VARCHAR(300) NOT NULL,
  description     TEXT,
  maintenance_type maintenance_type NOT NULL DEFAULT 'preventive',
  priority        priority_level   NOT NULL DEFAULT 'medium',

  -- Frequência
  frequency_type  VARCHAR(20) NOT NULL DEFAULT 'calendar',
  -- calendar: dias corridos | hours: horas de uso | km: quilometragem
  frequency_value INTEGER NOT NULL DEFAULT 30,
  -- ex: a cada 30 dias, a cada 250 horas, a cada 1000 km

  -- Estimativa de custo e tempo
  estimated_hours NUMERIC(8,2),
  estimated_cost  NUMERIC(14,2),

  -- Responsável e fornecedor
  responsible     VARCHAR(200),
  supplier_id     UUID REFERENCES partners(id) ON DELETE SET NULL,

  -- Checklist padrão para este plano (JSONB)
  -- [{ item, required, category }]
  checklist_template JSONB DEFAULT '[]',

  active          BOOLEAN DEFAULT TRUE,
  notes           TEXT,
  tags            TEXT[] DEFAULT '{}',

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mp_tenant_idx   ON maintenance_plans (tenant_id);
CREATE INDEX IF NOT EXISTS mp_machine_idx  ON maintenance_plans (machinery_id);
CREATE INDEX IF NOT EXISTS mp_farm_idx     ON maintenance_plans (farm_id);

CREATE OR REPLACE TRIGGER trg_mp_updated_at
  BEFORE UPDATE ON maintenance_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE maintenance_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mp_rls ON maintenance_plans;
CREATE POLICY mp_rls ON maintenance_plans FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Agendamento de Serviço ────────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_schedules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)          ON DELETE CASCADE,
  plan_id         UUID REFERENCES maintenance_plans(id)         ON DELETE SET NULL,
  machinery_id    UUID REFERENCES machinery(id)                 ON DELETE SET NULL,
  farm_id         UUID REFERENCES farms(id)                     ON DELETE SET NULL,
  supplier_id     UUID REFERENCES partners(id)                  ON DELETE SET NULL,

  title           VARCHAR(300) NOT NULL,
  maintenance_type maintenance_type NOT NULL DEFAULT 'preventive',
  priority        priority_level   NOT NULL DEFAULT 'medium',
  status          schedule_status  NOT NULL DEFAULT 'scheduled',

  scheduled_date  DATE NOT NULL,
  scheduled_time  TIME,
  estimated_hours NUMERIC(8,2),
  responsible     VARCHAR(200),

  -- Leitura do hodômetro / horímetro no agendamento
  meter_reading   NUMERIC(12,2),
  meter_unit      VARCHAR(10) DEFAULT 'h',  -- h (horas), km

  notes           TEXT,
  completed_at    TIMESTAMPTZ,
  completed_by    VARCHAR(200),
  completion_notes TEXT,

  -- OS gerada a partir deste agendamento
  work_order_id   UUID,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ms_tenant_idx  ON maintenance_schedules (tenant_id);
CREATE INDEX IF NOT EXISTS ms_machine_idx ON maintenance_schedules (machinery_id);
CREATE INDEX IF NOT EXISTS ms_date_idx    ON maintenance_schedules (tenant_id, scheduled_date);
CREATE INDEX IF NOT EXISTS ms_status_idx  ON maintenance_schedules (tenant_id, status);

CREATE OR REPLACE TRIGGER trg_ms_updated_at
  BEFORE UPDATE ON maintenance_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Marca automaticamente como overdue
CREATE OR REPLACE FUNCTION check_schedule_overdue()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE maintenance_schedules
  SET status = 'overdue'
  WHERE status = 'scheduled'
    AND scheduled_date < CURRENT_DATE;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE maintenance_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ms_rls ON maintenance_schedules;
CREATE POLICY ms_rls ON maintenance_schedules FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Ordem de Serviço (OS) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)          ON DELETE CASCADE,
  schedule_id     UUID REFERENCES maintenance_schedules(id)     ON DELETE SET NULL,
  machinery_id    UUID REFERENCES machinery(id)                 ON DELETE SET NULL,
  farm_id         UUID REFERENCES farms(id)                     ON DELETE SET NULL,
  supplier_id     UUID REFERENCES partners(id)                  ON DELETE SET NULL,
  cost_center_id  UUID REFERENCES cost_centers(id)             ON DELETE SET NULL,

  os_number       VARCHAR(30),
  title           VARCHAR(300) NOT NULL,
  description     TEXT,
  maintenance_type maintenance_type NOT NULL DEFAULT 'corrective',
  priority        priority_level   NOT NULL DEFAULT 'medium',
  status          os_status        NOT NULL DEFAULT 'open',

  -- Datas
  opened_at       DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date        DATE,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,

  -- Técnico
  assigned_to     VARCHAR(200),
  phone           VARCHAR(30),

  -- Problema / solução
  problem_desc    TEXT,
  solution_desc   TEXT,
  root_cause      TEXT,

  -- Leituras
  meter_reading_start NUMERIC(12,2),
  meter_reading_end   NUMERIC(12,2),
  meter_unit          VARCHAR(10) DEFAULT 'h',

  -- Peças e custos (JSONB)
  -- [{ part_name, part_code, qty, unit_cost, total }]
  parts           JSONB DEFAULT '[]',

  -- Custos
  parts_cost      NUMERIC(14,2) DEFAULT 0,
  labor_cost      NUMERIC(14,2) DEFAULT 0,
  other_cost      NUMERIC(14,2) DEFAULT 0,
  total_cost      NUMERIC(14,2) DEFAULT 0,

  -- Horas trabalhadas
  labor_hours     NUMERIC(8,2),

  -- Fotos / evidências
  attachments     TEXT[] DEFAULT '{}',

  notes           TEXT,
  tags            TEXT[] DEFAULT '{}',

  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wo_tenant_idx  ON work_orders (tenant_id);
CREATE INDEX IF NOT EXISTS wo_machine_idx ON work_orders (machinery_id);
CREATE INDEX IF NOT EXISTS wo_status_idx  ON work_orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS wo_date_idx    ON work_orders (tenant_id, opened_at DESC);

-- Trigger: recalcula total_cost
CREATE OR REPLACE FUNCTION calc_wo_total_cost()
RETURNS TRIGGER AS $$
BEGIN
  NEW.parts_cost := COALESCE(
    (SELECT SUM((p->>'total')::NUMERIC)
     FROM jsonb_array_elements(NEW.parts) p), 0);
  NEW.total_cost := COALESCE(NEW.parts_cost, 0)
                  + COALESCE(NEW.labor_cost, 0)
                  + COALESCE(NEW.other_cost, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wo_cost ON work_orders;
CREATE TRIGGER trg_wo_cost
  BEFORE INSERT OR UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION calc_wo_total_cost();

CREATE OR REPLACE TRIGGER trg_wo_updated_at
  BEFORE UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wo_rls ON work_orders;
CREATE POLICY wo_rls ON work_orders FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Checklist de Inspeção ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS inspection_checklists (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  machinery_id    UUID REFERENCES machinery(id)           ON DELETE SET NULL,
  farm_id         UUID REFERENCES farms(id)               ON DELETE SET NULL,
  work_order_id   UUID REFERENCES work_orders(id)        ON DELETE SET NULL,
  plan_id         UUID REFERENCES maintenance_plans(id)   ON DELETE SET NULL,

  title           VARCHAR(300) NOT NULL,
  inspected_at    DATE NOT NULL DEFAULT CURRENT_DATE,
  inspector       VARCHAR(200) NOT NULL,
  meter_reading   NUMERIC(12,2),
  meter_unit      VARCHAR(10) DEFAULT 'h',

  -- Itens do checklist
  -- [{ category, item, status: ok|nok|na, notes, photo_url }]
  items           JSONB NOT NULL DEFAULT '[]',

  -- Resultado geral
  overall_result  VARCHAR(20) DEFAULT 'ok',  -- ok, nok, partial
  critical_issues INTEGER DEFAULT 0,
  notes           TEXT,
  signature_url   TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ic_tenant_idx  ON inspection_checklists (tenant_id);
CREATE INDEX IF NOT EXISTS ic_machine_idx ON inspection_checklists (machinery_id);
CREATE INDEX IF NOT EXISTS ic_date_idx    ON inspection_checklists (tenant_id, inspected_at DESC);

-- Trigger: conta issues críticos
CREATE OR REPLACE FUNCTION calc_checklist_issues()
RETURNS TRIGGER AS $$
BEGIN
  NEW.critical_issues := COALESCE(
    (SELECT COUNT(*) FROM jsonb_array_elements(NEW.items) i
     WHERE i->>'status' = 'nok'), 0);
  NEW.overall_result := CASE
    WHEN NEW.critical_issues = 0 THEN 'ok'
    WHEN NEW.critical_issues <= 2 THEN 'partial'
    ELSE 'nok'
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ic_issues ON inspection_checklists;
CREATE TRIGGER trg_ic_issues
  BEFORE INSERT OR UPDATE ON inspection_checklists
  FOR EACH ROW EXECUTE FUNCTION calc_checklist_issues();

CREATE OR REPLACE TRIGGER trg_ic_updated_at
  BEFORE UPDATE ON inspection_checklists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE inspection_checklists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ic_rls ON inspection_checklists;
CREATE POLICY ic_rls ON inspection_checklists FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── View: histórico consolidado por ativo ─────────────────────
DROP VIEW IF EXISTS maintenance_history_view;
CREATE VIEW maintenance_history_view AS
SELECT
  wo.id,
  wo.tenant_id,
  wo.machinery_id,
  m.name                    AS machinery_name,
  m.model                   AS machinery_model,
  m.plate                   AS machinery_plate,
  wo.farm_id,
  f.name                    AS farm_name,
  wo.os_number,
  wo.title,
  wo.maintenance_type,
  wo.priority,
  wo.status,
  wo.opened_at,
  wo.completed_at,
  EXTRACT(DAY FROM wo.completed_at - wo.opened_at::TIMESTAMPTZ)::INTEGER
                            AS days_to_complete,
  wo.assigned_to,
  wo.parts_cost,
  wo.labor_cost,
  wo.other_cost,
  wo.total_cost,
  wo.labor_hours,
  wo.meter_reading_start,
  wo.meter_reading_end,
  wo.meter_unit,
  wo.problem_desc,
  wo.solution_desc,
  p.name                    AS supplier_name,
  'work_order'              AS record_type
FROM work_orders wo
LEFT JOIN machinery m ON m.id = wo.machinery_id
LEFT JOIN farms     f ON f.id = wo.farm_id
LEFT JOIN partners  p ON p.id = wo.supplier_id

UNION ALL

SELECT
  ic.id,
  ic.tenant_id,
  ic.machinery_id,
  m.name,
  m.model,
  m.plate,
  ic.farm_id,
  f.name,
  NULL,                     -- os_number
  ic.title,
  'inspection',
  'low',
  ic.overall_result,
  ic.inspected_at,
  NULL,                     -- completed_at
  NULL,                     -- days_to_complete
  ic.inspector,
  0, 0, 0, 0,              -- costs
  NULL,                     -- labor_hours
  ic.meter_reading, NULL, ic.meter_unit,
  NULL, NULL,               -- problem/solution
  NULL,
  'inspection'
FROM inspection_checklists ic
LEFT JOIN machinery m ON m.id = ic.machinery_id
LEFT JOIN farms     f ON f.id = ic.farm_id

ORDER BY opened_at DESC NULLS LAST;

-- ── View: KPIs de manutenção ──────────────────────────────────
DROP VIEW IF EXISTS maintenance_kpis;
CREATE VIEW maintenance_kpis AS
SELECT
  wo.tenant_id,
  COUNT(*) FILTER (WHERE wo.status = 'open')                  AS os_open,
  COUNT(*) FILTER (WHERE wo.status = 'in_progress')           AS os_in_progress,
  COUNT(*) FILTER (WHERE wo.status = 'waiting_part')          AS os_waiting_part,
  COUNT(*) FILTER (WHERE wo.priority = 'critical'
    AND wo.status NOT IN ('done','cancelled'))                  AS os_critical,
  COUNT(*) FILTER (WHERE wo.status = 'done'
    AND wo.completed_at >= NOW() - INTERVAL '30 days')         AS os_done_month,
  SUM(wo.total_cost) FILTER (WHERE wo.status = 'done'
    AND wo.completed_at >= NOW() - INTERVAL '30 days')         AS cost_month,
  COUNT(*) FILTER (WHERE wo.due_date < CURRENT_DATE
    AND wo.status NOT IN ('done','cancelled'))                  AS os_overdue,
  AVG(EXTRACT(DAY FROM wo.completed_at - wo.opened_at::TIMESTAMPTZ))
    FILTER (WHERE wo.status = 'done')                          AS avg_days_to_complete
FROM work_orders wo
GROUP BY wo.tenant_id;
