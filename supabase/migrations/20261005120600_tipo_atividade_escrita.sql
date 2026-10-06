-- ============================================================================
-- Abre escrita no catálogo de tipos de atividade.
--
-- Contexto: a policy 20261005120200_policies.sql:35 era só de SELECT, e o
-- SettingsPage falhava de propósito com "o catálogo é gerenciado no Supabase".
-- Decisão do usuário em 05/10/2026: as duas contas do app são de confiança e o
-- CRUD precisa funcionar pela tela.
--
-- O que muda em relação ao MySQL: lá qualquer autenticado podia apagar a
-- categoria que o outro estava usando. Aqui o FK
-- `atividade_id_tipo_atividade_fkey` é `on delete restrict`, então o banco já
-- recusa o DELETE de uma categoria em uso com 23503. O problema original nunca
-- foi o DELETE em si — foi apagar sem o banco avisar. Com o restrict, a
-- categoria em uso continua existindo e a UI traduz o erro em português.
--
-- Isso não é uma tabela "compartilhada" no sentido perigoso: as duas contas
-- administram o mesmo conjunto de categorias de propósito, então "editar a
-- categoria do outro" aqui é comportamento desejado, não invasão.
-- ============================================================================

create policy "tipo_atividade: autenticado cria"
  on public.tipo_atividade for insert
  with check (auth.role() = 'authenticated');

create policy "tipo_atividade: autenticado altera"
  on public.tipo_atividade for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- No update, o `using` sozinho já restringe ao que a pessoa enxerga (todas as
-- linhas são legíveis para autenticados), então não há escopo por dono a
-- checar aqui. `with check` garante que a linha continues visível depois.
create policy "tipo_atividade: autenticado remove"
  on public.tipo_atividade for delete
  using (auth.role() = 'authenticated');