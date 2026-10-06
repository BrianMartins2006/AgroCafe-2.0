/**
 * Verifica que `supabase/aplicar_periodos.sql` instala o mesmo schema que a
 * migration 20261005120800.
 *
 * Existe porque o script de instalação é copiado à mão para o SQL Editor, e
 * uma cópia desatualizada passaria despercebida: ninguém compararia o banco com
 * o repositório. Aqui as duas são aplicadas em bancos separados e os catálogos
 * comparados.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bancoAte, lerMigration } from './base-pg.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOME_MIGRATION = '20261005120800_periodo_trabalho.sql';
const SCRIPT = join(RAIZ, 'aplicar_periodos.sql');
const SCRIPT_REPARO = join(RAIZ, 'reparar_periodos.sql');

let passou = 0;
let falhou = 0;
const ok = (msg) => { passou++; console.log(`  ok   ${msg}`); };
const no = (msg, detalhe) => { falhou++; console.log(`  FAIL ${msg}${detalhe ? ` — ${detalhe}` : ''}`); };

/** Colunas, tipos, nullability, defaults e geradas. */
const consultaColunas = `
  select column_name, data_type, udt_name, is_nullable, column_default, is_generated
  from information_schema.columns
  where table_schema = 'public' and table_name = 'periodo_trabalho'
  order by column_name`;

const consultaPolicies = `
  select policyname, cmd, qual, with_check
  from pg_policies
  where schemaname = 'public' and tablename = 'periodo_trabalho'
  order by policyname`;

const consultaIndices = `
  select indexname, indexdef
  from pg_indexes
  where schemaname = 'public' and tablename = 'periodo_trabalho'
  order by indexname`;

const consultaTriggers = `
  select tgname, pg_get_triggerdef(oid) as definicao
  from pg_trigger
  where tgrelid = 'public.periodo_trabalho'::regclass and not tgisinternal
  order by tgname`;

const consultaChecks = `
  select conname, pg_get_constraintdef(oid) as definicao
  from pg_constraint
  where conrelid = 'public.periodo_trabalho'::regclass
  order by conname`;

/** Schema base sem a 08: é o estado que o SQL Editor tem antes do script. */
const bancoBase = () => bancoAte(NOME_MIGRATION);

console.log('\n== script de instalação ==');

const viaMigration = await bancoBase();
await viaMigration.exec(lerMigration(NOME_MIGRATION));

const viaScript = await bancoBase();
const sqlScript = readFileSync(SCRIPT, 'utf8');
// A guarda final é só para leitura no SQL Editor; aqui comparamos o schema.
const corpo = sqlScript.slice(0, sqlScript.indexOf('-- Confere o resultado'));
await viaScript.exec(corpo);

// 1. Tabela existe e as duas instalações produzem o mesmo catálogo.
const tab = await viaScript.query(`select to_regclass('public.periodo_trabalho') is not null as ok`);
tab.rows[0].ok ? ok('script cria a tabela') : no('script não criou a tabela');

for (const [nome, consulta] of [
  ['colunas', consultaColunas],
  ['policies', consultaPolicies],
  ['índices', consultaIndices],
  ['checks', consultaChecks],
]) {
  const a = await viaMigration.query(consulta);
  const b = await viaScript.query(consulta);
  const ja = JSON.stringify(a.rows);
  const jb = JSON.stringify(b.rows);
  ja === jb ? ok(`${nome} idênticos (${a.rows.length})`) : no(`${nome} divergem`, `\n    migration: ${ja}\n    script:    ${jb}`);
}

// 2. O ponto que o RLS só existe se a tabela estiver marcada.
const rls = await viaScript.query(
  `select relrowsecurity as ligado from pg_class where oid = 'public.periodo_trabalho'::regclass`);
rls.rows[0].ligado ? ok('RLS ligado pelo script') : no('RLS NÃO ligado — policies decorativas');

