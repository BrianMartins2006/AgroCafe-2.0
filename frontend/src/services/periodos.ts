import { supabase } from '../lib/supabase';
import type { Funcionario } from './funcionarios';
import {
  calcularPeriodo,
  normalizarDescartados,
  type CalcularPeriodoParams,
  type DataISO,
  type PeriodoCalculo,
} from './calculoPeriodo';

/**
 * Períodos de trabalho: valor por dia, datas e total.
 *
 * `valor_total` é coluna gerada no Postgres (`dias * valor_dia`), então nunca
 * entra no insert nem no update — mandar o campo num write dá erro. É o que
 * garante que o valor gravado e o valor exibido sejam o mesmo número.
 */

export interface Periodo {
  id: number;
  id_funcionario: number;
  data_inicio: DataISO;
  /** Nulo = período em aberto, contando até hoje. */
  data_termino: DataISO | null;
  valor_dia: number;
  dias: number;
  /**
   * `dias` foi digitado pelo usuário em vez de derivado das datas.
   *
   * O banco precisa guardar isso: os dois caminhos gravam um inteiro em `dias`,
   * e só com o inteiro não dá para saber se um período aberto deve continuar
   * contando sozinho ou respeitar o número que o usuário digitou.
   */
  calculo_manual: boolean;
  valor_total: number;
  dias_descartados: DataISO[];
  observacao: string | null;
  updated_at: string;
}

export interface PeriodoComFuncionario extends Periodo {
  funcionario_nome: string;
  funcionario_cargo: string | null;
  /**
   * Recalculo feito no cliente a partir das datas, Needed para período em
   * aberto: a linha guarda o total do momento em que foi salva, e um período
   * que não termina precisa continuar contando sozinho.
   */
  aoVivo: PeriodoCalculo;
}

export interface PeriodoInput {
  id_funcionario: number;
  dataInicio: DataISO;
  /** Nulo ou vazio = em aberto. */
  dataTermino?: DataISO | null;
  valorDia: string | number;
  diasDescartados?: DataISO[] | null;
  diasManuais?: number | null;
  observacao?: string | null;
}

const COLUNAS =
  'id, id_funcionario, data_inicio, data_termino, valor_dia, dias, calculo_manual, valor_total, dias_descartados, observacao, updated_at';

function linhaParaPeriodo(linha: Record<string, unknown>): Periodo {
  return {
    id: linha.id as number,
    id_funcionario: linha.id_funcionario as number,
    data_inicio: linha.data_inicio as DataISO,
    data_termino: (linha.data_termino as DataISO | null) ?? null,
    valor_dia: Number(linha.valor_dia),
    dias: Number(linha.dias),
    calculo_manual: Boolean(linha.calculo_manual),
    valor_total: Number(linha.valor_total),
    dias_descartados: Array.isArray(linha.dias_descartados) ? (linha.dias_descartados as DataISO[]) : [],
    observacao: (linha.observacao as string | null) ?? null,
    updated_at: linha.updated_at as string,
  };
}

/**
 * Recalcula o total no cliente.
 *
 * Só é obrigatório para período em aberto, onde o valor cresce com o tempo: a
 * linha guarda o total do momento em que foi salva, e um período que não
 * termina precisa continuar contando sozinho. Em período fechado o número
 * gravado é o definitivo — recalcular também não machuca e protege a tabela
 * caso alguém corrija `dias` direto no banco.
 *
 * Exceção: quando o usuário digitou os dias, `dias` é respeitado como
 * digitado, mesmo com o período aberto. Contar o calendário de novo ali
 * sobrescreveria a informação que ele registrou à mão.
 */
function aoVivo(periodo: Periodo): PeriodoCalculo {
  return calcularPeriodo({
    dataInicio: periodo.data_inicio,
    dataTermino: periodo.data_termino,
    valorDia: periodo.valor_dia,
    diasDescartados: periodo.dias_descartados,
    // Repassar `dias` só quando o usuário ditou. Sem esta linha o cálculo
    // automático sobrescreveria na tela o lançamento manual de um período
    // em aberto, e o total da tabela passaria a divergir do valor salvo.
    diasManuais: periodo.calculo_manual ? periodo.dias : null,
  });
}

