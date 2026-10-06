-- ============================================================================
-- AgroCafé — criação de perfil no signup
--
-- Quando uma linha entra em auth.users, o perfil correspondente entra em
-- public.usuario. O trigger é a única coisa autorizada a escrever em usuario:
-- não há política de INSERT na tabela (migration 03), de propósito.
--
-- SECURITY DEFINER porque o papel que dispara o trigger (supabase_auth_admin)
-- não passaria por uma política de RLS do usuário final.
-- Ver PLANO_MIGRACAO §4.6.
-- ============================================================================

create or replace function public.handle_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usuario (id, nome)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'nome'), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    )
  );

  return new;
end;
$$;

comment on function public.handle_novo_usuario() is
  'Cria public.usuario a partir de um novo auth.users. Lê o nome de '
  'raw_user_meta_data->>''nome'', caindo para a parte anterior ao @ do e-mail.';

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_novo_usuario();

-- ============================================================================
-- A tabela public.usuario NÃO usa force row level security (ver migration 02):
-- o INSERT acima roda como dono da tabela e precisa bypassar a RLS.
-- ============================================================================