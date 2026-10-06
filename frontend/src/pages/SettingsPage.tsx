import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, Truck, ChevronRight, Plus,
  LayoutGrid, Trash2, Edit, X, Check,
  Sprout, Wind, Zap, Droplets, Sun, Hammer,
  Download, CalendarDays
} from 'lucide-react';
import Layout from '../components/Layout';
import toast from 'react-hot-toast';
import { buscarPerfil, type UserProfile } from '../services/perfil';
import {
  listarTiposAtividade,
  criarTipoAtividade,
  atualizarTipoAtividade,
  deletarTipoAtividade,
  type TipoAtividade,
} from '../services/catalogo';
import { LogOut, User as UserIcon } from 'lucide-react';
import { getMediaUrl } from '../utils/media';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';



const COLORS = [
  { name: 'Verde', value: 'bg-whatsapp-green' },
  { name: 'Teal', value: 'bg-whatsapp-teal' },
  { name: 'Laranja', value: 'bg-orange-500' },
  { name: 'Azul', value: 'bg-blue-500' },
  { name: 'Roxo', value: 'bg-purple-500' },
  { name: 'Vermelho', value: 'bg-red-500' },
];

const ICONS_MAP: any = {
  'Sprout': Sprout,
  'Truck': Truck,
  'Wind': Wind,
  'Zap': Zap,
  'Droplets': Droplets,
  'Sun': Sun,
  'Hammer': Hammer,
  'Default': LayoutGrid
};

