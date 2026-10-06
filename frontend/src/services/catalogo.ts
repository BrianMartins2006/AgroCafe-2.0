import { supabase } from '../lib/supabase';

/**
 * Catálogo de tipos de atividade.
 *
 * O nome `TipoAtividade` e os campos batem com o que as telas já esperam, então
 * este módulo é um adaptador quase transparente.
 */
export interface TipoAtividade {
  id: number;
  nome: string;
  icone: string;
  cor: string;
}

export async function listarTiposAtividade(): Promise<TipoAtividade[]> {
  const { data, error } = await supabase
    .from('tipo_atividade')
    .select('id, nome, icone, cor')
    .order('nome', { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function buscarTipoAtividade(id: number): Promise<TipoAtividade | null> {
  const { data, error } = await supabase
    .from('tipo_atividade')
    .select('id, nome, icone, cor')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export interface TipoAtividadeInput {
  nome: string;
  icone?: string | null;
  cor?: string | null;
}

// O check do banco exige 1..100 caracteres em `nome`, mas a mensagem do
// Postgres ("violates check constraint") não diz nada útil na tela. Validar
// aqui dá um erro em português antes da request.
const validarNome = (nome: string): string => {
  const limpo = nome.trim();
  if (!limpo) throw new Error('O nome da categoria é obrigatório.');
  if (limpo.length > 100) throw new Error('O nome da categoria deve ter no máximo 100 caracteres.');
  return limpo;
};

export async function criarTipoAtividade(input: TipoAtividadeInput): Promise<TipoAtividade> {
  const { data, error } = await supabase
    .from('tipo_atividade')
    .insert({
      nome: validarNome(input.nome),
      icone: input.icone?.trim() || 'Sprout',
      cor: input.cor?.trim() || 'bg-whatsapp-green',
    })
    .select('id, nome, icone, cor')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function atualizarTipoAtividade(id: number, patch: Partial<TipoAtividadeInput>): Promise<TipoAtividade> {
  const update: Record<string, unknown> = {};

  if (patch.nome !== undefined) update.nome = validarNome(patch.nome);
  if (patch.icone !== undefined) update.icone = patch.icone?.trim() || 'Sprout';
  if (patch.cor !== undefined) update.cor = patch.cor?.trim() || 'bg-whatsapp-green';

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from('tipo_atividade').update(update).eq('id', id);
    if (error) throw new Error(error.message);
  }

  const { data, error } = await supabase
    .from('tipo_atividade')
    .select('id, nome, icone, cor')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('Categoria não encontrada.');
  return data;
}

/**
 * Apaga a categoria. O FK `atividade_id_tipo_atividade_fkey` é `on delete
 * restrict`, então o banco recusa (23503) quando a categoria está em uso — que é
 * exatamente a garantia que o MySQL não dava. Traduzir o erro aqui evita um
 * "violates foreign key constraint" cru na tela.
 */
export async function deletarTipoAtividade(id: number): Promise<void> {
  const { error } = await supabase.from('tipo_atividade').delete().eq('id', id);

  if (error) {
    if (error.code === '23503') {
      throw new Error('Esta categoria tem atividade registrada e não pode ser excluída.');
    }
    throw new Error(error.message);
  }
}