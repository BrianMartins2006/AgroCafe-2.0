# AgroCafé — Arquitetura Atual

> Snapshot do sistema **antes** da migração para Supabase.
> Descreve o que existe hoje em produção, para servir de referência e plano de migração.
> Última verificação: leitura direta do código em `main`.

---

## 1. O que é

Aplicação web de gestão para cafeicultura. O produtor cadastra **lavouras**, registra
**atividades** (adubação, colheita, pulverização, monitoramento) com fotos, e gerencia
**funcionários** e **maquinário**. Mobile-first, instalável como PWA.

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript + Vite 5 + TailwindCSS 3 |
| Estado/cache | TanStack Query v5 + `query-async-storage-persister` (localStorage) |
| Rotas | React Router 6 |
| Gráficos | Recharts 3 |
| PWA | `vite-plugin-pwa` (Workbox) |
| Backend | Python + Flask 3 + Flask-SQLAlchemy 3 + Flask-Login |
| Banco | MySQL (externo ao Render) |
| Imagens | Cloudinary |
| Gráficos/ícones | lucide-react |

## 3. Onde cada coisa está hospedada

| Parte | Provedor | URL / observação |
|---|---|---|
| Frontend | Vercel | `agro-cafe.vercel.app` |
| Backend (API) | Render — **plano gratuito** | ver `VITE_API_URL` no painel da Vercel |
| Banco MySQL | Provedor externo (a descobrir) | definido por `DB_HOST` no painel do Render |
| Imagens | Cloudinary | free tier |

**Problema conhecido:** o plano gratuito do Render hiberna a instância após ~15 min
sem tráfego. O primeiro request seguinte leva 30–60 s. A região do Render fica nos EUA
(aprox. Oregon), o que adiciona ~180 ms de latência para usuários no Brasil.

## 4. Arquitetura

```
┌─────────────────┐        HTTPS / cookie cross-site        ┌──────────────────┐
│  Navegador      │ ───────────────────────────────────────▶  │  Render (free)   │
│                 │                                           │                  │
│  React + PWA    │   Vercel (agro-cafe.vercel.app)          │  Flask + Gunicorn│
│  React Query    │                                           │        │         │
│  localStorage   │ ◀────── JSON ───────────────────────────  │        ▼         │
└─────────────────┘                                           │      MySQL       │
        │                                                       │   (externo)     │
        │                                                       └──────────────────┘
        └──────▶ res.cloudinary.com  (imagens, via CDN do Cloudinary)
```

O frontend chama a API em **domínios diferentes**. Disso decorre a necessidade de
`SESSION_COOKIE_SAMESITE = 'None'` (ver §9.1).

### Alternativa em desenvolvimento

Em `npm run dev` o Vite faz proxy de `/api` → `http://127.0.0.1:5000`
(`frontend/vite.config.ts`, bloco `server.proxy`). Por isso não existe `.env` local no
frontend: em desenvolvimento a URL da API fica vazia e o proxy resolve.

## 5. Modelo de dados

### 5.1 Tamanho do backend

| Bloco | Linhas | Observação |
|---|---|---|
| `app/routes/api/routes.py` | 552 | a API — **é isso que o React consome** |
| `app/routes/auth/routes.py` | 137 | UI HTML legada, **morta** (§6.7) |
| `app/__init__.py` | 94 | factory, CORS, seeding |
| `app/models/*.py` | 308 | 9 models |
| `config.py` + `run.py` | 49 | |
| **Subtotal runtime** | **1.140** | o que roda em produção |
| scripts na raiz (`init_db.py`, `fix_db.py`, `check_*.py`) | 174 | utilitários avulsos, fora do runtime |
| `scratch/` + `tests/` | 109 | |
| **Total no repositório** | **1.423** | |

Dos 1.140 de runtime, **~430 são código morto ou legado**: os 137 da UI HTML (§6.7),
os 30 de `atividade_funcionario_model.py`, os 15 de `permissao_model.py` e partes de
`atividade_imagem.py` (o hook `after_delete`, §9.4).

