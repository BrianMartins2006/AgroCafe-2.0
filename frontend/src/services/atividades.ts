import { supabase } from '../lib/supabase';
import type { TipoAtividade } from './catalogo';

/**
 * Espelha o `Atividade.to_dict()` do Flask. O ponto que não pode mudar é o
 * `tipo`: no MySQL vinha como objeto aninhado (via relationship), então as telas
 * acessam `atividade.tipo.nome`. No Postgres o mesmo formato sai de um embed do
 * PostgREST, mas o alias tem que se chamar `tipo` para o código das telas não
 * precisar ser tocado.
 */
export interface AtividadeImagem {
  id: number;
  foto_url: string;
}

export interface Atividade {
  id: number;
  id_lavoura: number;
  tipo: TipoAtividade | null;
  data: string;
  descricao: string | null;
  responsavel: string | null;
  imagens: AtividadeImagem[];
}

export interface AtividadeInput {
  id_lavoura: number;
  id_tipo_atividade: number;
  descricao?: string | null;
  responsavel?: string | null;
  /** URLs que o frontend já subiu no Cloudinary antes de chamar aqui. */
  imagens?: string[];
  /** 'YYYY-MM-DD' ou ISO completo. Vazio usa now() no banco. */
  data?: string | null;
}

/**
 * Reproduz a "data inteligente" do Flask, que não pode ser perdida sem mudar o
 * comportamento visível do feed:
 *
 * - data só com dia (`2026-10-05`) e diferente de hoje → meio-dia UTC naquele dia.
 *   Meio-dia em vez de 00:00 porque o MySQL gravava datetime sem fuso e o
 *   navegador interpretava como local; 00:00 UTC viraria dia anterior em
 *   horário negativo.
 * - data só com dia e igual a hoje → agora(), preservando o "criado agora".
 * - ISO completo → respeita o horário enviado.
 *
 * Sem isso, toda atividade nasceria trancada no instante da criação e o usuário
 * não consegueria registrar aplicação de produto em dia anterior.
 */
function paraData(valor: string | null | undefined): string | null {
  if (!valor) return null;

  // O `d` de dia é literal de propósito: existem 3 grupos de captura
  // (ano, mês, dia). Destruir com [, ano, mes] deixaria `dia` undefined e a
  // string viraria "2026-10-05-undefinedT12:00:00Z" → 22023 no Postgres.
  const soDia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
  if (soDia) {
    const [, ano, mes, dia] = soDia;
    const hoje = new Date();
    const dataDeHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    if (`${ano}-${mes}-${dia}` === dataDeHoje) return null; // deixa o default now()
    return `${ano}-${mes}-${dia}T12:00:00Z`;
  }

  const iso = new Date(valor);
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}

// Columns + embeds. `tipo` e `imagens` são aliases do PostgREST.
const SELECT =
  'id, id_lavoura, data, descricao, responsavel, ' +
  'tipo:tipo_atividade(id, nome, icone, cor), ' +
  'imagens:atividade_imagem(id, foto_url)';

/**
 * O Flask reescrevia a URL do Cloudinary no `to_dict` para o feed não baixar a
 * imagem original. Mantido aqui porque as telas esperam a versão transformada;
 * trocar por `getMediaUrl` depois quebraria o tamanho no feed.
 */
function otimizarUrl(url: string): string {
  if (url.includes('res.cloudinary.com') && url.includes('/upload/') && !url.includes('q_auto')) {
    return url.replace('/upload/', '/upload/f_auto,q_auto,w_1200,c_limit/');
  }
  return url;
}

/**
 * O embed pode devolver `null` (lavoura sem tipo, se o FK fosse removido) ou um
 * array em vez de objeto em dependendo da versão do PostgREST. Normalizar aqui
 * evita `undefined.nome` quebrando a tela inteira.
 */
