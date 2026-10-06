# Estado da Migração — AgroCafé → Supabase

> Documento de passagem de turno. Serve para retomar o trabalho do zero se a
> sessão for perdida. Atualizar ao fim de cada fase.

**Última atualização:** 06/10/2026 — Fases C e D concluídas. Frontend 100% no Supabase; `api.ts`, proxy Flask e cache de API do PWA removidos. Cache de atividades corrigido, CRUD de categorias liberado, foto do cadastro persistida. **Nada commitado ainda** — branch `main` no commit `7f74a12` com ~34 arquivos modificados/novos no working tree.
**Workspace:** `/home/brian/AgroCaf-2.0/AgroCafé` (branch `main`)
**Projeto Supabase:** `apwmdbtpczylzowfrmvb` — https://apwmdbtpczylzowfrmvb.supabase.co (São Paulo)
**Verificação no último ponto:** `tsc` limpo, build verde (7s), **46 testes** (36 RLS/PGlite + 10 de data) passando.

---

## 1. Decisões já tomadas (não reabrir sem motivo novo)

| Tema | Decisão |
|---|---|
| Dados antigos | **Nenhuma migração.** App novo, sem ETL. Órfãos descartados. |
| Senhas antigas | Descartadas. Nenhum hash é importado. |
| Credenciais MySQL | Não são mais necessárias. |
| Auth | Supabase Auth (GoTrue), sessão real, sem pergunta de segurança. |
| Recuperação de senha | Só por e-mail, resposta genérica (não enumera contas). |
| E-mail | SMTP embutido do Supabase. Limite de ~2 e-mails/hora. |
| Backend | Eliminado. Cliente fala direto com o Postgres via RLS. |
| Imagens | Cloudinary, **unsigned upload preset**, direto do navegador. |
| Granularidade | Uma tela por vez, validada no navegador antes da próxima. |
| Guarda de rota | Baseada na sessão do Supabase. `onboarding_complete` **não** decide acesso. |

### Constraint do SMTP embutido
Só Brian e a esposa usam o app. Ambos precisam estar como membros da
**organação Supabase**, senão o limite de e-mails trava. Antes de testar reset de
senha da esposa, adicionar o e-mail dela em *Organization → Members*.

---

## 2. Estado do banco (aplicado no projeto real)

Migrations aplicadas com `npx supabase db push`. Confirmado via
`supabase inspect db table-stats --linked`: **7 tabelas** + **5 categorias** semeadas.

| Migration | Conteúdo |
|---|---|
| `20261005120000_schema.sql` | `usuario`, `lavoura`, `tipo_atividade`, `atividade`, `imagem`, `funcionario`, `maquinario` |
| `20261005120100_rls.sql` | `enable RLS` em todas + função `usuario_ativo()` |
| `20261005120200_policies.sql` | 23 políticas (`usuario` 2, `tipo_atividade` 1, demais 4 cada) |
| `20261005120300_trigger_signup.sql` | `on_auth_user_created` → cria `public.usuario` |
| `20261005120400_seed_tipos.sql` | catálogo de tipos de atividade |
| `20261005120500_view_lavoura.sql` | `default auth.uid()` em `id_usuario` + view `lavoura_com_ultima_atividade` |
| `20261005120600_tipo_atividade_escrita.sql` | INSERT/UPDATE/DELETE no catálogo de categorias. **Aplicada** |
| `20261005120700_trigger_foto_perfil.sql` | trigger de signup grava `foto_url`. **PENDENTE de aplicar** |
| `20261005120800_periodo_trabalho.sql` | `periodo_trabalho`: valor/dia, datas, `dias`, total gerado, RLS. **PENDENTE de aplicar** |

Decisões de modelagem que já estão travadas no schema:
- `lavoura`, `funcionario`, `maquinario` têm `id_usuario NOT NULL` (dono obrigatório).
- `atividade.data` é `timestamptz`.
- `public.usuario` **sem `FORCE RLS`** — forçar quebraria o próprio trigger de signup.

### Testes
```
cd supabase/tests && npm run test:all   # 55 RLS + 10 data + 45 período + 21 script
```
Rodam sobre PGlite (Postgres real em memória), não em mock. Cobrem isolamento
entre dois usuários, IDOR, integridade do catálogo, `usuario` desativado, anon,
integridade de FK, cascade `lavoura → atividade → imagem`, o default de dono e o
isolamento da view.

