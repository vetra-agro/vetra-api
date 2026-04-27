-- ============================================================
-- Seed de migração: vincular usuários existentes ao tenant
-- Execute no Supabase SQL Editor para migrar o PoC
-- ============================================================

-- 1. Verificar quais tenants existem
SELECT id, name FROM tenants ORDER BY created_at;

-- 2. Verificar quais usuários existem
SELECT id, full_name, email, role FROM profiles ORDER BY full_name;

-- 3. Vincular TODOS os usuários ao PRIMEIRO tenant (ajuste o UUID conforme necessário)
-- Substitua 'SEU-TENANT-UUID-AQUI' pelo UUID retornado no passo 1
INSERT INTO user_tenants (user_id, tenant_id, role, is_default, accepted_at)
SELECT
  p.id,
  (SELECT id FROM tenants ORDER BY created_at LIMIT 1),
  p.role,
  TRUE,
  NOW()
FROM profiles p
WHERE p.active = TRUE
ON CONFLICT (user_id, tenant_id) DO UPDATE
  SET role = EXCLUDED.role,
      is_default = TRUE,
      accepted_at = NOW();

-- 4. Verificar resultado
SELECT
  ut.user_id,
  p.full_name,
  p.email,
  t.name AS tenant_name,
  ut.role,
  ut.is_default
FROM user_tenants ut
JOIN profiles p ON p.id = ut.user_id
JOIN tenants t  ON t.id = ut.tenant_id
ORDER BY t.name, p.full_name;
