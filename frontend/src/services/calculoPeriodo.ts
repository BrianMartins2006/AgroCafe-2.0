/**
 * Cálculo do período de trabalho.
 *
 * Arquivo sem imports de propósito: os testes importam ESTE arquivo
 * (`node --experimental-strip-types`), então o que é testado é o que roda na
 * tela. Foi o que faltou no `paraData()`, cujo teste copiava a função e podia
 * passar com o original quebrado.
 *
 * Por que dias de calendário e não dias úteis: o usuário pediu contar todos os
 * dias por padrão. Quem precisar excluir fim de semana usa `dias_descartados` —
 * é para isso que o campo existe.
 *
 * Fuso: as datas são `date`, não `timestamptz`, então não existe conversão. Um
 * período de 01/01 a 31/01 são 31 dias em qualquer timezone. Era o que causava
 * o bug do dia anterior no gráfico do dashboard.
 */

/** `YYYY-MM-DD`, o formato que o Postgres devolve em coluna `date`. */
export type DataISO = string;

export interface PeriodoCalculo {
  /** Datas brutas do intervalo, já sem os descartados. */
  diasBrutos: number;
  /** Dias dentro do intervalo que estão em `descartados`. */
  diasDescartados: number;
  /** `diasBrutos - diasDescartados`. */
  diasEfetivos: number;
  /** Valor por dia, já normalizado (aceita "1.234,56" e "1234.56"). */
  valorDia: number;
  /** `diasEfetivos * valorDia`, com 2 casas. */
  valorTotal: number;
  /** Data final usada: a informada ou hoje, quando o período está aberto. */
  dataFim: DataISO;
  /** `data_termino is null`. */
  emAberto: boolean;
}

/** Chave de data local, sem a armadilha de `toISOString()` em horário negativo. */
export function chaveData(d: Date): DataISO {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/** Hoje no fuso do navegador. `new Date().toISOString()` pode cair no dia anterior. */
export function hojeLocal(): DataISO {
  return chaveData(new Date());
}

/**
 * Converte string para `Date` no meio-dia local.
 *
 * Meio-dia é o horário neutro: `new Date('2026-01-01')` é UTC e em horário
 * negativo vira 31/12 no fuso local, o que deslocaria a contagem em um dia.
 */
export function dataParaDate(iso: DataISO): Date {
  const [ano, mes, dia] = iso.split('-').map(Number);
  return new Date(ano, mes - 1, dia, 12, 0, 0, 0);
}

/**
 * Aceita o que o usuário digita: "150", "1.234,56", "1234.56", "R$ 80".
 * `parseFloat` sozinho trava em "1.234,56" e devolve 1 — silenciosamente errado.
 *
 * Separador único é ambíguo e a decisão é do idioma da tela, que é pt-BR:
 *   - "1.234"      → 1234     (ponto de milhar)
 *   - "1.234,56"   → 1234.56  (milhar + decimal)
 *   - "1,234"      → 1.234    (vírgula decimal, como em pt-BR)
 * Com os dois separadores, o último é o decimal.
 */
export function parseValor(entrada: string | number | null | undefined): number {
  if (typeof entrada === 'number') return Number.isFinite(entrada) ? entrada : 0;
  if (!entrada) return 0;

  const limpo = String(entrada).replace(/[^\d,.-]/g, '').trim();
  if (!limpo) return 0;

  const temVirgula = limpo.includes(',');
  const temPonto = limpo.includes('.');
  const depoisDoPonto = limpo.split('.').pop() ?? '';

  let normalizado: string;
  if (temVirgula && temPonto) {
    normalizado = limpo.lastIndexOf(',') > limpo.lastIndexOf('.')
      ? limpo.replace(/\./g, '').replace(',', '.')
      : limpo.replace(/,/g, '');
  } else if (temPonto) {
    // Ponto sozinho com exatamente 3 dígitos é milhar em pt-BR ("1.234"),
    // não decimal. Sem essa regra o total sai 1000x menor que o esperado.
    normalizado = depoisDoPonto.length === 3 ? limpo.replace(/\./g, '') : limpo;
  } else if (temVirgula) {
    normalizado = limpo.replace(',', '.');
  } else {
    normalizado = limpo;
  }

  const n = Number.parseFloat(normalizado);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Dias entre as datas, **inclusivo nas duas pontas**.
 *
 * Inclusivo porque 01/01 a 01/01 é um dia trabalhado, não zero. A diferença
 * simples daria 0 e o período seria rejeitado pelo check `dias > 0`.
 *
 * Usa `setDate` em vez de dividir por 86400000: em horário de verão brasileiro
 * o dia tem 23 horas e a divisão por milissegundos arredonda errado.
 */
export function contarDias(inicio: DataISO, fim: DataISO): number {
  const inicioLocal = dataParaDate(inicio);
  const fimLocal = dataParaDate(fim);

  if (Number.isNaN(inicioLocal.getTime()) || Number.isNaN(fimLocal.getTime())) return 0;
  if (fimLocal < inicioLocal) return 0;

  const cursor = new Date(inicioLocal);
  let dias = 0;
  while (cursor <= fimLocal) {
    dias++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

/** Normaliza a lista de descartados: sem repetição e só datas válidas. */
export function normalizarDescartados(descartados: DataISO[] | null | undefined): DataISO[] {
  if (!Array.isArray(descartados)) return [];
  const validos = descartados.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
  return [...new Set(validos)].sort();
}

export interface CalcularPeriodoParams {
  dataInicio: DataISO;
  /** Nulo ou vazio = período em aberto, conta até hoje. */
  dataTermino?: DataISO | null;
  valorDia: string | number | null | undefined;
  diasDescartados?: DataISO[] | null;
  /**
   * Dias digitados direto pelo usuário, ignorando o cálculo por datas. Vem
   * quando ele sabe o número exato e não quer mexer em calendário.
   */
  diasManuais?: number | null;
  /** Injetável para os testes. */
  hoje?: DataISO;
}

/**
 * Calcula dias e total. É a mesma função usada no formulário (prévia) e no
 * save, então o que aparece antes de confirmar é exatamente o que é gravado.
 */
export function calcularPeriodo(params: CalcularPeriodoParams): PeriodoCalculo {
  const {
    dataInicio,
    dataTermino,
    valorDia,
    diasDescartados,
    diasManuais,
    hoje = hojeLocal(),
  } = params;

  const emAberto = !dataTermino;
  const dataFim = emAberto ? hoje : (dataTermino as DataISO);

  const diasBrutos = contarDias(dataInicio, dataFim);

  // Só conta como descartado o dia que está dentro do período. Uma data fora
  // das datas não pode reduzir a conta — um descarte antigo deixado no formulário
  // derrubaria o total sem motivo nenhum.
  const dentroDoPeriodo = normalizarDescartados(diasDescartados).filter(
    (d) => contarDias(dataInicio, d) > 0 && contarDias(d, dataFim) > 0,
  );
  const diasDescartadosNoPeriodo = dentroDoPeriodo.length;

  const diasEfetivos = diasManuais && diasManuais > 0 ? Math.floor(diasManuais) : diasBrutos - diasDescartadosNoPeriodo;

  const valorDiaNum = parseValor(valorDia);
  const valorTotal = Math.round(diasEfetivos * valorDiaNum * 100) / 100;

  return {
    diasBrutos,
    diasDescartados: diasDescartadosNoPeriodo,
    diasEfetivos: Math.max(0, diasEfetivos),
    valorDia: valorDiaNum,
    valorTotal,
    dataFim,
    emAberto,
  };
}