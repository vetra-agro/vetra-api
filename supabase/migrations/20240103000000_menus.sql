-- ============================================================
-- Vetra — Catálogo de menus, ACL por perfil e licença
-- ============================================================

-- ── Enum de perfis (deve existir — criado na migration de profiles)
-- CREATE TYPE user_role AS ENUM (...)  <-- já existe

-- ── Tabela de módulos (nível 1 — ex: Fazenda, Financeiro)
CREATE TABLE menu_modules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         VARCHAR(50)  NOT NULL UNIQUE,  -- ex: 'farm', 'financial'
  label       VARCHAR(100) NOT NULL,
  icon        VARCHAR(50),                   -- nome do ícone lucide
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE, -- ativado pela licença
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tabela de itens de menu (nível 2 — submenus)
CREATE TABLE menu_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  module_id   UUID NOT NULL REFERENCES menu_modules(id) ON DELETE CASCADE,
  key         VARCHAR(80)  NOT NULL UNIQUE,  -- ex: 'farm.field-book'
  label       VARCHAR(150) NOT NULL,
  href        VARCHAR(200) NOT NULL,
  badge       VARCHAR(20),                   -- 'novo', 'crítico', null
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX menu_items_module_idx ON menu_items (module_id);
CREATE INDEX menu_items_active_idx ON menu_items (active);

-- ── ACL: visibilidade de módulo por perfil
CREATE TABLE menu_module_acl (
  module_id   UUID      NOT NULL REFERENCES menu_modules(id) ON DELETE CASCADE,
  role        user_role NOT NULL,
  can_access  BOOLEAN   NOT NULL DEFAULT TRUE,
  PRIMARY KEY (module_id, role)
);

-- ── ACL: visibilidade de item de menu por perfil
CREATE TABLE menu_item_acl (
  item_id    UUID      NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  role       user_role NOT NULL,
  can_access BOOLEAN   NOT NULL DEFAULT TRUE,
  PRIMARY KEY (item_id, role)
);

-- ── RLS (apenas service_role acessa — gerido pela API admin)
ALTER TABLE menu_modules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_module_acl ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_item_acl   ENABLE ROW LEVEL SECURITY;

-- ── View: menu completo com ACL resolvida por perfil
-- Usada pela API para renderizar o sidebar de cada usuário
CREATE VIEW menu_by_role AS
SELECT
  mm.id          AS module_id,
  mm.key         AS module_key,
  mm.label       AS module_label,
  mm.icon        AS module_icon,
  mm.sort_order  AS module_order,
  mm.active      AS module_active,
  mma.role,
  mma.can_access AS module_can_access,
  mi.id          AS item_id,
  mi.key         AS item_key,
  mi.label       AS item_label,
  mi.href        AS item_href,
  mi.badge       AS item_badge,
  mi.sort_order  AS item_order,
  mi.active      AS item_active,
  mia.can_access AS item_can_access
FROM menu_modules mm
JOIN menu_module_acl mma ON mma.module_id = mm.id
JOIN menu_items mi       ON mi.module_id  = mm.id
LEFT JOIN menu_item_acl mia
  ON mia.item_id = mi.id AND mia.role = mma.role
ORDER BY mm.sort_order, mi.sort_order;

-- ============================================================
-- SEED: estrutura completa do menu Vetra
-- ============================================================

-- Inserir módulos
INSERT INTO menu_modules (key, label, icon, sort_order) VALUES
  ('admin',       'Administração',    'ShieldCheck',  1),
  ('farm',        'Fazenda',          'Tractor',      2),
  ('financial',   'Financeiro',       'DollarSign',   3),
  ('accounting',  'Contábil',         'BookOpen',     4),
  ('purchasing',  'Compras',          'ShoppingCart', 5),
  ('sales',       'Vendas',           'TrendingUp',   6),
  ('logistics',   'Logística',        'Truck',        7),
  ('fiscal',      'Fiscal',           'Scale',        8),
  ('maintenance', 'Manutenção',       'Wrench',       9),
  ('inventory',   'Inventário',       'Package',      10),
  ('production',  'Produção Agro',    'Cog',          11),
  ('services',    'Serviços',         'Briefcase',    12),
  ('analytics',   'BI e Analytics',   'BarChart2',    13);