**`security_invoker` na view:** sem essa opção a view roda com privilégios de
dono do schema e ignora a RLS de `lavoura`/`atividade` — as duas contas
veriam as lavouras uma da outra. Há teste dedicado a isso, e é o motivo de a
view ser a solução e não um `select` aninhado do PostgREST.

---

## 3. Fase B — Autenticação (CONCLUÍDA)

**Arquivos novos**
- `frontend/src/lib/supabase.ts` — cliente único; falha alto se env ausente.
- `frontend/src/hooks/useAuth.tsx` — `AuthProvider`, `useAuth`, `RotaPrivada`.
  Funções: `entrar`, `cadastrar`, `sair`, `pedirReset`.
- `frontend/src/pages/RedefinirSenhaPage.tsx`
- `frontend/.env.local.example`
- `supabase/tests/` (harness PGlite), `supabase/verify.sql`

**Arquivos reescritos**
- `frontend/src/App.tsx` — `AuthProvider` + `RotaPrivada` em volta das rotas.
- `frontend/src/pages/ForgotPasswordPage.tsx` — sem pergunta de segurança.
- `frontend/src/pages/LoginPage.tsx` — usa `entrar()`.
- `frontend/src/pages/WelcomePage.tsx` — usa `cadastrar()`.
- `frontend/src/pages/SettingsPage.tsx` — usa `sair()`.

**Removido do fluxo de auth:** chamadas a `api.ts`, evento `app:login`,
`localStorage.onboarding_complete`, pergunta/resposta de segurança.

**Dependências:** `@supabase/supabase-js ^2.117.2` adicionado, `axios` removido
(não era usado). `package-lock.json` atualizado. `yarn.lock` **não** foi tocado
por esta fase.

### Bugs corrigidos durante a Fase B
- `signInWithPassword` exige `password`, não `senha` (erro de tipo, pego pelo `tsc`).
- `onAuthStateChange` retorna `{ data: { subscription } }` → unsubscribe é
  `onLogout.data.subscription`.
- **`SettingsPage` fazia `localStorage.clear()` em "Limpar cache".** A sessão do
  Supabase vive em localStorage (`sb-<ref>-auth-token`), então aquele botão
  deslogava o usuário. Agora preserva as chaves `sb-` antes de limpar. Nenhum
  teste automatizado pegaria isso.

### Estado de validação (após as Fases C e D)
- `npm run build` — **verde**.
- `npm run test:all` — **55/55** no PGlite (RLS) + **10/10** em `teste-data.mjs`
  + **45/45** em `teste-periodo.mjs` + **21/21** em `teste-script-periodos.mjs`
  (função pura de data, que é onde mora o bug do 22023).
- `npx tsc --noEmit` — **sem erros**.
- `npm run lint` — os 4 arquivos do chat/dashboard/atividades/perfil caíram de
  36 para 18 problemas. Os que sobram são `no-explicit-any` pré-existentes no
  JSX. `src/services/` inteiro está limpo.
- **Validado no navegador**: login, lista e criação de lavouras, cadastro, e
  upload de imagem no Cloudinary (curl direto confirmou o preset).
- **Não validado no navegador ainda**: chat, dashboard, atividades, perfil da
  lavoura, funcionários e maquinário — foram migrados e compilam, mas ainda não
  foram navegados um a um. A criação de atividade no chat teve o 22023 corrigido
  (armadilha 10) mas **ainda não foi confirmada no navegador**.

---

## 4. Armadilhas conhecidas (ler antes de mexer no código)

1. ~~`DashboardPage.tsx:64` usava `a.data.startsWith(date)`~~ — **corrigido**.
   Além do `.startsWith` não existir em `Date`, havia um bug de fuso: com
   `timestamptz`, uma atividade criada às 22h em São Paulo guardava
   `2026-10-05T01:00:00Z` e o gráfico contava no dia 05 enquanto o usuário
   estava no dia 04. Agora há um helper `diaLocal()` no topo do arquivo e o
   gráfico conta uma vez por dia num reduce, em vez de 7 × N `filter`.
2. **`CONFIRMACAO_NECESSARIA`** — `cadastrar()` lança essa string quando o Auth
   tem "Confirm email" ligado. `WelcomePage` já tem tela para esse estado. Se a
   opção estiver desligada no painel, o `signUp` loga direto e o caminho nunca é
   usado (não é bug).
3. **`verify.sql` foi corrigido de 26 para 23** políticas. O número 26 era
   errado e circulou antes; o valor real conferido no arquivo é 23.
