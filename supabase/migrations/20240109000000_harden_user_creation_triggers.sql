-- ============================================================
-- Hardening: evitar que falhas de trigger impeçam criação de usuário
-- ============================================================

-- 1) handle_new_user nunca deve abortar INSERT em auth.users
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role user_role := 'owner';
BEGIN
  BEGIN
    v_role := (NEW.raw_user_meta_data->>'role')::user_role;
  EXCEPTION WHEN invalid_text_representation OR OTHERS THEN
    v_role := 'owner';
  END;

  IF v_role IS NULL THEN
    v_role := 'owner';
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, full_name, email, role)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
      NEW.email,
      v_role
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- Não bloqueia criação no auth.users; profile será sincronizado pela API.
    RAISE WARNING 'handle_new_user failed for user %, reason: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2) Auditoria também não deve bloquear transações de negócio
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

  BEGIN
    INSERT INTO audit_logs (
      event_type, module, entity, description,
      old_values, new_values, success
    ) VALUES (
      v_event, TG_TABLE_NAME, TG_TABLE_NAME, v_desc,
      v_old_vals, v_new_vals, TRUE
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'audit_table_changes failed on %.% (%): %', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP, SQLERRM;
  END;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
