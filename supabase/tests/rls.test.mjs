import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Relativo ao próprio script: o harness roda de qualquer diretório e sobrevive
// a mover o repositório de lugar.
const MIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// Ordem: o CLI aplica por timestamp do nome do arquivo.
const files = readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort();

// memory:// garante banco novo a cada execução — sem isso o estado persiste
// entre runs e os fixtures colidem na chave primária.
const db = new PGlite({ dataDir: 'memory://', extensions: { pgcrypto } });
let pass = 0, fail = 0;

const ok = (label) => { pass++; console.log(`  ok   ${label}`); };
const no = (label, extra) => { fail++; console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`); };

// ---------------------------------------------------------------------------
// 1. Schema auth falso (no Supabase real isso já existe)
// ---------------------------------------------------------------------------
await db.exec(`
  create schema auth;

  create table auth.users (
    id                 uuid primary key default gen_random_uuid(),
    email              text unique,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );

  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create or replace function auth.role() returns text language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
  $$;

  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  -- Sem isso, uma query que chame auth.uid() direto falha com
  -- "permission denied for schema auth". As policies escapam porque são
  -- avaliadas com privilégio do dono da tabela; uma chamada na cláusula WHERE
  -- é do usuário. No Supabase real as duas roles já têm usage em auth.
  grant usage on schema auth to anon, authenticated;
`);

// ---------------------------------------------------------------------------
// 2. Aplicar as migrations, na ordem
// ---------------------------------------------------------------------------
console.log('\n== migrations ==');
for (const f of files) {
  try {
    await db.exec(readFileSync(`${MIG_DIR}/${f}`, 'utf8'));
    ok(f);
  } catch (e) {
    no(f, e.message);
    console.log('\nAbortando: migration base falhou.');
    process.exit(1);
  }
}

// Baseline: um SQL só roda como superuser, então conceda privilégios aos papéis
// que o PostgREST usa. No Supabase isso já vem pronto.
await db.exec(`
  grant all on all tables    in schema public to anon, authenticated;
  grant all on all sequences in schema public to anon, authenticated;
`);

// ---------------------------------------------------------------------------
// 3. Fixtures: dois produtores, via o trigger de signup
// ---------------------------------------------------------------------------
const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB   = '22222222-2222-2222-2222-222222222222';

// Aplica o trigger de verdade: o insert em auth.users dispara
// on_auth_user_created, que cria o perfil. Nada de insert manual —
// seria duplicar a linha e mascarar o comportamento do trigger.
await db.query(
  `insert into auth.users (id, email, raw_user_meta_data)
   values ($1, 'alice@teste.com', '{"nome":"Alice","foto_url":"https://res.cloudinary.com/dbmxmbqbi/image/upload/perfil/abc.jpg"}'),
          ($2, 'bob@teste.com',   '{}'),
          ($3, 'semnome@teste.com','{"nome":"   "}')`,
  [ALICE, BOB, '33333333-3333-3333-3333-333333333333']
);

console.log('\n== trigger de signup ==');
const perfis = (await db.query('select nome from public.usuario order by nome')).rows;
perfis.length === 3
  ? ok('trigger criou 3 perfis a partir de auth.users')
  : no('perfis', `veio ${perfis.length}`);
perfis.some(p => p.nome === 'Alice')
  ? ok('nome veio de raw_user_meta_data->>nome')
  : no('nome do metadata');
perfis.some(p => p.nome === 'bob')
  ? ok('metadata vazio caiu no prefixo do e-mail')
  : no('fallback de nome', JSON.stringify(perfis.map(p => p.nome)));
perfis.some(p => p.nome === 'semnome')
  ? ok('nome em branco no metadata virou prefixo do e-mail')
  : no('trim de nome em branco', JSON.stringify(perfis.map(p => p.nome)));

// Foto do cadastro: sem isso o WelcomePage subia a imagem para o Cloudinary e
// ela ficava órfã — a URL nunca chegava em public.usuario.
const comFoto = (await db.query(`select nome, foto_url from public.usuario where nome = 'Alice'`)).rows;
comFoto[0]?.foto_url?.includes('res.cloudinary.com')
  ? ok('foto_url veio do metadata no signup')
  : no('foto do signup', JSON.stringify(comFoto));

// Sem foto no metadata, a coluna tem de ficar nula — não string vazia, que
// passaria no NOT NULL e renderizaria <img src=""> quebrado na tela.
const semFoto = (await db.query(`select nome, foto_url from public.usuario where nome = 'bob'`)).rows;
semFoto[0]?.foto_url === null
  ? ok('sem foto no metadata, foto_url fica null (não string vazia)')
  : no('foto vazia', JSON.stringify(semFoto));

// ---------------------------------------------------------------------------
// 4. Isolamento entre produtores
// ---------------------------------------------------------------------------
async function asUser(uid, sql, params = []) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
  await db.query('set role authenticated');
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.query('reset role');
  }
}

async function anon(sql, params = []) {
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  await db.query(`select set_config('request.jwt.claim.role', 'anon', false)`);
  await db.query('set role anon');
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.query('reset role');
  }
}

await asUser(ALICE, `insert into public.lavoura (nome, cultura, id_usuario)
                     values ('Sítio da Alice', 'Café', $1)`, [ALICE]);
await asUser(BOB, `insert into public.lavoura (nome, cultura, id_usuario)
                   values ('Fazenda do Bob', 'Café', $1)`, [BOB]);

const aliceAtivities = await asUser(ALICE, `insert into public.atividade (id_lavoura, id_tipo_atividade, descricao)
  select id, 1, 'Adubei a lavoura' from public.lavoura limit 1`);
void aliceAtivities;

console.log('\n== isolamento ==');
const aliceLav = await asUser(ALICE, 'select nome from public.lavoura');
aliceLav.length === 1 && aliceLav[0].nome === 'Sítio da Alice'
  ? ok('Alice vê só a própria lavoura') : no('Alice lê lavouras', JSON.stringify(aliceLav));

const bobLav = await asUser(BOB, 'select nome from public.lavoura');
bobLav.length === 1 && bobLav[0].nome === 'Fazenda do Bob'
  ? ok('Bob vê só a própria lavoura') : no('Bob lê lavouras', JSON.stringify(bobLav));

const bobAtiv = await asUser(BOB, 'select descricao from public.atividade');
bobAtiv.length === 0
  ? ok("Bob não vê a atividade da Alice (escopo via join)")
  : no('vazamento de atividade', JSON.stringify(bobAtiv));

// IDOR: Bob tenta escrever na lavoura da Alice.
try {
  await asUser(BOB, `update public.lavoura set nome = 'tomada' where nome = 'Sítio da Alice'`);
  const r = await asUser(ALICE, `select nome from public.lavoura where nome = 'tomada'`);
  r.length === 0 ? ok('UPDATE na lavoura alheia não surtiu efeito') : no('IDOR de escrita', JSON.stringify(r));
} catch (e) { ok(`UPDATE na lavoura alheia rejeitado (${e.message.slice(0, 40)})`); }

// Bob tenta estornar o dono da própria lavoura para a Alice.
try {
  await asUser(BOB, `update public.lavoura set id_usuario = $1 where nome = 'Fazenda do Bob'`, [ALICE]);
  const r = await asUser(ALICE, `select nome from public.lavoura where nome = 'Fazenda do Bob'`);
  r.length === 0 ? ok('with check do UPDATE impede reatribuir dono') : no('reatribuição de dono', JSON.stringify(r));
} catch (e) { ok(`reatribuição de dono bloqueada (${e.message.slice(0, 40)})`); }

// ---------------------------------------------------------------------------
// 5. Catálogo e usuários desativados
// ---------------------------------------------------------------------------
console.log('\n== catalogo e ativo ==');
const tipos = await asUser(ALICE, 'select nome from public.tipo_atividade order by nome');
tipos.length === 5 ? ok('5 categorias semeadas') : no('semente', `${tipos.length} linhas`);

// Catálogo gravável desde 20261005120600. O que precisa continuar garantido é
// a integridade: categoria em uso não pode sumir.
const criada = await asUser(ALICE, `insert into public.tipo_atividade (nome, icone, cor)
  values ('Teste CRUD', 'Sprout', 'bg-green-500') returning id`);
criada.length === 1 ? ok('autenticado cria categoria') : no('insert no catálogo');

const renomeada = await asUser(ALICE, `update public.tipo_atividade set nome = 'Renomeada'
  where id = ${criada[0].id} returning nome`);
renomeada[0]?.nome === 'Renomeada' ? ok('autenticado renomeia categoria') : no('update no catálogo');

// Categoria em uso pela atividade da Alice. Descobrir pelo join em vez de
// assumir nome/id: a semente usa on conflict e o id pode variar.
const emUso = await asUser(ALICE, `select t.id, t.nome from public.tipo_atividade t
  join public.atividade a on a.id_tipo_atividade = t.id
  join public.lavoura l on l.id = a.id_lavoura
  where l.id_usuario = auth.uid() limit 1`);

// O DELETE tem de ser recusado pelo FK on delete restrict - e a protecao que
// substitui a politica de somente leitura.
const naoApagaEmUso = emUso.length > 0
  ? await asUser(ALICE, `delete from public.tipo_atividade where id = ${emUso[0].id}`).then(() => false).catch(() => true)
  : false;
naoApagaEmUso ? ok(`categoria em uso nao pode ser apagada (FK restrict: ${emUso[0]?.nome})`)
             : no('apagou categoria em uso');

// Categoria sem uso pode sair.
await asUser(ALICE, `delete from public.tipo_atividade where id = ${criada[0].id}`);
const sobrou = await asUser(ALICE, `select count(*)::int as n from public.tipo_atividade where id = ${criada[0].id}`);
sobrou[0].n === 0 ? ok('categoria sem uso pode ser apagada') : no('delete de categoria livre');

// Nome duplicado e barrado por unique(lower(nome)).
const duplicada = await asUser(ALICE, `insert into public.tipo_atividade (nome) values ('${emUso[0]?.nome}')`)
  .then(() => false).catch(() => true);
duplicada ? ok('nome duplicado recusado por unique(lower(nome))') : no('aceitou categoria duplicada');

// Anonimo continua sem escrita, mesmo com as policies de escrita abertas para
// authenticated.
const anonEscreve = await anon(`insert into public.tipo_atividade (nome) values ('Anon')`)
  .then(() => false).catch(() => true);
anonEscreve ? ok('anon nao cria categoria') : no('anon gravou no catalogo');


await db.query('update public.usuario set ativo = false where id = $1', [ALICE]);
const lavInativa = await asUser(ALICE, 'select nome from public.lavoura');
lavInativa.length === 0 ? ok('usuário desativado não lê nada') : no('usuario_ativo() ignorado', JSON.stringify(lavInativa));
await db.query('update public.usuario set ativo = true where id = $1', [ALICE]);

// ---------------------------------------------------------------------------
// 6. Anônimo
// ---------------------------------------------------------------------------
console.log('\n== anonimo ==');
const anonLav = await anon('select nome from public.lavoura');
anonLav.length === 0 ? ok('anon não vê lavouras') : no('anon leu', JSON.stringify(anonLav));
const anonTipos = await anon('select nome from public.tipo_atividade');
anonTipos.length === 0 ? ok('anon não vê o catálogo') : no('anon leu catalogo');

// ---------------------------------------------------------------------------
// 7. Integridade referencial
// ---------------------------------------------------------------------------
console.log('\n== integridade ==');
const semTipo = await asUser(ALICE, `insert into public.atividade (id_lavoura, id_tipo_atividade)
  select id, 99999 from public.lavoura limit 1`).then(() => false).catch(() => true);
semTipo ? ok('atividade com tipo inexistente recusada por FK') : no('FK de tipo_atividade');

const cascade = await asUser(ALICE, 'select count(*)::int as n from public.atividade_imagem');
cascade[0].n === 0 ? ok('cascade lavoura->atividade->imagem íntegro') : no('cascade');

// ---------------------------------------------------------------------------
// 8. Default de dono (migration 05)
// ---------------------------------------------------------------------------
console.log('\n== default de dono ==');

// O ponto é o INSERT *sem* id_usuario: é assim que o frontend vai gravar, sem
// que o navegador precise saber qual uuid é o do dono.
const semDono = await asUser(ALICE, `insert into public.lavoura (nome, cultura)
                                      values ('Sem dono explícito', 'Café')
                                      returning id_usuario`);
semDono[0]?.id_usuario === ALICE
  ? ok('id_usuario preenchido por auth.uid() quando o cliente omite')
  : no('default de dono', JSON.stringify(semDono[0]));

// E o cliente tentando forçar a lavoura para a conta do vizinho tem de ser
// recusado: é o with check da política pegando, não o default.
const forcado = await asUser(ALICE, `insert into public.lavoura (nome, cultura, id_usuario)
                                     values ('Roubo', 'Café', $1)`).then(() => false).catch(() => true);
forcado ? ok('INSERT com id_usuario do vizinho recusado') : no('vazamento via id_usuario');

// ---------------------------------------------------------------------------
// 9. View de última atividade (migration 05)
// ---------------------------------------------------------------------------
console.log('\n== view lavoura_com_ultima_atividade ==');

// Isolamento primeiro, e é o teste que importa: sem security_invoker a view roda
// como dono do schema e as duas contas enxergam as lavouras uma da outra.
const viewAlice = await asUser(ALICE,
  `select nome, ultima_atividade_date from public.lavoura_com_ultima_atividade order by nome`);
const viewBob = await asUser(BOB,
  `select nome, ultima_atividade_date from public.lavoura_com_ultima_atividade order by nome`);

const aliceVaza = viewAlice.some(l => l.nome === 'Fazenda do Bob');
const bobVaza = viewBob.some(l => l.nome === 'Sítio da Alice');
!aliceVaza && !bobVaza
  ? ok('view não expõe lavouras da outra conta (security_invoker)')
  : no('view vazou', `Alice viu ${JSON.stringify(viewAlice)} / Bob viu ${JSON.stringify(viewBob)}`);

const comData = viewAlice.find(l => l.nome === 'Sítio da Alice');
comData?.ultima_atividade_date
  ? ok('última atividade veio preenchida')
  : no('ultima_atividade_date', JSON.stringify(comData));

const semData = viewAlice.find(l => l.nome === 'Sem dono explícito');
semData && semData.ultima_atividade_date === null
  ? ok('lavoura sem atividade tem data nula, e não some da lista')
  : no('lavoura sem atividade', JSON.stringify(semData));

// ---------------------------------------------------------------------------
console.log(`\n${pass} passaram, ${fail} falharam\n`);
process.exit(fail > 0 ? 1 : 0);