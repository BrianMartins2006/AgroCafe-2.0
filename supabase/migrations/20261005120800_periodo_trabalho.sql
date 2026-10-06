-- ============================================================================
-- Período de trabalho: valor por dia, datas e total calculado.
--
-- Substitui a contagem manual que o MySQL não tinha. `atividade_funcionario`
-- (horas trabalhadas por tarefa) existia no Flask mas nunca foi migrada e não
-- responde a esta pergunta — aqui o que se registra é o período inteiro.
--
-- O total é coluna GERADA, não campo preenchido pelo cliente. Assim o valor
-- gravado é sempre `dias * valor_dia` por definição: não existe caminho em que
-- o número exibido divirja do cálculo, nem erro de arredondamento no cliente.
-- Consequência prática: o INSERT e o UPDATE não podem mandar `valor_total`
-- (o Postgres responde "cannot insert a non-DEFAULT value").
--
-- `dias` é a quantidade EFETIVA, não a diferença bruta entre as datas. É o que
-- permite as duas coisas que o usuário pediu: excluir dias específicos
-- (`dias_descartados`) ou digitar a quantidade direto, sem abrir calendário.
-- Nos dois casos o resultado cai no mesmo campo e o total segue a conta.
--
-- A data de término pode ficar nula = período em aberto, que conta até hoje.
-- ============================================================================

create table public.periodo_trabalho (
  id                bigint         generated always as identity primary key,
  id_funcionario    bigint         not null references public.funcionario (id) on delete cascade,

  data_inicio       date           not null,
  -- Nulo significa "ainda não terminou": o período segue correndo até hoje.
  -- A checagem abaixo existe para o inverso — término antes do início — que
  -- resultaria em dias negativos.
  data_termino      date           check (data_termino is null or data_termino >= data_inicio),

  valor_dia         numeric(10, 2) not null check (valor_dia >= 0),

  -- Quantos dias foram efetivamente trabalhados. Sempre > 0: um período de
  -- zero dias não é um período, é erro de preenchimento.
  dias              integer        not null check (dias > 0),

  -- Marca se `dias` foi ditado pelo usuário em vez de derivado das datas.
  -- Sem isto o app não distingue "contei pelo calendário e deu 20" de "digitei
  -- 20": os dois gravam 20, mas só o primeiro deve continuar contando até hoje
  -- enquanto o período estiver aberto. Persistir o modo é o que impede um
  -- lançamento manual de ser sobrescrito pelo cálculo automático.
  calculo_manual    boolean        not null default false,

  -- Calculado pelo banco. Não inserir.
  valor_total       numeric(12, 2) generated always as (dias * valor_dia) stored,

  -- Dias dentro do período em que não houve trabalho. Alimenta o mesmo `dias`.
  -- Guardar aqui em vez de tabela filha porque o caso é poucos dias avulsos e
  -- não consulta: o total já está materializado em `dias`.
  dias_descartados  date[]         not null default '{}',

  observacao        text           check (observacao is null or char_length(observacao) <= 500),

  created_at        timestamptz    not null default now(),
  updated_at        timestamptz    not null default now()
);

create index periodo_trabalho_funcionario_idx
  on public.periodo_trabalho (id_funcionario);

-- Um funcionário não pode ter dois períodos em aberto: os dois contariam até
-- hoje e o mesmo dia seria pago duas vezes. Períodos fechados podem se
-- repetir livremente, que é o caso de quem saiu e voltou.
create unique index periodo_trabalho_aberto_unico
  on public.periodo_trabalho (id_funcionario)
  where data_termino is null;

-- Sem isto as policies abaixo não filtram nada e a tabela fica legível por
-- qualquer papel, inclusive anon. Habilitar RLS é o que ativa o filtro.
alter table public.periodo_trabalho enable row level security;

-- Primeira tabela do schema com updated_at, então o toque de timestamp é
-- criado aqui. Sem trigger a coluna ficaria congelada no valor da inserção e
-- ordenação por alteração recente mentiria.
create function public.tocar_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger periodo_trabalho_toca_updated_at
  before update on public.periodo_trabalho
  for each row execute function public.tocar_updated_at();

comment on column public.periodo_trabalho.calculo_manual is
  'Verdadeiro quando dias foi digitado pelo usuário. Nesse caso o valor é '
  'autoritativo mesmo com o período em aberto.';
comment on column public.periodo_trabalho.dias is
  'Dias efetivamente trabalhados. Resultado do cálculo por datas, dos '
  'dias_descartados, ou digitado direto pelo usuário.';
comment on column public.periodo_trabalho.valor_total is
  'Gerado pelo banco como dias * valor_dia. Não é possível divergir.';
comment on column public.periodo_trabalho.data_termino is
  'Nulo = período em aberto, contando até a data de hoje.';

-- ============================================================================
-- RLS — escopo por dono, herdado do funcionário.
--
-- Mesma forma da atividade: nada de id_usuario na linha, o dono vem do join
-- com funcionario. Uma conta não enxerga nem toca no período do outro.
-- ============================================================================

create policy "periodo_trabalho: dono do funcionario le"
  on public.periodo_trabalho for select
  using (
    public.usuario_ativo()
    and exists (
      select 1
      from public.funcionario f
      where f.id = periodo_trabalho.id_funcionario
        and f.id_usuario = auth.uid()
    )
  );

create policy "periodo_trabalho: dono do funcionario cria"
  on public.periodo_trabalho for insert
  with check (
    exists (
      select 1
      from public.funcionario f
      where f.id = periodo_trabalho.id_funcionario
        and f.id_usuario = auth.uid()
    )
  );

create policy "periodo_trabalho: dono do funcionario altera"
  on public.periodo_trabalho for update
  using (
    public.usuario_ativo()
    and exists (
      select 1
      from public.funcionario f
      where f.id = periodo_trabalho.id_funcionario
        and f.id_usuario = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.funcionario f
      where f.id = periodo_trabalho.id_funcionario
        and f.id_usuario = auth.uid()
    )
  );

create policy "periodo_trabalho: dono do funcionario remove"
  on public.periodo_trabalho for delete
  using (
    public.usuario_ativo()
    and exists (
      select 1
      from public.funcionario f
      where f.id = periodo_trabalho.id_funcionario
        and f.id_usuario = auth.uid()
    )
  );