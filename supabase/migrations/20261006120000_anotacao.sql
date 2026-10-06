-- ============================================================================
-- AgroCafé — anotações livres do produtor
--
-- Espaço independente do resto do sistema: não referencia lavoura, atividade
-- nem funcionário de propósito. O pedido foi "não precisa ser relacionada às
-- outras coisas" — amarrar em lavoura criaria uma FK que ninguém pediu e
-- transformaria a exclusão de talhão em perda silenciosa de anotações.
--
-- Fotos: mesma arquitetura de atividade_imagem — URL absoluta do Cloudinary
-- em coluna, upload feito pelo navegador antes do insert (PLANO_MIGRACAO §7).
-- ============================================================================

create table public.anotacao (
  id           bigint         generated always as identity primary key,
  titulo       text           not null check (char_length(btrim(titulo)) between 1 and 150),
  conteudo     text           check (conteudo is null or char_length(conteudo) <= 5000),
  -- Default auth.uid(): o cliente não manda o dono (mesmo padrão da migration
  -- 20261005120500_view_lavoura). O with check da policy ainda valida — o
  -- default só evita que a tela precise saber qual uuid é o dela.
  id_usuario   uuid           not null default auth.uid() references public.usuario (id) on delete cascade,
  -- Nomes iguais aos de periodo_trabalho de propósito: é o que permite reusar
  -- o trigger tocar_updated_at() em vez de criar uma função gêmea com outro
  -- nome (a função faz `new.updated_at := now()` — coluna diferente não serve).
  created_at   timestamptz    not null default now(),
  updated_at   timestamptz    not null default now()
);

-- Listagem é sempre "minhas anotações, mais recentes primeiro": o índice
-- cobre exatamente esse caminho — filtro por dono + ordenação.
create index anotacao_id_usuario_idx on public.anotacao (id_usuario);
create index anotacao_created_at_idx on public.anotacao (created_at desc);

-- ============================================================================
-- Imagens da anotação.
--
-- Sem política própria: o escopo é derivado do dono da anotação (dois joins
-- como em atividade_imagem). ON DELETE CASCADE cobre apagar a anotação — as
-- URLs no Cloudinary ficam órfãs, que é o comportamento do app inteiro
-- (nenhum delete de asset remoto existe hoje).
-- ============================================================================
create table public.anotacao_imagem (
  id           bigint generated always as identity primary key,
  id_anotacao  bigint not null references public.anotacao (id) on delete cascade,
  foto_url     text   not null
);

create index anotacao_imagem_anotacao_idx on public.anotacao_imagem (id_anotacao);

-- Sem isto as policies abaixo não filtram nada. Habilitar RLS é o que ativa o
-- filtro — feito ANTES das policies, para nunca existir janela aberta.
alter table public.anotacao enable row level security;
alter table public.anotacao_imagem enable row level security;

-- tocar_updated_at() já existe (migration 20261005120800_periodo_trabalho).
-- Reutilizar em vez de criar uma função igual com outro nome: duas funções
-- idênticas com nomes distintos é dívida que alguém paga depois.
create trigger anotacao_toca_updated_at
  before update on public.anotacao
  for each row execute function public.tocar_updated_at();

comment on table public.anotacao is
  'Anotações livres do produtor, sem vínculo com lavoura/atividade. Fotos em anotacao_imagem.';
comment on column public.anotacao.conteudo is
  'Texto livre. Nulo permitido: anotação pode ser só título + fotos.';

-- ============================================================================
-- RLS — escopo por dono direto (id_usuario na linha), como lavoura.
--
-- O with check do update impede reatribuir a anotação a outro usuário: sem
-- ele, daria para trocar id_usuario pelo do vizinho e a linha sumiria do
-- escopo próprio sem erro nenhum.
-- ============================================================================

create policy "anotacao: dono le"
  on public.anotacao for select
  using (id_usuario = auth.uid() and public.usuario_ativo());

create policy "anotacao: dono cria"
  on public.anotacao for insert
  with check (id_usuario = auth.uid() and public.usuario_ativo());

create policy "anotacao: dono altera"
  on public.anotacao for update
  using (id_usuario = auth.uid() and public.usuario_ativo())
  with check (id_usuario = auth.uid());

create policy "anotacao: dono remove"
  on public.anotacao for delete
  using (id_usuario = auth.uid() and public.usuario_ativo());

-- ============================================================================
-- anotacao_imagem — dono derivado, dois joins (imagem -> anotacao -> usuario).
--
-- O join é com anotacao, que carrega id_usuario: não existe caminho de uma
-- imagem pertencer a uma anotacao de outro dono, porque o FK já amarra.
-- ============================================================================

create policy "anotacao_imagem: dono le"
  on public.anotacao_imagem for select
  using (
    public.usuario_ativo()
    and exists (
      select 1
      from public.anotacao a
      where a.id = anotacao_imagem.id_anotacao
        and a.id_usuario = auth.uid()
    )
  );

create policy "anotacao_imagem: dono cria"
  on public.anotacao_imagem for insert
  with check (
    exists (
      select 1
      from public.anotacao a
      where a.id = anotacao_imagem.id_anotacao
        and a.id_usuario = auth.uid()
    )
  );

create policy "anotacao_imagem: dono altera"
  on public.anotacao_imagem for update
  using (
    public.usuario_ativo()
    and exists (
      select 1
      from public.anotacao a
      where a.id = anotacao_imagem.id_anotacao
        and a.id_usuario = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.anotacao a
      where a.id = anotacao_imagem.id_anotacao
        and a.id_usuario = auth.uid()
    )
  );

create policy "anotacao_imagem: dono remove"
  on public.anotacao_imagem for delete
  using (
    public.usuario_ativo()
    and exists (
      select 1
      from public.anotacao a
      where a.id = anotacao_imagem.id_anotacao
        and a.id_usuario = auth.uid()
    )
  );