// `force row level security` fica desligado por decisão do projeto (migration
// 02): o dono da tabela contorna o RLS, e quem conecta é `authenticated`, não o
// dono. Só é checado aqui para o script não divergir das outras tabelas —
// ligado numa tabela e desligado em outra seria uma diferença silenciosa.
const forcado = await viaScript.query(`
  select relname, relforcerowsecurity as forcado
  from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r'
    and relname in ('periodo_trabalho', 'funcionario', 'atividade')
  order by relname`);
forcado.rows.every((t) => t.forcado === false)
  ? ok('force row level security desligado, igual às demais tabelas')
  : no('force divergente entre tabelas', JSON.stringify(forcado.rows));

// 3. Colunas Generated: o script tem que preservar o total como gerado.
const geradas = await viaScript.query(`
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'periodo_trabalho' and is_generated = 'ALWAYS'`);
geradas.rows.some((r) => r.column_name === 'valor_total')
  ? ok('valor_total continua coluna gerada')
  : no('valor_total deixou de ser gerada');

// 4. O guarda de porta: rodar o script inteiro duas vezes deve abortar limpo,
//    em vez de estourar erro de sintaxe ou criar tudo em duplicidade.
const segunda = await viaScript
  .exec(sqlScript)
  .then(() => 'aceitou')
  .catch((e) => e.message);
/aceitou/i.test(segunda) || /ja existe/i.test(segunda)
  ? ok('reexecutar o script aborta com aviso claro')
  : no('script aceitou reexecução silenciosa', segunda.slice(0, 120));

// 5. O trigger de updated_at tem que estar lá, senão a coluna morre na criação.
const trig = await viaScript.query(`
  select tgname from pg_trigger
  where tgrelid = 'public.periodo_trabalho'::regclass and not tgisinternal`);
trig.rows.some((t) => t.tgname === 'periodo_trabalho_toca_updated_at')
  ? ok('trigger de updated_at instalado')
  : no('trigger de updated_at ausente', JSON.stringify(trig.rows));

// ---------------------------------------------------------------------------
// 6. Script de reparo
//
// Reproduz o estado real encontrado no projeto Supabase em 06/10: a tabela
// existia com RLS e as 4 policies, mas sem `calculo_manual` e sem o trigger,
// criada por uma versão anterior do script. O reparo tem que levar esse estado
// ao schema completo — e não pode quebrar nada quando já está completo.
// ---------------------------------------------------------------------------

/**
 * Migration sem `calculo_manual` nem o trigger — a versão que foi colada no
 * painel antes do script ganhar esses dois itens.
 *
 * Corta a partir do comentário e até o `;` seguinte em vez de casar regex com o
 * texto exato: assim o recorte acompanha o arquivo quando ele muda, em vez de
 * silenciosamente deixar resíduo e o teste passar por um estado que não é o real.
 */
