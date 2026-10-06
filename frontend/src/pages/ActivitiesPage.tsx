import { useNavigate } from 'react-router-dom';
import { User, MessageSquare } from 'lucide-react';
import Layout from '../components/Layout';
import { getMediaUrl } from '../utils/media';
import { useQuery } from '@tanstack/react-query';
import { listarFeed, type Atividade } from '../services/atividades';
import { QUERY } from '../services/atividadesCache';

const ActivitiesPage = () => {
  const navigate = useNavigate();

  const { data, isLoading: loading } = useQuery<Atividade[]>({
    queryKey: QUERY.feed(),
    queryFn: () => listarFeed()
  });
  const atividades = data ?? [];

  // `tipo` é null no contrato (o FK é NOT NULL no banco, mas a relação pode não
  // resolver). O ChatPage já tratava com `?.` e fallback; aqui o mesmo fallback
  // evita quebrar a lista inteira se uma atividade vier sem tipo.
  const corTipo = (atv: Atividade) => atv.tipo?.cor ?? 'bg-gray-500';
  const nomeTipo = (atv: Atividade) => atv.tipo?.nome ?? 'Geral';

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
                  <div className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full text-white ${corTipo(atv)}`}>
                    {nomeTipo(atv)}
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
