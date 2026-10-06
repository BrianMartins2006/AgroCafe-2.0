
# Plano de Migração — Flask/MySQL → Supabase (Postgres)

> Documento de trabalho para o **repositório novo**. É autossuficiente: descreve a
> arquitetura alvo, o schema, as políticas de segurança e o passo a passo da migração.
>
> Referência do sistema atual: `ARQUITETURA_ATUAL.md` (copie junto para o repo novo).

---

## 1. Decisão

**Migrate para Supabase (Postgres) e elimine o backend Flask.**

Supabase, e não Firebase: o schema é relacional, com FK e cascade de três níveis
(`Lavoura → Atividade → AtividadeImagem`) e um campo decimal exato para salário. Ver
`ARQUITETURA_ATUAL.md` §5.

### Por que o backend pode sumir

O backend tem **1.140 linhas de código de runtime**, e **toda rota segue o mesmo formato**:

```python
@login_required                                   # 1. autenticar
if recurso.id_usuario_fk != current_user.id:      # 2. checar dono
    return 403
data = request.json                               # 3. ler JSON
db.session.add(Model(...)); db.session.commit()   # 4. CRUD
return jsonify(model.to_dict())                   # 5. serializar
```

Não há regra de negócio, agregação, job, fila ou SQL manual. É CRUD com filtro por
dono — exatamente o que Postgres resolve com Row Level Security.

### Ganho real

| Antes | Depois |
|---|---|
| 9 checagens manuais de dono (`routes.py:165…539`) | 1 política por tabela, garantida pelo banco |
| Cold start de 30–60 s (Render free) | sem sono; região São Paulo |
| ~180 ms de latência (Render nos EUA) | ~30 ms |
| `SameSite=None` + CORS (`config.py:31-38`) | mesma origem, nada disso |
| ~60 linhas de retry de wakeup (`api.ts:29-90`) | deletadas |

## 2. Arquitetura alvo

```
┌──────────────────────────────────────────────────────────────┐
│  Vercel  (frontend React — mesmo repositório de hoje)        │
│                                                              │
│    React + React Query ──► @supabase/supabase-js             │
└───────────────┬──────────────────────────────┬───────────────┘
                │ PostgREST (REST)             │ Auth (JWT)
                ▼                              ▼
      ┌──────────────────────────────────────────────┐
      │  Supabase — região São Paulo (southamerica-  │
      │  east1), projeto único                       │
      │                                              │
      │   Postgres  ── RLS por auth.uid()            │
      │   GoTrue    ── auth.users + reset por e-mail  │
      │   Storage   ── imagens (opcional)             │
      │   Edge Fn   ── o que sobrou (~5 endpoints)    │
      └──────────────────────────────────────────────┘
```

Frontend e API no **mesmo domínio** → sem CORS, sem cookie cross-site.

## 3. Schema alvo

Renomeações escolhidas, para reduzir atrito com o Supabase e com `auth.users`:

| Atual (MySQL) | Novo (Postgres) | Motivo |
|---|---|---|
| `usuario.id_usuario` | `usuario.id` | casa com `auth.users.id` |
| `funcionario.id_funcionario` | `funcionario.id` | consistência |
| `*.id_usuario_fk` | `*.id_usuario` | convenção Postgres |

Colunas **removidas** de `usuario`: `senha_hash` (incompatível — ver §6), `email`
(dup de `auth.users`), `pergunta_seguranca`, `resposta_hash` (§6).

Tabelas **removidas**: `permissao`, `usuario_permissao` e `atividade_funcionario` — nunca
consultadas por rota nenhuma, mas que **existem no MySQL** (ver `ARQUITETURA_ATUAL.md`
§5.3). Confira se têm linhas antes de descartar.