4. **`localStorage` é o armazenamento da sessão.** Qualquer `clear()` ou
   `removeItem` em `sb-*` desloga o usuário.
5. **Rate limit de e-mail (2/hora)** atrapalha testes repetidos de reset.
6. **`docs/PLANO_MIGRACAO.md` está desatualizado e contradiz as decisões.** A
   §5 ("Migração de dados") e a Fase 2 dele ainda descrevem ETL de staging, que
   foi descartada. Não seguir esse documento sem corrigir antes.
7. **O backend Flask ainda tem 2 alterações não commitadas** que não estão em
   nenhum ponto da história do git e que se perdem para sempre se o diretório
   for apagado sem commit anterior:
   - `backend/app/models/atividade.py` — `to_dict()` com `data` tolerante a `None`.
   - `backend/app/routes/api/routes.py` — **removeu o `@login_required` da rota
     `/upload`**. Isso é um furo: o endpoint de upload fica público para
     qualquer um que alcance a API do Flask. Como essa API já não está no caminho
     de produção, o risco é baixo, mas **não commitar essa linha** se o backend
     ainda estiver exposto em algum lugar. **Agravante:** em 05/10 essas alterações
   foram parar no `7f74a12` do repositório novo, então o commit contém o furo.
   O repositório antigo foi revertido e está íntegro — é de lá que a versão
   segura vem.
8. ~~O cache do service worker sabotaria a Fase C~~ — **regra removida**.
   O runtime cache de `/api/v1/*` foi deletado do `vite.config.ts`, junto com
   o proxy `/api` e `/static`. Ainda vale limpar o cache do site uma vez: o SW
   instalado em builds anteriores pode ter respostas do Flask guardadas.
9. **Fuso horário em `atividade.data`.** `timestamptz` guarda UTC, mas o usuário
   pensa em dia local. `paraData()` em `atividades.ts` reproduz a lógica do
   Flask: dia cheio e diferente de hoje vira meio-dia UTC (não 00:00, que em
   horário negativo viraria dia anterior); dia igual a hoje vira `now()`.
   `listarAtividades()` ordena **crescente**, porque o chat renderiza em
   `flex-col` e rola até o fim esperando o mais antigo no topo.
10. **`paraData()` foi destruída com menos elementos do que o regex captura**
    (corrigido, com teste em `supabase/tests/teste-data.mjs`). Era
    `/^(\d{4}-\d{2}-\d{2})$/` — **um** grupo — mas o destructuring pedia três:
    `const [, ano, mes, dia]`. Resultado: `"2026-10-05-undefined-undefinedT12:00:00Z"`
    e o Postgres respondia **`22023` time zone "undefined-undefinedt12:00:00z"
    not recognized** em *toda* criação de atividade. Agora são três grupos
    explícitos: `/^(\d{4})-(\d{2})-(\d{2})$/`. O teste de PGlite não pegou isso
    porque o bug é de JS puro, anterior à query — precisa de teste de função.
    **Como diagnosticar o próximo erro 4xx:** o código sozinho não basta,
    interceptar o `fetch` do supabase-js e ler o corpo enviado foi o que
    revelou o valor corrompido.
11. **Tamanho do backend:** 158M, dos quais **146M são `backend/venv/`**, que já
   está no `.gitignore` e não afeta o commit de forma alguma. Os 12M de
   `backend/app/static/` são majoritariamente 5 JPEGs de teste versionados
   (`cafe.jpg`, `cafe2.jpeg`). Nada disso entra no commit da Fase B.
12. **Query key com id de rota precisa ser number.** `useParams` devolve string,
   e o React Query trata `'2'` e `2` como caches diferentes. Foi exatamente o
   que quebrou a invalidação em `LavouraProfilePage`. Passar por `Number(id)` em
   qualquer chave que envolva id de URL. Ver §11.
13. **Grant `usage on schema auth` falta no bootstrap dos testes.** As policies
   escapam porque são avaliadas com privilégio do dono da tabela, mas uma query
   que chame `auth.uid()` direto na cláusula WHERE é executada como o usuário e
   falha com `permission denied for schema auth`. Foi o que travou o teste do FK
   restrict ao usar `where l.id_usuario = auth.uid()`. No Supabase real as duas
   roles já têm o grant; só o harness PGlite precisa conceder.

---

## 5. Bloqueios para testar no navegador

- [x] **Anon key colada** em `frontend/.env.local`. Login validado no navegador.
- [x] **Unsigned upload preset** no Cloudinary, validado com upload real
      (`cloud_name: dbmxmbqbi`, preset `agrocafe_unsigned`).
