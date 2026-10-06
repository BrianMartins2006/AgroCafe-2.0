-- ============================================================================
-- AgroCafé — diagnóstico: em que estado está a tabela de períodos?
--
-- Supabase Dashboard → SQL Editor → New query → colar → Run
--
-- Só leitura: não altera nada. Serve para separar três causas que produzem
-- sintomas parecidos:
--
--   1. tabela não existe            → script nunca rodou
--   2. tabela existe, RLS/policies OK → o erro era só o cache do PostgREST
--   3. tabela existe, RLS desligada  → aplicação pela metade, e as policies
--                                        são decorativas (qualquer conta lê)
--
-- Esperado com a instalação completa: TODAS as linhas como "ok".
-- Se `tabela` responder "AUSENTE", rode aplicar_periodos.sql.
-- ============================================================================

select 'tabela' as item,
       case when to_regclass('public.periodo_trabalho') is not null then 'ok' else 'AUSENTE' end as estado
union all
select 'rls ligado',
       case when relrowsecurity then 'ok' else 'FALHA — policies não filtram nada' end
  from pg_class where oid = 'public.periodo_trabalho'::regclass
union all
select 'policies (esperado 4)',
       coalesce((select count(*)::text from pg_policies
                  where schemaname = 'public' and tablename = 'periodo_trabalho'), '0')
  from pg_class where oid = 'public.periodo_trabalho'::regclass
union all
select 'trigger updated_at',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.periodo_trabalho'::regclass
                            and tgname = 'periodo_trabalho_toca_updated_at')
            then 'ok' else 'FALHA — updated_at congelado' end
  from pg_class where oid = 'public.periodo_trabalho'::regclass
union all
select 'indice aberto unico',
       case when exists (select 1 from pg_indexes
                          where schemaname = 'public'
                            and indexname = 'periodo_trabalho_aberto_unico')
            then 'ok' else 'FALHA — aceita dois periodos abertos' end
  from pg_class where oid = 'public.periodo_trabalho'::regclass
union all
select 'coluna calculo_manual',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'periodo_trabalho'
                            and column_name = 'calculo_manual')
            then 'ok' else 'FALHA — versao antiga do script' end
  from pg_class where oid = 'public.periodo_trabalho'::regclass
union all
select 'coluna valor_total e gerada',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'periodo_trabalho'
                            and column_name = 'valor_total' and is_generated = 'ALWAYS')
            then 'ok' else 'FALHA — total virou campo comum' end
  from pg_class where oid = 'public.periodo_trabalho'::regclass;


-- ---------------------------------------------------------------------------
-- Quais colunas existem de fato. Se aparecer `tocar_updated_at` aqui, a tabela
-- foi criada por uma versão anterior do script, que não tinha o trigger.
-- ---------------------------------------------------------------------------
select column_name, data_type, is_nullable, column_default, is_generated
from information_schema.columns
where table_schema = 'public' and table_name = 'periodo_trabalho'
order by ordinal_position;


-- ---------------------------------------------------------------------------
-- As policies com o texto completo. Compare com a migration: policy diferente
-- da migration significa versão antiga.
-- ---------------------------------------------------------------------------
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'periodo_trabalho'
order by policyname;


-- ---------------------------------------------------------------------------
-- Se a tabela existe e está correta, mas a tela ainda der PGRST204, o
-- problema é o cache do schema do PostgREST, que não recarrega sozinho na hora.
-- Esta query força a recarga:
-- ---------------------------------------------------------------------------
-- notify pgrst, 'reload schema';