-- Inserir itens — Administração
WITH m AS (SELECT id FROM menu_modules WHERE key='admin')
INSERT INTO menu_items (module_id, key, label, href, sort_order) VALUES
  ((SELECT id FROM m), 'admin.users',        'Usuários',                 '/admin/users',        1),
  ((SELECT id FROM m), 'admin.menus',        'Menus',                    '/admin/menus',        2),
  ((SELECT id FROM m), 'admin.acl',          'Perfis de acesso (ACL)',   '/admin/acl',          3),
  ((SELECT id FROM m), 'admin.licenses',     'Licenças',                 '/admin/licenses',     4),
  ((SELECT id FROM m), 'admin.audit',        'Auditoria e logs',         '/admin/audit',        5),
  ((SELECT id FROM m), 'admin.partners',     'Parceiros',                '/admin/partners',     6),
  ((SELECT id FROM m), 'admin.settings',     'Configurações gerais',     '/admin/settings',     7),
  ((SELECT id FROM m), 'admin.companies',    'Empresas / multi-fazenda', '/admin/companies',    8),
  ((SELECT id FROM m), 'admin.integrations', 'Integrações externas',     '/admin/integrations', 9);

-- Inserir itens — Fazenda
WITH m AS (SELECT id FROM menu_modules WHERE key='farm')
INSERT INTO menu_items (module_id, key, label, href, badge, sort_order) VALUES
  ((SELECT id FROM m), 'farm.farms',         'Fazendas',                     '/farm/farms',         NULL,      1),
  ((SELECT id FROM m), 'farm.fields',        'Talhões (quadras)',             '/farm/fields',        NULL,      2),
  ((SELECT id FROM m), 'farm.seasons',       'Safras / ciclos produtivos',   '/farm/seasons',       NULL,      3),
  ((SELECT id FROM m), 'farm.machinery',     'Maquinário e implementos',     '/farm/machinery',     NULL,      4),
  ((SELECT id FROM m), 'farm.activities',    'Apontamento de atividades',    '/farm/activities',    NULL,      5),
  ((SELECT id FROM m), 'farm.weather',       'Previsão meteorológica',       '/farm/weather',       NULL,      6),
  ((SELECT id FROM m), 'farm.field-book',    'Caderno de campo digital',     '/farm/field-book',    'crítico', 7),
  ((SELECT id FROM m), 'farm.phytosanitary', 'Aplicações fitossanitárias',   '/farm/phytosanitary', 'novo',    8),
  ((SELECT id FROM m), 'farm.fuel',          'Abastecimento e combustíveis', '/farm/fuel',          'novo',    9),
  ((SELECT id FROM m), 'farm.map',           'Mapa de talhões',              '/farm/map',           'novo',    10),
  ((SELECT id FROM m), 'farm.history',       'Histórico por safra e área',   '/farm/history',       'novo',    11);

-- Inserir itens — Financeiro
WITH m AS (SELECT id FROM menu_modules WHERE key='financial')
INSERT INTO menu_items (module_id, key, label, href, badge, sort_order) VALUES
  ((SELECT id FROM m), 'financial.payable',        'Contas a pagar',                   '/financial/payable',        NULL,   1),
  ((SELECT id FROM m), 'financial.receivable',     'Contas a receber',                 '/financial/receivable',     NULL,   2),
  ((SELECT id FROM m), 'financial.cashflow',       'Fluxo de caixa',                   '/financial/cashflow',       NULL,   3),
  ((SELECT id FROM m), 'financial.reconcile',      'Conciliação bancária',             '/financial/reconcile',      NULL,   4),
  ((SELECT id FROM m), 'financial.banks',          'Bancos e contas correntes',        '/financial/banks',          NULL,   5),
  ((SELECT id FROM m), 'financial.cost-centers',   'Centros de custo / lucro',         '/financial/cost-centers',   NULL,   6),
  ((SELECT id FROM m), 'financial.credit',         'Gestão de crédito e cobrança',     '/financial/credit',         NULL,   7),
  ((SELECT id FROM m), 'financial.forex',          'Registro de operações de câmbio',  '/financial/forex',          'novo', 8),
  ((SELECT id FROM m), 'financial.forex-exposure', 'Controle de exposição cambial',    '/financial/forex-exposure', 'novo', 9),
  ((SELECT id FROM m), 'financial.forex-link',     'Vínculo câmbio × contrato',        '/financial/forex-link',     'novo', 10),
  ((SELECT id FROM m), 'financial.forex-sim',      'Simulação de cenários cambiais',   '/financial/forex-sim',      'novo', 11),
  ((SELECT id FROM m), 'financial.crop-cost',      'Custo de produção por safra',      '/financial/crop-cost',      'novo', 12);

