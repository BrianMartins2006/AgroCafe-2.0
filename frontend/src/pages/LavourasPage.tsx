import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Sprout, MessageSquarePlus, Settings, Search, Trash, Pin, PinOff, X } from 'lucide-react';
import Layout from '../components/Layout';
import Skeleton from '../components/Skeleton';
import {
  listarLavouras,
  deletarLavoura,
  alternarPin,
  type Lavoura,
} from '../services/lavouras';
import { getMediaUrl } from '../utils/media';


// Icone customizado para garantir compatibilidade
const MoreVertical = ({ size, className }: { size: number; className?: string }) => (
  <svg 
    width={size} height={size} viewBox="0 0 24 24" fill="none" 
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" 
    strokeLinejoin="round" className={className}
  >
    <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
  </svg>
);



const LavourasPage = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [selectedLavoura, setSelectedLavoura] = useState<Lavoura | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Busca de dados com React Query (Persistence habilitada no App.tsx)
  const { data: lavouras = [], isLoading, isFetching } = useQuery<Lavoura[]>({
    queryKey: ['lavouras'],
    queryFn: listarLavouras,
  });

  // Mutação para Deletar
  const deleteMutation = useMutation({
    mutationFn: deletarLavoura,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lavouras'] });
      setShowDeleteConfirm(false);
      setSelectedLavoura(null);
    },
  });

  // Mutação para Toggle Pin
  const pinMutation = useMutation({
    mutationFn: ({ id, isPinned }: { id: number; isPinned: boolean }) => alternarPin(id, isPinned),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lavouras'] });
      setSelectedLavoura(null);
    },
  });

  // Hook para Long Press (Simplificado)
  const [longPressTimer, setLongPressTimer] = useState<any>(null);

  const startLongPress = (lavoura: Lavoura) => {
    const timer = setTimeout(() => {
      setSelectedLavoura(lavoura);
    }, 600);
    setLongPressTimer(timer);
  };

  const clearLongPress = () => {
    if (longPressTimer) clearTimeout(longPressTimer);
  };

  const handleDelete = () => {
    if (selectedLavoura) deleteMutation.mutate(selectedLavoura.id);
  };

  const handleTogglePin = (e: React.MouseEvent, lavoura: Lavoura) => {
    e.stopPropagation();
    pinMutation.mutate({ id: lavoura.id, isPinned: !lavoura.is_pinned });
  };

  // Lógica de Ordenação Híbrida (Igual ao WhatsApp)
  const sortedLavouras = [...lavouras].sort((a, b) => {
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;

    const dateA = a.ultima_atividade_date ? new Date(a.ultima_atividade_date).getTime() : 0;
    const dateB = b.ultima_atividade_date ? new Date(b.ultima_atividade_date).getTime() : 0;
    
    if (dateA !== dateB) return dateB - dateA;
    return b.id - a.id;
  });

  const filteredLavouras = sortedLavouras.filter(l => 
    l.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
    l.cultura.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Layout 
      showTabs={true} 
      onSearchClick={() => setShowSearch(!showSearch)}
    >
      <div className="bg-white min-h-screen pb-20">
        <div className="bg-whatsapp-teal text-white p-4 text-xs font-bold uppercase tracking-widest text-center shadow-inner relative">
          Meus Talhões de Café
          {isFetching && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 text-[8px] animate-pulse">
              <RefreshCw size={10} className="animate-spin" />
              Sincronizando...
            </div>
          )}
        </div>
        
        {/* Search Bar */}
        {showSearch && (
          <div className="p-3 bg-gray-50 border-b border-gray-100 animate-in slide-in-from-top-2 duration-200">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Pesquisar lavoura ou cultura..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoFocus
                className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-whatsapp-teal transition-all"
              />
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="p-4 space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white p-4 rounded-[2rem] flex gap-4 items-center shadow-sm border border-gray-50">
                <Skeleton className="w-14 h-14 rounded-full" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredLavouras.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            <div className="mb-4 flex justify-center text-gray-300">
              <Sprout size={64} />
            </div>
            <p className="font-bold text-gray-600">
              {searchTerm ? 'Nenhuma lavoura encontrada.' : 'Sua lista está vazia.'}
            </p>
            <p className="text-sm mt-1">Clique no botão verde lateral para começar.</p>
          </div>
        ) : (
          filteredLavouras.map((lavoura) => (
            <div 
              key={lavoura.id}
              onClick={() => navigate(`/chat/${lavoura.id}`)}
              onPointerDown={() => startLongPress(lavoura)}
              onPointerUp={clearLongPress}
              onPointerLeave={clearLongPress}
              className={`group flex items-center p-4 hover:bg-gray-50 cursor-pointer border-b border-gray-100 active:bg-gray-100 transition-all relative ${lavoura.is_pinned ? 'bg-gray-50/50' : 'bg-white'}`}
            >
              <div 
                onClick={(e) => {
                  e.stopPropagation();
                  lavoura.foto_perfil && setLightboxImage(getMediaUrl(lavoura.foto_perfil));
                }}
                className="w-14 h-14 rounded-full overflow-hidden flex-shrink-0 bg-gray-200 shadow-sm active:scale-90 transition-all cursor-pointer"
              >
                  <img 
                    src={getMediaUrl(lavoura.foto_perfil)} 
                    alt={lavoura.nome} 
                    loading="lazy"
                    className="w-full h-full object-cover" 
                  />
              </div>

              {/* Info */}
              <div className="ml-4 flex-1">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-gray-900">{lavoura.nome}</h3>
                    {lavoura.is_pinned && <Pin size={12} className="text-whatsapp-teal fill-whatsapp-teal -rotate-45" />}
                  </div>
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">
                    {lavoura.ultima_atividade_date
                      ? new Date(lavoura.ultima_atividade_date).toLocaleDateString()
                      : lavoura.data_inicio
                        ? new Date(`${lavoura.data_inicio}T12:00:00`).toLocaleDateString()
                        : 'Sem registro'}
                  </span>
                </div>
                <p className="text-sm text-gray-500 truncate mt-0.5 flex items-center gap-1">
                  <Sprout size={14} className="text-whatsapp-green" />
                  {lavoura.cultura}
                </p>
              </div>

              {/* Three Dots Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedLavoura(lavoura);
                }}
                className="ml-2 p-2 rounded-full text-gray-300 hover:text-whatsapp-teal hover:bg-gray-100 transition-all"
              >
                <MoreVertical size={20} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Floating Action Button */}
      <div className="fixed bottom-24 left-1/2 -translate-x-1/2 w-full max-w-md flex justify-end px-6 z-50 pointer-events-none">
        <button 
          onClick={() => navigate('/nova-lavoura')}
          className="w-16 h-16 bg-whatsapp-green text-white rounded-full shadow-2xl flex items-center justify-center transition-all active:scale-90 pointer-events-auto hover:shadow-whatsapp-green/40 hover:-translate-y-1"
        >
          <MessageSquarePlus size={32} />
        </button>
      </div>

      {/* Options Modal */}
      {selectedLavoura && !showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-[100] p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden animate-in slide-in-from-bottom-10 duration-300 shadow-2xl">
            <div className="p-8">
              <div className="flex items-center gap-5 mb-8">
                <img 
                  onClick={() => selectedLavoura.foto_perfil && setLightboxImage(getMediaUrl(selectedLavoura.foto_perfil))}
                  src={getMediaUrl(selectedLavoura.foto_perfil)} 
                  alt="" 
                  className="w-20 h-20 rounded-full object-cover border-4 border-gray-50 shadow-lg cursor-pointer active:scale-95 transition-all" 
                />
                <div>
                  <h3 className="font-black text-2xl text-gray-900 leading-tight">{selectedLavoura.nome}</h3>
                  <p className="text-gray-400 font-bold text-sm flex items-center gap-1 mt-1">
                    <Sprout size={14} className="text-whatsapp-green" />
                    {selectedLavoura.cultura}
                  </p>
                </div>
              </div>
              
              <div className="space-y-4">
                <button 
                  onClick={(e) => handleTogglePin(e, selectedLavoura)}
                  className="w-full flex items-center justify-center gap-3 bg-whatsapp-teal text-white py-4 rounded-2xl font-black shadow-xl shadow-whatsapp-teal/20 active:scale-95 transition-all text-lg"
                >
                  {pinMutation.isPending ? "Processando..." : (selectedLavoura.is_pinned ? (
                    <><PinOff size={24} /> Desafixar Talhão</>
                  ) : (
                    <><Pin size={24} /> Fixar no Topo</>
                  ))}
                </button>
                <button 
                  onClick={() => navigate(`/editar-lavoura/${selectedLavoura.id}`)}
                  className="w-full flex items-center justify-center gap-3 bg-gray-100 text-gray-700 py-4 rounded-2xl font-bold active:scale-95 transition-all"
                >
                  <Settings size={24} /> Editar Talhão
                </button>
                <button 
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full flex items-center justify-center gap-3 bg-red-50 text-red-600 py-4 rounded-2xl font-bold active:scale-95 transition-all"
                >
                  <Trash size={24} /> Excluir Registro
                </button>
                <button 
                  onClick={() => setSelectedLavoura(null)}
                  className="w-full py-4 text-gray-400 font-bold active:scale-95 transition-all uppercase text-xs tracking-widest pt-6"
                >
                  Fechar Menu
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && selectedLavoura && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-[110] p-6 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-10 text-center">
              <div className="w-24 h-24 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner">
                <Trash size={48} />
              </div>
              <h3 className="text-3xl font-black text-gray-900 mb-4">Confirmar?</h3>
              <p className="text-gray-500 mb-10 leading-relaxed font-medium">
                Esta ação apagará **definitivamente** o talhão <span className="font-black text-red-600 underline">{selectedLavoura.nome}</span> e todo o seu histórico.
              </p>
              
              <div className="flex flex-col gap-4">
                <button 
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  className="w-full bg-red-600 text-white py-5 rounded-[1.5rem] font-black shadow-2xl shadow-red-200 active:scale-95 transition-all text-xl disabled:opacity-50"
                >
                  {deleteMutation.isPending ? "APAGANDO..." : "APAGAR TUDO"}
                </button>
                <button 
                  onClick={() => setShowDeleteConfirm(false)}
                  className="w-full py-5 text-gray-400 font-bold active:scale-95 transition-all"
                >
                  Cancelar, manter talhão
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Lightbox Style WhatsApp */}
      {lightboxImage && (
        <div 
          className="fixed inset-0 bg-black z-[200] flex flex-col animate-in fade-in duration-200"
          onClick={() => setLightboxImage(null)}
        >
          <div className="p-4 flex items-center justify-between text-white bg-black/40 backdrop-blur-md absolute top-0 left-0 right-0 z-10">
            <div className="flex items-center gap-3">
              <span className="font-bold">Visualizar Foto</span>
            </div>
            <button onClick={() => setLightboxImage(null)} className="p-2"><X size={24} /></button>
          </div>
          <div className="flex-1 flex items-center justify-center p-2">
            <img 
              src={lightboxImage} 
              alt="" 
              className="max-w-full max-h-[80vh] object-contain shadow-2xl animate-in zoom-in-95 duration-300" 
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </Layout>
  );
};

export default LavourasPage;