const SettingsPage = () => {
  const navigate = useNavigate();
  const { sair } = useAuth();
  const queryClient = useQueryClient();

  const { data: profile, isLoading: loadProfile } = useQuery<UserProfile>({
    queryKey: ['perfil'],
    queryFn: buscarPerfil
  });

  const { data: tipos = [], isLoading: loadTipos } = useQuery<TipoAtividade[]>({
    queryKey: ['tipos-atividade'],
    queryFn: listarTiposAtividade
  });

  const loading = loadProfile || loadTipos;
  
  const [showModal, setShowModal] = useState(false);
  const [editingTipo, setEditingTipo] = useState<TipoAtividade | null>(null);
  const [form, setForm] = useState({ nome: '', icone: 'Sprout', cor: 'bg-whatsapp-green' });
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  
  // PWA Install Prompt
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    });
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setDeferredPrompt(null);
    } else {
      toast((t) => (
        <div className="text-xs">
          <p className="font-bold mb-2">Instalação Manual:</p>
          <p>• <b>iPhone:</b> Clique no ícone de "Compartilhar" e depois em "Adicionar à Tela de Início".</p>
          <p className="mt-2">• <b>Android:</b> Clique nos 3 pontinhos do menu e selecione "Instalar Aplicativo".</p>
          <button onClick={() => toast.dismiss(t.id)} className="mt-2 bg-whatsapp-teal text-white px-2 py-1 rounded">Ok</button>
        </div>
      ), { duration: 4000 });
    }
  };

  const handleLogout = async () => {
    if (window.confirm("Deseja realmente sair da sua conta?")) {
      try {
        await sair();
      } catch (err) {
        console.error("Erro ao sair:", err);
      }
      navigate('/login', { replace: true });
    }
  };

  const handleOpenModal = (tipo?: TipoAtividade) => {
    if (tipo) {
      setEditingTipo(tipo);
      setForm({ nome: tipo.nome, icone: tipo.icone, cor: tipo.cor });
    } else {
      setEditingTipo(null);
      setForm({ nome: '', icone: 'Sprout', cor: 'bg-whatsapp-green' });
    }
    setShowModal(true);
  };

  const saveMutation = useMutation({
    // Escrita liberada em 20261005120600_tipo_atividade_escrita.sql. A proteção
    // que importa continua no banco: categoria em uso não pode ser apagada
    // (FK on delete restrict), e o serviço traduz o 23503 para português.
    mutationFn: (data: typeof form) => {
      const payload = { nome: data.nome, icone: data.icone, cor: data.cor };
      return editingTipo
        ? atualizarTipoAtividade(editingTipo.id, payload)
        : criarTipoAtividade(payload);
    },
    onMutate: async (data: any) => {
      await queryClient.cancelQueries({ queryKey: ['tipos-atividade'] });
      const previous = queryClient.getQueryData(['tipos-atividade']);

      // Otimista só na edição: na criação o id é gerado pelo banco, e um
      // Date.now() provisório colidiria com o próximo insert (mesmo problema que
      // foi corrigido em funcionarios.ts e maquinarios.ts).
      if (editingTipo) {
        const otimista = { ...editingTipo, ...data };
        queryClient.setQueryData(['tipos-atividade'], (old: any) =>
          old?.map((t: any) => (t.id === editingTipo.id ? otimista : t)) ?? old
        );
      }

      return { previous };
    },
    onSuccess: () => {
      setShowModal(false);
      setEditingTipo(null);
      setForm({ nome: '', icone: 'Sprout', cor: 'bg-whatsapp-green' });
    },
    onError: (err: Error, _data, context: any) => {
      queryClient.setQueryData(['tipos-atividade'], context?.previous);
      toast.error(err.message || 'Erro ao salvar categoria.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tipos-atividade'] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletarTipoAtividade(id),
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ['tipos-atividade'] });
      const previous = queryClient.getQueryData(['tipos-atividade']);

      queryClient.setQueryData(['tipos-atividade'], (old: any) => {
        if (!old) return old;
        return old.filter((t: any) => t.id !== id);
      });

      return { previous };
    },
    onError: (err: Error, _id, context: any) => {
      queryClient.setQueryData(['tipos-atividade'], context?.previous);
      toast.error(err.message || 'Erro ao excluir categoria.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tipos-atividade'] });
    }
  });

  const handleSave = () => {
    if (!form.nome.trim()) return;
    saveMutation.mutate(form);
  };

  const handleDelete = (id: number) => {
    toast((t) => (
      <div className="flex flex-col gap-3">
        <span className="font-bold">Excluir esta categoria?</span>
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
    ), { duration: 4000 });
  };

  // Função para renderizar o ícone correto
  const renderIcon = (iconName: string, size = 20) => {
    const IconComponent = ICONS_MAP[iconName] || ICONS_MAP['Default'];
    return <IconComponent size={size} />;
  };

  return (
    <Layout title="Configurações">
      <div className="p-4 space-y-6 pb-24">
        {/* Profile Card */}
        <div 
          onClick={() => navigate('/perfil')}
          className="bg-white p-6 rounded-[2rem] shadow-sm flex items-center gap-4 cursor-pointer hover:bg-gray-50 transition-all border border-gray-50 group"
        >
          <div 
            onClick={(e) => {
              e.stopPropagation();
              profile?.foto_url && setLightboxImage(getMediaUrl(profile.foto_url));
            }}
            className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center overflow-hidden border-2 border-white shadow-md active:scale-90 transition-all cursor-pointer"
          >
            {profile?.foto_url ? (
              <img src={getMediaUrl(profile.foto_url)} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <UserIcon size={32} className="text-gray-300" />
            )}
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-black text-gray-900 group-hover:text-whatsapp-teal transition-colors">
              {profile?.nome || 'Carregando...'}
            </h2>
            <p className="text-xs text-gray-400 font-medium truncate max-w-[180px]">{profile?.email}</p>
          </div>
          <ChevronRight size={20} className="text-gray-300 group-hover:text-whatsapp-teal transition-colors" />
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 gap-4">
          <div onClick={() => navigate('/funcionarios')} className="bg-white p-8 rounded-[2.5rem] shadow-sm flex flex-col items-center gap-3 border border-gray-50 active:scale-95 transition-all">
            <div className="w-14 h-14 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center shadow-inner"><Users size={28} /></div>
            <span className="text-sm font-black text-gray-700">Equipe</span>
          </div>
          <div onClick={() => navigate('/maquinarios')} className="bg-white p-8 rounded-[2.5rem] shadow-sm flex flex-col items-center gap-3 border border-gray-50 active:scale-95 transition-all">
            <div className="w-14 h-14 bg-orange-50 text-orange-500 rounded-2xl flex items-center justify-center shadow-inner"><Truck size={28} /></div>
            <span className="text-sm font-black text-gray-700">Frota</span>
          </div>
        </div>
        
        {/* Períodos fica em linha cheia, e não como terceiro card do grid de dois:
            um tile órfão metade vazia ficava torto, e a tela de períodos é o
            destino de quem já passou pela equipe, não um atalho do mesmo peso. */}
        <button
          onClick={() => navigate('/periodos')}
          className="w-full flex items-center gap-4 p-5 bg-white rounded-[2.5rem] shadow-sm border border-gray-50 active:scale-[0.98] transition-all text-left"
        >
          <div className="w-12 h-12 bg-whatsapp-teal/10 text-whatsapp-teal rounded-2xl flex items-center justify-center shrink-0">
            <CalendarDays size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-gray-800">Períodos de Trabalho</p>
            <p className="text-xs text-gray-400 font-medium truncate">
              Valor por dia e total por funcionário
            </p>
          </div>
          <ChevronRight size={20} className="text-gray-300" />
        </button>

        {/* Instalação do PWA — fica ao lado do perfil, que é onde se espera
            encontrar "instalar o app". Antes era uma seção "App & Performance"
            com limpeza de cache e uma dica de velocidade que não é mais
            verdadeira: o Supabase pago não hiberna. */}
        <button
          onClick={handleInstall}
          className="w-full flex items-center gap-4 p-5 bg-whatsapp-teal rounded-[2.5rem] shadow-lg shadow-whatsapp-teal/20 active:scale-[0.98] transition-all text-left"
        >
          <div className="w-12 h-12 bg-white/20 text-white rounded-2xl flex items-center justify-center shrink-0">
            <Download size={24} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-black text-white">Instalar Aplicativo</p>
            <p className="text-[11px] text-white/80 font-medium">Tenha o AgroCafé na sua tela de início</p>
          </div>
          <ChevronRight size={20} className="text-white/60 shrink-0" />
        </button>

        {/* Categories List */}
        <div className="bg-white rounded-[2.5rem] p-6 shadow-sm border border-gray-50">
          <div className="flex justify-between items-center mb-6 px-2">
            <div>
              <h3 className="text-lg font-black text-gray-900">Categorias</h3>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Configurações do Chat</p>
            </div>
            <button 
              onClick={() => handleOpenModal()}
              className="bg-whatsapp-green text-white p-3 rounded-2xl shadow-lg shadow-whatsapp-green/20 active:scale-90 transition-all"
            >
              <Plus size={24} />
            </button>
          </div>

          <div className="space-y-3">
            {loading ? (
              <div className="text-center py-8"><div className="w-8 h-8 border-4 border-whatsapp-teal border-t-transparent rounded-full animate-spin mx-auto"></div></div>
            ) : tipos.map(t => (
              <div key={t.id} className="flex items-center gap-4 p-4 bg-gray-50/50 rounded-3xl border border-gray-50 group hover:bg-white hover:shadow-md transition-all">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg ${t.cor}`}>
                  {renderIcon(t.icone)}
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-black text-gray-800">{t.nome}</h4>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handleOpenModal(t)} className="p-2 text-gray-300 hover:text-whatsapp-teal transition-colors"><Edit size={16} /></button>
                  <button onClick={() => handleDelete(t.id)} className="p-2 text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Logout Section */}
        <div className="px-2 pb-10">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-3 p-5 bg-red-50 text-red-600 rounded-[2rem] font-black hover:bg-red-100 transition-all active:scale-95 border border-red-100"
          >
            <LogOut size={24} />
            SAIR DA CONTA
          </button>
          <p className="text-center text-[9px] text-gray-300 mt-6 font-black uppercase tracking-widest">AgroCafé v2.0 • Protegido por Antigravity</p>
        </div>
      </div>

      {/* MODAL: ADD/EDIT CATEGORY */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col">
            <div className="bg-whatsapp-teal p-6 text-white flex justify-between items-center">
              <div>
                <h3 className="text-xl font-black">{editingTipo ? 'Editar Categoria' : 'Nova Categoria'}</h3>
                <p className="text-[10px] text-white/70 font-bold uppercase tracking-widest mt-1">Configuração de Registro</p>
              </div>
              <button onClick={() => setShowModal(false)} className="bg-white/10 p-2 rounded-full hover:bg-white/20 transition-all"><X size={20} /></button>
            </div>

            <div className="p-8 space-y-6">
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">Nome da Categoria</label>
                <input 
                  type="text"
                  value={form.nome}
                  onChange={e => setForm({...form, nome: e.target.value})}
                  placeholder="Ex: Pulverização, Colheita..."
                  className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-whatsapp-teal outline-none transition-all"
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 block ml-2">Cor de Destaque</label>
                <div className="grid grid-cols-6 gap-2">
                  {COLORS.map(c => (
                    <button
                      key={c.value}
                      onClick={() => setForm({...form, cor: c.value})}
                      className={`w-10 h-10 rounded-xl transition-all ${c.value} ${form.cor === c.value ? 'ring-4 ring-gray-100 scale-110' : 'opacity-60 hover:opacity-100'}`}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 block ml-2">Ícone Visual</label>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(ICONS_MAP).filter(k => k !== 'Default').map(i => (
                    <button
                      key={i}
                      onClick={() => setForm({...form, icone: i})}
                      className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all flex items-center gap-2 ${form.icone === i ? 'bg-whatsapp-teal text-white border-whatsapp-teal' : 'bg-white text-gray-400 border-gray-100 hover:border-gray-200'}`}
                    >
                      {renderIcon(i, 14)}
                      {i}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-8 bg-gray-50/50 flex gap-4 border-t border-gray-100">
              <button onClick={() => setShowModal(false)} className="flex-1 py-4 text-xs font-black text-gray-400 hover:bg-gray-100 rounded-2xl transition-all">CANCELAR</button>
              <button 
                onClick={handleSave}
                disabled={!form.nome.trim()}
                className="flex-[2] py-4 bg-whatsapp-teal text-white font-black rounded-2xl shadow-xl shadow-whatsapp-teal/20 hover:bg-whatsapp-teal-dark active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Check size={18} /> SALVAR
              </button>
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
              <span className="font-bold">{profile?.nome}</span>
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

export default SettingsPage;
