import { supabase } from '../lib/supabase';

/**
 * Perfil do produtor.
 *
 * `id_usuario` continua exposto com esse nome porque é o que as telas já
 * esperam, mas o valor é o UUID do auth.users (no MySQL era um inteiro
 * autoincremental) — o tipo mudou e as telas precisam acompanhar.
 *
 * `email` não vem de public.usuario: o e-mail é gerenciado pelo GoTrue e não
 * deve ser duplicado em tabela de perfil, senão os dois desviam. Por isso vem
 * da sessão.
 */
export interface UserProfile {
  id_usuario: string;
  nome: string;
  email: string;
  foto_url?: string | null;
  ativo?: boolean;
}

/**
 * Identidade da sessão, pelo servidor.
 *
 * Não usar o user do onAuthStateChange para decidir dono de nada: aquele objeto
 * vem do cache local e pode estar desatualizado. getUser() vai no GoTrue.
 */
async function idDaSessao(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Sessão expirada. Faça login novamente.');
  return data.user.id;
}

export async function buscarPerfil(): Promise<UserProfile> {
  const idUsuario = await idDaSessao();

  const { data, error } = await supabase
    .from('usuario')
    .select('id, nome, foto_url, ativo')
    .eq('id', idUsuario)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('Perfil não encontrado para esta sessão.');

  const { data: sessao } = await supabase.auth.getUser();

  return {
    id_usuario: data.id,
    nome: data.nome,
    email: sessao.user?.email ?? '',
    foto_url: data.foto_url,
    ativo: data.ativo,
  };
}

/**
 * Atualiza o próprio perfil.
 *
 * Sem `ativo` e sem `id`: um usuário desativado no banco precisa continuar
 * desativado, e não deve poder reatribuir a própria linha para outra conta. A
 * RLS recusa os dois, mas nem chega a enviar.
 */
export async function atualizarPerfil(patch: { nome?: string; foto_url?: string | null }): Promise<UserProfile> {
  const idUsuario = await idDaSessao();

  if (patch.nome !== undefined && !patch.nome.trim()) {
    throw new Error('O nome não pode ficar em branco.');
  }

  const { error } = await supabase
    .from('usuario')
    .update({
      ...(patch.nome !== undefined ? { nome: patch.nome.trim() } : {}),
      ...(patch.foto_url !== undefined ? { foto_url: patch.foto_url } : {}),
    })
    .eq('id', idUsuario);

  if (error) throw new Error(error.message);

  return buscarPerfil();
}