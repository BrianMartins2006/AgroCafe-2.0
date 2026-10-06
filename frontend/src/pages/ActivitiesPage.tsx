import { useNavigate } from 'react-router-dom';
import { User, MessageSquare } from 'lucide-react';
import Layout from '../components/Layout';
import { api } from '../services/api';
import { getMediaUrl } from '../utils/media';
import { useQuery } from '@tanstack/react-query';

interface TipoAtividade {
  id: number;
  nome: string;
  icone: string;
  cor: string;
}

interface Atividade {
  id: number;
  id_lavoura: number;
  tipo: TipoAtividade;
  data: string;
  descricao: string;
  responsavel: string;
  imagens: { id: number; foto_url: string }[];
}

const ActivitiesPage = () => {
  const navigate = useNavigate();

  const { data, isLoading: loading } = useQuery({
    queryKey: ['feed'],
    queryFn: () => api.get('/api/v1/feed').then(res => res.json())
  });
  const atividades: Atividade[] = Array.isArray(data) ? data : [];

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <Layout title="Todas as Atividades" showTabs={true}>
      <div className="bg-[#f0f2f5] min-h-full pb-20">
        <div className="bg-whatsapp-teal text-white p-4 text-xs font-bold uppercase tracking-widest text-center shadow-inner">
          Linha do Tempo Global
        </div>

        {loading ? (
          <div className="p-10 text-center text-gray-500 italic">Carregando atividades...</div>
        ) : atividades.length === 0 ? (
          <div className="p-10 text-center text-gray-500 italic">Nenhuma atividade registrada ainda.</div>
        ) : (
          <div className="p-4 space-y-4">
            {atividades.map((atv) => (
              <div 
                key={atv.id} 
                onClick={() => navigate(`/chat/${atv.id_lavoura}`)}
                className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition-all cursor-pointer active:scale-[0.98]"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full text-white ${atv.tipo.cor}`}>
                    {atv.tipo.nome}
                  </div>
                  <span className="text-[10px] text-gray-400 font-bold">{formatDate(atv.data)}</span>
                </div>

                <p className="text-sm text-gray-800 leading-relaxed line-clamp-3 mb-3">
                  {atv.descricao}
                </p>

                {atv.imagens.length > 0 && (
                  <div className="flex gap-1 overflow-x-auto no-scrollbar mb-3">
                    {atv.imagens.map((img) => (
                      <img 
                        key={img.id} 
                        src={getMediaUrl(img.foto_url)} 
                        className="w-20 h-20 object-cover rounded-lg border border-gray-50 shrink-0" 
                      />
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between pt-3 border-t border-gray-50">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <User size={12} />
                    <span className="font-medium">{atv.responsavel}</span>
                  </div>
                  <div className="flex items-center gap-1 text-whatsapp-teal text-xs font-bold">
                    <MessageSquare size={12} />
                    Ver no Chat
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default ActivitiesPage;
