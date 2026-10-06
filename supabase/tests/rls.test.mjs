import { novoBanco, migrations, lerMigration } from './base-pg.mjs';

// Ordem: o CLI aplica por timestamp do nome do arquivo.
const files = migrations();

const db = await novoBanco();
let pass = 0, fail = 0;

const ok = (label) => { pass++; console.log(`  ok   ${label}`); };
const no = (label, extra) => { fail++; console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`); };

// ---------------------------------------------------------------------------
// 2. Aplicar as migrations, na ordem
// ---------------------------------------------------------------------------
console.log('\n== migrations ==');
for (const f of files) {
  try {
    await db.exec(lerMigration(f));
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
// 7.1 Período de trabalho (migration 08)
// ---------------------------------------------------------------------------
console.log('\n== periodo de trabalho ==');

// O seed não cria funcionários, e a tabela de período depende de um.
if ((await asUser(ALICE, `select id from public.funcionario limit 1`)).length === 0) {
  await asUser(ALICE, `insert into public.funcionario (nome, cargo, id_usuario)
    values ('Ana Colheita', 'Colheita', auth.uid())`);
  await asUser(BOB, `insert into public.funcionario (nome, cargo, id_usuario)
    values ('Bruno Plantio', 'Plantio', auth.uid())`);
}

const idFunc = (await asUser(ALICE, `select id from public.funcionario
  where id_usuario = auth.uid() order by id limit 1`))[0].id;

// Total é coluna gerada: o banco calcula, o cliente não manda.
const per = await asUser(ALICE, `insert into public.periodo_trabalho
  (id_funcionario, data_inicio, data_termino, valor_dia, dias)
  values ($1, '2026-10-01', '2026-10-10', 150, 8) returning id, valor_total`, [idFunc]);
per[0]?.valor_total === '1200.00'
  ? ok('valor_total calculado pelo banco (8 x 150)')
  : no('valor_total gerado', JSON.stringify(per[0]));

// Gravar no total é impossível: o banco recusa a coluna gerada.
const mexerNoTotal = await asUser(ALICE, `update public.periodo_trabalho
  set valor_total = 999999 where id = ${per[0].id}`)
  .then(() => false)
  .catch(e => /can only be updated to DEFAULT/i.test(e.message));
mexerNoTotal
  ? ok('total não pode ser forjado (coluna gerada)')
  : no('total forjável');

const mudouDias = await asUser(ALICE, `update public.periodo_trabalho
  set dias = 4 where id = ${per[0].id} returning valor_total`);
mudouDias[0]?.valor_total === '600.00'
  ? ok('total recalcula sozinho quando os dias mudam')
  : no('recalculo', JSON.stringify(mudouDias[0]));

// Período em aberto: a coluna data_termino aceita null.
const aberto = await asUser(ALICE, `insert into public.periodo_trabalho
  (id_funcionario, data_inicio, valor_dia, dias)
  values ($1, '2026-09-01', 100, 40) returning id, data_termino`, [idFunc]);
aberto[0]?.data_termino === null ? ok('período em aberto grava término nulo') : no('aberto', JSON.stringify(aberto[0]));

// O índice único existe para o dia não ser pago duas vezes.
const segundoAberto = await asUser(ALICE, `insert into public.periodo_trabalho
  (id_funcionario, data_inicio, valor_dia, dias)
  values ($1, '2026-09-15', 100, 20)`, [idFunc]).then(() => false).catch(() => true);
segundoAberto ? ok('não deixa dois períodos em aberto do mesmo funcionário') : no('aceitou 2 abertos');

// calculo_manual é o que separa "contei pelo calendário" de "digitei".
// Sem ele um lançamento manual de período aberto seria recontado na tela.
const manual = await asUser(ALICE, `insert into public.periodo_trabalho
  (id_funcionario, data_inicio, data_termino, valor_dia, dias, calculo_manual)
  values ($1, '2026-07-01', '2026-07-31', 120, 15, true) returning calculo_manual`, [idFunc]);
manual[0]?.calculo_manual === true ? ok('calculo_manual TRUE gravado') : no('manual true', JSON.stringify(manual[0]));

const porDatas = await asUser(ALICE, `insert into public.periodo_trabalho
  (id_funcionario, data_inicio, data_termino, valor_dia, dias)
  values ($1, '2026-06-01', '2026-06-30', 120, 30) returning id, calculo_manual`, [idFunc]);
porDatas[0]?.calculo_manual === false
  ? ok('calculo_manual default false quando a contagem vem das datas')
  : no('default calculo_manual', JSON.stringify(porDatas[0]));

// O updated_at precisa andar sozinho: sem trigger a coluna travaria na criação
// e qualquer ordenação por alteração recente mentiria.
const antesDoToque = await asUser(ALICE, `select updated_at from public.periodo_trabalho where id = $1`, [porDatas[0].id]);
await new Promise(r => setTimeout(r, 1100));
const depoisDoToque = await asUser(ALICE, `update public.periodo_trabalho
  set observacao = 'corrigido' where id = $1 returning updated_at`, [porDatas[0].id]);
new Date(depoisDoToque[0].updated_at).getTime() > new Date(antesDoToque[0].updated_at).getTime()
  ? ok('updated_at avança no update (trigger)')
  : no('updated_at congelado', JSON.stringify([antesDoToque[0], depoisDoToque[0]]));

// updated_at é intocável pelo cliente também.
const forjarTimestamp = await asUser(ALICE, `update public.periodo_trabalho
  set updated_at = '2020-01-01' where id = $1 returning updated_at`, [porDatas[0].id]);
!String(forjarTimestamp[0]?.updated_at).startsWith('2020-01-01')
  ? ok('updated_at do cliente é descartado pelo trigger')
  : no('aceitou updated_at do cliente', JSON.stringify(forjarTimestamp[0]));

await asUser(ALICE, `delete from public.periodo_trabalho where id in ($1, $2)`, [manual[0].id, porDatas[0].id]);

// Períodos fechados repetidos são permitidos: saiu e voltou.
const fechou = await asUser(ALICE, `update public.periodo_trabalho
  set data_termino = '2026-09-30' where id = ${aberto[0].id} returning id`);
fechou[0] ? ok('período aberto pode ser fechado') : no('fechamento');
const segundoFechado = await asUser(ALICE, `insert into public.periodo_trabalho
  (id_funcionario, data_inicio, data_termino, valor_dia, dias)
  values ($1, '2026-10-01', '2026-10-05', 100, 5) returning id`, [idFunc]);
segundoFechado[0] ? ok('vários períodos fechados do mesmo funcionário') : no('periodos multiplos');

const terminoAntes = await asUser(ALICE, `insert into public.periodo_trabalho
  (id_funcionario, data_inicio, data_termino, valor_dia, dias)
  values ($1, '2026-10-10', '2026-10-01', 100, 5)`, [idFunc]).then(() => false).catch(() => true);
terminoAntes ? ok('término antes do início recusado pelo check') : no('aceitou término invertido');

const zeroDias = await asUser(ALICE, `insert into public.periodo_trabalho
  (id_funcionario, data_inicio, valor_dia, dias)
  values ($1, '2026-10-01', 100, 0)`, [idFunc]).then(() => false).catch(() => true);
zeroDias ? ok('zero dias recusado pelo check') : no('aceitou 0 dias');

const valorNegativo = await asUser(ALICE, `insert into public.periodo_trabalho
  (id_funcionario, data_inicio, valor_dia, dias)
  values ($1, '2026-10-01', -50, 5)`, [idFunc]).then(() => false).catch(() => true);
valorNegativo ? ok('valor do dia negativo recusado') : no('aceitou valor negativo');

const descarteForaDoPeriodo = await asUser(ALICE, `insert into public.periodo_trabalho
  (id_funcionario, data_inicio, data_termino, valor_dia, dias, dias_descartados)
  values ($1, '2026-10-01', '2026-10-05', 100, 5,
          array['2026-11-30']::date[]) returning id`, [idFunc]);
descarteForaDoPeriodo[0] ? ok('dias_descartados guarda array de datas') : no('array de datas');

// A conta do Bob não enxerga nem toca no período da Alice.
const bobVe = await asUser(BOB, `select count(*)::int as n from public.periodo_trabalho`);
bobVe[0].n === 0 ? ok('Bob não vê o período da Alice') : no('vazamento entre contas', JSON.stringify(bobVe));

const bobEscreve = await asUser(BOB, `insert into public.periodo_trabalho
  (id_funcionario, data_inicio, valor_dia, dias)
  values ($1, '2026-10-01', 100, 5)`, [per[0].id_funcionario]).then(() => false).catch(() => true);
bobEscreve ? ok('Bob não cria período em cima do funcionário da Alice') : no('Bob gravou para a Alice');

const anonVe = await anon('select count(*)::int as n from public.periodo_trabalho');
anonVe[0].n === 0 ? ok('anon não vê períodos') : no('anon leu periodos');

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