```sql
-- ============================================================================
-- Extensões
-- ============================================================================
create extension if not exists "pgcrypto";

-- ============================================================================
-- Perfil do usuário. A identidade (e-mail, senha) fica em auth.users.
-- ============================================================================
create table public.usuario (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text        not null check (char_length(nome) between 1 and 100),
  foto_url    text,
  ativo       boolean     not null default true,
  criado_em   timestamptz not null default now()
);

-- ============================================================================
-- Catálogo global de categorias de atividade
-- ============================================================================
create table public.tipo_atividade (
  id    bigint generated always as identity primary key,
  nome  text not null check (char_length(nome) between 1 and 100),
  icone text not null default 'Info',
  cor   text not null default 'bg-gray-500'
);

-- ============================================================================
-- Lavoura
-- ============================================================================
create table public.lavoura (
  id             bigint generated always as identity primary key,
  nome           text        not null check (char_length(nome) between 1 and 100),
  cultura        text        not null check (char_length(cultura) between 1 and 50),
  foto_perfil    text,
  area_hectares  numeric(12,2) check (area_hectares is null or area_hectares >= 0),
  localizacao    text,
  data_inicio    date,
  is_pinned      boolean     not null default false,
  id_usuario     uuid        references public.usuario(id) on delete cascade
);

-- ============================================================================
-- Atividade
-- ============================================================================
create table public.atividade (
  id                   bigint generated always as identity primary key,
  id_lavoura           bigint      not null references public.lavoura(id) on delete cascade,
  id_tipo_atividade    bigint      not null references public.tipo_atividade(id) on delete restrict,
  data                 timestamptz not null default now(),
  descricao            text,
  responsavel          text        default 'Produtor'
);

-- ============================================================================
-- Imagens da atividade
-- ============================================================================
create table public.atividade_imagem (
  id             bigint generated always as identity primary key,
  id_atividade   bigint not null references public.atividade(id) on delete cascade,
  foto_url       text   not null
);

-- ============================================================================
-- Funcionário e maquinário
-- ============================================================================
create table public.funcionario (
  id            bigint generated always as identity primary key,
  nome          text        not null check (char_length(nome) between 1 and 100),
  cargo         text,
  salario_hora  numeric(10,2) check (salario_hora is null or salario_hora >= 0),
  contato       text,
  id_usuario    uuid        references public.usuario(id) on delete cascade
);

create table public.maquinario (
  id               bigint generated always as identity primary key,
  tipo             text,
  modelo           text,
  valor_hora       numeric(12,2),
  consumo_medio    numeric(12,2),
  id_usuario       uuid references public.usuario(id) on delete cascade
);

-- ============================================================================
-- Índices para as consultas que o app realmente faz
-- ============================================================================
create index on public.lavoura          (id_usuario);
create index on public.atividade        (id_lavoura, data desc);
create index on public.atividade_imagem (id_atividade);
create index on public.funcionario      (id_usuario);
create index on public.maquinario       (id_usuario);

-- ============================================================================
-- ON DELETE CASCADE de lavoura → atividade → imagem substitui o
-- cascade="all, delete-orphan" do SQLAlchemy (lavoura.py:19).
-- ON DELETE RESTRICT em tipo_atividade substitui a checagem manual
-- de routes.py:455.
-- ============================================================================
```

### 3.1 Semente do catálogo

As categorias padrão são criadas hoje em `__init__.py:45-56` **na inicialização, se a
tabela estiver vazia**. Isso vira uma migration:

```sql
insert into public.tipo_atividade (nome, icone, cor) values
  ('Adubação',      'Sprouts', 'bg-green-500'),
  ('Colheita',      'Truck',   'bg-orange-500'),
  ('Pulverização',  'Wind',    'bg-blue-500'),
  ('Monitoramento', 'Search',  'bg-yellow-500'),
  ('Outros',        'Info',    'bg-gray-500');
```

## 4. Row Level Security — o coração da mudança

Ative em **todas** as tabelas antes de qualquer insert:

```sql
alter table public.usuario          enable row level security;
alter table public.tipo_atividade   enable row level security;
alter table public.lavoura          enable row level security;
alter table public.atividade        enable row level security;
alter table public.atividade_imagem enable row level security;
alter table public.funcionario      enable row level security;
alter table public.maquinario       enable row level security;
```

Função auxiliar para barrar usuário desativado:

```sql
create or replace function public.usuario_ativo()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select ativo from public.usuario where id = auth.uid()),
    false
  );
$$;
```

> `security definer` + `search_path` fixo: a função lê `usuario`, que tem RLS própria, e
> não pode cair num recursion infinito de políticas.

### 4.1 `usuario`

```sql
create policy "usuario: lê o próprio perfil"
  on public.usuario for select
  using (id = auth.uid());

create policy "usuario: atualiza o próprio perfil"
  on public.usuario for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- INSERT é feito por trigger no auth.users, não pelo cliente (§4.6)
```

### 4.2 `lavoura` — escopo por dono

```sql
create policy "lavoura: dono lê"
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
```

⚠️ O `with check` no `update` impede que uma linha seja reatribuída a outro usuário.

