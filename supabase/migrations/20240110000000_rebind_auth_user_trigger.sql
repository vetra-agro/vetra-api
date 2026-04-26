-- ============================================================
-- Rebind do trigger de criação de usuário
-- Garante que auth.users use EXPLICITAMENTE public.handle_new_user()
-- ============================================================

-- Remove trigger antigo (caso aponte para função errada/antiga)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Recria trigger apontando para função hardened em public
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Segurança extra: garantir owner adequado da função
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
