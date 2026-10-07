import { useMemo, useState } from 'react';
import {
  Plus, Search, Edit, Trash2, X, Check,
  NotebookPen, ImagePlus, ChevronLeft, ChevronRight,
} from 'lucide-react';
import Layout from '../components/Layout';
import MediaPicker from '../components/MediaPicker';
import toast from 'react-hot-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listarAnotacoes,
  criarAnotacao,
  atualizarAnotacao,
  deletarAnotacao,
  type Anotacao,
} from '../services/anotacoes';
import { uploadImagem } from '../services/cloudinary';
import { getMediaUrl } from '../utils/media';

const QUERY_KEY = ['anotacoes'] as const;

const TITULO_MAX = 150;
const CONTEUDO_MAX = 5000;

interface LightboxState {
  urls: string[];
  index: number;
}

const AnotacoesPage = () => {
  const queryClient = useQueryClient();

  const { data: anotacoes = [], isLoading: loading } = useQuery<Anotacao[]>({
    queryKey: QUERY_KEY,
    queryFn: listarAnotacoes,
  });

  const [busca, setBusca] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Anotacao | null>(null);
  const [titulo, setTitulo] = useState('');
  const [conteudo, setConteudo] = useState('');
  /** URLs já gravadas (edição): vêm do banco e voltam no update. */
  const [urlsExistentes, setUrlsExistentes] = useState<string[]>([]);
  /** Arquivos escolhidos nesta sessão: sobem no Cloudinary só no salvar. */
  const [novosArquivos, setNovosArquivos] = useState<{ file: File; preview: string }[]>([]);
  const [showMediaPicker, setShowMediaPicker] = useState(false);

  const [lightbox, setLightbox] = useState<LightboxState | null>(null);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return anotacoes;
    return anotacoes.filter(
      (a) =>
        a.titulo.toLowerCase().includes(termo) ||
        (a.conteudo ?? '').toLowerCase().includes(termo)
    );
  }, [anotacoes, busca]);

  const liberarPreviews = (lista: { file: File; preview: string }[]) => {
    lista.forEach((item) => URL.revokeObjectURL(item.preview));
  };

  const closeModal = () => {
    liberarPreviews(novosArquivos);
    setNovosArquivos([]);
    setIsModalOpen(false);
    setEditing(null);
    setTitulo('');
    setConteudo('');
    setUrlsExistentes([]);
  };

  const openCreate = () => {
    setEditing(null);
    setTitulo('');
    setConteudo('');
    setUrlsExistentes([]);
    setNovosArquivos([]);
    setIsModalOpen(true);
  };

  const openEdit = (anotacao: Anotacao) => {
    setEditing(anotacao);
    setTitulo(anotacao.titulo);
    setConteudo(anotacao.conteudo ?? '');
    setUrlsExistentes(anotacao.imagens.map((img) => img.foto_url));
    setNovosArquivos([]);
    setIsModalOpen(true);
  };

  const handleSelect = (files: File[]) => {
    // MediaPicker já comprime; criar preview aqui evita subir arquivo só para
    // mostrar miniatura no modal.
    const novos = files.map((file) => ({ file, preview: URL.createObjectURL(file) }));
    setNovosArquivos((atual) => [...atual, ...novos]);
  };

  const removerExistente = (index: number) => {
    setUrlsExistentes((atual) => atual.filter((_, i) => i !== index));
  };

  const removerNovo = (index: number) => {
    setNovosArquivos((atual) => {
      const alvo = atual[index];
      if (alvo) URL.revokeObjectURL(alvo.preview);
      return atual.filter((_, i) => i !== index);
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Upload antes do registro: a URL é o que entra no banco. Em edição,
      // as URLs existentes voltam intactas e só os arquivos novos sobem.
      const subidas: string[] = [];
      for (const item of novosArquivos) {
        const up = await uploadImagem(item.file, { folder: 'anotacoes' });
        subidas.push(up.url);
      }
      const imagens = [...urlsExistentes, ...subidas];

      return editing
        ? atualizarAnotacao(editing.id, { titulo, conteudo, imagens })
        : criarAnotacao({ titulo, conteudo, imagens });
    },
    onSuccess: () => {
      closeModal();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Erro ao salvar anotação.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletarAnotacao(id),
    // Mesmo otimista do FuncionariosPage: some da tela na hora e volta se o
    // banco recusar. Aqui não há outras telas lendo anotação, então a chave é
    // só esta — invalidar no settled cobre o revalidate.
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<Anotacao[]>(QUERY_KEY);
      queryClient.setQueryData<Anotacao[]>(QUERY_KEY, (old) =>
        old?.filter((a) => a.id !== id) ?? old
      );
      return { previous };
    },
    onError: (err: Error, _id, context) => {
      queryClient.setQueryData(QUERY_KEY, context?.previous);
      toast.error(err.message || 'Erro ao excluir.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo.trim() || saveMutation.isPending) return;
    saveMutation.mutate();
  };

  const handleDelete = (id: number) => {
    toast(
      (t) => (
        <div className="flex flex-col gap-3">
          <span className="font-bold">Excluir esta anotação?</span>
          <div className="flex gap-2">
            <button
              className="bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs"
              onClick={() => {
                toast.dismiss(t.id);
                deleteMutation.mutate(id);
              }}
            >
              Sim, Excluir
            </button>
            <button
              className="bg-gray-100 px-3 py-1.5 rounded-lg text-xs"
              onClick={() => toast.dismiss(t.id)}
            >
              Cancelar
            </button>
          </div>
        </div>
      ),
      { duration: 4000 }
    );
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const abrirLightbox = (urls: string[], index: number) => setLightbox({ urls, index });

  const fecharLightbox = () => setLightbox(null);

  const moverLightbox = (delta: number) => {
    setLightbox((atual) => {
      if (!atual) return atual;
      const proximo = (atual.index + delta + atual.urls.length) % atual.urls.length;
      return { ...atual, index: proximo };
    });
  };

  const totalEdicao = urlsExistentes.length + novosArquivos.length;

  return (
    <Layout title="Anotações">
      <div className="bg-[#f0f2f5] min-h-full pb-24">
        {/* Header Section */}
        <div className="bg-white p-6 border-b border-gray-100 shadow-sm mb-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-2xl font-black text-gray-900">Minhas Anotações</h2>
            <button
              onClick={openCreate}
              className="p-3 bg-whatsapp-teal text-white rounded-2xl shadow-xl shadow-whatsapp-teal/20 active:scale-90 transition-all"
            >
              <Plus size={24} />
            </button>
          </div>
          <p className="text-sm text-gray-400 font-medium">
          </p>
        </div>

        {/* Search Bar */}
        <div className="px-4 mb-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Buscar nas anotações..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-white border-none rounded-2xl shadow-sm outline-none focus:ring-2 focus:ring-whatsapp-teal transition-all text-gray-700 font-medium"
            />
          </div>
        </div>

        {/* List Section */}
        <div className="px-4 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-10 h-10 border-4 border-whatsapp-teal border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400 font-bold animate-pulse">Carregando anotações...</p>
            </div>
          ) : filtradas.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center shadow-sm">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <NotebookPen size={40} className="text-gray-200" />
              </div>
              <h3 className="text-lg font-black text-gray-900 mb-2">
                {busca ? 'Nada encontrado' : 'Nenhuma anotação'}
              </h3>
              <p className="text-gray-400 text-sm mb-6">
                {busca
                  ? 'Tente outro termo na busca.'
                  : 'Anote um lembrete, uma ideia ou registre uma foto avulsa.'}
              </p>
              {!busca && (
                <button
                  onClick={openCreate}
                  className="px-8 py-3 bg-gray-50 text-whatsapp-teal font-black rounded-xl hover:bg-whatsapp-teal hover:text-white transition-all"
                >
                  Criar Agora
                </button>
              )}
            </div>
          ) : (
            filtradas.map((anotacao) => (
              <div
                key={anotacao.id}
                className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-50 group hover:shadow-md transition-all animate-in fade-in slide-in-from-bottom-4 duration-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-xl font-black text-gray-900 leading-tight break-words">
                      {anotacao.titulo}
                    </h3>
                    <span className="text-[10px] text-gray-400 font-bold">
                      {formatDate(anotacao.created_at)}
                      {anotacao.updated_at !== anotacao.created_at && ' · editada'}
                    </span>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => openEdit(anotacao)}
                      aria-label="Editar anotação"
                      className="p-3 text-gray-400 hover:text-whatsapp-teal hover:bg-whatsapp-teal/5 rounded-2xl transition-all"
                    >
                      <Edit size={20} />
                    </button>
                    <button
                      onClick={() => handleDelete(anotacao.id)}
                      aria-label="Excluir anotação"
                      className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>

                {anotacao.conteudo && (
                  <p className="text-sm text-gray-600 leading-relaxed line-clamp-3 mt-3">
                    {anotacao.conteudo}
                  </p>
                )}

                {anotacao.imagens.length > 0 && (
                  <div className="flex gap-2 mt-4 overflow-x-auto no-scrollbar">
                    {anotacao.imagens.slice(0, 3).map((img) => (
                      <button
                        key={img.id}
                        onClick={() =>
                          abrirLightbox(
                            anotacao.imagens.map((i) => i.foto_url),
                            anotacao.imagens.findIndex((i) => i.id === img.id)
                          )
                        }
                        className="shrink-0 active:scale-95 transition-all"
                        aria-label="Ampliar foto"
                      >
                        {/* h-24 com largura natural: sem moldura quadrada, a foto
                            mantém a proporção original em vez de ser cortada. */}
                        <img
                          src={getMediaUrl(img.foto_url)}
                          alt=""
                          className="h-24 w-auto rounded-xl bg-gray-100"
                        />
                      </button>
                    ))}
                    {anotacao.imagens.length > 3 && (
                      <div className="h-24 px-4 rounded-xl bg-gray-100 flex items-center justify-center text-xs font-black text-gray-400 shrink-0">
                        +{anotacao.imagens.length - 3}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Modal Overlay */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-sm rounded-[2.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
              <div className="bg-whatsapp-teal p-6 text-white flex justify-between items-center shrink-0">
                <h3 className="text-xl font-black">
                  {editing ? 'Editar Anotação' : 'Nova Anotação'}
                </h3>
                <button onClick={closeModal} aria-label="Fechar" className="active:scale-90 transition-all">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto no-scrollbar">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">
                    Título
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={TITULO_MAX}
                    value={titulo}
                    onChange={(e) => setTitulo(e.target.value)}
                    placeholder="Ex: Comprar adubo, conferir irrigador..."
                    className="w-full px-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-gray-800 outline-none focus:ring-2 focus:ring-whatsapp-teal transition-all font-medium"
                  />
                  <span className="text-[10px] text-gray-300 font-bold ml-2">
                    {titulo.length}/{TITULO_MAX}
                  </span>
                </div>

                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">
                    Texto
                  </label>
                  <textarea
                    value={conteudo}
                    maxLength={CONTEUDO_MAX}
                    onChange={(e) => setConteudo(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-gray-800 outline-none focus:ring-2 focus:ring-whatsapp-teal transition-all font-medium resize-none"
                  />
                  <span className="text-[10px] text-gray-300 font-bold ml-2">
                    {conteudo.length}/{CONTEUDO_MAX}
                  </span>
                </div>

                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">
                    Fotos
                  </label>

                  <div className="flex flex-wrap gap-2 items-start">
                    {/* Já gravadas (edição) — sem borda e sem corte quadrado */}
                    {urlsExistentes.map((url, i) => (
                      <div key={`existente-${i}`} className="relative shrink-0">
                        <img
                          src={getMediaUrl(url)}
                          alt=""
                          className="h-24 w-auto rounded-xl bg-gray-100"
                        />
                        <button
                          type="button"
                          onClick={() => removerExistente(i)}
                          aria-label="Remover foto"
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md active:scale-90 transition-all"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}

                    {/* Escolhidas nesta sessão (prévia local) */}
                    {novosArquivos.map((item, i) => (
                      <div key={`novo-${i}`} className="relative shrink-0">
                        <img
                          src={item.preview}
                          alt=""
                          className="h-24 w-auto rounded-xl bg-gray-100"
                        />
                        <button
                          type="button"
                          onClick={() => removerNovo(i)}
                          aria-label="Remover foto"
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md active:scale-90 transition-all"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() => setShowMediaPicker(true)}
                      className="h-24 min-w-[6rem] rounded-xl bg-gray-50 border border-dashed border-gray-300 flex flex-col items-center justify-center gap-1 text-gray-400 hover:text-whatsapp-teal hover:border-whatsapp-teal/40 active:scale-95 transition-all"
                    >
                      <ImagePlus size={22} />
                      <span className="text-[9px] font-black uppercase">Foto</span>
                    </button>
                  </div>

                  {totalEdicao > 0 && (
                    <span className="text-[10px] text-gray-300 font-bold ml-2 block mt-1">
                      {totalEdicao} foto{totalEdicao > 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                <div className="pt-2 flex gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="flex-1 py-4 text-gray-400 font-black hover:bg-gray-50 rounded-2xl transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={!titulo.trim() || saveMutation.isPending}
                    className={`flex-1 py-4 font-black rounded-2xl shadow-xl transition-all flex items-center justify-center gap-2 ${
                      titulo.trim() && !saveMutation.isPending
                        ? 'bg-whatsapp-teal text-white shadow-whatsapp-teal/20 active:scale-95'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    <Check size={20} />
                    {saveMutation.isPending
                      ? 'Salvando...'
                      : editing
                        ? 'Salvar'
                        : 'Criar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <MediaPicker
          isOpen={showMediaPicker}
          onClose={() => setShowMediaPicker(false)}
          onSelect={handleSelect}
          multiple={true}
        />

        {/* Lightbox */}
        {lightbox && (
          <div className="fixed inset-0 bg-black/95 z-[300] flex items-center justify-center animate-in fade-in duration-200">
            <button
              onClick={fecharLightbox}
              aria-label="Fechar"
              className="absolute top-4 right-4 text-white/80 hover:text-white p-3 active:scale-90 transition-all z-10"
            >
              <X size={28} />
            </button>

            {lightbox.urls.length > 1 && (
              <>
                <button
                  onClick={() => moverLightbox(-1)}
                  aria-label="Foto anterior"
                  className="absolute left-2 text-white/80 hover:text-white p-3 active:scale-90 transition-all z-10"
                >
                  <ChevronLeft size={36} />
                </button>
                <button
                  onClick={() => moverLightbox(1)}
                  aria-label="Próxima foto"
                  className="absolute right-2 text-white/80 hover:text-white p-3 active:scale-90 transition-all z-10"
                >
                  <ChevronRight size={36} />
                </button>
                <span className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/70 text-xs font-black tracking-widest">
                  {lightbox.index + 1} / {lightbox.urls.length}
                </span>
              </>
            )}

            <img
              src={lightbox.urls[lightbox.index]}
              alt=""
              className="max-w-[92vw] max-h-[85vh] object-contain rounded-xl"
            />
          </div>
        )}
      </div>
    </Layout>
  );
};

export default AnotacoesPage;