### 4.3 `atividade` e `atividade_imagem` — escopo via join

O usuário não é dono direto de `atividade`; é dono da **lavoura** que a contém.

```sql
create policy "atividade: dono da lavoura lê"
  on public.atividade for select
  using (
    exists (
      select 1 from public.lavoura l
      where l.id = atividade.id_lavoura
        and l.id_usuario = auth.uid()
    ) and public.usuario_ativo()
  );

create policy "atividade: dono da lavoura escreve"
  on public.atividade for all
  using (
    exists (
      select 1 from public.lavoura l
      where l.id = atividade.id_lavoura
        and l.id_usuario = auth.uid()
    ) and public.usuario_ativo()
  )
  with check (
    exists (
      select 1 from public.lavoura l
      where l.id = atividade.id_lavoura
        and l.id_usuario = auth.uid()
    ) and public.usuario_ativo()
  );
```

O mesmo para `atividade_imagem`, descendo mais um nível:

```sql
create policy "imagem: dono da lavoura lê"
  on public.atividade_imagem for select
  using (
    exists (
      select 1
      from public.atividade a
      join public.lavoura l on l.id = a.id_lavoura
      where a.id = atividade_imagem.id_atividade
        and l.id_usuario = auth.uid()
    ) and public.usuario_ativo()
  );

create policy "imagem: dono da lavoura escreve"
  on public.atividade_imagem for all
  using (
    exists (
      select 1
      from public.atividade a
      join public.lavoura l on l.id = a.id_lavoura
      where a.id = atividade_imagem.id_atividade
        and l.id_usuario = auth.uid()
    ) and public.usuario_ativo()
  )
  with check (
    exists (
      select 1
      from public.atividade a
      join public.lavoura l on l.id = a.id_lavoura
      where a.id = atividade_imagem.id_atividade
        and l.id_usuario = auth.uid()
    ) and public.usuario_ativo()
  );
```

### 4.4 `funcionario` e `maquinario` — o padrão "próprio ou global"

O app atual lista `(id_usuario = eu) OR (id_usuario IS NULL)` (`routes.py:475`, `517`).
Os registros sem dono são seeds legados. Decisão: **continuar lendo os globais, mas
permitir escrita apenas do próprio** — é o comportamento atual, sem abrir brecha.

```sql
create policy "funcionario: lê próprio ou global"
  on public.funcionario for select
  using (public.usuario_ativo() and (id_usuario is null or id_usuario = auth.uid()));

create policy "funcionario: cria o próprio"
  on public.funcionario for insert
  with check (id_usuario = auth.uid() and public.usuario_ativo());

create policy "funcionario: altera o próprio"
  on public.funcionario for update
  using (id_usuario = auth.uid() and public.usuario_ativo())
  with check (id_usuario = auth.uid());

create policy "funcionario: remove o próprio"
  on public.funcionario for delete
  using (id_usuario = auth.uid() and public.usuario_ativo());
```

Repita para `maquinario`.

> **Pergunta para decidir antes de codar:** "registro global" é uma funcionalidade de
> verdade, ou só lixo de seed? Se for lixo, apague os órfãos na ETL e troque as políticas
> por cópias diretas de `lavoura` — mais simples e mais rápido.

### 4.5 `tipo_atividade` — só leitura ⚠️

**Bug encontrado na auditoria.** `tipo_atividade` **não tem `id_usuario`** e as rotas
`POST`/`PUT`/`DELETE` têm apenas `@login_required`, sem checagem de dono
(`routes.py:426-466`). Na prática: **qualquer usuário autenticado apaga a categoria que
os outros usam.** O `GET /lavouras` de qualquer usuário novo recria as cinco padrão
(`__init__.py:45-56`), o que mascara o problema.

No Supabase, trate como catálogo: leitura liberada, escrita fora do alcance do cliente.

```sql
create policy "tipo_atividade: qualquer autenticado lê"
  on public.tipo_atividade for select
  using (auth.role() = 'authenticated');
```

Sem política de `insert`/`update`/`delete` → o cliente não escreve. Alterações passam por
migration SQL.

### 4.6 Criar perfil no signup

```sql
create or replace function public.handle_novo_usuario()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.usuario (id, nome)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_novo_usuario();
```

O frontend passa a mandar `signUp({ email, password, options: { data: { nome } } })`.

## 5. Migração de dados

### 5.1 Bloqueio

