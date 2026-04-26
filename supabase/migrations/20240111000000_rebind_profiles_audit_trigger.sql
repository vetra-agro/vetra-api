-- ============================================================
-- Rebind do trigger de auditoria em profiles
-- Garante que profiles use EXPLICITAMENTE public.audit_table_changes()
-- ============================================================

DROP TRIGGER IF EXISTS audit_profiles_changes ON public.profiles;

CREATE TRIGGER audit_profiles_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_table_changes();

ALTER FUNCTION public.audit_table_changes() OWNER TO postgres;
