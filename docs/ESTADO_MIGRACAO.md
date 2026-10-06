# Estado da Migração — AgroCafé → Supabase

> Documento de passagem de turno. Serve para retomar o trabalho do zero se a
> sessão for perdida. Atualizar ao fim de cada fase.

**Última atualização:** 05/10/2026 — Fase B (autenticação) concluída.
**Workspace:** `/home/brian/AgroCaf-2.0/AgroCafé` (branch `main`)
**Projeto Supabase:** `apwmdbtpczylzowfrmvb` — https://apwmdbtpczylzowfrmvb.supabase.co (São Paulo)

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

Decisões de modelagem que já estão travadas no schema:
- `lavoura`, `funcionario`, `maquinario` têm `id_usuario NOT NULL` (dono obrigatório).
- `atividade.data` é `timestamptz`.
- `public.usuario` **sem `FORCE RLS`** — forçar quebraria o próprio trigger de signup.

### Testes
```
cd supabase/tests && npm test     # 21 passaram, 0 falharam
```
Rodam sobre PGlite (Postgres real em memória), não em mock. Cobrem isolamento
entre dois usuários, IDOR, catálogo read-only, `usuario` desativado, anon,
integridade de FK e cascade `lavoura → atividade → imagem`.

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

### Estado de validação
- `npm run build` — **verde**.
- `npm test` (PGlite) — **21/21**.
- `npm run lint` — 73 problemas, **todos pré-existentes** (`no-explicit-any` em
  arquivos não tocados por esta fase). Arquivos novos têm 0 erros, 1 warning de
  `react-refresh` em `useAuth.tsx`. Não é regressão; limpar é trabalho da Fase E.
- **Não validado no navegador ainda** — falta a anon key (ver §5).

---

## 4. Armadilhas conhecidas (ler antes de mexer no código)

1. **`DashboardPage.tsx:64`** usa `a.data.startsWith(date)`. `atividade.data` é
   `timestamptz`, então o Supabase devolve `Date` e `.startsWith` deixa de
   existir. Precisa de comparação por dia no fuso local, não por string. É o
   primeiro erro que vai aparecer ao ligar o módulo `atividades.ts`.
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
     ainda estiver exposto em algum lugar.
8. **Tamanho do backend:** 158M, dos quais **146M são `backend/venv/`**, que já
   está no `.gitignore` e não afeta o commit de forma alguma. Os 12M de
   `backend/app/static/` são majoritariamente 5 JPEGs de teste versionados
   (`cafe.jpg`, `cafe2.jpeg`). Nada disso entra no commit da Fase B.

---

## 5. Bloqueios para testar no navegador

- [ ] **Colar a `VITE_SUPABASE_ANON_KEY`** em `frontend/.env.local`
      (copiar de `.env.local.example`). É a chave pública; pode ir no frontend.
      **Nunca** usar `service_role` no frontend.
- [ ] **Configurar Redirect URLs** no painel do Supabase (Auth → URL Configuration):
      incluir a URL de produção e o path de recuperação de senha
      (`/redefinir-senha`).
- [ ] **Confirmar o estado de "Confirm email"** no painel e decidir se fica ligado.
- [ ] Adicionar o e-mail da esposa à organização (para o SMTP funcionar).
- [ ] **Configurar o unsigned upload preset** no Cloudinary (Fase D).

O frontend hoje **compila mas não loga** sem a anon key. E, como **11 arquivos
ainda importam `api.ts`** (`ProfilePage`, `LavourasPage`, `NewLavouraPage`,
`LavouraProfilePage`, `ActivitiesPage`, `DashboardPage`, `ChatPage`,
`FuncionariosPage`, `MaquinariosPage`, e `WelcomePage`/`SettingsPage` só para
upload e perfil), **o app não abre a lista de lavouras até a Fase C terminar** —
isso é esperado, não é regressão.

---

## 6. O que falta, em ordem

### Fase C — Serviços de dados (próxima)
Substituir `frontend/src/services/api.ts` por um módulo por domínio, usando
`supabase.from(...)`. Ordem sugerida:

