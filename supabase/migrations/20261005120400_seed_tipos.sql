-- ============================================================================
-- AgroCafé — semente do catálogo de categorias de atividade
--
-- No Flask isso rodava em __init__.py:45-56, a cada boot, se a tabela
-- estivesse vazia. Como o Postgres do Supabase é gerenciado, vira migration.
-- Ver PLANO_MIGRACAO §3.1.
--
-- on conflict do índice único em lower(nome) torna a migration idempotente:
-- rodar duas vezes não duplica o catálogo.
-- ============================================================================

insert into public.tipo_atividade (nome, icone, cor)
values
  ('Adubação',      'Sprouts', 'bg-green-500'),
  ('Colheita',      'Truck',   'bg-orange-500'),
  ('Pulverização',  'Wind',    'bg-blue-500'),
  ('Monitoramento', 'Search',  'bg-yellow-500'),
  ('Outros',        'Info',    'bg-gray-500')
on conflict (lower(nome)) do update
  set icone = excluded.icone,
      cor   = excluded.cor;

-- ============================================================================
-- Ajusta a sequência do identity depois do insert explícito de IDs.
--
-- Sem isso, o próximo insert automático tenta id = 1 e bate numa chave
-- primária já ocupada. Afeta qualquer carga que insira IDs explícitos —
-- inclusive a ETL (PLANO_MIGRACAO §5.2).
-- ============================================================================
select setval(
  pg_get_serial_sequence('public.tipo_atividade', 'id'),
  coalesce((select max(id) from public.tipo_atividade), 1),
  true
);