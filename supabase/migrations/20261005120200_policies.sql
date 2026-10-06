-- ============================================================================
-- AgroCafé — políticas de RLS
--
-- Substituem as 9 checagens manuais de dono do Flask (routes.py:165…539).
-- Ver PLANO_MIGRACAO §4.
--
-- Convenção: uma política por operação. A repetição do USING é o preço da
-- auditabilidade — em código de segurança, "for all" esconde o que cada
-- operação realmente exige.
-- ============================================================================

-- ============================================================================
-- usuario — o próprio perfil, e só ele.
--
-- INSERT não tem política: o perfil nasce pelo trigger de signup (migration 04).
-- DELETE não tem política: conta se remove pelo GoTrue, que dá cascade.
-- ============================================================================
create policy "usuario: le o proprio perfil"
  on public.usuario for select
  using (id = auth.uid());

create policy "usuario: atualiza o proprio perfil"
  on public.usuario for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ============================================================================
-- tipo_atividade — catálogo, somente leitura.
--
-- No MySQL não tinha dono e qualquer autenticado podia escrever
-- (routes.py:426-466): um usuário apagava a categoria dos outros. Aqui não há
-- política de escrita, então o cliente não altera o catálogo. Mudança passa por
-- migration SQL. Ver PLANO_MIGRACAO §4.5.
-- ============================================================================
create policy "tipo_atividade: autenticado le"
  on public.tipo_atividade for select
  using (auth.role() = 'authenticated');

-- ============================================================================
-- lavoura — escopo por dono.
--
-- O with check do update impede reatribuir uma lavoura a outro usuário: sem
-- ele, um usuário poderia dar update na própria linha trocando id_usuario
-- pelo do vizinho — e a linha sumiria do escopo dele, sem erro nenhum.
-- ============================================================================
create policy "lavoura: dono le"
  on public.lavoura for select
  using (id_usuario = auth.uid() and public.usuario_ativo());

create policy "lavoura: dono cria"
  on public.lavoura for insert
  with check (id_usuario = auth.uid() and public.usuario_ativo());

create policy "lavoura: dono altera"
  on public.lavoura for update
  using (id_usuario = auth.uid() and public.usuario_ativo())
  with check (id_usuario = auth.uid());

create policy "lavoura: dono remove"
  on public.lavoura for delete
  using (id_usuario = auth.uid() and public.usuario_ativo());

-- ============================================================================
-- atividade — o dono é o dono da lavoura, não o da atividade.
--
-- O id_atividade sobrevive ao DELETE de atividade: o escopo é derivado do
-- id_lavoura, que continua válido.
-- ============================================================================
create policy "atividade: dono da lavoura le"
  on public.atividade for select
  using (
    public.usuario_ativo()
    and exists (
      select 1
      from public.lavoura l
      where l.id = atividade.id_lavoura
        and l.id_usuario = auth.uid()
    )
  );

create policy "atividade: dono da lavoura cria"
  on public.atividade for insert
  with check (
    public.usuario_ativo()
    and exists (
      select 1
      from public.lavoura l
      where l.id = atividade.id_lavoura
        and l.id_usuario = auth.uid()
    )
  );

create policy "atividade: dono da lavoura altera"
  on public.atividade for update
  using (
    public.usuario_ativo()
    and exists (
      select 1
      from public.lavoura l
      where l.id = atividade.id_lavoura
        and l.id_usuario = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.lavoura l
      where l.id = atividade.id_lavoura
        and l.id_usuario = auth.uid()
    )
  );

create policy "atividade: dono da lavoura remove"
  on public.atividade for delete
  using (
    public.usuario_ativo()
    and exists (
      select 1
      from public.lavoura l
      where l.id = atividade.id_lavoura
        and l.id_usuario = auth.uid()
    )
  );

-- ============================================================================
-- atividade_imagem — um nível a mais de descendência.
-- ============================================================================
create policy "imagem: dono da lavoura le"
  on public.atividade_imagem for select
  using (
    public.usuario_ativo()
    and exists (
      select 1
      from public.atividade a
      join public.lavoura l on l.id = a.id_lavoura
      where a.id = atividade_imagem.id_atividade
        and l.id_usuario = auth.uid()
    )
  );

create policy "imagem: dono da lavoura cria"
  on public.atividade_imagem for insert
  with check (
    public.usuario_ativo()
    and exists (
      select 1
      from public.atividade a
      join public.lavoura l on l.id = a.id_lavoura
      where a.id = atividade_imagem.id_atividade
        and l.id_usuario = auth.uid()
    )
  );

create policy "imagem: dono da lavoura altera"
  on public.atividade_imagem for update
  using (
    public.usuario_ativo()
    and exists (
      select 1
      from public.atividade a
      join public.lavoura l on l.id = a.id_lavoura
      where a.id = atividade_imagem.id_atividade
        and l.id_usuario = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.atividade a
      join public.lavoura l on l.id = a.id_lavoura
      where a.id = atividade_imagem.id_atividade
        and l.id_usuario = auth.uid()
    )
  );

create policy "imagem: dono da lavoura remove"
  on public.atividade_imagem for delete
  using (
    public.usuario_ativo()
    and exists (
      select 1
      from public.atividade a
      join public.lavoura l on l.id = a.id_lavoura
      where a.id = atividade_imagem.id_atividade
        and l.id_usuario = auth.uid()
    )
  );

-- ============================================================================
-- funcionario — escopo por dono, igual à lavoura.
--
-- Deliberadamente SEM o "ou global" do MySQL
-- ((id_usuario = eu) OR (id_usuario IS NULL), routes.py:475). Os registros sem
-- dono eram seeds legados e estão sendo descartados na ETL; a coluna passou a
-- ser NOT NULL no schema. Ver PLANO_MIGRACAO §4.4.
-- ============================================================================
create policy "funcionario: dono le"
  on public.funcionario for select
  using (id_usuario = auth.uid() and public.usuario_ativo());

create policy "funcionario: dono cria"
  on public.funcionario for insert
  with check (id_usuario = auth.uid() and public.usuario_ativo());

create policy "funcionario: dono altera"
  on public.funcionario for update
  using (id_usuario = auth.uid() and public.usuario_ativo())
  with check (id_usuario = auth.uid());

create policy "funcionario: dono remove"
  on public.funcionario for delete
  using (id_usuario = auth.uid() and public.usuario_ativo());

-- ============================================================================
-- maquinario — idem funcionario.
-- ============================================================================
create policy "maquinario: dono le"
  on public.maquinario for select
  using (id_usuario = auth.uid() and public.usuario_ativo());

create policy "maquinario: dono cria"
  on public.maquinario for insert
  with check (id_usuario = auth.uid() and public.usuario_ativo());

create policy "maquinario: dono altera"
  on public.maquinario for update
  using (id_usuario = auth.uid() and public.usuario_ativo())
  with check (id_usuario = auth.uid());

create policy "maquinario: dono remove"
  on public.maquinario for delete
  using (id_usuario = auth.uid() and public.usuario_ativo());