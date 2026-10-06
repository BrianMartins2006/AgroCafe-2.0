import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'src', 'services');

// Os testes importam o arquivo real do frontend. `paraData()` foi testado por
// uma cópia sua, e o original estava quebrado — o teste passou verde. Com
// type-stripping do Node não existe cópia possível de divergir.
const { contarDias, calcularPeriodo, parseValor, normalizarDescartados, dataParaDate } =
  await import(join(DIR, 'calculoPeriodo.ts'));

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ok   ${l}`); };
const no = (l, e) => { fail++; console.log(`  FAIL ${l}${e ? ' — ' + e : ''}`); };
const eq = (l, obtido, esperado) =>
  Object.is(obtido, esperado) ? ok(l) : no(l, `veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`);

console.log('\n== contarDias ==');

eq('dia único conta 1', contarDias('2026-01-01', '2026-01-01'), 1);
eq('31 dias no mês de janeiro', contarDias('2026-01-01', '2026-01-31'), 31);
eq('janeiro tem 31, não 30', contarDias('2026-02-01', '2026-02-28'), 28);
eq('ano bissexto: 2024-02-29 existe', contarDias('2024-02-01', '2024-02-29'), 29);
eq('ano não bissexto: 2026 não tem 29/02', contarDias('2026-02-01', '2026-02-28'), 28);
eq('março tem 31', contarDias('2026-03-01', '2026-03-31'), 31);
eq('intervalo de 1 ano', contarDias('2025-01-01', '2025-12-31'), 365);
eq('ano bissexto inteiro', contarDias('2024-01-01', '2024-12-31'), 366);
eq('término antes do início devolve 0', contarDias('2026-03-10', '2026-03-01'), 0);
eq('data inválida devolve 0', contarDias('lixo', '2026-03-01'), 0);

// A divisão por 86400000 falha aqui: 2026-10-18 é o início do horário de
// verão brasileiro, e o dia tem 23 horas.
const verao = contarDias('2026-10-18', '2026-10-19');
eq('passagem do horário de verão conta 2', verao, 2);

console.log('\n== parseValor ==');

eq('inteiro', parseValor('150'), 150);
eq('decimal com ponto', parseValor('1234.56'), 1234.56);
eq('decimal com vírgula (pt-BR)', parseValor('1234,56'), 1234.56);
eq('milhar com ponto', parseValor('1.234'), 1234);
eq('milhar + decimal pt-BR', parseValor('1.234,56'), 1234.56);
eq('milhar + decimal en-US', parseValor('1,234.56'), 1234.56);
eq('com prefixo R$', parseValor('R$ 80,00'), 80);
eq('vírgula sozinha é decimal em pt-BR', parseValor('1,234'), 1.234);
eq('vazio devolve 0', parseValor(''), 0);
eq('null devolve 0', parseValor(null), 0);
eq('texto solto devolve 0', parseValor('abc'), 0);
// O bug que parseFloat não pegaria: devolve 1 em vez de 1234.
eq('não trunca em 1.234,56', parseValor('1.234,56'), 1234.56);

console.log('\n== calcularPeriodo ==');

const base = { hoje: '2026-10-10' };

const p1 = calcularPeriodo({ ...base, dataInicio: '2026-10-01', dataTermino: '2026-10-31', valorDia: '150' });
eq('período fechado: dias', p1.diasEfetivos, 31);
eq('período fechado: total', p1.valorTotal, 4650);
eq('período fechado: emAberto falso', p1.emAberto, false);

const p2 = calcularPeriodo({ ...base, dataInicio: '2026-10-01', valorDia: '100' });
eq('aberto conta até hoje', p2.diasEfetivos, 10);
eq('aberto: total', p2.valorTotal, 1000);
eq('aberto: emAberto verdadeiro', p2.emAberto, true);

// Período aberto com término explicitamente nulo (vem assim do Postgres).
const p2b = calcularPeriodo({ ...base, dataInicio: '2026-10-01', dataTermino: null, valorDia: '100' });
eq('termino null conta até hoje', p2b.diasEfetivos, 10);

const p3 = calcularPeriodo({
  ...base, dataInicio: '2026-10-01', dataTermino: '2026-10-10', valorDia: '200',
  diasDescartados: ['2026-10-03', '2026-10-04'],
});
eq('descontar 2 dias', p3.diasEfetivos, 8);
eq('total com desconto', p3.valorTotal, 1600);

const p4 = calcularPeriodo({
  ...base, dataInicio: '2026-10-01', dataTermino: '2026-10-10', valorDia: '200',
  diasDescartados: ['2026-10-03', '2026-10-03'],
});
eq('descartar o mesmo dia 2x conta 1', p4.diasEfetivos, 9);

// Data de descarte fora do período não pode reduzir a conta.
const p5 = calcularPeriodo({
  ...base, dataInicio: '2026-10-05', dataTermino: '2026-10-10', valorDia: '100',
  diasDescartados: ['2026-09-01', '2026-11-01'],
});
eq('descarte fora do período é ignorado', p5.diasEfetivos, 6);

const p6 = calcularPeriodo({ ...base, dataInicio: '2026-10-01', dataTermino: '2026-10-10', valorDia: '80', diasManuais: 25 });
eq('dias manuais têm precedência', p6.diasEfetivos, 25);
eq('total pelos dias manuais', p6.valorTotal, 2000);

const p7 = calcularPeriodo({ ...base, dataInicio: '2026-10-01', dataTermino: '2026-10-10', valorDia: '80', diasManuais: 25.9 });
eq('dias manuais fracionários arredondam para baixo', p7.diasEfetivos, 25);

const p8 = calcularPeriodo({ ...base, dataInicio: '2026-10-01', dataTermino: '2026-10-10', valorDia: '33,33' });
eq('total com 2 casas', p8.valorTotal, 333.3);
eq('arredonda em centavos', Math.round(p8.valorTotal * 100) / 100, p8.valorTotal);

console.log('\n== normalizarDescartados ==');

eq('remove repetidos', normalizarDescartados(['2026-10-05', '2026-10-01', '2026-10-05']).length, 2);
eq('ordena', normalizarDescartados(['2026-10-05', '2026-10-01'])[0], '2026-10-01');
eq('joga fora data inválida', normalizarDescartados(['2026-10-01', 'nao-data', '']).length, 1);
eq('aceita null', normalizarDescartados(null).length, 0);

console.log('\n== dataParaDate ==');

eq('meio-dia local evita o dia anterior', dataParaDate('2026-01-01').getDate(), 1);
eq('mês zero-based', dataParaDate('2026-01-15').getMonth(), 0);

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail > 0 ? 1 : 0);