- [ ] **Rotacionar a API secret do Cloudinary** — a credencial completa foi colada
      num log de conversa. Não afeta o frontend (preset unsigned não usa secret);
      o Flask local passa a falhar no upload, o que é esperado.
- [ ] **Configurar Redirect URLs** no painel do Supabase (Auth → URL Configuration):
      incluir a URL de produção e o path de recuperação de senha
      (`/redefinir-senha`).
- [ ] **Confirmar o estado de "Confirm email"** no painel e decidir se fica ligado.
- [ ] Adicionar o e-mail da esposa à organização (para o SMTP funcionar).

Nenhum bloco impede mais abrir o app. O que falta acima é configuração de
produção, não de desenvolvimento.

---

## 6. O que falta, em ordem

### Fase C — Serviços de dados (CONCLUÍDA)
`api.ts` foi removido. Cada domínio virou um módulo sobre `supabase.from(...)`:

- [x] `perfil.ts` — `buscarPerfil()`, `atualizarPerfil()`. Usa
      `supabase.auth.getUser()`, nunca confia em id do cliente.
- [x] `catalogo.ts` — `listarTiposAtividade()`, `buscarTipoAtividade()` e,
      desde 06/10, `criarTipoAtividade()`, `atualizarTipoAtividade()` e
      `deletarTipoAtividade()` (ver §10).
- [x] `lavouras.ts` — `listarLavouras()`, `buscarLavoura()`, `criarLavoura()`,
      `atualizarLavoura()`, `deletarLavoura()`, `alternarPin()`. Lê da view.
- [x] `atividades.ts` — CRUD + `listarFeed()` + `listarMidiaLavoura()`. As
      imagens entram no mesmo módulo: não havia caso de uso para `imagens.ts`.
- [x] `funcionarios.ts`, `maquinarios.ts` — CRUD.
- [x] `dashboard.ts` — **não existiu.** As agregações são volume baixo e
      passaram a ser feitas no cliente a partir de `listarFeed()`.
- [x] `chat.ts` — **não existiu.** O chat é a lista de atividades da lavoura
      (`ChatPage` renderiza `listarAtividades()`); não é mensagem persistida.
- [x] Removidos `api.ts`, o proxy `/api` e `/static` do `vite.config.ts`, o
      runtime cache `StaleWhileRevalidate` de `/api/v1/*` do PWA (que servia
      resposta velha do Flask por 24h) e o prefixo `VITE_API_URL` de
      `utils/media.ts`.
- [x] Corrigido o bug de data do `DashboardPage` (ver §4).

### Fase D — Uploads (CONCLUÍDA)
- [x] `services/cloudinary.ts` — unsigned upload via `fetch`, sem SDK. Motivo:
      o SDK oficial arrasta ~300 kB de polyfill de Node (fs, http) para o
      navegador, e aqui só é preciso um POST.
- [x] `NewLavouraPage`, `ProfilePage`, `WelcomePage`, `ChatPage` migrados.
      `MediaPicker` recebe `File[]` e não fazia upload por conta própria.

### Fase E — Limpeza
- [ ] Tipar o resto (eliminar os `any` do lint — 18 restantes, todos
      preexistentes, down de 36 na revisão de 06/10).
- [ ] Separar `useAuth` para silenciar o warning de `react-refresh`.
- [ ] Remover os `console.log` de `utils/performance.ts` (linhas 11-12) — ruído
      no console de produção.
- [x] Backend Flask removido em 06/10 (commit a ser confirmado). `backend/`
      inteiro saiu: 56 arquivos versionados, API, modelos, templates e os
      5 JPEGs de teste. Isso também tira do HEAD a rota `/upload` sem
      `@login_required` (armadilha 7) — mas o histórico do GitHub continua
      com ela, e o serviço no Render, se ainda estiver no ar, não para
      sozinho.
- [ ] Corrigir/atualizar `docs/PLANO_MIGRACAO.md` (remover ETL).

### Fase F — Deploy

Ordem obrigatória, senão o app fica sem backend:

1. [ ] Rodar `supabase/aplicar_trigger_foto.sql` no SQL Editor (**ver §11**).
1. [ ] Rotacionar a API secret do Cloudinary. A que estava configurada ficou
      exposta na conversa de 05/10 e precisa ser trocada no painel.