-- Inserir itens — Contábil
WITH m AS (SELECT id FROM menu_modules WHERE key='accounting')
INSERT INTO menu_items (module_id, key, label, href, sort_order) VALUES
  ((SELECT id FROM m), 'accounting.chart',       'Plano de contas',               '/accounting/chart',       1),
  ((SELECT id FROM m), 'accounting.dre',         'DRE',                           '/accounting/dre',         2),
  ((SELECT id FROM m), 'accounting.entries',     'Lançamentos contábeis',         '/accounting/entries',     3),
  ((SELECT id FROM m), 'accounting.bookkeeping', 'Escrituração contábil',         '/accounting/bookkeeping', 4),
  ((SELECT id FROM m), 'accounting.assets',      'Gestão de ativos (imobilizado)','/accounting/assets',      5);

-- Inserir itens — Compras
WITH m AS (SELECT id FROM menu_modules WHERE key='purchasing')
INSERT INTO menu_items (module_id, key, label, href, badge, sort_order) VALUES
  ((SELECT id FROM m), 'purchasing.requisition',    'Requisição de compra',          '/purchasing/requisition',    NULL,   1),
  ((SELECT id FROM m), 'purchasing.quotation',      'Cotação (mapa de comparação)',  '/purchasing/quotation',      NULL,   2),
  ((SELECT id FROM m), 'purchasing.orders',         'Pedido de compra',              '/purchasing/orders',         NULL,   3),
  ((SELECT id FROM m), 'purchasing.approval',       'Aprovação (workflow)',          '/purchasing/approval',       NULL,   4),
  ((SELECT id FROM m), 'purchasing.contracts',      'Contratos de fornecimento',     '/purchasing/contracts',      NULL,   5),
  ((SELECT id FROM m), 'purchasing.followup',       'Follow-up de entrega',          '/purchasing/followup',       NULL,   6),
  ((SELECT id FROM m), 'purchasing.agro-contracts', 'Contratos de insumos agrícolas','/purchasing/agro-contracts', 'novo', 7);

-- Inserir itens — Vendas
WITH m AS (SELECT id FROM menu_modules WHERE key='sales')
INSERT INTO menu_items (module_id, key, label, href, badge, sort_order) VALUES
  ((SELECT id FROM m), 'sales.prices',      'Tabela de preços',                 '/sales/prices',      NULL,   1),
  ((SELECT id FROM m), 'sales.orders',      'Pedido de venda / orçamento',      '/sales/orders',      NULL,   2),
  ((SELECT id FROM m), 'sales.approval',    'Aprovação de pedido',              '/sales/approval',    NULL,   3),
  ((SELECT id FROM m), 'sales.commissions', 'Gestão de comissões',              '/sales/commissions', NULL,   4),
  ((SELECT id FROM m), 'sales.portal',      'Portal do cliente',                '/sales/portal',      NULL,   5),
  ((SELECT id FROM m), 'sales.agro',        'Contratos de venda agrícola',      '/sales/agro',        'novo', 6),
  ((SELECT id FROM m), 'sales.pricing',     'Fixação de preço de commodity',    '/sales/pricing',     'novo', 7),
  ((SELECT id FROM m), 'sales.volumes',     'Controle de volumes contratados',  '/sales/volumes',     'novo', 8);

-- Inserir itens — Logística
WITH m AS (SELECT id FROM menu_modules WHERE key='logistics')
INSERT INTO menu_items (module_id, key, label, href, badge, sort_order) VALUES
  ((SELECT id FROM m), 'logistics.planning',  'Planejamento de transporte',    '/logistics/planning',  'novo', 1),
  ((SELECT id FROM m), 'logistics.freight',   'Gestão de fretes e CT-e',       '/logistics/freight',   'novo', 2),
  ((SELECT id FROM m), 'logistics.tracking',  'Acompanhamento de entregas',    '/logistics/tracking',  'novo', 3),
  ((SELECT id FROM m), 'logistics.manifest',  'Romaneio de carga',             '/logistics/manifest',  'novo', 4),
  ((SELECT id FROM m), 'logistics.cost',      'Custo logístico por contrato',  '/logistics/cost',      'novo', 5),
  ((SELECT id FROM m), 'logistics.carriers',  'Gestão de transportadoras',     '/logistics/carriers',  'novo', 6);