export async function listarPeriodos(): Promise<PeriodoComFuncionario[]> {
  const { data, error } = await supabase
    .from('periodo_trabalho')
    .select(`${COLUNAS}, funcionario:funcionario(nome, cargo)`)
    .order('data_inicio', { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((linha) => {
    const base = linhaParaPeriodo(linha);
    const func = linha.funcionario as { nome?: string; cargo?: string | null } | null;

    return {
      ...base,
      funcionario_nome: func?.nome ?? 'Funcionário removido',
      funcionario_cargo: func?.cargo ?? null,
      aoVivo: aoVivo(base),
    };
  });
}

export async function buscarPeriodo(id: number): Promise<Periodo | null> {
  const { data, error } = await supabase
    .from('periodo_trabalho')
    .select(COLUNAS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? linhaParaPeriodo(data) : null;
}

/** Valida no cliente o que o banco recusaria, para o erro chegar em português. */
function preparar(input: PeriodoInput) {
  if (!input.dataInicio) throw new Error('A data de início é obrigatória.');
  if (input.dataTermino && input.dataTermino < input.dataInicio) {
    throw new Error('A data de término não pode ser antes da data de início.');
  }
  if (input.valorDia === '' || input.valorDia === null || input.valorDia === undefined) {
    throw new Error('Informe o valor do dia.');
  }

  const calculo = calcularPeriodo({
    dataInicio: input.dataInicio,
    dataTermino: input.dataTermino,
    valorDia: input.valorDia,
    diasDescartados: input.diasDescartados,
    diasManuais: input.diasManuais,
  });

  if (calculo.diasEfetivos <= 0) {
    throw new Error('O período precisa ter ao menos 1 dia trabalhado.');
  }
  if (calculo.valorDia < 0) {
    throw new Error('O valor do dia não pode ser negativo.');
  }

  return { calculo, payload: montarPayload(input, calculo) };
}

function montarPayload(input: PeriodoInput, calculo: PeriodoCalculo) {
  return {
    id_funcionario: input.id_funcionario,
    data_inicio: input.dataInicio,
    // Normalizado para null: a string vazia que o formulário devolve ao
    // deixar o campo em branco não é a mesma coisa que "sem término", e o
    // índice de período aberto único só enxerga o null.
    data_termino: calculo.emAberto ? null : input.dataTermino,
    valor_dia: calculo.valorDia,
    dias: calculo.diasEfetivos,
    // Sem isto a linha não carrega a distinção entre contagem e digitação.
    calculo_manual: input.diasManuais != null && input.diasManuais > 0,
    // Normalizado: sem repetição, ordenado e só com datas válidas. Gravar a
    // lista crua repetiria o mesmo dia N vezes, inflando `diasDescartados`.
    dias_descartados: normalizarDescartados(input.diasDescartados),
    observacao: input.observacao?.trim() || null,
    // valor_total é gerado no banco: não entra aqui de propósito.
  };
}

export async function criarPeriodo(input: PeriodoInput): Promise<Periodo> {
  const { payload } = preparar(input);

  const { data, error } = await supabase
    .from('periodo_trabalho')
    .insert(payload)
    .select(COLUNAS)
    .single();

  if (error) throw new Error(traduzirErro(error));
  return linhaParaPeriodo(data);
}

export async function atualizarPeriodo(id: number, input: PeriodoInput): Promise<Periodo> {
  const { payload } = preparar(input);

  const { data, error } = await supabase
    .from('periodo_trabalho')
    .update(payload)
    .eq('id', id)
    .select(COLUNAS)
    .single();

  if (error) throw new Error(traduzirErro(error));
  return linhaParaPeriodo(data);
}

/**
 * Apaga o período. Não mexe no funcionário: quem sai de um período continua
 * cadastrado na tela de equipe.
 */
export async function deletarPeriodo(id: number): Promise<void> {
  const { error } = await supabase.from('periodo_trabalho').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Traduz os erros do banco que a tela pode encontrar.
 *
 * 23505 no índice `periodo_trabalho_aberto_unico`: o funcionário já tem um
 * período em aberto. Registrar outro faria o mesmo dia ser contado duas vezes,
 * e o usuário não tem como perceber isso olhando a tabela.
 */
function traduzirErro(error: { code?: string; message: string }): string {
  if (error.code === '23505' && error.message.includes('periodo_trabalho_aberto_unico')) {
    return 'Este funcionário já tem um período em aberto. Termine o período atual antes de iniciar outro.';
  }
  if (error.code === '23503') {
    return 'Funcionário não encontrado.';
  }
  if (error.code === '23514') {
    if (error.message.includes('data_termino')) {
      return 'A data de término não pode ser antes da data de início.';
    }
    if (error.message.includes('dias')) {
      return 'O período precisa ter ao menos 1 dia trabalhado.';
    }
    if (error.message.includes('valor_dia')) {
      return 'O valor do dia não pode ser negativo.';
    }
  }
  return error.message;
}

/** Reexporta o cálculo para a tela importar de um lugar só. */
export { calcularPeriodo };
export type { CalcularPeriodoParams, PeriodoCalculo, DataISO };
export type { Funcionario };