**Só ~710 linhas servindo efetivamente a API.**

Banco relacional. Todas as tabelas de domínio carregam `id_usuario_fk` — **o isolamento
entre produtores é feito só por esse campo**, filtrado na aplicação.

```
usuario ──┬──< lavoura ──┬──< atividade ──< atividade_imagem
          │              │
          │              └── (tipo_atividade)
          ├──< funcionario
          ├──< maquinario
          └──< usuario_permissao >── permissao
```

### 5.2 Tabelas do domínio

**`usuario`** — `backend/app/models/user_model.py`

| Campo | Tipo | Obs |
|---|---|---|
| `id_usuario` | int, PK | nome da coluna é `id`, não `id_usuario` |
| `nome` | varchar(100) | obrigatório |
| `email` | varchar(100) | **único**, obrigatório |
| `senha_hash` | varchar(255) | `werkzeug.generate_password_hash` |
| `ativo` | bool | **nunca verificado em nenhuma rota** |
| `foto_url` | varchar(255) | |
| `pergunta_seguranca` | varchar(255) | mecanismo de recuperação |
| `resposta_hash` | varchar(255) | hash da resposta, `lower().strip()` |

**`lavoura`** — `models/lavoura.py`

| Campo | Tipo | Obs |
|---|---|---|
| `id` | int, PK | |
| `nome` | varchar(100) | obrigatório |
| `cultura` | varchar(50) | obrigatório |
| `foto_perfil` | varchar(255) | |
| `area_hectares` | float | |
| `localizacao` | varchar(255) | texto livre |
| `data_inicio` | date | |
| `is_pinned` | bool | default `false`, alternado por PATCH |
| `id_usuario_fk` | int, FK → `usuario` | **nullable** |

Relacionamentos: `atividades` com `cascade="all, delete-orphan"`;
propriedade `ultima_atividade_date` que usa cache do `joinedload` e cai para uma query
separada se a relação não estiver carregada.

**`atividade`** — `models/atividade.py`

| Campo | Tipo | Obs |
|---|---|---|
| `id` | int, PK | |
| `id_lavoura_fk` | int, FK | obrigatório |
| `id_tipo_atividade_fk` | int, FK | obrigatório |
| `data` | datetime | default `datetime.now(timezone.utc)` |
| `descricao` | text | |
| `responsavel` | varchar(100) | default `"Produtor"` |

**`atividade_imagem`** — `models/atividade_imagem.py`

| Campo | Tipo | Obs |
|---|---|---|
| `id` | int, PK | |
| `id_atividade_fk` | int, FK | obrigatório |
| `foto_url` | varchar(255) | obrigatório |

`to_dict()` injeta transformações de URL do Cloudinary
(`/upload/f_auto,q_auto,w_1200,c_limit/`) para otimizar entrega.
Possui um hook `after_delete` que tenta apagar o arquivo local correspondente.

**`tipo_atividade`** — `models/tipo_atividade.py` — `id`, `nome`, `icone`, `cor`.
**`funcionario`** — `models/funcionario_model.py` — PK `id_funcionario`, `nome`, `cargo`,
`salario_hora` (`Numeric(10,2)`), `contato`, `id_usuario_fk`.
**`maquinario`** — `models/maquinario_model.py` — `id`, `tipo`, `modelo`, `valor_hora`,
`consumo_medio`, `id_usuario_fk`.

### 5.3 Tabelas e campos sem uso

Duas categorias distintas, com implicações diferentes na migração.

**Nunca consultados por nenhuma rota** — mas as tabelas **existem no banco**, porque
`db.create_all()` (`__init__.py:43`) cria tudo que está declarado nos models:

- **`permissao`** + ponte **`usuario_permissao`** — relação M2M declarada em
  `user_model.py:24-27`; o parâmetro `include_permissao` de `to_dict()` nunca é
  passado como `True` (`user_model.py:51`). `grep` por `Permissao` em `app/routes/`
  retorna **zero**.
- **`atividade_funcionario`** — `AtividadeFuncionario` é importado em
  `models/__init__.py:5` e nunca usado em rota nenhuma.

⚠️ Como as tabelas existem, **a ETL precisa decidir**: migrar os dados ou descartar.
Confira se têm linhas antes de descartar:

```sql
select count(*) from permissao;
select count(*) from usuario_permissao;
select count(*) from atividade_funcionario;
```

**Campo nunca consultado:**

- **`usuario.ativo`** — definido, mas nenhuma rota verifica `current_user.ativo`.
  Diferente das tabelas acima, é seguro dar utilidade a ele: o plano expõe isso como
  função `usuario_ativo()` usada nas políticas de RLS.

### 5.4 Dependência Python sem uso

`Flask-Bootstrap==3.3.7.1` está em `requirements.txt` e **não é importado em lugar
nenhum**. Bootstrap 3 + jQuery, obsoleto. Sai junto com o Flask.

## 6. API

Blueprint único `api`, prefixo **`/api/v1`** (`app/__init__.py:37`).
29 rotas na API, todas em `app/routes/api/routes.py`. Somam-se 7 rotas legadas de HTML em
`auth/routes.py` (ver §6.7) — total de 36, mas só as 29 da API são usadas pelo frontend.

> `app/routes/api/controllers.py` existe mas tem **0 linhas**.

