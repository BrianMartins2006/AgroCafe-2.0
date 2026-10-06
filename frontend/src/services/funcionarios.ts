import { supabase } from '../lib/supabase';

/**
 * Espelha `Funcionario.to_dict()` do Flask. Os nomes `id_funcionario` e
 * `id_usuario_fk` são preservados porque as telas já os usam em JSX e nos
 * handlers de edição/exclusão.
 *
 * `salario_hora` volta como 0 quando é null (e não null), porque
 * MaquinariosPage/FuncionariosPage chamam `.toString()` no valor.
 */
export interface Funcionario {
  id_funcionario: number;
  nome: string;
  cargo: string | null;
  salario_hora: number;
  contato: string | null;
}

export interface FuncionarioInput {
  nome: string;
  cargo?: string | null;
  salario_hora?: number | null;
  contato?: string | null;
}

const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));

function paraFuncionario(row: Record<string, unknown>): Funcionario {
  return {
    id_funcionario: Number(row.id),
    nome: String(row.nome),
    cargo: (row.cargo as string | null) ?? null,
    salario_hora: num(row.salario_hora),
    contato: (row.contato as string | null) ?? null,
  };
}

export async function listarFuncionarios(): Promise<Funcionario[]> {
  const { data, error } = await supabase
    .from('funcionario')
    .select('id, nome, cargo, salario_hora, contato')
    .order('nome', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(paraFuncionario);
}

export async function criarFuncionario(input: FuncionarioInput): Promise<Funcionario> {
  if (!input.nome.trim()) throw new Error('O nome do funcionário é obrigatório.');

  const { data, error } = await supabase
    .from('funcionario')
    .insert({
      nome: input.nome.trim(),
      cargo: input.cargo?.trim() || null,
      salario_hora: input.salario_hora ?? null,
      contato: input.contato?.trim() || null,
    })
    .select('id, nome, cargo, salario_hora, contato')
    .single();

  if (error) throw new Error(error.message);
  return paraFuncionario(data);
}

export async function atualizarFuncionario(id: number, patch: Partial<FuncionarioInput>): Promise<Funcionario> {
  const update: Record<string, unknown> = {};

  if (patch.nome !== undefined) {
    if (!patch.nome.trim()) throw new Error('O nome do funcionário é obrigatório.');
    update.nome = patch.nome.trim();
  }
  if (patch.cargo !== undefined) update.cargo = patch.cargo?.trim() || null;
  if (patch.salario_hora !== undefined) update.salario_hora = patch.salario_hora;
  if (patch.contato !== undefined) update.contato = patch.contato?.trim() || null;

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from('funcionario').update(update).eq('id', id);
    if (error) throw new Error(error.message);
  }

  const { data, error } = await supabase
    .from('funcionario')
    .select('id, nome, cargo, salario_hora, contato')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('Funcionário não encontrado.');
  return paraFuncionario(data);
}

export async function deletarFuncionario(id: number): Promise<void> {
  const { error } = await supabase.from('funcionario').delete().eq('id', id);
  if (error) throw new Error(error.message);
}