-- ============================================================
-- Fix: handle_new_user trigger falhava ao receber role inválida
-- (ex: 'producer' não existe no enum user_role).
-- Usa EXCEPTION para fazer fallback seguro para 'owner'.
-- Também insere manualmente o profile de usuários já existentes
-- que ficaram sem profile por causa do bug.
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role user_role;
BEGIN
  BEGIN
    v_role := (NEW.raw_user_meta_data->>'role')::user_role;
  EXCEPTION WHEN invalid_text_representation OR OTHERS THEN
    v_role := 'owner';
  END;

  IF v_role IS NULL THEN
    v_role := 'owner';
  END IF;

  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    v_role
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill: cria profiles para usuários auth que ainda não têm profile
INSERT INTO public.profiles (id, full_name, email, role)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  u.email,
  'owner'::user_role
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = u.id
);