O passo crítico é **não** escrever direto no Postgres de produção. Duas fases:

1. **Exportação e validação** — leia do MySQL, Grave num Postgres de staging, compare
   contagens. Repita até bater.
2. **Carga final** — quando os usuários já estiverem usando o sistema novo, um último
   delta. Ou, se o sistema ficar em modo somente-leitura durante a troca, uma carga
   única.

### 5.2 Conversões que exigem atenção

| Origem (MySQL) | Destino (Postgres) | Cuidado |
|---|---|---|
| `id` auto-increment | `bigint` + `setval` | importa com ID explícito; **ajuste a sequência depois** ou os próximos inserts colidem |
| `usuario.id_usuario` (int) | `usuario.id` (**uuid**) | **não copia.** Mapeia para `auth.users.id`. Ver §5.3 |
| `id_usuario_fk` (int) | `id_usuario` (uuid) | precisa do mapeamento int → uuid |
| `Numeric(10,2)` | `numeric(10,2)` | mapping direto; não usar float |
| `DateTime` | `timestamptz` | ⚠️ ver abaixo |
| `Date` | `date` | direto |

⚠️ **Bug de fuso horário no dado atual.** A coluna `atividade.data` recebe **datetime
com e sem timezone**, misturados:

- `routes.py:262` → `datetime.now(timezone.utc)` (com TZ)
- `routes.py:270` → `datetime.combine(date, 12:00)` (**sem TZ**)
- `routes.py:326` → `datetime.now()` (**sem TZ**, e `now()` local, não UTC!)

`routes.py:326` é o branch de `PUT` e usa `now()` local — é a origem do bug de horário
que já estava no `PLAN_DE_MELHORIAS.md` ("Garantir horário de Brasília UTC-3").

Antes da ETL, **decida a convenção** e aplique uma vez:
MySQL não guarda offset, então `timestamptz` vai assumir o fuso do servidor. Se o MySQL
está em UTC, `at time zone 'UTC'` resolve. Verifique com:

```sql
select @@global.time_zone, @@session.time_zone;
```

Recomendação: salvar tudo em UTC, converter para o fuso do produtor só na interface.

### 5.3 Ordem de carga (FKs obrigatórias)

```
1. auth.users          (via Admin API do GoTrue, ou criação manual no dashboard)
2. public.usuario      (mapeando id_usuario int → auth.users.id uuid)
3. tipo_atividade      (mapear nome → id; é um catálogo pequeno)
4. lavoura             (id_usuario_fk int → uuid)
5. atividade
6. atividade_imagem
7. funcionario, maquinario
```

### 5.4 Checklist de validação

Rode antes e depois e compare. Não pule.

```sql
-- contagens
select 'usuario'          as t, count(*) from usuario
union all select 'lavoura',          count(*) from lavoura
union all select 'atividade',        count(*) from atividade
union all select 'atividade_imagem', count(*) from atividade_imagem
union all select 'funcionario',      count(*) from funcionario
union all select 'maquinario',       count(*) from maquinario;

-- órfãos (o app atual tem lógica de migração para esses, routes.py:132-136)
select count(*) from lavoura where id_usuario is null;

-- integridade referencial
select count(*) from atividade a
  left join lavoura l on l.id = a.id_lavoura
  where l.id is null;

-- actividades sem imagem / imagens sem atividade
select count(*) from atividade a
  where not exists (select 1 from atividade_imagem i where i.id_atividade = a.id);
```

⚠️ `routes.py:132-136` reatribui **todos** os órfãos ao usuário que está carregando a
tela. Se isso já rodou em produção, o banco pode ter registros hoje atribuídos ao
usuário errado. **Não tente corrigir isso na ETL** — não há como saber a origem. Aceite
e siga.

## 6. Migração de autenticação — o ponto mais delicado

### 6.1 Os hashes existentes não são compatíveis

`usuario.senha_hash` usa `werkzeug.security.generate_password_hash`, cujo default é
**scrypt** (ou PBKDF2 em versões antigas).

O GoTrue (auth do Supabase) verifica **exclusivamente bcrypt**.

**Não há conversão possível.** Não existe caminho para manter as senhas atuais — nem
convertendo o hash, nem mudando o algoritmo do GoTrue.

### 6.2 Decisão: forçar reset de senha

Esqueça ponte de hash, tabela paralela ou Edge Function Python. A abordagem correta é:

1. Na ETL, crie cada usuário via Admin API do GoTrue
   (`POST /auth/v1/admin/users`, com `email_confirm: true`).
2. Sem senha definida (ou com uma aleatória que nunca é comunicada).
3. Envie **"Redefinir senha"** — o link de recuperação do Supabase funciona.

Trade-off: cada usuário existente precisa redefinir a senha uma vez.

### 6.3 ⚠️ O SMTP padrão não serve para produção

O SMTP embutido do Supabase é limitado a **poucos e-mails por hora** e com enforced
rate limit — insuficiente para recuperação de senha em produção.

Configure um provedor próprio em *Authentication → Providers → Email → SMTP*:

| Opção | Free tier |
|---|---|
| Resend | 3.000 e-mails/mês |
| Brevo (Sendinblue) | 300 e-mails/dia |
| AWS SES | pay-per-use, ~US$0,10/1.000 |

Com Resend free, 3.000 resets por mês cobrem folgado um sistema pessoal.

### 6.4 Migração do cadastro

| Antes | Depois |
|---|---|
| `POST /auth/register` → Flask cria usuário | `supabase.auth.signUp({ email, password, options: { data: { nome } } })` |
| `POST /auth/login` | `supabase.auth.signInWithPassword({ email, password })` |
| `POST /auth/logout` | `supabase.auth.signOut()` |
| `POST /auth/forgot-password` → **devolve `pergunta_seguranca`** | `supabase.auth.resetPasswordForEmail(email, { redirectTo })` |
| `POST /auth/reset-password` → compara `resposta_hash` | `supabase.auth.updateUser({ password })` numa rota protegida por sessão de recovery |

**Delete** `pergunta_seguranca` / `resposta_hash` e a migration de
`__init__.py:68-74` que definia resposta padrão `"agrocafe"`.

> Nota de segurança: o fluxo antigo **revela a pergunta de segurança para qualquer
> e-mail válido** (`routes.py:78-80`). Quem soubesse o e-mail de alguém e acertasse a
> resposta genérica assumia a conta. O reset por e-mail elimina essa classe de problema.

## 7. O que fazer com o upload

Hoje `POST /upload` sobe para o Cloudinary (`routes.py:369-424`). Duas opções:

**A) Manter o Cloudinary** (menos trabalho). Gere uma assinatura de upload no backend e
o cliente envia direto ao Cloudinary, pulando o proxy do backend.

**B) Supabase Storage.** Elimina mais uma dependência. Requer as políticas de storage
equivalentes às de §4.3:

```sql
create policy "imagens: dono da lavoura gerencia"
  on storage.objects for all
  using (
    bucket_id = 'atividades'
    and exists (
      select 1
      from public.atividade a
      join public.lavoura l on l.id = a.id_lavoura
      where a.id::text = (storage.foldername(name))[1]
        and l.id_usuario = auth.uid()
    )
  );
```

⚠️ Se for Storage, a coluna `atividade_imagem.foto_url` passa a guardar o caminho
(`atividades/<id_atividade>/<arquivo>`), e não a URL. Ajuste `to_dict()` — que hoje
injeta transformações de URL do Cloudinary (`atividade_imagem.py:15-19`).

## 8. O que sobra como Edge Function

Só o que o Postgres não resolve sozinho:

| # | Caso | Observação |
|---|---|---|
| 1 | Upload assinado | §7 |
| 2 | Normalização de data | a lógica de `routes.py:262-276` e `320-333`. Alternativa melhor: uma função SQL `immutable` chamada via RPC, ou resolver no cliente |
| 3 | `GET /feed` | se a consulta aninhada ficar cara, um `VIEW` ou função SQL |
| 4 | `ultima_atividade_date` | hoje é property que dispara query sob demanda (`lavoura.py:20-30`). Vira uma view ou coluna gerada |
| 5 | Compatibilidade | se quiser manter o contrato `/api/v1/*` idêntico durante a transição |

O `GET /lavouras` com `joinedload(Lavoura.atividades)` + `ultima_atividade_date`
(`routes.py:138-142`) é o caso que mais merece atenção: hoje ele faz **N+1 queries**,
uma por lavoura. No Postgres, resolva com uma view ou `json_agg` e ganhe performance
além da migração.

## 9. Ordem de execução

Cada fase é reversível. **Nenhuma delas toca produção.**