- [ ] `perfil.ts` — `buscar()`, `atualizar()`. **`WelcomePage` já consome foto no
      cadastro; esse é o primeiro consumidor.** Usa `supabase.auth.getUser()`,
      nunca confia em id do cliente.
- [ ] `lavouras.ts` — CRUD + busca. `id_usuario` sempre do usuário da sessão.
- [ ] `atividades.ts` — CRUD. `data` vira `Date`: cuidado com o fuso.
- [ ] `imagens.ts` — CRUD.
- [ ] `funcionarios.ts`, `maquinarios.ts` — CRUD.
- [ ] `dashboard.ts` — agregações. Feito no cliente por enquanto (volume baixo).
- [ ] `chat.ts` — revisar: hoje é localStorage? Se for, não há tabela nova.
- [ ] Remover `api.ts` quando nenhum import restar.
- [ ] Corrigir `DashboardPage.tsx:64`.

Depois de cada módulo: rodar o app e navegar na tela correspondente. **Não
avançar para o próximo módulo sem navegar no anterior.**

### Fase D — Uploads
- [ ] `lib/cloudinary.ts` — unsigned upload com preset.
- [ ] `MediaPicker.tsx` e `WelcomePage.tsx` (hoje ainda chamam `/api/v1/upload`).

### Fase E — Limpeza
- [ ] Tipar o resto (eliminar os 69 `any` do lint).
- [ ] Separar `useAuth` para silenciar o warning de `react-refresh`.
- [ ] Remover o backend Flask quando o frontend estiver validado.
- [ ] Corrigir/atualizar `docs/PLANO_MIGRACAO.md` (remover ETL).

### Fase F — Deploy
- [ ] Build de produção, variáveis de ambiente na hospedagem.
- [ ] Teste real de e-mail (reset de senha) com as duas contas.

---

## 7. Inventário (para não redescobrir do zero)

**24 padrões de endpoint** distribuídos em **13 telas**, ~4.300 linhas.
Backend legado ainda presente em `backend/` (não remover antes da Fase E).

Ordem de migração das telas, da mais simples para a mais dependente:
Login/Welcome/Settings (feito) → Perfil → Lavouras → Detalhe da Lavoura →
Atividades → Funcionários → Maquinário → Dashboard → Chat.

---

## 8. Comandos

```bash
# frontend
cd frontend && npm run build && npm run lint

# testes de RLS
cd supabase/tests && npm test

# sincronizar migrations com o projeto real
npx supabase db push --linked
npx supabase inspect db table-stats --linked

# verificação remota completa (rodar no SQL Editor do painel)
# conteúdo de supabase/verify.sql
```

---

## 9. Pendências de git

O `main` tem alterações não commitadas de antes da migração. Elas **não fazem
parte do commit da Fase B** e é justamente por isso que o commit limpo se faz
com *staging explícito*, não com `git add -A`.

**Não commitar agora** (pré-existentes, fora do escopo):
`backend/app/models/atividade.py`, `backend/app/routes/api/routes.py`,
`frontend/src/services/api.ts`, `frontend/yarn.lock`,
`frontend/src/pages/{Activities,Chat,Dashboard}Page.tsx`, e as remoções de
`PLAN_DE_MELHORIAS.md`, `ROADMAP.md`, `design_notes.md`, `design_notes.pdf`,
`relatorio_seguranca_ux.md`.

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

### Backend: decisão pendente com o usuário
A remoção de `backend/` foi adiada por decisão explícita — o usuário vai tratar
disso depois. Registrando o motivo de não ser feito agora, para ninguém
"acelerar" isso numa sessão futura sem ler:

- O frontend ainda **não foi validado no navegador** (falta a anon key) e **11
  arquivos ainda chamam a API do Flask**. Apagar o backend agora deixa o app sem
  nenhuma forma de funcionar, sem fallback.
- Como não há ETL nem push para remote, apagar `backend/app/` **destrói 2
  alterações não commitadas** (ver armadilha 7) que não estão no histórico.
- Se for realmente remover, fazer **commitar primeiro**, depois remover, e só
  na Fase E (após frontend validado).