1. [ ] Conferir "Confirm email" ligado e cadastrar as Redirect URLs do domínio
      de produção. `pedirReset` aponta para `/redefinir-senha`.
1. [ ] Build de produção e variáveis de ambiente na hospedagem
      (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
      `VITE_CLOUDINARY_CLOUD_NAME`, `VITE_CLOUDINARY_UPLOAD_PRESET`).
1. [ ] Teste real de e-mail (reset de senha) com as duas contas.
1. [ ] Só então desligar o Render e remover `backend/`.

---

## 7. Inventário (para não redescobrir do zero)

Os **24 padrões de endpoint** do Flask foram consumidos por 7 módulos em
`frontend/src/services/`. A tela inteira do frontend está no Supabase — não há
nenhum `import` de `api.ts` restante (o arquivo foi apagado).

Mapa endpoint → módulo:

| Endpoint Flask | Substituído por |
|---|---|
| `/auth/*`, `/usuario`, `/perfil` | `lib/supabase.ts` + `services/perfil.ts` |
| `/tipos-atividade` | `services/catalogo.ts` |
| `/lavouras`, `/lavouras/:id`, `/pin` | `services/lavouras.ts` |
| `/atividades`, `/lavouras/:id/atividades` | `services/atividades.ts` |
| `/feed` | `services/atividades.ts` → `listarFeed()` |
| `/lavouras/:id/media` | `services/atividades.ts` → `listarMidiaLavoura()` |
| `/funcionarios` | `services/funcionarios.ts` |
| `/maquinarios` | `services/maquinarios.ts` |
| `/upload` | `services/cloudinary.ts` |

Backend legado ainda presente em `backend/` (não remover antes da Fase E).

---

## 8. Comandos

```bash
# frontend
cd frontend && npm run build && npm run lint

# testes de RLS
cd supabase/tests && npm run test:all

# sincronizar migrations com o projeto real
npx supabase db push --linked
npx supabase inspect db table-stats --linked

# verificação remota completa (rodar no SQL Editor do painel)
# conteúdo de supabase/verify.sql
```

---

## 9. Pendências de git

**Estado em 06/10:** nada das Fases C/D e das correções do dia foi commitado.
`main` está em `7f74a12` com ~34 arquivos modificados/novos no working tree.
O usuário pediu revisão antes de subir, mas **não autorizou o commit** — perguntar
antes de commitar.

Arquivos novos, nenhum rastreado ainda:

```
frontend/src/services/        atividades.ts  atividadesCache.ts  catalogo.ts
                               cloudinary.ts  funcionarios.ts  lavouras.ts
                               maquinarios.ts  perfil.ts
supabase/migrations/          20261005120500_view_lavoura.sql
                               20261005120600_tipo_atividade_escrita.sql
                               20261005120700_trigger_foto_perfil.sql
supabase/                     aplicar_catalogo.sql  aplicar_trigger_foto.sql
supabase/tests/               teste-data.mjs
```

Removido: `frontend/src/services/api.ts`.

`frontend/.env.local` está corretamente ignorado (`frontend/.gitignore:13`,
padrão `*.local`) — confirmado com `git check-ignore -v`. Não versionar.

O `main` tem alterações não commitadas de antes da migração. Elas **não fazem
parte do commit da Fase B** e é justamente por isso que o commit limpo se faz
com *staging explícito*, não com `git add -A`.

**Não commitar agora** (pré-existentes, fora do escopo):
`frontend/yarn.lock`, e as remoções de `PLAN_DE_MELHORIAS.md`, `ROADMAP.md`,
`design_notes.md`, `design_notes.pdf`, `relatorio_seguranca_ux.md`.

O que era "não commitar" e virou escopo das Fases C e D (e portanto entra):
`backend/app/models/atividade.py`, `backend/app/routes/api/routes.py`,
`frontend/src/services/api.ts` (removido), e
`frontend/src/pages/{Activities,Chat,Dashboard,Funcionarios,Maquinarios,LavouraProfile}Page.tsx`.

> **Atenção ao `backend/app/routes/api/routes.py`:** essa versão remove o
> `@login_required` de `/upload` (armadilha 7). Não levar esse arquivo para
> deploy. Como o upload do frontend não usa mais o Flask, o certo é reverter
> essa linha antes de qualquer push, ou deixar `backend/` de fora do deploy.

> Atenção: `backend/venv/` (146M) e `backend/app/static/uploads/` (12M) já são
> ignorados ou irrelevantes para o diff. **Não é necessário apagar nada** para
> ter um commit limpo.

