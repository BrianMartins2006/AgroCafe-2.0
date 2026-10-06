// Trava o bug do destructuring de paraData(). O regex tem 3 grupos de captura
// (ano, mes, dia); destruir com menos elementos fazia a data virar
// "2026-10-05-undefined-undefinedT12:00:00Z" e o Postgres respondia 22023
// ("time zone not recognized") em toda criação de atividade.
//
// Não testa via PGlite porque o bug é de JS puro: acontece antes da query.
// Uso: node teste-data.mjs
import assert from 'node:assert/strict';

// Cópia fiel de frontend/src/services/atividades.ts. Mantida em paralelo de
// propósito: o arquivo real é TypeScript com imports do supabase-js, e este
// teste roda sem build.
function paraData(valor, agora = new Date()) {
  if (!valor) return null;

  const soDia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
  if (soDia) {
    const [, ano, mes, dia] = soDia;
    const dataDeHoje = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
    if (`${ano}-${mes}-${dia}` === dataDeHoje) return null;
    return `${ano}-${mes}-${dia}T12:00:00Z`;
  }

  const iso = new Date(valor);
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}

let pass = 0;
let fail = 0;
const ok = (l) => { pass++; console.log(`  ok   ${l}`); };
const no = (l, e) => { fail++; console.log(`  FAIL ${l}${e ? ` — ${e}` : ''}`); };

// 2026-10-05 é segunda. Passa um "hoje" fixo para o teste não depender do dia.
const HOJE = new Date(2026, 9, 5, 22, 0, 0); // 05/10/2026 22:00 local

console.log('\n== paraData ==');

const t = (rotulo, entrada, esperado) => {
  const got = paraData(entrada, HOJE);
  try {
    assert.deepEqual(got, esperado);
    // A regressão do 22023 era 'undefined' aparecer na string. Checagem
    // explícita para não depender do expected.
    if (typeof got === 'string') {
      assert.ok(!got.includes('undefined'), `saída contém "undefined": ${got}`);
      assert.ok(!/NaN/.test(got), `saída contém NaN: ${got}`);
    }
    ok(`${rotulo} -> ${JSON.stringify(got)}`);
  } catch (e) {
    no(rotulo, `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(got)}`);
  }
};

t('dia cheio de ontem', '2026-10-04', '2026-10-04T12:00:00Z');
t('dia cheio de hoje (vira now no banco)', '2026-10-05', null);
t('dia cheio de amanhã', '2026-10-06', '2026-10-06T12:00:00Z');
t('mês e dia com zero à esquerda', '2026-01-09', '2026-01-09T12:00:00Z');
t('string vazia', '', null);
t('undefined', undefined, null);
t('null', null, null);
t('ISO completo respeita o horário', '2026-10-01T15:30:00Z', '2026-10-01T15:30:00.000Z');
t('lixo é ignorado', 'nao-e-data', null);

console.log('\n== regressão do 22023 ==');
// O formato exato que quebrava em produção.
const formatado = paraData('2026-10-04', HOJE);
try {
  assert.equal(formatado, '2026-10-04T12:00:00Z');
  // O Postgres aceita isso; rejeita "undefined-undefined" como fuso.
  assert.doesNotThrow(() => new Date(formatado));
  ok('data gerada é um timestamptz válido');
} catch (e) {
  no('data gerada é um timestamptz válido', e.message);
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);