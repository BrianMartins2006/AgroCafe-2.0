-- ============================================================================
-- AgroCafé — reparo: acrescenta em public.periodo_trabalho o que falta
--
-- Supabase Dashboard → SQL Editor → New query → colar → Run
--
-- SITUAÇÃO: a tabela existe, com RLS e as 4 policies corretas, mas veio de uma
-- versão anterior do script. Faltam `calculo_manual` e o trigger de
-- `updated_at`. Rode este script em vez de `aplicar_periodos.sql`, que aborta
-- de propósito quando a tabela já existe.
--
-- Idempotente: pode rodar mais de uma vez. Cada passo só age se o objeto
-- ainda não existir, então o script serve tanto para a tabela vazia quanto
-- para uma que já tenha uso.
--
-- O que NÃO é mexido: colunas, índices, checks e policies já existentes.
-- `valor_total` gerada e o RLS ligado já estão corretos (conferidos no
-- diagnóstico) e recriá-los seria risco sem ganho.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. calculo_manual
--
-- Coluna nova. `false` é o default porque a linha existente foi contada pelo
-- calendário, não digitada — e é exatamente o que o app espera para continuar
-- contando um período em aberto.
-- ---------------------------------------------------------------------------
alter table public.periodo_trabalho
  add column if not exists calculo_manual boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Trigger de updated_at
--
-- A coluna updated_at existe desde a criação, mas sem trigger ela congela no
-- valor da inserção: qualquer ordenação por alteração recente mente.
-- ---------------------------------------------------------------------------
create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists periodo_trabalho_toca_updated_at on public.periodo_trabalho;
create trigger periodo_trabalho_toca_updated_at
  before update on public.periodo_trabalho
  for each row execute function public.tocar_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Índice de período aberto único
--
-- Recriado aqui por `if not exists` porque é a garantia de que um funcionário
-- não tem dois períodos abertos — sem ele o mesmo dia seria pago duas vezes.
-- ---------------------------------------------------------------------------
create unique index if not exists periodo_trabalho_aberto_unico
  on public.periodo_trabalho (id_funcionario)
  where data_termino is null;

create index if not exists periodo_trabalho_funcionario_idx
  on public.periodo_trabalho (id_funcionario);

-- ---------------------------------------------------------------------------
-- 4. Comentários da coluna nova (o resto já veio do script anterior)
-- ---------------------------------------------------------------------------
comment on column public.periodo_trabalho.calculo_manual is
  'Verdadeiro quando dias foi digitado pelo usuário. Nesse caso o valor é '
  'autoritativo mesmo com o período em aberto.';

-- ---------------------------------------------------------------------------
-- 5. Recarga do cache do PostgREST
--
-- Sem isto a API continua respondendo PGRST204 ("could not find column in
-- schema cache") mesmo com a coluna criada há segundos: o erro é do cache do
-- schema, não da tabela.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Conferência. Esperado: 5 linhas, todas "ok" / 4 / 1.
-- ---------------------------------------------------------------------------
select 'rls ligado' as item,
       case when relrowsecurity then 'ok' else 'FALHA' end as valor
  from pg_class where oid = 'public.periodo_trabalho'::regclass
union all
select 'calculo_manual',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'periodo_trabalho'
                            and column_name = 'calculo_manual')
            then 'ok' else 'AUSENTE' end
union all
select 'trigger updated_at',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.periodo_trabalho'::regclass
                            and tgname = 'periodo_trabalho_toca_updated_at')
            then 'ok' else 'AUSENTE' end
union all
select 'policies',
       (select count(*)::text from pg_policies
         where schemaname = 'public' and tablename = 'periodo_trabalho')
union all
select 'indice aberto unico',
       case when exists (select 1 from pg_indexes
                          where schemaname = 'public'
                            and indexname = 'periodo_trabalho_aberto_unico')
            then 'ok' else 'AUSENTE' end;
