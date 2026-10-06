import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ambiente de teste compartilhado: PGlite novo, com o schema `auth` falso e as
 * migrations aplicadas na ordem.
 *
 * Existe para que os testes de RLS e os de script de instalação não cada um
 * montem seu próprio banco — e para o bootstrap do `auth` existir em um lugar
 * só. Divergir aqui faria um teste passar e o outro falhar sem motivo visível.
 */

const MIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// Ordena por timestamp do nome, que é como o CLI do Supabase aplica.
export const migrations = () =>
  readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();

export function lerMigration(nome) {
  return readFileSync(join(MIG_DIR, nome), 'utf8');
}

/** `auth` e as roles: no Supabase real isso já existe, então simulado. */
const BOOTSTRAP_AUTH = `
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
`;

/**
 * Banco novo com pgcrypto e o schema auth.
 *
 * `dataDir: memory://` garante estado descartável: sem isso o conteúdo persiste
 * entre execuções e os fixtures colidem na chave primária.
 */
export async function novoBanco() {
  const db = new PGlite({ dataDir: 'memory://', extensions: { pgcrypto } });
  await db.exec(BOOTSTRAP_AUTH);
  return db;
}

/** Banco com todas as migrations aplicadas, na ordem. */
export async function bancoComMigrations() {
  const db = await novoBanco();
  for (const f of migrations()) await db.exec(lerMigration(f));
  return db;
}

/**
 * Banco com só as migrations anteriores a `antesDeste`.
 *
 * Usado para aplicar uma migration avulsa por cima de um schema já coerente,
 * que é o que o SQL Editor faz na prática.
 */
export async function bancoAte(antesDeste) {
  const db = await novoBanco();
  for (const f of migrations()) {
    if (f >= antesDeste) break;
    await db.exec(lerMigration(f));
  }
  return db;
}