-- Inserir itens — Fiscal
WITH m AS (SELECT id FROM menu_modules WHERE key='fiscal')
INSERT INTO menu_items (module_id, key, label, href, sort_order) VALUES
  ((SELECT id FROM m), 'fiscal.taxes',    'Configuração de impostos',       '/fiscal/taxes',    1),
  ((SELECT id FROM m), 'fiscal.invoices', 'Emissão de NF-e, NFS-e, CT-e',  '/fiscal/invoices', 2),
  ((SELECT id FROM m), 'fiscal.xml',      'Importação de XML',              '/fiscal/xml',      3),
  ((SELECT id FROM m), 'fiscal.books',    'Livros fiscais',                 '/fiscal/books',    4),
  ((SELECT id FROM m), 'fiscal.sped',     'SPED / obrigações acessórias',  '/fiscal/sped',     5);

-- Inserir itens — Manutenção
WITH m AS (SELECT id FROM menu_modules WHERE key='maintenance')
INSERT INTO menu_items (module_id, key, label, href, sort_order) VALUES
  ((SELECT id FROM m), 'maintenance.plan',      'Plano de manutenção preventiva', '/maintenance/plan',      1),
  ((SELECT id FROM m), 'maintenance.schedule',  'Agendamento de serviço',         '/maintenance/schedule',  2),
  ((SELECT id FROM m), 'maintenance.os',        'Abertura de OS',                 '/maintenance/os',        3),
  ((SELECT id FROM m), 'maintenance.checklist', 'Checklist de inspeção',          '/maintenance/checklist', 4),
  ((SELECT id FROM m), 'maintenance.history',   'Histórico por ativo',            '/maintenance/history',   5);

-- Inserir itens — Inventário
WITH m AS (SELECT id FROM menu_modules WHERE key='inventory')
INSERT INTO menu_items (module_id, key, label, href, badge, sort_order) VALUES
  ((SELECT id FROM m), 'inventory.stock',     'Saldos em estoque',                    '/inventory/stock',     NULL,   1),
  ((SELECT id FROM m), 'inventory.moves',     'Movimentação de material',             '/inventory/moves',     NULL,   2),
  ((SELECT id FROM m), 'inventory.cancel',    'Cancelamento de movimentação',         '/inventory/cancel',    NULL,   3),
  ((SELECT id FROM m), 'inventory.min',       'Estoque mínimo e ponto de pedido',     '/inventory/min',       NULL,   4),
  ((SELECT id FROM m), 'inventory.adjust',    'Ajuste de inventário',                 '/inventory/adjust',    NULL,   5),
  ((SELECT id FROM m), 'inventory.lots',      'Rastreabilidade / lotes',              '/inventory/lots',      NULL,   6),
  ((SELECT id FROM m), 'inventory.catalog',   'Catálogo de insumos e defensivos',     '/inventory/catalog',   NULL,   7),
  ((SELECT id FROM m), 'inventory.quality',   'Controle de qualidade e classificação','/inventory/quality',   'novo', 8),
  ((SELECT id FROM m), 'inventory.locations', 'Estoque por silo / armazém',          '/inventory/locations', 'novo', 9);

-- Inserir itens — Produção Agro
WITH m AS (SELECT id FROM menu_modules WHERE key='production')
INSERT INTO menu_items (module_id, key, label, href, badge, sort_order) VALUES
  ((SELECT id FROM m), 'production.orders',       'Ordem de produção',          '/production/orders',       NULL,   1),
  ((SELECT id FROM m), 'production.bom',          'Ficha técnica / BoM',        '/production/bom',          NULL,   2),
  ((SELECT id FROM m), 'production.appointments', 'Apontamento de produção',    '/production/appointments', NULL,   3),
  ((SELECT id FROM m), 'production.quality',      'Controle de qualidade',      '/production/quality',      NULL,   4),
  ((SELECT id FROM m), 'production.costs',        'Custos de produção',         '/production/costs',        NULL,   5),
  ((SELECT id FROM m), 'production.traceability', 'Rastreabilidade agrícola',   '/production/traceability', 'novo', 6),
  ((SELECT id FROM m), 'production.prescription', 'Receituário agronômico',     '/production/prescription', 'novo', 7);

