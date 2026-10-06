import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit, Calendar, MapPin, Sprout, Image as ImageIcon, ChevronRight, X } from 'lucide-react';
import { getMediaUrl } from '../utils/media';
import { useQuery } from '@tanstack/react-query';
import { buscarLavoura, type Lavoura } from '../services/lavouras';
import { listarMidiaLavoura, type ImagemLavoura } from '../services/atividades';
import { QUERY } from '../services/atividadesCache';

/**
 * A galeria e a ficha leem de consultas diferentes, mas as duas derivam da
 * atividade. `QUERY.midia` usa number porque `id` vem do useParams como string
 * e o cache trata '2' e 2 como entradas distintas.
 */

const LavouraProfilePage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const { data: lavoura, isLoading: loadingLavoura } = useQuery<Lavoura | null>({
    queryKey: ['lavouras', id],
    queryFn: () => buscarLavoura(Number(id)),
    enabled: !!id
  });

  const { data: media = [], isLoading: loadingMedia } = useQuery<ImagemLavoura[]>({
    queryKey: QUERY.midia(Number(id)),
    queryFn: () => listarMidiaLavoura(Number(id)),
    enabled: !!id
  });

  const loading = loadingLavoura || loadingMedia;

  if (loading && !lavoura) {
    return <div className="h-screen flex items-center justify-center bg-gray-50 text-gray-400 italic">Carregando perfil...</div>;
  }

  return (
    <div className="flex flex-col h-screen bg-[#f0f2f5] max-w-md mx-auto relative overflow-hidden font-sans">
      <div className="flex-1 overflow-y-auto no-scrollbar pb-24">
      {/* Header / Cover */}
      <div className="relative bg-white shadow-sm">
        <div className="absolute top-4 left-4 z-10">
          <button 
            onClick={() => navigate(-1)}
            className="p-2 bg-black/20 backdrop-blur-md text-white rounded-full hover:bg-black/40 transition-all"
          >
            <ArrowLeft size={24} />
          </button>
        </div>
        
        <div className="h-64 sm:h-80 overflow-hidden relative group">
          <img 
            src={getMediaUrl(lavoura?.foto_perfil)} 
            alt={lavoura?.nome}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
          <div className="absolute bottom-6 left-6 right-6 text-white">
            <h1 className="text-3xl font-black mb-1">{lavoura?.nome}</h1>
            <p className="flex items-center gap-2 text-white/80 font-medium">
              <Sprout size={18} /> {lavoura?.cultura}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 space-y-4 max-w-2xl mx-auto w-full">
        
        {/* Info Section */}
        <div className="bg-white rounded-2xl p-6 shadow-sm space-y-6">
          <h2 className="text-sm font-bold text-whatsapp-teal uppercase tracking-widest mb-4">Informações do Talhão</h2>
          
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-green-50 text-green-600 rounded-xl flex items-center justify-center shrink-0">
              <MapPin size={20} />
            </div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase">Localização / Área</p>
              <p className="text-gray-800 font-medium">
                {lavoura?.localizacao || "Não informada"} 
                {lavoura?.area_hectares ? ` - ${lavoura.area_hectares} hectares` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
              <Calendar size={20} />
            </div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase">Data de Início</p>
              <p className="text-gray-800 font-medium">
                {lavoura?.data_inicio 
                  ? new Date(lavoura.data_inicio).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) 
                  : "Não informada"}
              </p>
            </div>
          </div>
        </div>

        {/* Media Gallery Section */}
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-2">
              <ImageIcon size={20} className="text-gray-400" />
              <h2 className="text-sm font-bold text-whatsapp-teal uppercase tracking-widest">Arquivos e Mídia</h2>
            </div>
            <span className="text-xs font-bold text-gray-400">{media.length} itens</span>
          </div>

          {media.length === 0 ? (
            <div className="p-8 text-center border-2 border-dashed border-gray-100 rounded-xl">
              <p className="text-sm text-gray-400 italic">Nenhuma foto enviada neste chat ainda.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {media.map((item) => (
                <div 
                  key={item.id} 
                  onClick={() => setLightboxImage(item.foto_url)}
                  className="aspect-square rounded-lg overflow-hidden border border-gray-50 cursor-pointer hover:opacity-80 transition-opacity relative group"
                >
                  <img 
                    src={getMediaUrl(item.foto_url)} 
                    alt="Mídia" 
                    className="w-full h-full object-cover" 
                  />
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1">
                    <span className="text-[8px] text-white font-bold bg-black/40 backdrop-blur-sm rounded px-1">
                      {new Date(item.data).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activity Summary */}
        <div 
          onClick={() => navigate('/atividades')}
          className="bg-white rounded-2xl p-6 shadow-sm flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center">
              <ImageIcon size={20} />
            </div>
            <div>
              <p className="text-gray-800 font-bold">Relatório de Atividades</p>
              <p className="text-xs text-gray-400">Ver todas as mensagens trocadas</p>
            </div>
          </div>
          <ChevronRight size={20} className="text-gray-300" />
        </div>

        </div>
      </div>
      
      {/* Floating Action Button */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-md flex justify-end px-6 z-50 pointer-events-none">
        <button 
          onClick={() => navigate(`/editar-lavoura/${id}`)}
          className="w-16 h-16 bg-whatsapp-green text-white rounded-full shadow-2xl flex items-center justify-center transition-all pointer-events-auto hover:-translate-y-1 hover:shadow-whatsapp-green/40 hover:shadow-2xl"
        >
          <Edit size={28} />
        </button>
      </div>

      {/* Lightbox Modal */}
      {lightboxImage && (
        <div className="fixed inset-0 bg-black/95 z-[200] flex items-center justify-center animate-in fade-in duration-200 p-2" onClick={() => setLightboxImage(null)}>
          <button className="absolute top-6 right-6 text-white p-2 bg-black/50 rounded-full hover:bg-white/20 transition-all z-[210]"><X size={24} /></button>
          <img src={lightboxImage} className="max-w-full max-h-full object-contain select-none shadow-2xl rounded-lg animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
};

export default LavouraProfilePage;
