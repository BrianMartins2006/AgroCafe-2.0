-- ============================================================================
-- AgroCafé — Row Level Security: habilitação + funções auxiliares
--
-- RLS é fail-closed: habilitar antes de criar as políticas (migration 03)
-- significa que, se algo falhar, o acesso é negado em vez de liberado.
-- Ver PLANO_MIGRACAO §4 e §12.
-- ============================================================================

-- ============================================================================
-- Habilita RLS em todas as tabelas de domínio.
--
-- Sobre FORCE ROW LEVEL SECURITY: NÃO é aplicado em public.usuario.
-- O trigger de signup (migration 04) insere em usuario via SECURITY DEFINER;
-- se a tabela fosse FORCE, o dono também passaria pela RLS e o INSERT seria
-- barrado — não existe política de INSERT em usuario, por desenho.
-- Nas demais tabelas o RLS já se aplica ao papel `authenticated`, que é o que
-- o PostgREST usa.
-- ============================================================================
alter table public.usuario          enable row level security;
alter table public.tipo_atividade   enable row level security;
alter table public.lavoura          enable row level security;
alter table public.atividade        enable row level security;
alter table public.atividade_imagem enable row level security;
alter table public.funcionario      enable row level security;
alter table public.maquinario       enable row level security;

-- ============================================================================
-- usuario_ativo() — barrar usuário desativado.
--
-- SECURITY DEFINER + search_path fixo: a função lê public.usuario, que tem
-- RLS própria. Sem os dois, há risco de recursão de política.
--
-- Coalesce(..., false): se o perfil ainda não existir, o usuário é tratado como
-- inativo. O oposto (true) abriria a lavoura de quem não tem linha em usuario.
-- ============================================================================
create or replace function public.usuario_ativo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select ativo from public.usuario where id = auth.uid()),
    false
  );
$$;

comment on function public.usuario_ativo() is
  'true se há perfil de public.usuario para auth.uid() e ele está ativo. '
  'Usada nas políticas de RLS para barrar usuários desativados.';

-- função sem argumentos e sem efeito colateral: não precisa ser pública.
revoke execute on function public.usuario_ativo() from anon;

-- ============================================================================
-- As políticas ficam na migration seguinte.
--
-- Nota sobre desempenho: os EXISTS das políticas são escritos inline de
-- propósito, e não como funções SECURITY DEFINER. Uma função definer é uma
-- cerca de otimização — o Postgres não consegue empurrar os quals de RLS para
-- dentro dela. Inline, o planner avalia direto no índice de
-- lavoura(id_usuario), que é o caminho quente do app.
-- ============================================================================