Commit da Fase B deve conter **apenas**:
`frontend/package.json`, `frontend/package-lock.json`, `frontend/.env.local.example`,
`frontend/src/lib/`, `frontend/src/hooks/useAuth.tsx`,
`frontend/src/App.tsx`, `frontend/src/pages/{Login,Welcome,ForgotPassword,RedefinirSenha,Settings}Page.tsx`,
`supabase/`, `docs/`.

```bash
git add frontend/package.json frontend/package-lock.json \
  frontend/.env.local.example frontend/src/lib frontend/src/hooks/useAuth.tsx \
  frontend/src/App.tsx \
  frontend/src/pages/LoginPage.tsx frontend/src/pages/WelcomePage.tsx \
  frontend/src/pages/ForgotPasswordPage.tsx \
  frontend/src/pages/RedefinirSenhaPage.tsx \
  frontend/src/pages/SettingsPage.tsx \
  supabase docs

git diff --cached --stat   # conferir antes de commitar
```

### Backend Flask: REMOVIDO em 06/10
`backend/` foi apagado do repositório. Não há mais Python no projeto.

- 56 arquivos versionados saíram: API Flask, modelos SQLAlchemy/MySQL, templates
  HTML e os 5 JPEGs de teste em `app/static/uploads/`.
- Nenhuma referência a `backend/` sobrou no frontend. Só comentários em
  `utils/media.ts` e `services/cloudinary.ts` explicando de onde veio o
  formato — inofensivos e úteis.
- As linhas `venv/`, `.venv/` e `backend/app/static/uploads/atividades/*` do
  `.gitignore` saíram por só servirem ao Flask. `venv/` foi mantido: inofensivo
  e protege contra ambiente virtual criado na raiz por engano.
- O `backend/.env` local (credenciais MySQL, `SECRET_KEY`, `CLOUDINARY_URL`)
  foi junto. Essas credenciais de MySQL estão-mortas desde a migração.

**O furo do `/upload` continua no histórico.** A rota sem `@login_required` está
em `7f74a12`. Remover o diretório tira o código do HEAD, não apaga o commit do
GitHub. Se o Render ainda estiver no ar, o serviço continua rodando a versão
antiga — derrubar lá é passo separado.

**Ordem do desligamento completo:**
1. Deploy do frontend novo na Vercel (a produção ainda é o build antigo, que
   aponta `VITE_API_URL` para o Flask).
2. Confirmar que a produção roda sem o Flask.
3. Derrubar o serviço no Render.
4. Rotacionar a `SECRET_KEY` e as credenciais MySQL se algum backup antigo
   ainda as tiver.

---

## 10. Decisões em aberto (precisam do usuário)

### Catálogo de tipos de atividade — DECIDIDO em 06/10: escrita liberada
O usuário optou por abrir a escrita. Já está aplicado no projeto real.

- Migration: `20261005120600_tipo_atividade_escrita.sql` (INSERT/UPDATE/DELETE
  para `auth.role() = 'authenticated'`).
- Script para colar no SQL Editor: `supabase/aplicar_catalogo.sql`.
- `catalogo.ts` ganhou `criarTipoAtividade()`, `atualizarTipoAtividade()` e
  `deletarTipoAtividade()`. O `SettingsPage` grava de verdade.

**A garantia perdida não é o que parece.** O problema do MySQL não era
autorizar DELETE — era apagar sem o banco avisar. Aqui o FK
`atividade_id_tipo_atividade_fkey` é `on delete restrict`, então categoria em
uso continua existindo e o banco recusa com 23503. `deletarTipoAtividade()`
traduz esse código para "Esta categoria tem atividade registrada e não pode ser
excluída." Coberto por teste.

Para as duas contas do app, "editar a categoria do outro" é comportamento
desejado: elas administram o mesmo catálogo de propósito.

### Remoção do `onboarding_complete`
Hoje nada depende desse flag para liberar rota — quem decide é a sessão do
Supabase. Ainda aparece escrito em `localStorage` em pelo menos um lugar e pode
ser removido na limpeza da Fase E.

---

## 11. Correções de 06/10 (sessão do cache e do CRUD de categorias)

### Cache de atividades — a tela de atividades não atualizava
`services/atividadesCache.ts` (novo) centraliza as chaves do React Query.

O sintoma: criar atividade no chat funcionava, mas a lista global de atividades
e o dashboard mostravam a versão velha. Causa: as telas liam chaves diferentes.

