import { supabase } from '../lib/supabase';

/**
 * Anotações livres do produtor — sem vínculo com lavoura/atividade.
 *
 * O formato espelha o das atividades: a lista sai do PostgREST com embed de
 * imagens (`anotacao_imagem`) e as telas consomem `anotacao.imagens[]`. O
 * upload da foto acontece antes (Cloudinary, `services/cloudinary.ts`); aqui só
 * se grava a URL, como em atividade.
 */
export interface AnotacaoImagem {
  id: number;
  foto_url: string;
}

export interface Anotacao {
  id: number;
  titulo: string;
  conteudo: string | null;
  created_at: string;
  updated_at: string;
  imagens: AnotacaoImagem[];
}

export interface AnotacaoInput {
  titulo: string;
  conteudo?: string | null;
  /** URLs que o frontend já subiu no Cloudinary antes de chamar aqui. */
  imagens?: string[];
}

/**
 * Mesma transformação do feed de atividades: o painel do Cloudinary guarda o
 * original e a tela espera a versão já otimizada, senão o card baixaria
 * megabytes para renderizar uma miniatura.
 */
function otimizarUrl(url: string): string {
  if (url.includes('res.cloudinary.com') && url.includes('/upload/') && !url.includes('q_auto')) {
    return url.replace('/upload/', '/upload/f_auto,q_auto,w_1200,c_limit/');
  }
  return url;
}

// O supabase-js só infere tipos com select literal; com a constante SELECT
// (e o embed) ele cai no fallback não indexável. O cast fica confinado aqui.
const comoLinhas = (data: unknown): Record<string, unknown>[] =>
  Array.isArray(data) ? (data as unknown as Record<string, unknown>[]) : [];

const SELECT = 'id, titulo, conteudo, created_at, updated_at, imagens:anotacao_imagem(id, foto_url)';

function paraAnotacao(row: Record<string, unknown>): Anotacao {
  const imagensBrutas = Array.isArray(row.imagens) ? row.imagens : [];
  return {
    id: Number(row.id),
    titulo: String(row.titulo ?? ''),
    conteudo: (row.conteudo as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    imagens: imagensBrutas.map((img) => {
      const i = img as Record<string, unknown>;
      return {
        id: Number(i.id),
        foto_url: otimizarUrl(String(i.foto_url ?? '')),
      };
    }),
  };
}

export async function listarAnotacoes(): Promise<Anotacao[]> {
  const { data, error } = await supabase
    .from('anotacao')
    .select(SELECT)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (error) throw new Error(error.message);
  return comoLinhas(data).map(paraAnotacao);
}

export async function criarAnotacao(input: AnotacaoInput): Promise<Anotacao> {
  const titulo = input.titulo.trim();
  if (!titulo) throw new Error('O título da anotação é obrigatório.');
  if (titulo.length > 150) throw new Error('O título pode ter no máximo 150 caracteres.');

  const { data, error } = await supabase
    .from('anotacao')
    .insert({
      titulo,
      conteudo: input.conteudo?.trim() || null,
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  const id = Number(data.id);

  // Mesmo cuidado de criarAtividade: se o insert das imagens falhar, a
  // anotação não fica registrada sem foto — apaga e devolve o erro à tela.
  const urls = (input.imagens ?? []).filter(Boolean);
  if (urls.length > 0) {
    const { error: erroImg } = await supabase
      .from('anotacao_imagem')
      .insert(urls.map((foto_url) => ({ id_anotacao: id, foto_url })));

    if (erroImg) {
      await supabase.from('anotacao').delete().eq('id', id);
      throw new Error('Não foi possível salvar as imagens da anotação.');
    }
  }

  const criada = await buscarAnotacao(id);
  if (!criada) throw new Error('Anotação criada, mas não foi possível relê-la.');
  return criada;
}

export async function buscarAnotacao(id: number): Promise<Anotacao | null> {
  const { data, error } = await supabase
    .from('anotacao')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || Array.isArray(data)) return null;
  return paraAnotacao(data as unknown as Record<string, unknown>);
}

/**
 * Atualiza a anotação e sincroniza as imagens. O conjunto de fotos é pequeno
 * e sempre reescrito pela tela de edição, então delete + insert é mais barato
 * que um diff por URL — mesmo raciocínio de atualizarAtividade.
 */
export async function atualizarAnotacao(id: number, patch: Partial<AnotacaoInput>): Promise<Anotacao> {
  const update: Record<string, unknown> = {};

  if (patch.titulo !== undefined) {
    const titulo = patch.titulo.trim();
    if (!titulo) throw new Error('O título da anotação é obrigatório.');
    if (titulo.length > 150) throw new Error('O título pode ter no máximo 150 caracteres.');
    update.titulo = titulo;
  }
  if (patch.conteudo !== undefined) {
    const conteudo = patch.conteudo?.trim() || null;
    if (conteudo && conteudo.length > 5000) {
      throw new Error('O texto pode ter no máximo 5000 caracteres.');
    }
    update.conteudo = conteudo;
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from('anotacao').update(update).eq('id', id);
    if (error) throw new Error(error.message);
  }

  if (patch.imagens !== undefined) {
    const urls = patch.imagens.filter(Boolean);

    const { error: erroDelete } = await supabase
      .from('anotacao_imagem')
      .delete()
      .eq('id_anotacao', id);
    if (erroDelete) throw new Error(erroDelete.message);

    if (urls.length > 0) {
      const { error: erroInsert } = await supabase
        .from('anotacao_imagem')
        .insert(urls.map((foto_url) => ({ id_anotacao: id, foto_url })));
      if (erroInsert) throw new Error(erroInsert.message);
    }
  }

  const atualizada = await buscarAnotacao(id);
  if (!atualizada) throw new Error('Anotação não encontrada.');
  return atualizada;
}

export async function deletarAnotacao(id: number): Promise<void> {
  const { error } = await supabase.from('anotacao').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