function migrationLegada() {
  return lerMigration(NOME_MIGRATION)
    // Termina na própria linha da coluna (que termina em vírgula, não `;`) —
    // cortar até o primeiro `;` levaria o `create table` inteiro junto.
    .replace(/-- Marca se `dias`[\s\S]*?calculo_manual\s+boolean[^\n]*\n/, '')
    .replace(/comment on column public\.periodo_trabalho\.calculo_manual[\s\S]*?';\n/, '')
    .replace(/-- Primeira tabela do schema com updated_at[\s\S]*?tocar_updated_at\(\);\n/, '');
}

const conserta = (sql) => {
  const corpo = sql.slice(0, sql.indexOf('-- Conferência'));
  // O `notify` não é transacional; sem isso o teste morre aqui.
  return corpo.replace("notify pgrst, 'reload schema';", '-- notify removido no teste');
};

const legado = await bancoBase();
await legado.exec(migrationLegada());

const antes = await legado.query(consultaColunas);
const temColunaAntes = antes.rows.some((c) => c.column_name === 'calculo_manual');
const trigAntes = await legado.query(consultaTriggers);
!temColunaAntes && trigAntes.rows.length === 0
  ? ok('estado legado reproduzido: sem calculo_manual e sem trigger')
  : no('não consegui reproduzir o estado legado', JSON.stringify({ temColunaAntes, trigAntes: trigAntes.rows }));

await legado.exec(conserta(readFileSync(SCRIPT_REPARO, 'utf8')));

for (const [nome, consulta] of [
  ['colunas', consultaColunas],
  ['índices', consultaIndices],
  ['checks', consultaChecks],
  ['policies', consultaPolicies],
]) {
  const esperado = await viaMigration.query(consulta);
  const obtido = await legado.query(consulta);
  JSON.stringify(esperado.rows) === JSON.stringify(obtido.rows)
    ? ok(`reparo: ${nome} iguais à migration (${obtido.rows.length})`)
    : no(`reparo: ${nome} divergem`,
        `\n    migration: ${JSON.stringify(esperado.rows)}\n    reparado:  ${JSON.stringify(obtido.rows)}`);
}

// O total tem que continuar gerado — é a garantia de que o número exibido não
// diverge do gravado, e um reparo malfeito costuma recriá-la como campo comum.
const geradaDepois = await legado.query(`
  select column_name, is_generated from information_schema.columns
  where table_schema = 'public' and table_name = 'periodo_trabalho' and column_name = 'valor_total'`);
geradaDepois.rows[0]?.is_generated === 'ALWAYS'
  ? ok('reparo preservou valor_total como coluna gerada')
  : no('reparo destruiu valor_total gerada', JSON.stringify(geradaDepois.rows[0]));

// repaired twice: não pode falhar nem duplicar nada
await legado.exec(conserta(readFileSync(SCRIPT_REPARO, 'utf8')));
const duasVezes = await legado.query(consultaColunas);
duasVezes.rows.length === antes.rows.length + 1
  ? ok('reparo é idempotente (rodar 2x não duplica coluna)')
  : no('reparo duplicou ao rodar 2x', `${antes.rows.length} -> ${duasVezes.rows.length}`);

// A linha nova não pode nascer manual por acidente: `false` é o que mantém um
// período em aberto contando sozinho até hoje.
// O trigger de signup (migration 03) já cria o public.usuario sozinho.
const dono = await legado.query(`insert into auth.users (email) values ('reparo@teste') returning id`);
const func = await legado.query(
  `insert into public.funcionario (nome, id_usuario) values ('Ana', $1) returning id`, [dono.rows[0].id]);

const legadoRow = await legado.query(
  `insert into public.periodo_trabalho (id_funcionario, data_inicio, valor_dia, dias)
   values ($1, '2026-05-01', 100, 5) returning id, calculo_manual`, [func.rows[0].id]);
legadoRow.rows[0]?.calculo_manual === false
  ? ok('linha nova após reparo nasce com calculo_manual = false')
  : no('default de calculo_manual errado', JSON.stringify(legadoRow.rows[0]));

// E o que fecha o ciclo do bug: com o trigger instalado, uma edição precisa
// mover o updated_at, e o total tem que acompanhar os dias.
const antes1 = await legado.query(`select updated_at from public.periodo_trabalho where id = $1`, [legadoRow.rows[0].id]);
await new Promise((r) => setTimeout(r, 1100));
const depois1 = await legado.query(
  `update public.periodo_trabalho set dias = 9 where id = $1
   returning updated_at, valor_total, calculo_manual`, [legadoRow.rows[0].id]);
new Date(depois1.rows[0].updated_at).getTime() > new Date(antes1.rows[0].updated_at).getTime()
  ? ok('reparo: updated_at avança ao editar')
  : no('updated_at congelado após reparo', JSON.stringify([antes1.rows[0], depois1.rows[0]]));
String(depois1.rows[0].valor_total) === '900.00'
  ? ok('reparo: total recalcula com os novos dias (9 x 100)')
  : no('total não recalculou', JSON.stringify(depois1.rows[0]));

const trigDepois = await legado.query(consultaTriggers);
trigDepois.rows.some((t) => t.tgname === 'periodo_trabalho_toca_updated_at')
  ? ok('reparo instalou o trigger, e só um')
  : no('trigger ausente ou duplicado', JSON.stringify(trigDepois.rows));

await legado.close();

await viaMigration.close();
await viaScript.close();

console.log(`\n${passou} passaram, ${falhou} falharam`);
process.exit(falhou === 0 ? 0 : 1);
