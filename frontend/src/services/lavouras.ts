import { supabase } from '../lib/supabase';

/**
 * Espelha o formato que o backend Flask devolvia, para as telas não mudarem de
 * forma ao migrar. As diferenças em relação ao Postgres ficam presas aqui.
 *
 * `ultima_atividade_date` não é coluna: vem da view
 * `lavoura_com_ultima_atividade`, que faz o max() no banco. Sem ela, cada
 * listagem baixaria todas as atividades só para somar datas no navegador.
 */
export interface Lavoura {
  id: number;
  nome: string;
  cultura: string;
  foto_perfil: string | null;
  area_hectares: number | null;
  localizacao: string | null;
  data_inicio: string | null;
  is_pinned: boolean;
  ultima_atividade_date: string | null;
}

export interface LavouraInput {
  nome: string;
  cultura: string;
  foto_perfil?: string | null;
  area_hectares?: number | null;
  localizacao?: string | null;
  data_inicio?: string | null;
  is_pinned?: boolean;
}

// numeric(12,2) volta do PostgREST como string em alguns caminhos e como número
// em outros. Normalizar aqui evita "5.00 hectares" virar NaN na tela.
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// date (sem hora) precisa ir como 'YYYY-MM-DD'. Aceitar 'YYYY-MM-DDTHH:mm' faria
// o Postgres recusar com "invalid input syntax for type date".
const soData = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return match ? match[1] : null;
};

function paraLavoura(row: Record<string, unknown>): Lavoura {
  return {
    id: Number(row.id),
    nome: String(row.nome),
    cultura: String(row.cultura),
    foto_perfil: (row.foto_perfil as string | null) ?? null,
    area_hectares: num(row.area_hectares),
    localizacao: (row.localizacao as string | null) ?? null,
    data_inicio: (row.data_inicio as string | null) ?? null,
    is_pinned: Boolean(row.is_pinned),
    ultima_atividade_date: (row.ultima_atividade_date as string | null) ?? null,
  };
}

const COLUNAS = 'id, nome, cultura, foto_perfil, area_hectares, localizacao, data_inicio, is_pinned';

export async function listarLavouras(): Promise<Lavoura[]> {
  const { data, error } = await supabase
    .from('lavoura_com_ultima_atividade')
    .select(`${COLUNAS}, ultima_atividade_date`);

  if (error) throw new Error(error.message);
  return (data ?? []).map(paraLavoura);
}

export async function buscarLavoura(id: number): Promise<Lavoura | null> {
  const { data, error } = await supabase
    .from('lavoura_com_ultima_atividade')
    .select(`${COLUNAS}, ultima_atividade_date`)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? paraLavoura(data) : null;
}

export async function criarLavoura(input: LavouraInput): Promise<Lavoura> {
  if (!input.nome.trim()) throw new Error('O nome da lavoura é obrigatório.');
  if (!input.cultura.trim()) throw new Error('A cultura é obrigatória.');

  // id_usuario vai por default auth.uid() (migration 05): o navegador não
  // informa de quem é a lavoura, e a RLS ainda exige que seja o dono da sessão.
  const { data, error } = await supabase
    .from('lavoura')
    .insert({
      nome: input.nome.trim(),
      cultura: input.cultura.trim(),
      foto_perfil: input.foto_perfil ?? null,
      area_hectares: input.area_hectares ?? null,
      localizacao: input.localizacao?.trim() || null,
      data_inicio: soData(input.data_inicio),
      is_pinned: input.is_pinned ?? false,
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  // A view não é retornável no INSERT (PostgREST só retorna a tabela base), então
  // relê para devolver o mesmo formato de listarLavouras().
  const criada = await buscarLavoura(Number(data.id));
  if (!criada) throw new Error('Lavoura criada, mas não foi possível relê-la.');
  return criada;
}

export async function atualizarLavoura(id: number, patch: Partial<LavouraInput>): Promise<Lavoura> {
  const update: Record<string, unknown> = {};

  if (patch.nome !== undefined) update.nome = patch.nome.trim();
  if (patch.cultura !== undefined) update.cultura = patch.cultura.trim();
  if (patch.foto_perfil !== undefined) update.foto_perfil = patch.foto_perfil;
  if (patch.area_hectares !== undefined) update.area_hectares = patch.area_hectares;
  if (patch.localizacao !== undefined) update.localizacao = patch.localizacao?.trim() || null;
  if (patch.data_inicio !== undefined) update.data_inicio = soData(patch.data_inicio);
  if (patch.is_pinned !== undefined) update.is_pinned = patch.is_pinned;

  if (Object.keys(update).length === 0) return buscarLavoura(id).then((l) => {
    if (!l) throw new Error('Lavoura não encontrada.');
    return l;
  });

  const { error } = await supabase.from('lavoura').update(update).eq('id', id);
  if (error) throw new Error(error.message);

  const atualizada = await buscarLavoura(id);
  if (!atualizada) throw new Error('Lavoura não encontrada.');
  return atualizada;
}

/**
 * Deleta a lavoura. As atividades e imagens vão por cascade (o mesmo que o
 * Flask fazia com `delete-orphan`).
 */
export async function deletarLavoura(id: number): Promise<void> {
  const { error } = await supabase.from('lavoura').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Alterna o pin. Separado do atualizarLavoura porque a tela de listagem usa
 * para reordenar e não quer mandar o objeto inteiro.
 */
export async function alternarPin(id: number, isPinned: boolean): Promise<void> {
  const { error } = await supabase.from('lavoura').update({ is_pinned: isPinned }).eq('id', id);
  if (error) throw new Error(error.message);
}