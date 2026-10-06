-- ============================================================================
-- AgroCafé — grava a foto do perfil no cadastro
--
-- Supabase Dashboard → SQL Editor → New query → colar → Run
--
-- Sem isso a foto escolhida na tela de cadastro era enviada ao Cloudinary e
-- ficava órfã: a URL nunca chegava em public.usuario.
--
-- Só afeta contas novas. Quem já se cadastrou sem foto precisa salvar a foto
-- pelo perfil uma vez.
-- ============================================================================

create or replace function public.handle_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usuario (id, nome, foto_url)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'nome'), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'foto_url', '')), '')
  );

  return new;
end;
$$;