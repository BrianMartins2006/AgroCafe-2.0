-- ============================================================================
-- AgroCafé — escrita no catálogo de categorias (tipo_atividade)
--
-- Supabase Dashboard → SQL Editor → New query → colar → Run
--
-- Idempotente: pode ser executado mais de uma vez sem efeito colateral.
-- ============================================================================

-- Remove versões anteriores destas policies, se existirem.
drop policy if exists "tipo_atividade: autenticado cria"   on public.tipo_atividade;
drop policy if exists "tipo_atividade: autenticado altera" on public.tipo_atividade;
drop policy if exists "tipo_atividade: autenticado remove" on public.tipo_atividade;

-- Cria, renomeia e apaga categorias pela interface do sistema.
create policy "tipo_atividade: autenticado cria"
  on public.tipo_atividade
  for insert
  with check (auth.role() = 'authenticated');

create policy "tipo_atividade: autenticado altera"
  on public.tipo_atividade
  for update
  using      (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "tipo_atividade: autenticado remove"
  on public.tipo_atividade
  for delete
  using (auth.role() = 'authenticated');