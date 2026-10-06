-- ============================================================================
-- AgroCafé — schema base
--
-- Migração de MySQL/Flask para Postgres/Supabase. Ver docs/PLANO_MIGRACAO.md §3.
--
-- Convenções:
--   * identidade (e-mail, senha) vive em auth.users; aqui só o perfil.
--   * toda tabela de domínio carrega id_usuario uuid -> public.usuario(id).
--   * timestamps em timestamptz, sempre UTC (ver PLANO_MIGRACAO §5.2).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- Perfil do usuário.
-- A identidade (e-mail, senha) fica em auth.users.
--
-- id_usuario do MySQL (int) NÃO é copiado: o ETL mapeia para auth.users.id.
-- O perfil é criado pelo trigger on_auth_user_created (§ trigger_signup).
-- ============================================================================
create table public.usuario (
  id        uuid        primary key references auth.users (id) on delete cascade,
  nome      text        not null check (char_length(btrim(nome)) between 1 and 100),
  foto_url  text,
  ativo     boolean     not null default true,
  criado_em timestamptz not null default now()
);

comment on table public.usuario is
  'Perfil do produtor. Colunas senha_hash, email, pergunta_seguranca e '
  'resposta_hash do MySQL foram removidas: a autenticação passa pelo GoTrue.';

-- ============================================================================
-- Catálogo global de categorias de atividade.
--
-- Sem id_usuario por decisão: é catálogo compartilhado por todos os
-- produtores. No MySQL isso permitia que qualquer autenticado apagasse a
-- categoria dos outros (PLANO_MIGRACAO §4.5). Aqui é somente leitura para o
-- cliente; alterações passam por migration.
-- ============================================================================
create table public.tipo_atividade (
  id    bigint generated always as identity primary key,
  nome  text not null check (char_length(btrim(nome)) between 1 and 100),
  icone text not null default 'Info',
  cor   text not null default 'bg-gray-500'
);

create unique index tipo_atividade_nome_key on public.tipo_atividade (lower(nome));

-- ============================================================================
-- Lavoura.
--
-- id_usuario é NOT NULL de propósito: no MySQL era nullable e havia uma
-- migração de órfãos rodando a cada GET /lavouras (routes.py:132-136) para
-- reatribuir registros sem dono ao usuário que carregava a tela. Descartar os
-- órfãos na ETL permite eliminar esse comportamento (PLANO_MIGRACAO §9.3).
-- ============================================================================
create table public.lavoura (
  id            bigint         generated always as identity primary key,
  nome          text           not null check (char_length(btrim(nome)) between 1 and 100),
  cultura       text           not null check (char_length(btrim(cultura)) between 1 and 50),
  foto_perfil   text,
  area_hectares numeric(12, 2) check (area_hectares is null or area_hectares >= 0),
  localizacao   text,
  data_inicio   date,
  is_pinned     boolean        not null default false,
  id_usuario    uuid           not null references public.usuario (id) on delete cascade
);

-- ============================================================================
-- Atividade.
--
-- O usuário não é dono direto: é dono da lavoura que a contém. O escopo é
-- resolvido por join em lavoura (PLANO_MIGRACAO §4.3).
--
-- data default now() grava o instante corrente em UTC. A lógica que fixava
-- 12:00 para datas passadas (routes.py:262-276) passa a ser do cliente.
-- ============================================================================
create table public.atividade (
  id                bigint      generated always as identity primary key,
  id_lavoura        bigint      not null references public.lavoura (id) on delete cascade,
  id_tipo_atividade bigint      not null references public.tipo_atividade (id) on delete restrict,
  data              timestamptz not null default now(),
  descricao         text,
  responsavel       text        not null default 'Produtor'
);

-- Não há CHECK de "data não pode estar no futuro": exigiria now() (STABLE)
-- dentro de um CHECK, que o Postgres reavalia a cada UPDATE. A validação fica
-- no script de ETL (PLANO_MIGRACAO §5.4).

-- ============================================================================
-- Imagens da atividade.
--
-- foto_url guarda a URL absoluta no Cloudinary (PLANO_MIGRACAO §7: o upload
-- foi mantido no Cloudinary — o Storage do free tier do Supabase tem 1 GB).
-- ============================================================================
create table public.atividade_imagem (
  id           bigint generated always as identity primary key,
  id_atividade bigint not null references public.atividade (id) on delete cascade,
  foto_url     text   not null
);

-- ============================================================================
-- Funcionário.
--
-- id_usuario NOT NULL: os registros sem dono (id_usuario_fk IS NULL) eram
-- seeds legados e serão descartados na ETL (PLANO_MIGRACAO §4.4). Sem eles,
-- as políticas são idênticas às de lavoura — sem leitura de globais.
-- ============================================================================
create table public.funcionario (
  id           bigint         generated always as identity primary key,
  nome         text           not null check (char_length(btrim(nome)) between 1 and 100),
  cargo        text,
  salario_hora numeric(10, 2) check (salario_hora is null or salario_hora >= 0),
  contato      text,
  id_usuario   uuid           not null references public.usuario (id) on delete cascade
);

-- ============================================================================
-- Maquinário.
-- ============================================================================
create table public.maquinario (
  id             bigint         generated always as identity primary key,
  tipo           text,
  modelo         text,
  valor_hora     numeric(12, 2) check (valor_hora is null or valor_hora >= 0),
  consumo_medio  numeric(12, 2) check (consumo_medio is null or consumo_medio >= 0),
  id_usuario     uuid           not null references public.usuario (id) on delete cascade
);

-- ============================================================================
-- Índices para as consultas que o app realmente faz.
-- ============================================================================

-- GET /lavouras
create index lavoura_id_usuario_idx on public.lavoura (id_usuario);

-- feed e GET /lavouras/<id>/atividades
create index atividade_lavoura_data_idx on public.atividade (id_lavoura, data desc);

-- feed global do usuário
create index atividade_data_idx on public.atividade (data desc);

create index atividade_tipo_idx on public.atividade (id_tipo_atividade);
create index atividade_imagem_atividade_idx on public.atividade_imagem (id_atividade);
create index funcionario_id_usuario_idx on public.funcionario (id_usuario);
create index maquinario_id_usuario_idx on public.maquinario (id_usuario);

-- ============================================================================
-- ON DELETE CASCADE de lavoura -> atividade -> imagem substitui o
-- cascade="all, delete-orphan" do SQLAlchemy (lavoura.py:19).
--
-- ON DELETE RESTRICT em tipo_atividade substitui a checagem manual de
-- routes.py:455: o banco recusa o DELETE se houver atividade vinculada.
-- ============================================================================