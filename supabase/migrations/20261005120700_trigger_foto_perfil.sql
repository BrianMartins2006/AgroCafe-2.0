-- ============================================================================
-- Trigger de signup passa a gravar a foto do perfil.
--
-- O WelcomePage sobe a imagem para o Cloudinary antes do signUp e manda a URL
-- nos metadados. Este ajuste faz o trigger copiá-la para public.usuario.
--
-- Por que o metadata e não um atualizarPerfil() depois do login: o trigger roda
-- quando a linha de auth.users nasce, antes da confirmação de e-mail. Com
-- "Confirm email" ligado (está ligado no projeto) não existe sessão nesse
-- instante, então a única forma de a foto sobreviver ao cadastro é ela entrar
-- junto com o signUp. Confirmado no diagnóstico: o signup de teste devolveu
-- data.session nulo.
--
-- Coerção de tipo: o metadata é jsonb e qualquer cliente escreve nele. Uma URL
-- como número faria o INSERT falhar e derrubar o cadastro inteiro. nullif(...,'')
-- evita gravar string vazia, que passaria no NOT NULL mas viraria foto quebrada.
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