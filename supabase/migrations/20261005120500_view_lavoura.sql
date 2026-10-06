-- ============================================================================
-- AgroCafé — defaults de dono e view de última atividade
--
-- Roda depois de 20261005120000_schema.sql e 20261005120200_policies.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Defaults de dono: auth.uid() em vez de id_usuario vindo do cliente.
--
-- id_usuario é NOT NULL, então sem default o INSERT precisa mandar o valor — e
-- aí o navegador decide de qual usuário é a lavoura. A RLS pegaria o caso mal
--icioso (a WITH CHECK exige id_usuario = auth.uid()), mas o certo é nem dar a
-- opção: o default preenche, e se o cliente mandar alguma coisa divergente a
-- WITH CHECK rejeita do mesmo jeito.
--
-- Belt and braces: default no banco + WITH check na política.
-- ----------------------------------------------------------------------------
alter table public.lavoura    alter column id_usuario set default auth.uid();
alter table public.funcionario alter column id_usuario set default auth.uid();
alter table public.maquinario alter column id_usuario set default auth.uid();

-- ----------------------------------------------------------------------------
-- View: última atividade por lavoura.
--
-- O Flask calculava isso em Python (max() das atividades da lavoura, com um
-- workaround de joinedload). O PostgREST não agrega, então a agregação precisa
-- ficar no banco — senão cada listagem de lavouras teria que baixar todas as
-- atividades só para somar datas no navegador.
--
-- security_invoker = on é OBRIGATÓRIO e não é cosmético: sem ele a view executa
-- com os privilégios do dono do schema (postgres) e ignora a RLS de
-- public.lavoura e public.atividade — as duas contas veriam as lavouras uma da
-- outra. Requer Postgres 15+.
--
-- group by l.id só, sem listar todas as colunas: o Postgres aceita por
-- dependência funcional, já que l.id é a primary key.
-- ----------------------------------------------------------------------------
create or replace view public.lavoura_com_ultima_atividade
with (security_invoker = on)
as
select
  l.id,
  l.nome,
  l.cultura,
  l.foto_perfil,
  l.area_hectares,
  l.localizacao,
  l.data_inicio,
  l.is_pinned,
  l.id_usuario,
  max(a.data) as ultima_atividade_date
from public.lavoura l
left join public.atividade a on a.id_lavoura = l.id
group by l.id;

comment on view public.lavoura_com_ultima_atividade is
  'Lavouras com a data da atividade mais recente. RLS das tabelas base se aplica (security_invoker).';