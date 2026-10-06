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
   values ($1, 'alice@teste.com', '{"nome":"Alice"}'),
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

try {
  await asUser(ALICE, `delete from public.tipo_atividade where nome = 'Outros'`);
  const r = await asUser(ALICE, `select count(*)::int as n from public.tipo_atividade where nome = 'Outros'`);
  r[0].n === 1 ? ok('cliente não apaga categoria (sem política de DELETE)') : no('catalogo gravavel');
} catch (e) { ok(`escrita no catálogo rejeitada (${e.message.slice(0, 40)})`); }

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
console.log(`\n${pass} passaram, ${fail} falharam\n`);
process.exit(fail > 0 ? 1 : 0);