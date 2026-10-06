import { supabase } from '../lib/supabase';

/**
 * Espelha `Maquinario.to_dict()` do Flask.
 *
 * O MySQL tinha `data_aquisicao` e a tabela do Postgres não tem a coluna. Omiti
 * de propósito: nenhuma tela do frontend referencia esse campo, então inventar um
 * equivalente seria contrato morto. Se a data de aquisição virar requisito de
 * tela, aí sim a coluna precisa entrar via migration.
 *
 * `valor_hora` e `consumo_medio` voltam como 0 quando são null (e não null),
 * porque MaquinariosPage chama `.toString()` nos dois.
 */
export interface Maquinario {
  id_maquina: number;
  tipo: string | null;
  modelo: string | null;
  valor_hora: number;
  consumo_medio: number;
}

export interface MaquinarioInput {
  tipo?: string | null;
  modelo?: string | null;
  valor_hora?: number | null;
  consumo_medio?: number | null;
}

const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));

function paraMaquinario(row: Record<string, unknown>): Maquinario {
  return {
    id_maquina: Number(row.id),
    tipo: (row.tipo as string | null) ?? null,
    modelo: (row.modelo as string | null) ?? null,
    valor_hora: num(row.valor_hora),
    consumo_medio: num(row.consumo_medio),
  };
}

const COLUNAS = 'id, tipo, modelo, valor_hora, consumo_medio';

export async function listarMaquinarios(): Promise<Maquinario[]> {
  const { data, error } = await supabase.from('maquinario').select(COLUNAS).order('id', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(paraMaquinario);
}

export async function criarMaquinario(input: MaquinarioInput): Promise<Maquinario> {
  if (!input.tipo?.trim()) throw new Error('O tipo de equipamento é obrigatório.');

  const { data, error } = await supabase
    .from('maquinario')
    .insert({
      tipo: input.tipo.trim(),
      modelo: input.modelo?.trim() || null,
      valor_hora: input.valor_hora ?? null,
      consumo_medio: input.consumo_medio ?? null,
    })
    .select(COLUNAS)
    .single();

  if (error) throw new Error(error.message);
  return paraMaquinario(data);
}

export async function atualizarMaquinario(id: number, patch: Partial<MaquinarioInput>): Promise<Maquinario> {
  const update: Record<string, unknown> = {};

  if (patch.tipo !== undefined) {
    if (!patch.tipo?.trim()) throw new Error('O tipo de equipamento é obrigatório.');
    update.tipo = patch.tipo.trim();
  }
  if (patch.modelo !== undefined) update.modelo = patch.modelo?.trim() || null;
  if (patch.valor_hora !== undefined) update.valor_hora = patch.valor_hora;
  if (patch.consumo_medio !== undefined) update.consumo_medio = patch.consumo_medio;

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from('maquinario').update(update).eq('id', id);
    if (error) throw new Error(error.message);
  }

  const { data, error } = await supabase.from('maquinario').select(COLUNAS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Equipamento não encontrado.');
  return paraMaquinario(data);
}

export async function deletarMaquinario(id: number): Promise<void> {
  const { error } = await supabase.from('maquinario').delete().eq('id', id);
  if (error) throw new Error(error.message);
}