-- Inserir itens — Serviços
WITH m AS (SELECT id FROM menu_modules WHERE key='services')
INSERT INTO menu_items (module_id, key, label, href, sort_order) VALUES
  ((SELECT id FROM m), 'services.quotation', 'Cotação de serviço',      '/services/quotation', 1),
  ((SELECT id FROM m), 'services.os',        'Ordem de serviço (OS)',   '/services/os',        2),
  ((SELECT id FROM m), 'services.timesheet', 'Apontamento de horas',    '/services/timesheet', 3),
  ((SELECT id FROM m), 'services.contracts', 'Contratos recorrentes',   '/services/contracts', 4),
  ((SELECT id FROM m), 'services.billing',   'Faturamento de serviços', '/services/billing',   5);

-- Inserir itens — BI e Analytics
WITH m AS (SELECT id FROM menu_modules WHERE key='analytics')
INSERT INTO menu_items (module_id, key, label, href, badge, sort_order) VALUES
  ((SELECT id FROM m), 'analytics.dashboard', 'Dashboard gerencial',       '/analytics/dashboard', 'novo', 1),
  ((SELECT id FROM m), 'analytics.margin',    'Análise de margem',         '/analytics/margin',    'novo', 2),
  ((SELECT id FROM m), 'analytics.crop-cost', 'Custo por hectare e safra', '/analytics/crop-cost', 'novo', 3),
  ((SELECT id FROM m), 'analytics.kpis',      'Indicadores operacionais',  '/analytics/kpis',      'novo', 4),
  ((SELECT id FROM m), 'analytics.reports',   'Relatórios personalizados', '/analytics/reports',   'novo', 5),
  ((SELECT id FROM m), 'analytics.export',    'Exportação PDF / Excel',    '/analytics/export',    'novo', 6);

-- ── ACL padrão: owner e manager têm acesso a tudo
INSERT INTO menu_module_acl (module_id, role, can_access)
SELECT id, unnest(ARRAY['owner','manager']::user_role[]), TRUE
FROM menu_modules;

-- agronomist: fazenda, inventário, produção, manutenção
INSERT INTO menu_module_acl (module_id, role, can_access)
SELECT id, 'agronomist', TRUE
FROM menu_modules
WHERE key IN ('farm','inventory','production','maintenance','analytics');

INSERT INTO menu_module_acl (module_id, role, can_access)
SELECT id, 'agronomist', FALSE
FROM menu_modules
WHERE key NOT IN ('farm','inventory','production','maintenance','analytics');

-- accountant: financeiro, contábil, fiscal, analytics
INSERT INTO menu_module_acl (module_id, role, can_access)
SELECT id, 'accountant', TRUE
FROM menu_modules
WHERE key IN ('financial','accounting','fiscal','analytics');

INSERT INTO menu_module_acl (module_id, role, can_access)
SELECT id, 'accountant', FALSE
FROM menu_modules
WHERE key NOT IN ('financial','accounting','fiscal','analytics');

-- operator: fazenda, inventário, manutenção (somente apontamentos)
INSERT INTO menu_module_acl (module_id, role, can_access)
SELECT id, 'operator', TRUE
FROM menu_modules
WHERE key IN ('farm','inventory','maintenance');

INSERT INTO menu_module_acl (module_id, role, can_access)
SELECT id, 'operator', FALSE
FROM menu_modules
WHERE key NOT IN ('farm','inventory','maintenance');

-- viewer: somente analytics e fazenda (read-only)
INSERT INTO menu_module_acl (module_id, role, can_access)
SELECT id, 'viewer', TRUE
FROM menu_modules
WHERE key IN ('farm','analytics');

INSERT INTO menu_module_acl (module_id, role, can_access)
SELECT id, 'viewer', FALSE
FROM menu_modules
WHERE key NOT IN ('farm','analytics');
