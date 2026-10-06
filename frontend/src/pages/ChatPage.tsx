import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Send, Plus, X, User, Edit, 
  Trash2, Check, ChevronDown,
  Sprout, Wind, Zap, Droplets, Sun, Hammer, LayoutGrid,
  Image as ImageIcon
} from 'lucide-react';
import Layout from '../components/Layout';
import MediaPicker from '../components/MediaPicker';
import { useDraggableScroll } from '../hooks/useDraggableScroll';
import { listarLavouras } from '../services/lavouras';
import { listarTiposAtividade, type TipoAtividade } from '../services/catalogo';
import { listarFuncionarios, type Funcionario } from '../services/funcionarios';
import {
  listarAtividades,
  criarAtividade,
  atualizarAtividade,
  deletarAtividade,
  type Atividade,
} from '../services/atividades';
import { uploadImagem } from '../services/cloudinary';
import { QUERY, invalidarAtividades } from '../services/atividadesCache';
import { compressImage } from '../utils/imageCompression';
import { Clock, Check as CheckIcon } from 'lucide-react';
import { getMediaUrl } from '../utils/media';
import toast from 'react-hot-toast';



const ICONS_MAP: any = {
  'Sprout': Sprout,
  'Truck': Wind,
  'Wind': Wind,
  'Zap': Zap,
  'Droplets': Droplets,
  'Sun': Sun,
  'Hammer': Hammer,
  'Default': LayoutGrid
};

const ChatPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dragScroll = useDraggableScroll<HTMLDivElement>();
  
  // Estados UI
  const [searchTerm, setSearchTerm] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0); 
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingAtv, setEditingAtv] = useState<any>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // O upload deixou de ser mutation do React Query (virou chamada direta ao
  // Cloudinary dentro de handleFilesSelected), então o spinner precisa de um
  // estado próprio para não aparecer como "salvando atividade".
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [showRespDropdown, setShowRespDropdown] = useState(false);
  const [showMediaOptions, setShowMediaOptions] = useState(false);
  const [isEditingRespDropdown, setIsEditingRespDropdown] = useState(false);

  // Refs
  const respRef = useRef<HTMLDivElement>(null);
  const editRespRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Form Novo
  const [newAtvForm, setNewAtvForm] = useState({
    descricao: '', id_tipo_atividade: 0, responsavel: 'Produtor',
    data: new Date().toLocaleDateString('en-CA'), fotos: [] as string[]
  });

  // Queries (Persistence habilitada no App.tsx)
  const { data: lavouras = [] } = useQuery({
    queryKey: ['lavouras'],
    queryFn: listarLavouras
  });
  
  const lavoura = lavouras.find((l) => l.id === Number(id));

  const { data: tipos = [] } = useQuery<TipoAtividade[]>({
    queryKey: ['tipos-atividade'],
    queryFn: listarTiposAtividade,
  });

  const { data: funcionarios = [] } = useQuery<Funcionario[]>({
    queryKey: ['funcionarios'],
    queryFn: listarFuncionarios
  });

  const idLavoura = Number(id);

  const { data: atividadesData, isLoading, isFetching } = useQuery<Atividade[]>({
    queryKey: QUERY.chat(idLavoura),
    queryFn: () => listarAtividades(idLavoura),
    enabled: !!idLavoura
  });
  const atividades: Atividade[] = useMemo(() => atividadesData ?? [], [atividadesData]);

  // Efeito para definir a categoria padrão assim que carregar
  useEffect(() => {
    if (tipos.length > 0 && newAtvForm.id_tipo_atividade === 0) {
      setNewAtvForm(p => ({ ...p, id_tipo_atividade: tipos[0].id }));
    }
  }, [tipos, newAtvForm.id_tipo_atividade]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (newData: typeof newAtvForm) => criarAtividade({
      id_lavoura: idLavoura,
      id_tipo_atividade: newData.id_tipo_atividade,
      descricao: newData.descricao,
      responsavel: newData.responsavel,
      data: newData.data,
      imagens: newData.fotos,
    }),
    onSuccess: () => {
      setNewAtvForm({ 
        descricao: '', 
        id_tipo_atividade: tipos[0]?.id || 0, 
        responsavel: 'Produtor', 
        data: new Date().toLocaleDateString('en-CA'), 
        fotos: [] 
      });
      setShowNewModal(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Erro ao registrar atividade. Tente novamente.');
    },
    onSettled: async () => {
      await Promise.all(invalidarAtividades(queryClient, idLavoura));
    }
  });

  const updateMutation = useMutation({
    mutationFn: (atv: any) => atualizarAtividade(atv.id, {
      descricao: atv.descricao,
      id_tipo_atividade: atv.tipo.id,
      responsavel: atv.responsavel,
      data: atv.data,
      imagens: atv.imagens.map((img: Atividade['imagens'][number]) => img.foto_url),
    }),
    onSuccess: () => {
      setEditingAtv(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Erro ao atualizar atividade.');
    },
    onSettled: async () => {
      await Promise.all(invalidarAtividades(queryClient, idLavoura));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (atvId: number) => deletarAtividade(atvId),
    onMutate: async (atvId: number) => {
      await queryClient.cancelQueries({ queryKey: QUERY.chat(idLavoura) });
      const previous = queryClient.getQueryData<Atividade[]>(QUERY.chat(idLavoura));
      setDeletingId(null);

      queryClient.setQueryData<Atividade[]>(QUERY.chat(idLavoura), (old) =>
        old?.filter((o) => o.id !== atvId) ?? old
      );
      return { previous };
    },
    onError: (err: Error, _atvId, context: { previous: Atividade[] | undefined } | undefined) => {
      queryClient.setQueryData(QUERY.chat(idLavoura), context?.previous);
      toast.error(err.message || 'Erro ao excluir atividade.');
    },
    onSettled: async () => {
      await Promise.all(invalidarAtividades(queryClient, idLavoura));
    }
  });

  // Scroll Automático
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [atividades]);

  // Click Outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (respRef.current && !respRef.current.contains(event.target as Node)) setShowRespDropdown(false);
      if (editRespRef.current && !editRespRef.current.contains(event.target as Node)) setIsEditingRespDropdown(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handlers
  const handleFilesSelected = async (files: File[]) => {
    const isEdit = !!editingAtv;

    setEnviandoFoto(true);
    try {
      for (const file of files) {
        const compressed = await compressImage(file);
        const data = await uploadImagem(compressed, { folder: 'atividades' });

        if (isEdit && editingAtv) {
          setEditingAtv((prev: any) => ({
            ...prev,
            imagens: [...prev.imagens, { id: Date.now(), foto_url: data.url }]
          }));
        } else {
          setNewAtvForm(p => ({ ...p, fotos: [...p.fotos, data.url] }));
          if (!isEdit) setShowNewModal(true);
        }
      }
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : 'Não foi possível enviar a foto.');
    } finally {
      setEnviandoFoto(false);
    }
  };

  const handleCreate = () => {
    if (!newAtvForm.descricao.trim() && newAtvForm.fotos.length === 0) return;
    createMutation.mutate(newAtvForm);
  };

  const renderIcon = (name: string, size = 10) => {
    const Icon = ICONS_MAP[name] || ICONS_MAP['Default'];
    return <Icon size={size} />;
  };

  const filteredAtividades = (Array.isArray(atividades) ? atividades : []).filter((a: any) => {
    const desc = a.descricao || '';
    const tipoNome = a.tipo?.nome || '';
    const matchesSearch = desc.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          tipoNome.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTab = activeTab === 0 || a.tipo?.id === activeTab;
    return matchesSearch && matchesTab;
  });

  return (
    <Layout 
      title={lavoura?.nome || "Carregando..."} 
      subtitle={isFetching ? "Sincronizando dados..." : (lavoura ? "Toque para ver os detalhes" : undefined)}
      avatarUrl={lavoura?.foto_perfil ?? undefined}
      showBackButton={true} 
      onSearchClick={() => setShowSearch(!showSearch)}
      onTitleClick={() => navigate(`/lavoura/${id}/perfil`)}
      key={lavoura?.id ?? 'carregando'}
    >
      <div className="flex flex-col h-full bg-[#efeae2] relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06] bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat"></div>
        
        {/* Busca */}
        {showSearch && (
          <div className="p-2 bg-white border-b border-gray-100 animate-in slide-in-from-top-2 duration-200 z-30">
            <input 
              type="text" 
              value={searchTerm} 
              onChange={(e) => setSearchTerm(e.target.value)} 
              placeholder="Pesquisar no chat..." 
              className="w-full px-4 py-2 bg-gray-100 rounded-full text-sm outline-none focus:ring-1 focus:ring-whatsapp-teal" 
              autoFocus 
            />
          </div>
        )}

        {/* Categorias / Abas */}
        <div 
          className={`bg-white border-b border-gray-100 overflow-x-auto no-scrollbar shadow-sm z-10 ${dragScroll.className}`}
          ref={dragScroll.ref}
          onMouseDown={dragScroll.onMouseDown}
          onMouseLeave={dragScroll.onMouseLeave}
          onMouseUp={dragScroll.onMouseUp}
          onMouseMove={dragScroll.onMouseMove}
        >
          <div className="flex p-2 flex-nowrap gap-2 min-w-max px-4">
            <button 
              onClick={() => setActiveTab(0)} 
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[10px] font-black uppercase transition-all ${activeTab === 0 ? 'bg-gray-800 text-white shadow-md scale-105' : 'bg-gray-100 text-gray-500'}`}
            >
              🏠 Geral
            </button>
            {tipos.map((t: any) => (
              <button 
                key={t.id} 
                onClick={() => setActiveTab(t.id)} 
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[10px] font-black uppercase transition-all ${activeTab === t.id ? `${t.cor} text-white shadow-md scale-105` : 'bg-gray-100 text-gray-500'}`}
              >
                {renderIcon(t.icone, 12)} {t.nome}
              </button>
            ))}
          </div>
        </div>

        {/* Lista de Mensagens */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 relative no-scrollbar pb-32">
          {isLoading ? (
            [...Array(4)].map((_, i) => (
              <div key={i} className={`flex flex-col animate-pulse ${i % 2 === 0 ? 'items-start' : 'items-end'}`}>
                <div className="bg-gray-200 rounded-xl rounded-tl-none p-3 shadow-sm w-[70%] h-24 relative border-l-4 border-l-gray-300"></div>
              </div>
            ))
          ) : filteredAtividades.map((atv: any) => (
            <div key={atv.id} className="flex flex-col group animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="bg-white rounded-xl rounded-tl-none p-3 shadow-sm max-w-[90%] relative self-start border-l-4 border-l-whatsapp-teal">
                <div className="flex justify-between items-center gap-4 mb-0.5">
                  <span className="text-[10px] font-black text-whatsapp-teal uppercase tracking-tight">{atv.responsavel}</span>
                  <div className="flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity">
                    <button onClick={() => setEditingAtv(atv)} className="p-1 text-gray-500 hover:text-whatsapp-teal"><Edit size={14} /></button>
                    <button onClick={() => setDeletingId(atv.id)} className="p-1 text-gray-500 hover:text-red-500"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md mb-2 shadow-sm ${atv.tipo?.cor || 'bg-gray-500'}`}>
                  <div className="text-white">{renderIcon(atv.tipo?.icone || 'Default')}</div>
                  <span className="text-[8px] font-black text-white uppercase tracking-tighter">{atv.tipo?.nome || 'Geral'}</span>
                </div>
                <p className="text-[13px] text-gray-800 leading-snug font-medium mb-1 whitespace-pre-wrap">{atv.descricao || ''}</p>
                {atv.imagens?.length > 0 && (
                  <div className={`mt-2 grid ${atv.imagens.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-1 rounded-lg overflow-hidden`}>
                    {atv.imagens.map((img: any) => (
                      <img 
                        key={img.id} 
                        src={getMediaUrl(img.foto_url)} 
                        loading="lazy"
                        className="w-full h-32 object-cover cursor-pointer active:scale-95 transition-all" 
                        onClick={() => setLightboxImage(img.foto_url)} 
                      />
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-end gap-1 mt-1">
                  <div className="text-[9px] text-gray-400 font-bold italic">{new Date(atv.data).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  {atv.status === 'pending' ? (
                    <Clock size={10} className="text-gray-400 animate-pulse" />
                  ) : (
                    <CheckIcon size={10} className="text-whatsapp-teal" />
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar - FIXADA NO RODAPÉ */}
        <div className="fixed bottom-0 left-0 right-0 bg-white p-3 flex items-center gap-3 border-t border-gray-100 z-50 pb-safe shadow-[0_-5px_15px_rgba(0,0,0,0.05)]">
          <button 
            onClick={() => setShowMediaOptions(true)} 
            className="p-3 bg-teal-50 text-whatsapp-teal rounded-full hover:bg-teal-100 active:scale-95 transition-all"
          >
            {enviandoFoto ? <div className="w-5 h-5 border-2 border-whatsapp-teal border-t-transparent animate-spin rounded-full" /> : <ImageIcon size={22} />}
          </button>
          
          <div className="flex-1 bg-gray-50 border border-gray-100 rounded-3xl px-4 py-3 flex items-center focus-within:ring-2 focus-within:ring-whatsapp-teal/20 transition-all">
            <input 
              type="text" 
              value={newAtvForm.descricao} 
              onChange={e => setNewAtvForm({...newAtvForm, descricao: e.target.value})} 
              onKeyDown={e => e.key === 'Enter' && (newAtvForm.descricao.trim() && setShowNewModal(true))} 
              placeholder="Registrar atividade..." 
              className="w-full text-sm outline-none bg-transparent placeholder-gray-400 text-gray-700 font-medium" 
            />
          </div>
          
          <button 
            onClick={() => setShowNewModal(true)} 
            disabled={!newAtvForm.descricao.trim() && newAtvForm.fotos.length === 0} 
            className={`p-3 rounded-full shadow-sm transition-all ${
              newAtvForm.descricao.trim() || newAtvForm.fotos.length > 0 
                ? 'bg-whatsapp-teal text-white hover:bg-teal-600 active:scale-90 shadow-whatsapp-teal/30 shadow-lg' 
                : 'bg-gray-100 text-gray-400'
            }`}
          >
            <Send size={20} className={newAtvForm.descricao.trim() || newAtvForm.fotos.length > 0 ? 'ml-0.5' : ''} />
          </button>
        </div>

        {/* MODAL: NOVO */}
        {showNewModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-sm rounded-[2.5rem] overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
              <div className="bg-whatsapp-teal p-6 text-white flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <img 
                    src={lavoura?.foto_perfil ?? undefined} 
                    className="w-10 h-10 rounded-full border-2 border-white/20 object-cover" 
                    alt="" 
                  />
                  <div>
                    <h3 className="text-lg font-black leading-tight">Novo Registro</h3>
                    <p className="text-[10px] font-bold text-white/70 uppercase tracking-wider">{lavoura?.nome}</p>
                  </div>
                </div>
                <button onClick={() => setShowNewModal(false)} className="p-2 hover:bg-white/10 rounded-full transition-all"><X size={20} /></button>
              </div>
              <div className="p-8 pb-10 space-y-6 overflow-y-auto no-scrollbar relative">
                  <div className="grid grid-cols-3 gap-2">
                    {newAtvForm.fotos.map((url, idx) => (
                      <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border border-gray-100 shadow-sm">
                        <img src={url} className="w-full h-full object-cover" />
                        <button onClick={() => setNewAtvForm({...newAtvForm, fotos: newAtvForm.fotos.filter((_, i) => i !== idx)})} className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 shadow-md"><X size={10} /></button>
                      </div>
                    ))}
                    <button onClick={() => setShowMediaOptions(true)} className="aspect-square rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-400 hover:text-whatsapp-teal hover:border-whatsapp-teal transition-all flex-col gap-1">
                      <Plus size={20} />
                      <span className="text-[7px] font-black uppercase">Foto</span>
                    </button>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block ml-2">Descrição</label>
                  <textarea 
                    value={newAtvForm.descricao} 
                    onChange={e => setNewAtvForm({...newAtvForm, descricao: e.target.value})} 
                    className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm min-h-[100px] outline-none focus:ring-1 focus:ring-whatsapp-teal" 
                    placeholder="O que aconteceu no campo?" 
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block ml-2">Categoria</label>
                  <div className="flex flex-wrap gap-2">
                    {tipos.map((t: any) => (
                      <button 
                        key={t.id} 
                        onClick={() => setNewAtvForm({...newAtvForm, id_tipo_atividade: t.id})} 
                        className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1 transition-all ${newAtvForm.id_tipo_atividade === t.id ? `${t.cor} text-white shadow-lg scale-105` : 'bg-gray-100 text-gray-500'}`}
                      >
                        {renderIcon(t.icone, 12)} {t.nome}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative" ref={respRef}>
                  <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block ml-2">Responsável</label>
                  <button onClick={() => setShowRespDropdown(!showRespDropdown)} className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold text-left flex items-center justify-between hover:bg-gray-100 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-whatsapp-teal/10 flex items-center justify-center text-whatsapp-teal"><User size={16} /></div>
                      {newAtvForm.responsavel}
                    </div>
                    <ChevronDown size={16} className={`text-gray-300 transition-transform ${showRespDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  {showRespDropdown && (
                    <div className="absolute bottom-full mb-2 left-0 w-full bg-white rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.15)] border border-gray-100 z-[100] overflow-hidden">
                      <div className="p-2 space-y-1 max-h-56 overflow-y-auto no-scrollbar">
                        <button onClick={() => { setNewAtvForm({...newAtvForm, responsavel: 'Produtor'}); setShowRespDropdown(false); }} className={`w-full p-3 rounded-2xl text-left text-sm font-bold flex items-center justify-between transition-all ${newAtvForm.responsavel === 'Produtor' ? 'bg-whatsapp-teal/10 text-whatsapp-teal' : 'hover:bg-gray-50 text-gray-700'}`}>
                          Produtor (Eu)
                          {newAtvForm.responsavel === 'Produtor' && <Check size={18} />}
                        </button>
                        {funcionarios.map((f: any) => (
                          <button key={f.id_funcionario} onClick={() => { setNewAtvForm({...newAtvForm, responsavel: f.nome}); setShowRespDropdown(false); }} className={`w-full p-3 rounded-2xl text-left text-sm font-bold flex items-center justify-between transition-all ${newAtvForm.responsavel === f.nome ? 'bg-whatsapp-teal/10 text-whatsapp-teal' : 'hover:bg-gray-50 text-gray-700'}`}>
                            {f.nome}
                            {newAtvForm.responsavel === f.nome && <Check size={18} />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="p-8 bg-gray-50">
                <button 
                  onClick={handleCreate} 
                  disabled={createMutation.isPending || enviandoFoto} 
                  className="w-full py-4 bg-whatsapp-teal text-white font-black rounded-2xl shadow-xl shadow-whatsapp-teal/20 hover:bg-whatsapp-teal-dark active:scale-95 transition-all disabled:opacity-50"
                >
                  {createMutation.isPending ? 'REGISTRANDO...' : 'CONFIRMAR REGISTRO'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: EDITAR COMPLETO */}
        {editingAtv && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
             <div className="bg-white w-full max-w-sm rounded-[2.5rem] overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
               <div className="bg-whatsapp-teal p-6 text-white flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <img 
                      src={getMediaUrl(lavoura?.foto_perfil)} 
                      className="w-10 h-10 rounded-full border-2 border-white/20 object-cover" 
                      alt="" 
                    />
                    <div>
                      <h3 className="text-lg font-black leading-tight">Editar Registro</h3>
                      <p className="text-[10px] font-bold text-white/70 uppercase tracking-wider">{lavoura?.nome}</p>
                    </div>
                  </div>
                 <button onClick={() => setEditingAtv(null)} className="p-2 hover:bg-white/10 rounded-full transition-all"><X size={20} /></button>
               </div>
               
               <div className="p-8 pb-10 space-y-6 overflow-y-auto no-scrollbar relative">
                 {/* Imagens na Edição */}
                 <div className="grid grid-cols-3 gap-2">
                   {editingAtv.imagens.map((img: any, idx: number) => (
                     <div key={img.id || idx} className="relative aspect-square rounded-xl overflow-hidden border border-gray-100 shadow-sm">
                       <img src={getMediaUrl(img.foto_url)} className="w-full h-full object-cover" />
                       <button 
                         onClick={() => setEditingAtv({
                           ...editingAtv, 
                           imagens: editingAtv.imagens.filter((_: any, i: number) => i !== idx)
                         })} 
                         className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 shadow-md"
                       >
                         <X size={10} />
                       </button>
                     </div>
                   ))}
                   <button 
                    onClick={() => setShowMediaOptions(true)} 
                    className="aspect-square rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-400 hover:text-whatsapp-teal hover:border-whatsapp-teal transition-all"
                   >
                    <Plus size={24} />
                   </button>
                 </div>

                 <div>
                   <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block ml-2">Descrição</label>
                   <textarea 
                     value={editingAtv.descricao} 
                     onChange={e => setEditingAtv({...editingAtv, descricao: e.target.value})} 
                     className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm min-h-[100px] outline-none focus:ring-1 focus:ring-whatsapp-teal" 
                   />
                 </div>

                 <div>
                   <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block ml-2">Categoria</label>
                   <div className="flex flex-wrap gap-2">
                     {tipos.map((t: any) => (
                       <button 
                         key={t.id} 
                         onClick={() => setEditingAtv({...editingAtv, tipo: t})} 
                         className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1 transition-all ${editingAtv.tipo.id === t.id ? `${t.cor} text-white shadow-lg scale-105` : 'bg-gray-100 text-gray-500'}`}
                       >
                         {renderIcon(t.icone, 12)} {t.nome}
                       </button>
                     ))}
                   </div>
                 </div>

                 <div className="relative" ref={editRespRef}>
                   <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block ml-2">Responsável</label>
                   <button onClick={() => setIsEditingRespDropdown(!isEditingRespDropdown)} className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold text-left flex items-center justify-between hover:bg-gray-100 transition-colors">
                     <div className="flex items-center gap-3">
                       <div className="w-8 h-8 rounded-full bg-whatsapp-teal/10 flex items-center justify-center text-whatsapp-teal"><User size={16} /></div>
                       {editingAtv.responsavel}
                     </div>
                     <ChevronDown size={16} className={`text-gray-300 transition-transform ${isEditingRespDropdown ? 'rotate-180' : ''}`} />
                   </button>
                   {isEditingRespDropdown && (
                     <div className="absolute bottom-full mb-2 left-0 w-full bg-white rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.15)] border border-gray-100 z-[100] overflow-hidden">
                       <div className="p-2 space-y-1 max-h-56 overflow-y-auto no-scrollbar">
                         <button onClick={() => { setEditingAtv({...editingAtv, responsavel: 'Produtor'}); setIsEditingRespDropdown(false); }} className={`w-full p-3 rounded-2xl text-left text-sm font-bold flex items-center justify-between transition-all ${editingAtv.responsavel === 'Produtor' ? 'bg-whatsapp-teal/10 text-whatsapp-teal' : 'hover:bg-gray-50 text-gray-700'}`}>
                           Produtor (Eu)
                           {editingAtv.responsavel === 'Produtor' && <Check size={18} />}
                         </button>
                         {funcionarios.map((f: any) => (
                           <button key={f.id_funcionario} onClick={() => { setEditingAtv({...editingAtv, responsavel: f.nome}); setIsEditingRespDropdown(false); }} className={`w-full p-3 rounded-2xl text-left text-sm font-bold flex items-center justify-between transition-all ${editingAtv.responsavel === f.nome ? 'bg-whatsapp-teal/10 text-whatsapp-teal' : 'hover:bg-gray-50 text-gray-700'}`}>
                             {f.nome}
                             {editingAtv.responsavel === f.nome && <Check size={18} />}
                           </button>
                         ))}
                       </div>
                     </div>
                   )}
                 </div>
               </div>

               <div className="p-8 bg-gray-50">
                  <button 
                    onClick={() => updateMutation.mutate(editingAtv)} 
                    disabled={updateMutation.isPending}
                    className="w-full py-4 bg-whatsapp-teal text-white font-black rounded-2xl shadow-xl shadow-whatsapp-teal/20 hover:bg-whatsapp-teal-dark active:scale-95 transition-all disabled:opacity-50"
                  >
                    {updateMutation.isPending ? 'SALVANDO...' : 'SALVAR ALTERAÇÕES'}
                  </button>
               </div>
             </div>
          </div>
        )}

        {/* FAB - Nova Atividade */}
        <button
          onClick={() => setShowNewModal(true)}
          className="fixed bottom-20 right-4 z-50 w-14 h-14 bg-whatsapp-green text-white rounded-full shadow-2xl flex items-center justify-center transition-all active:scale-90 hover:-translate-y-1 hover:shadow-whatsapp-green/40 pointer-events-auto"
        >
          <Plus size={28} />
        </button>

        {/* MODAL: DELETE */}
        {deletingId && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
            <div className="bg-white rounded-[2.5rem] p-8 text-center max-w-xs w-full shadow-2xl">
              <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 size={32} /></div>
              <h3 className="text-lg font-black mb-2">Apagar registro?</h3>
              <div className="flex gap-4 mt-6">
                <button onClick={() => setDeletingId(null)} className="flex-1 py-3 text-xs font-black text-gray-400 bg-gray-100 rounded-xl">NÃO</button>
                <button onClick={() => deleteMutation.mutate(deletingId)} className="flex-1 py-3 text-xs font-black text-white bg-red-500 rounded-xl">SIM</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxImage && (
        <div className="fixed inset-0 bg-black/95 z-[200] flex items-center justify-center p-2" onClick={() => setLightboxImage(null)}>
          <img src={lightboxImage} className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}

      {/* Seletor de Mídia Centralizado */}
      <MediaPicker 
        isOpen={showMediaOptions} 
        onClose={() => setShowMediaOptions(false)} 
        onSelect={handleFilesSelected} 
      />
    </Layout>
  );
};

export default ChatPage;