| Fase | Entrega | Reversão |
|---|---|---|
| **0** | Provisionar: projeto Supabase (região **São Paulo**) + projeto Vercel de staging | apagar o projeto |
| **1** | Schema + RLS + semente (§3, §4) | `drop schema public cascade` |
| **2** | ETL de staging + validação (§5) | `truncate` |
| **3** | Edge Functions + apontar staging | reverter URL |
| **4** | Validar com dados reais em staging | — |
| **5** | Trocar o frontend para `supabase-js`; deletar `api.ts` | reverter commit |
| **6** | Cutover; **Render fica no ar por 1 semana** | voltar `VITE_API_URL` |

**Estaging no Vercel:** a Vercel cria um preview automático por branch e por PR. Suba a
branch de migração, aponte a `VITE_API_URL` do preview para as Edge Functions e ganhe um
ambiente de teste isolado sem configurar nada.

**O botão de escape da fase 6:** o frontend inteiro lê a URL da API de **uma variável
só** — `VITE_API_URL` em `services/api.ts:3`, `utils/media.ts:1` e
`NewLavouraPage.tsx:10`. Trocar a variável aponta o sistema inteiro para outro backend.
Estrutura de rollback: mudar env var, redeploy da Vercel (segundos).

## 10. Código a deletar (com risco controlado)

Apague **depois** da fase 5, junto com o backend:

| Alvo | Onde | Linhas |
|---|---|---|
| Toast de wakeup + retries 502/503 | `services/api.ts` | ~60 |
| Hack de cookie cross-site | `config.py` | 8 |
| CORS cross-site | `app/__init__.py:18` | 1 |
| Migração de órfãos em runtime | `routes.py:132-136` | 5 |
| Hook `after_delete` de arquivo local | `models/atividade_imagem.py:29-45` | 17 |
| Pergunta/resposta de segurança | `routes.py:69-98`, `models/user_model.py:43-46` | ~35 |
| `Permissao` + `usuario_permissao` (morto) | `models/permissao_model.py`, `models/user_model.py:20-27` | ~35 |
| Prints de debug | `routes.py:275,297,333,400,423` | 5 |
| Traceback na resposta | `app/__init__.py:76-94` | ~19 |

## 11. Correções de segurança a fazer no caminho

Não são pré-requisito da migração, mas o Supabase deixa barato corrigir:

1. **`tipo_atividade` sem dono e gravável por qualquer autenticado** — §4.5. É a mais
   grave: um usuário apaga a categoria dos outros.
2. **`POST /upload` sem `@login_required`** (`routes.py:369`) — qualquer um pode subir
   arquivo para a sua conta do Cloudinary.
3. **Traceback no corpo do erro** (`app/__init__.py:76-94`) — expõe caminho de arquivo,
   versão de biblioteca e estrutura interna. Logar no servidor, responder genérico.
4. **`api_key` do Cloudinary em log de produção** (`routes.py:400`).
5. **Handler genérico de `Exception` → 500** (`app/__init__.py:85`) — transforma erro de
   negócio em erro de servidor.
6. **Leitura de registro global** (§4.4) — decide se é funcionalidade ou lixo.

## 12. Armadilhas

- **`db.create_all()` não migra.** Em `__init__.py:43` só cria tabelas ausentes. Como
  o Supabase é gerenciado, **todas** as mudanças de schema passam por
  `supabase migration`. Não haverá `ALTER` implícito.
- **`Numeric` vs `float`.** `salario_hora` é dinheiro. `float` acumula erro de
  arredondamento; o frontend já converte (`funcionario_model.py:26`).
- **RLS não é retroativo.** Ative antes do primeiro insert, senão o service role
  (usado na ETL) passa e o anon/authenticated não enxerga nada.
- **`security definer` e `search_path`.** Funções que leem tabelas com RLS precisam
  dos dois, senão há recursão de política.
- **`FORCE ROW LEVEL SECURITY`.** Se o dono da tabela for o mesmo usuário do app, a RLS
  não se aplica a ele. Use `alter table ... force row level security`.
- **Limite de e-mail.** §6.3.
- **Região do Supabase.** Crie o projeto em **São Paulo** desde o começo — região não
  pode ser alterada depois.
- **`atualidade` do PWA.** O Workbox faz cache de `/api/v1/*` por 24 h com
  `StaleWhileRevalidate` (`vite.config.ts`). Ao migrar, isso pode servir dado velho
  durante um tempo. Ajuste a estratégia de cache junto com a migração.