function paraTipo(valor: unknown): TipoAtividade | null {
  if (!valor) return null;
  const raw = Array.isArray(valor) ? valor[0] : valor;
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  return {
    id: Number(t.id),
    nome: String(t.nome ?? ''),
    icone: String(t.icone ?? 'Info'),
    cor: String(t.cor ?? 'bg-gray-500'),
  };
}

// O supabase-js só infere tipos quando o select é literal; com a constante
// SELECT (e os embeds) ele cai no fallback `GenericStringError`, que não é um
// objeto indexável. O cast fica confinado aqui em vez de espalhado pela página.
const comoLinhas = (data: unknown): Record<string, unknown>[] =>
  Array.isArray(data) ? (data as unknown as Record<string, unknown>[]) : [];

function paraAtividade(row: Record<string, unknown>): Atividade {
  const imagensBrutas = Array.isArray(row.imagens) ? row.imagens : [];
  return {
    id: Number(row.id),
    id_lavoura: Number(row.id_lavoura),
    tipo: paraTipo(row.tipo),
    data: String(row.data),
    descricao: (row.descricao as string | null) ?? null,
    responsavel: (row.responsavel as string | null) ?? null,
    imagens: imagensBrutas.map((img) => {
      const i = img as Record<string, unknown>;
      return {
        id: Number(i.id),
        foto_url: otimizarUrl(String(i.foto_url ?? '')),
      };
    }),
  };
}

/**
 * Ascendente de propósito. O ChatPage faz scroll até o fim da lista e usa
 * flex-col, então ele renderiza esperando o mais antigo no topo. O Flask também
 * ordenava `data.asc()` nessa rota. Inverter aqui colocaria a mensagem nova no
 * topo e o scroll automático pointed para o meio da conversa.
 */
/**
 * Feed global: todas as atividades de todas as lavouras do usuário, da mais
 * recente para a mais antiga. Substitui o `/api/v1/feed` do Flask. A RLS já
 * garante que só entram lavouras do dono, então não é preciso filtrar por
 * id_usuario na query.
 */
export async function listarFeed(limite = 100): Promise<Atividade[]> {
  const { data, error } = await supabase
    .from('atividade')
    .select(SELECT)
    .order('data', { ascending: false })
    .order('id', { ascending: false })
    .limit(limite);

  if (error) throw new Error(error.message);
  return comoLinhas(data).map(paraAtividade);
}

/**
 * Mídia de uma lavoura para a galeria. Devolve o mesmo formato achatado que o
 * Flask montava à mão (`id`, `foto_url`, `data`, `atividade_id`), e não o
 * `Atividade` aninhado.
 */
export interface ImagemLavoura {
  id: number;
  foto_url: string;
  data: string;
  atividade_id: number;
}

export async function listarMidiaLavoura(idLavoura: number): Promise<ImagemLavoura[]> {
  const { data, error } = await supabase
    .from('atividade')
    .select('id, data, imagens:atividade_imagem(id, foto_url)')
    .eq('id_lavoura', idLavoura)
    .order('data', { ascending: false });

  if (error) throw new Error(error.message);

  const achatado: ImagemLavoura[] = [];
  for (const linha of comoLinhas(data)) {
    const imagens = Array.isArray(linha.imagens) ? linha.imagens : [];
    for (const img of imagens) {
      const i = img as Record<string, unknown>;
      achatado.push({
        id: Number(i.id),
        foto_url: otimizarUrl(String(i.foto_url ?? '')),
        data: String(linha.data),
        atividade_id: Number(linha.id),
      });
    }
  }

  // Mais recente primeiro, como o sort do Flask (reverse=True na data da
  // atividade, não na linha da imagem).
  return achatado.sort((a, b) => b.data.localeCompare(a.data));
}