```
ChatPage        → ['atividades', 2]   (id number)
ActivitiesPage  → ['feed']
DashboardPage   → ['feed']
```

A mutation do chat invalidava só a primeira. `invalidarAtividades()` agora
invalida `feed`, `lavouras`, `chat(id)` e `midia(id)` de uma vez.

`lavouras` entra na lista porque `lavoura_com_ultima_atividade` calcula
`ultima_atividade_date` no banco — criar atividade muda o que a lista mostra.

Armadilha encontrada no caminho: `LavouraProfilePage` usava `['lavouras', id]`
com `id` vindo do `useParams` (string), e o cache trata `'2'` e `2` como
entradas distintas. Normalizado com `Number(id)`. O mesmo vale para qualquer
chave com id vindo de rota — `QUERY.chat()` e `QUERY.midia()` recebem number.

### Foto do cadastro não persistia
`WelcomePage` subia a imagem para o Cloudinary, mas `cadastrar()` só recebia
email, senha e nome: a URL era descartada e a imagem ficava órfã.

A correção passa pelo metadata do `signUp`, não por um `atualizarPerfil()`
depois do login. O trigger `handle_novo_usuario` roda quando a linha de
`auth.users` nasce — **antes** da confirmação de e-mail. Com "Confirm email"
ligado não existe sessão nesse instante, então é a única forma de a foto
sobreviver ao cadastro.

- Migration: `20261005120700_trigger_foto_perfil.sql`.
- Script para colar no SQL Editor: `supabase/aplicar_trigger_foto.sql`.
- **Ainda não aplicado no projeto real.**

Só afeta contas novas. Quem já se cadastrou precisa salvar a foto pelo perfil
uma vez.

O `nullif(btrim(...), '')` no trigger não é decoração: sem ele, signup sem foto
gravaria string vazia, que passa no NOT NULL e renderiza `<img src="">`
quebrado. Tem teste para os dois lados.

### Configurações: instalação do PWA simplificada
Removida a seção "App & Performance" inteira. Ficou só o botão **Instalar
Aplicativo**, logo abaixo do perfil, em destaque (verde, com seta).

Saíram junto a função `handleClearCache` e os ícones `RefreshCw`/`ZapOff`.

A "Dica de Velocidade" foi removida por estar **errada**: ela falava em 15
minutos de sono. O Supable pausa projeto do plano gratuito (Free) depois de
**7 dias** de atividade baixa, com aviso por e-mail uma semana antes. Projeto
com uso diário não corre risco.

### Aplicar migrations neste projeto
Não há senha do banco disponível para o agente — `supabase/.temp/pooler-url` só
tem o host, e não existe `SUPABASE_ACCESS_TOKEN` no ambiente. Duas saídas:

- `npx supabase db push` a partir de `supabase/` (se o CLI estiver logado), ou
- colar o script `.sql` no SQL Editor do dashboard.

Por isso existem os arquivos `supabase/aplicar_*.sql`: são o caminho que não
depende de credencial. Verificar a aplicação com `select policyname, cmd from
pg_policies where tablename = 'tipo_atividade';` — para o CRUD funcionar, tem
que listar `delete`, `insert`, `select` e `update`. Se listar só `select`, o
INSERT volta com 403 (42501).

---

## 12. Períodos de trabalho — 05/10 (migration 08)

Conta de pagamento por funcionário: valor do dia, período e total. Substitui a
contagem manual que o MySQL não tinha.

### Regras

- Conta **todos os dias de calendário** por padrão, início e fim incluídos.
- `data_termino` nula = **período em aberto**, que conta até hoje.
- Vários períodos por funcionário; só **um aberto por vez** (índice único), senão
  o mesmo dia seria pago duas vezes.
- O total é **`generated always as (dias * valor_dia) stored`**. Não entra no
  INSERT nem no UPDATE — o banco responde "can only be updated to DEFAULT", e
  isso está coberto por teste. É o que garante que o valor exibido e o gravado
  não divirjam.
- Duas formas de ajustar a contagem, ambas caem no mesmo campo `dias`:
  1. excluir datas específicas (`dias_descartados date[]`);
  2. digitar o número direto, sem abrir o calendário.

### `calculo_manual`: a coluna que impede um bug silencioso

Os dois caminhos acima gravam um inteiro em `dias`. Só com o inteiro não dá para
saber se um período **aberto** deve continuar contando sozinho ou respeitar o
número digitado — e sem isso o cálculo automático sobrescrevia na tela o
lançamento manual, e a tabela passava a mostrar um total diferente do salvo.

