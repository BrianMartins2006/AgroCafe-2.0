-- ============================================================================
-- AgroCafé — verificação pós-migration
--
-- Cole no SQL Editor do painel do Supabase (ou rode via Management API).
--
-- Por que este arquivo existe: `supabase db dump` exige Docker, que não está
-- disponível neste ambiente. Esta query cobre o essencial do dump: o schema
-- foi criado, a RLS está ligada, as políticas foram criadas e a semente rodou.
--
-- Esperado: `falhas` = 0.
-- ============================================================================

with esperado (tabela) as (
  values
    ('usuario'), ('tipo_atividade'), ('lavoura'), ('atividade'),
    ('atividade_imagem'), ('funcionario'), ('maquinario')
),
rls as (
  select c.relname as tabela, c.relrowsecurity as habilitada
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
)

select
  e.tabela,
  case when r.habilitada then 'sim' else 'NÃO' end as rls,
  case when r.habilitada then 'ok' else 'FALHA' end as resultado
from esperado e
left join rls r on r.tabela = e.tabela
order by resultado desc, e.tabela;


-- ---------------------------------------------------------------------------
-- Contagem de políticas por tabela. Esperado: 2 em usuario (select + update),
-- 1 em tipo_atividade (só select), 4 nas de dono direto, 4 em atividade e
-- 4 em atividade_imagem.
-- ---------------------------------------------------------------------------
select
  tablename,
  count(*) filter (where cmd = 'SELECT') as selects,
  count(*) filter (where cmd = 'INSERT') as inserts,
  count(*) filter (where cmd = 'UPDATE') as updates,
  count(*) filter (where cmd = 'DELETE') as deletes,
  count(*) as total
from pg_policies
where schemaname = 'public'
group by tablename
order by tablename;


-- ---------------------------------------------------------------------------
-- Funções e trigger. A função handle_novo_usuario precisa ser SECURITY
-- DEFINER — sem isso o INSERT do perfil seria barrado pela própria RLS.
-- ---------------------------------------------------------------------------
select
  p.proname,
  p.prosecdef as security_definer,
  pg_get_function_result(p.oid) as retorno
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('usuario_ativo', 'handle_novo_usuario')
order by p.proname;


select
  tgname as trigger,
  tgrelid::regclass as tabela,
  tgenabled as ativo
from pg_trigger
where not tgisinternal
  and tgname = 'on_auth_user_created';


-- ---------------------------------------------------------------------------
-- Semente do catálogo. Esperado: 5.
-- ---------------------------------------------------------------------------
select count(*) as categorias, count(distinct lower(nome)) as nomes_unicos
from public.tipo_atividade;


-- ---------------------------------------------------------------------------
-- Resumo: uma linha por verificação. 'NÃO' ou contagem errada = falha.
-- ---------------------------------------------------------------------------
select 'tabelas com RLS' as verificacao,
       count(*) filter (where c.relrowsecurity) as ok_esperado_7,
       count(*) as total
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
union all
select 'políticas criadas', 23, count(*) from pg_policies where schemaname = 'public'
union all
select 'índices', 8, count(*) from pg_indexes where schemaname = 'public'
union all
select 'categorias na semente', 5, count(*) from public.tipo_atividade;