export async function listarAtividades(idLavoura: number): Promise<Atividade[]> {
  const { data, error } = await supabase
    .from('atividade')
    .select(SELECT)
    .eq('id_lavoura', idLavoura)
    .order('data', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw new Error(error.message);
  return comoLinhas(data).map(paraAtividade);
}

export async function criarAtividade(input: AtividadeInput): Promise<Atividade> {
  if (!input.id_lavoura) throw new Error('Atividade sem lavoura.');
  if (!input.id_tipo_atividade) throw new Error('Escolha o tipo da atividade.');

  // `responsavel` é NOT NULL no Postgres (default 'Produtor'), mas o Flask
  // aceitava null. Traduzir para o default evita o insert falhar com
  // "null value in column violates not-null constraint".
  const { data, error } = await supabase
    .from('atividade')
    .insert({
      id_lavoura: input.id_lavoura,
      id_tipo_atividade: input.id_tipo_atividade,
      descricao: input.descricao?.trim() || null,
      responsavel: input.responsavel?.trim() || 'Produtor',
      data: paraData(input.data) ?? undefined,
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  const id = Number(data.id);

  // As imagens entram depois: no Flask o upload era do arquivo inteiro e a
  // linha nascia junto. Aqui a foto já está no Cloudinary, então só falta o
  // registro. `on delete cascade` cobre o rollback manual de "criou mas a foto
  // falhou" quando o insert de imagens não for possible.
  const urls = (input.imagens ?? []).filter(Boolean);
  if (urls.length > 0) {
    const { error: erroImg } = await supabase
      .from('atividade_imagem')
      .insert(urls.map((foto_url) => ({ id_atividade: id, foto_url })));

    if (erroImg) {
      // Não deixa atividade órfã sem foto: a RLS já validou o dono, então o
      // delete é legítimo.
      await supabase.from('atividade').delete().eq('id', id);
      throw new Error('Não foi possível salvar as imagens da atividade.');
    }
  }

  return buscarAtividade(id).then((a) => {
    if (!a) throw new Error('Atividade criada, mas não foi possível relê-la.');
    return a;
  });
}

export async function buscarAtividade(id: number): Promise<Atividade | null> {
  const { data, error } = await supabase.from('atividade').select(SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || Array.isArray(data)) return null;
  return paraAtividade(data as unknown as Record<string, unknown>);
}

/**
 * Atualiza a atividade e sincroniza as imagens. O Flask fazia um diff por URL
 * (deleta as que sumiram da lista, insere as novas); aqui o mesmo efeito sai
 * mais barato com delete + insert, já que o conjunto de fotos de uma atividade
 * é pequeno e sempre reescrito pela tela de edição.
 */
export async function atualizarAtividade(id: number, patch: Partial<AtividadeInput>): Promise<Atividade> {
  const update: Record<string, unknown> = {};

  if (patch.id_tipo_atividade !== undefined) update.id_tipo_atividade = patch.id_tipo_atividade;
  if (patch.descricao !== undefined) update.descricao = patch.descricao?.trim() || null;
  if (patch.responsavel !== undefined) update.responsavel = patch.responsavel?.trim() || 'Produtor';
  if (patch.data !== undefined) update.data = paraData(patch.data) ?? new Date().toISOString();

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from('atividade').update(update).eq('id', id);
    if (error) throw new Error(error.message);
  }

  if (patch.imagens !== undefined) {
    const urls = patch.imagens.filter(Boolean);

    const { error: erroDelete } = await supabase.from('atividade_imagem').delete().eq('id_atividade', id);
    if (erroDelete) throw new Error(erroDelete.message);

    if (urls.length > 0) {
      const { error: erroInsert } = await supabase
        .from('atividade_imagem')
        .insert(urls.map((foto_url) => ({ id_atividade: id, foto_url })));
      if (erroInsert) throw new Error(erroInsert.message);
    }
  }

  const atualizada = await buscarAtividade(id);
  if (!atualizada) throw new Error('Atividade não encontrada.');
  return atualizada;
}

export async function deletarAtividade(id: number): Promise<void> {
  const { error } = await supabase.from('atividade').delete().eq('id', id);
  if (error) throw new Error(error.message);
}