Por isso `calculo_manual boolean not null default false` é persistido:

- `false` → `dias` vem das datas; período aberto continua contando até hoje.
- `true`  → `dias` foi ditado; respeitado como digitado, mesmo aberto.

`frontend/src/services/periodos.ts` passa `diasManuais` para `aoVivo()` só quando
`calculo_manual` é true, e `PeriodosPage.abrirEdicao()` reabre o campo de dias
nesse caso.

### O bug que o teste pegou

A migration criava as quatro policies e **nunca ligava RLS na tabela nova**.
Sem `enable row level security` as policies são decorativas: o teste mostrou
`anon` lendo os 4 períodos da outra conta. O `alter table ... enable row level
security` está no mesmo arquivo, com comentário explicando, e
`teste-script-periodos.mjs` checa `relrowsecurity` explicitamente — é a
asserção que mais vale aqui, porque a falha é invisível a olho nu.

### `updated_at`

Primeira tabela do schema com `updated_at`, então o trigger
`tocar_updated_at()` foi criado aqui. Sem ele a coluna congelava no valor da
inserção. O trigger **descarta** valor vindo do cliente em vez de recusar:
`set updated_at = '2020-01-01'` passa sem erro e é sobreposto — há teste
garantindo que a data enviada não sobrevive.

### Instalação manual — dois scripts, e qual usar

`supabase/diagnostico_periodos.sql` primeiro. É só leitura e diz em qual dos
dois estados a tabela está.

| Estado | Script |
|---|---|
| Tabela não existe | `aplicar_periodos.sql` |
| Tabela existe | `reparar_periodos.sql` |

`aplicar_periodos.sql` tem guarda de porta que aborta se a tabela já existir.
Preferi isso a `create table if not exists`: num script meio aplicado, o `if
not exists` seguiria adiante e deixaria trigger e policies pela metade, com a
tela funcionando e a segurança furada — falha silenciosa é pior que erro
vermelho.

`reparar_periodos.sql` é o caminho do projeto real. `teste-script-periodos.mjs`
compara o catálogo (colunas, policies, índices, checks, triggers) do script
contra o da migration e exige igualdade — é o que impede o SQL colado no painel
de divergir do repo.

### Estado real em 06/10: instalado pela metade

O diagnóstico no projeto `apwmdbtpczylzowfrmvb` devolveu:

```
rls ligado          true
policies            4  (texto idêntico à migration)
calculo_manual      AUSENTE das colunas
trigger updated_at  0
```

Ou seja: a tabela veio de uma versão anterior do script, aplicada antes de
`calculo_manual` e do trigger existirem. RLS e policies estão corretos.

**Consequência que não é óbvia:** o frontend pede `calculo_manual` no `select=`,
e o PostgREST responde **PGRST204** para coluna que ele não resolve no schema
cache. Foi esse o erro do POST na tela — não era tabela ausente nem cache velho,
as duas leituras que eu dei primeiro e estavam erradas.

Por isso a ordem importa: **rodar `reparar_periodos.sql` ANTES de publicar o
frontend novo.** No sentido inverso, a tela de períodos quebra com PGRST204
enquanto o reparo não for aplicado. O script termina com
`notify pgrst, 'reload schema'` justamente para não depender de espera.

### Ainda não verificado no navegador

Nada foi testado na UI real: só o cálculo puro (`teste-periodo.mjs`, 45 casos),
o schema e os scripts. Falta o reparo aplicado, `aplicar_trigger_foto.sql` e o
testo de tela.

---

## 13. Pendências manuais (não são código)

| Item | Onde |
|---|---|
| Rodar `aplicar_trigger_foto.sql` | SQL Editor do Supabase |
| Rodar `reparar_periodos.sql` | SQL Editor do Supabase — **antes do deploy** |
| Rotacionar API secret do Cloudinary | Cloudinary → Settings |
| Apagar asset de teste `vrsmiiajamsfl9vi06ic` | Cloudinary Media Library |
| Apagar conta de teste `tmpdiag12345@gmail.com` | Supabase → Authentication |
| Confirmar Redirect URLs | Supabase → Authentication → URL Configuration |
| Adicionar e-mail da esposa como membro | Supabase → Organization → Members (limite SMTP) |
| `supabase/verify.sql` | SQL Editor — confere as policies remotas |

O asset e a conta de teste foram criados no diagnóstico de 05/10 e não têm
efeito no app, mas o ideal é que saiam.

---