### 6.1 Autenticação

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/auth/register` | — | cria usuário e faz login |
| POST | `/auth/login` | — | sessão por cookie |
| POST | `/auth/logout` | sim | |
| POST | `/auth/forgot-password` | — | **devolve `pergunta_seguranca`** |
| POST | `/auth/reset-password` | — | valida resposta de segurança |

### 6.2 Perfil

| Método | Rota | Auth |
|---|---|---|
| GET | `/perfil` | sim |
| PUT | `/perfil` | sim |
| GET | `/health` | — |

### 6.3 Lavouras

| Método | Rota | Auth |
|---|---|---|
| GET | `/lavouras` | sim |
| POST | `/lavouras` | sim |
| GET | `/lavouras/<id>` | sim |
| PUT | `/lavouras/<id>` | sim |
| DELETE | `/lavouras/<id>` | sim |
| GET | `/lavouras/<id>/media` | sim |
| PATCH | `/lavouras/<id>/pin` | sim |
| GET | `/lavouras/<id>/atividades` | sim |

### 6.4 Atividades

| Método | Rota | Auth |
|---|---|---|
| GET | `/feed` | sim |
| POST | `/atividades` | sim |
| PUT | `/atividades/<id>` | sim |
| DELETE | `/atividades/<id>` | sim |
| POST | `/upload` | **não** ⚠️ |

`GET /lavouras` executa uma **migração de registros órfãos a cada requisição**
(`routes.py:132-136`): se achar `lavoura` com `id_usuario_fk IS NULL`, reatribui tudo ao
usuário atual. Roda em toda carga da tela principal.

`POST /atividades` e `PUT /atividades/<id>` contêm lógica de normalização de data
(`routes.py:262-276` e `320-333`): aceita `YYYY-MM-DD` ou ISO completo, e se a data for
hoje usa o instante atual; senão fixa as 12:00.

`PUT /atividades/<id>` sincroniza imagens por diff de lista de URLs
(`routes.py:336-350`).

### 6.5 Categorias, funcionários, maquinário

| Método | Rota | Auth |
|---|---|---|
| GET/POST | `/tipos-atividade` | sim |
| PUT/DELETE | `/tipos-atividade/<id>` | sim |
| GET/POST | `/funcionarios` | sim |
| PUT/DELETE | `/funcionarios/<id>` | sim |
| GET/POST | `/maquinarios` | sim |
| PUT/DELETE | `/maquinarios/<id>` | sim |

`DELETE /tipos-atividade/<id>` recusa se houver atividade vinculada (`routes.py:455`).

Funcionários e maquinários listam registros do usuário **e** os órfãos:
`WHERE id_usuario_fk = <user> OR id_usuario_fk IS NULL` (`routes.py:475`, `517`).
Funciona como registros "globais".

### 6.6 Upload

`POST /upload` valida mime type contra lista fixa (jpeg, png, webp, mp4, quicktime),
extrai as credenciais do `CLOUDINARY_URL` por regex e sobe para
`folder="agrocafe/atividades"`. Devolve `secure_url`.

**Não exige `@login_required`** — rotas sem auth são: `/auth/register`, `/auth/login`,
`/auth/forgot-password`, `/auth/reset-password`, `/health`, `/upload`.
`MAX_CONTENT_LENGTH = 10 MB` (`config.py:29`).

### 6.7 UI legada em HTML (morta)

O backend também registra um blueprint `auth_bp` (`app/routes/auth/__init__.py`,
montado em `app/__init__.py:34`) com **7 rotas renderizando Jinja**:

| Rota | Método |
|---|---|
| `/` | GET |
| `/cadastro` | GET, POST |
| `/login` | POST |
| `/logout` | — |
| `/esqueci-senha` | GET, POST |
| `/redefinir-senha/<token>` | GET, POST |

**O frontend React nunca chama nenhuma delas.** Todas as chamadas de auth do React vão
para `/api/v1/*` — verificável em `WelcomePage.tsx:65`, `LoginPage.tsx:24`,
`ForgotPasswordPage.tsx:22` e `:44`, `SettingsPage.tsx:110`.

`render_template` aparece **0 vezes** em `routes/api/routes.py` — a API é JSON puro. As
5 ocorrências estão todas em `auth/routes.py`.

Consequência: **tudo isso é descartável** — o blueprint `auth_bp` inteiro,
`app/templates/` (16 templates em 5 subdiretórios), `app/static/css` e `app/static/js`.

Esse caminho morto ainda traz um **segundo mecanismo de reset de senha**, com token
assinado via `itsdangerous`:

```python
generate_reset_token(email)                                    # auth/routes.py:81
confirm_reset_token(token, expiration=3600)                    # auth/routes.py:85
url_for('auth.redefinir_senha', token=..., _external=True)     # auth/routes.py:104
```

Não é usado pelo frontend e será substituído de qualquer forma pelo Supabase.

### 6.8 Dependência morta

**`Flask-Bootstrap==3.3.7.1`** está em `requirements.txt` mas **não é importado em lugar
nenhum** (`grep` por `bootstrap` no código Python: zero resultados). É Bootstrap 3 com
jQuery — obsoleto. Também pode sair.

## 7. Autenticação — como funciona

Não há JWT nem sessão no servidor. É o **cookie de sessão assinado** do Flask:

1. `POST /auth/login` → `Usuario.query.filter_by(email=...)` → `check_password()`
2. `login_user(user, remember=True)` grava o id no cookie
3. O cookie é assinado com `SECRET_KEY` e enviado pelo browser em toda requisição
   (`credentials: 'include'` no `api.ts:13`)
4. `@login_required` chama `load_user()` (`app/__init__.py:30-31`), que faz
   `db.session.get(Usuario, int(user_id))`

Consequências:

- **A aplicação é stateless.** Nenhum session store, nenhum volume persistente.
  O `SECRET_KEY` é a única coisa que precisa sobreviver a deploys.
- Escala horizontalmente sem trabalho extra.
- State de login e "onboarding" do frontend vive em `localStorage`
  (`onboarding_complete`, `user_name`, `user_photo`) + evento `app:login`.

### 7.1 Recuperação de senha

Fluxo alternativo ao e-mail: `forgot-password` devolve a `pergunta_seguranca` do
usuário, e `reset-password` compara `resposta_hash`. Existe uma migração em
`app/__init__.py:68-74` que define respostas padrão (`"agrocafe"`) para usuários antigos.

## 8. Frontend

### 8.1 Rotas (`src/App.tsx`)

Públicas: `/welcome`, `/login`, `/forgot-password`.
Protegidas por `isOnboarded` (flag em `localStorage`): `/`, `/chat/:id`, `/atividades`,
`/lavoura/:id/perfil`, `/configuracoes`, `/funcionarios`, `/maquinarios`, `/perfil`,
`/nova-lavoura`, `/editar-lavoura/:id`, `/dashboard`.
Fallback `*` redireciona conforme `isOnboarded`.

### 8.2 Camada de dados

`QueryClient` com `staleTime` 30 min, `gcTime` 7 dias, `retry: 1`.
`PersistQueryClientProvider` grava o cache em `localStorage` (7 dias).
Existe optimistic updates em várias telas.

Cliente HTTP em `src/services/api.ts`: expõe `api.get/post/put/patch/delete` sobre um
`fetch` com `credentials: 'include'`. **Todas** as chamadas passam por `apiFetch`, e a
URL vem de uma variável só:

```ts
const API_URL = import.meta.env.VITE_API_URL || '';   // services/api.ts:3
```

Usada também em `src/utils/media.ts:1` e `src/pages/NewLavouraPage.tsx:10`.
**Consequência prática: trocar de backend = mudar 1 variável de ambiente na Vercel.**

### 8.3 PWA

`registerType: 'autoUpdate'`, `display: standalone`, orientação retrato.
Runtime caching do Workbox:

| Padrão | Handler | TTL |
|---|---|---|
| `res.cloudinary.com/*` | CacheFirst | 30 dias |
| `fonts.googleapis.com/*` | CacheFirst | 1 ano |
| `/api/v1/*` | StaleWhileRevalidate | 24 h |

## 9. Dívida técnica mapeada

Tudo que existe **por causa** da topologia atual (frontend e backend em domínios
diferentes, backend em plano gratuito). É a lista do que a migração resolve.

### 9.1 Hack de cookie cross-site

`config.py:31-38` força `SESSION_COOKIE_SAMESITE = 'None'` e `SESSION_COOKIE_SECURE =
True` para o cookie atravessar Vercel → Render. CORS restrito a dois domínios em
`app/__init__.py:18` (`localhost:5173` e `agro-cafe.vercel.app`).

Unificar frontend e API no mesmo domínio elimina a necessidade disto.

### 9.2 Toast e retry de cold start

`api.ts:29-90` (~60 linhas) existe para contornar a hibernação do Render:

- após 3 s sem resposta, mostra toast *"☕ Café sendo passado... até 50s na primeira vez"*
- trata 502/503 como erro e repete a requisição
- backoff de 5 s → 8 s → 12 s, até 3 tentativas

### 9.3 Migração de órfãos em runtime

`routes.py:132-136` roda em todo `GET /lavouras`. Deveria ser uma migration única.

### 9.4 Limpeza de arquivo local

`atividade_imagem.py:29-45` — hook `after_delete` que tenta apagar o arquivo em
`UPLOAD_FOLDER`. Só faz sentido para o upload antigo em disco; inócuo desde que as
imagens vão para o Cloudinary.

### 9.5 Repetição da checagem de autorização

O padrão

```python
if recurso.id_usuario_fk != current_user.id:
    return jsonify({"erro": "Acesso negado"}), 403
```

está repetido em `routes.py` nas linhas **165, 191, 197, 230, 260, 308, 362, 497, 539**.
Nove cópias do mesmo teste, escrito à mão. Esquecer uma é brecha de IDOR — não há
proteção no banco.

O mesmo problema, em forma mais sutil, aparece no padrão com registro global:

```python
Funcionario.query.filter(
    (Funcionario.id_usuario_fk == current_user.id) | (Funcionario.id_usuario_fk == None)
).all()
```

`routes.py:475` (funcionários) e `routes.py:517` (maquinário). Qualquer registro criado
sem dono fica visível para **todos** os usuários. Não é uma brecha de escrita — a checagem
no `PUT`/`DELETE` protege — mas é um vazamento de leitura.

### 9.6 Handlers de erro vazando internals

`app/__init__.py:76-94` — tanto o handler de 500 quanto o de Exception devolvem
`str(e)` **e `traceback.format_exc()`** no corpo da resposta JSON. Em produção expõe
caminhos de arquivo, versões de biblioteca e estrutura interna. Também há um handler
genérico de `Exception` que transforma erros de negócio em HTTP 500.

### 9.7 Log de credencial em produção

`routes.py:400` — `print(f"DEBUG CLOUDINARY: CloudName='...' Key='{api_key}'")`.
A `api_key` do Cloudinary vai para o log a cada upload. A `api_secret` não é impressa,
mas o ideal é remover os dois prints de debug (`routes.py:275`, `297`, `333`, `400`, `423`).

### 9.8 Upload sem autenticação

`POST /upload` não tem `@login_required` (§6.6).

## 10. Como rodar local

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate   # venv/ já existe e é ignorada pelo git
pip install -r requirements.txt
cp .env .env.local        # ver §11
python run.py             # http://127.0.0.1:5000
```

### Frontend

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

O proxy do Vite (`vite.config.ts`) encaminha `/api` e `/static` para
`http://127.0.0.1:5000`, então **não é preciso definir `VITE_API_URL` em dev**.

Outros scripts: `npm run build` (`tsc && vite build`), `npm run lint`,
`npm run preview`.

## 11. Variáveis de ambiente

### Backend — `backend/.env` (git-ignored, ver §5 do `.gitignore`)

| Variável | Uso |
|---|---|
| `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME` | conexão MySQL |
| `DATABASE_URL` | alternativa; tem precedência sobre as cinco acima |
| `SECRET_KEY` | assina o cookie de sessão — **não pode mudar em produção** |
| `CLOUDINARY_URL` | `cloudinary://<key>:<secret>@<cloud_name>` |
| `FLASK_DEBUG` | liga o debug |

`config.py:23-24` converte `postgres://` → `postgresql://` automaticamente.

**Atenção:** o `.env` local tem `DB_HOST=localhost`, ou seja, aponta para um MySQL na
máquina. **O `DB_HOST` efetivo de produção só existe no painel do Render.** Para planejar
a migração é preciso confirmar lá qual é o banco real.

### Frontend — variável no painel da Vercel

| Variável | Uso |
|---|---|
| `VITE_API_URL` | URL base da API; vazia em dev (usa o proxy) |

## 12. Apêndice — inventário de rotas do frontend

Uma tela por área, todas consuming a API acima:

| Tela | Arquivo |
|---|---|
| Boas-vindas / onboarding | `src/pages/WelcomePage.tsx` |
| Login | `src/pages/LoginPage.tsx` |
| Recuperar senha | `src/pages/ForgotPasswordPage.tsx` |
| Lavouras (home) | `src/pages/LavourasPage.tsx` |
| Nova / editar lavoura | `src/pages/NewLavouraPage.tsx` |
| Perfil da lavoura | `src/pages/LavouraProfilePage.tsx` |
| Chat da lavoura | `src/pages/ChatPage.tsx` |
| Feed de atividades | `src/pages/ActivitiesPage.tsx` |
| Funcionários | `src/pages/FuncionariosPage.tsx` |
| Maquinário | `src/pages/MaquinariosPage.tsx` |
| Dashboard / gráficos | `src/pages/DashboardPage.tsx` |
| Perfil do usuário | `src/pages/ProfilePage.tsx` |
| Configurações | `src/pages/SettingsPage.tsx` |
