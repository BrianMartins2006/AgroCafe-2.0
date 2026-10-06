import { useState } from 'react';
import { 
  Plus, Edit, Trash2, Truck, 
  Settings, DollarSign, Zap, X, Check 
} from 'lucide-react';
import Layout from '../components/Layout';
import toast from 'react-hot-toast';
import {
  listarMaquinarios,
  criarMaquinario,
  atualizarMaquinario,
  deletarMaquinario,
  type Maquinario,
} from '../services/maquinarios';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';

const MaquinariosPage = () => {
  const queryClient = useQueryClient();
  const { data: maquinarios = [], isLoading: loading } = useQuery<Maquinario[]>({
    queryKey: ['maquinarios'],
    queryFn: listarMaquinarios
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMaq, setEditingMaq] = useState<Maquinario | null>(null);
  
  const [form, setForm] = useState({
    tipo: '',
    modelo: '',
    valor_hora: '',
    consumo_medio: ''
  });

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) => {
      const payload = {
        tipo: data.tipo,
        modelo: data.modelo,
        valor_hora: Number(data.valor_hora),
        consumo_medio: Number(data.consumo_medio),
      };
      return editingMaq
        ? atualizarMaquinario(editingMaq.id_maquina, payload)
        : criarMaquinario(payload);
    },
    onSuccess: () => {
      setIsModalOpen(false);
      setEditingMaq(null);
      setForm({ tipo: '', modelo: '', valor_hora: '', consumo_medio: '' });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Erro ao salvar máquina.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['maquinarios'] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletarMaquinario(id),
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ['maquinarios'] });
      const previous = queryClient.getQueryData<Maquinario[]>(['maquinarios']);

      queryClient.setQueryData<Maquinario[]>(['maquinarios'], (old) =>
        old?.filter((m) => m.id_maquina !== id) ?? old
      );

      return { previous };
    },
    onError: (err: Error, _id, context: { previous: Maquinario[] | undefined } | undefined) => {
      queryClient.setQueryData(['maquinarios'], context?.previous);
      toast.error(err.message || "Erro ao excluir.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['maquinarios'] });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  const handleDelete = (id: number) => {
    toast((t) => (
      <div className="flex flex-col gap-3">
        <span className="font-bold">Excluir este maquinário?</span>
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

  const openEdit = (maq: Maquinario) => {
    setEditingMaq(maq);
    setForm({ 
      tipo: maq.tipo ?? '', 
      modelo: maq.modelo ?? '', 
      valor_hora: maq.valor_hora.toString(), 
      consumo_medio: maq.consumo_medio.toString() 
    });
    setIsModalOpen(true);
  };

  return (
    <Layout title="Frota" showBackButton={true}>
      <div className="bg-[#f0f2f5] min-h-full pb-24">
        
        {/* Header Section */}
        <div className="bg-white p-6 border-b border-gray-100 shadow-sm mb-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-2xl font-black text-gray-900">Gestão de Maquinário</h2>
            <button 
              onClick={() => {
                setEditingMaq(null);
                setForm({ tipo: '', modelo: '', valor_hora: '', consumo_medio: '' });
                setIsModalOpen(true);
              }}
              className="p-3 bg-whatsapp-teal text-white rounded-2xl shadow-xl shadow-whatsapp-teal/20 active:scale-90 transition-all"
            >
              <Plus size={24} />
            </button>
          </div>
          <p className="text-sm text-gray-400 font-medium">Controle sua frota de tratores, colheitadeiras e equipamentos.</p>
        </div>

        {/* List Section */}
        <div className="px-4 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-10 h-10 border-4 border-whatsapp-teal border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-400 font-bold animate-pulse">Carregando frota...</p>
            </div>
          ) : maquinarios.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center shadow-sm">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <Truck size={40} className="text-gray-200" />
              </div>
              <h3 className="text-lg font-black text-gray-900 mb-2">Frota vazia</h3>
              <p className="text-gray-400 text-sm mb-6">Você ainda não cadastrou nenhum maquinário.</p>
              <button 
                onClick={() => setIsModalOpen(true)}
                className="px-8 py-3 bg-gray-50 text-whatsapp-teal font-black rounded-xl hover:bg-whatsapp-teal hover:text-white transition-all"
              >
                Cadastrar Máquina
              </button>
            </div>
          ) : (
            maquinarios.map(maq => (
              <div key={maq.id_maquina} className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-50 group hover:shadow-md transition-all animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-start justify-between">
                  <div className="flex gap-4">
                    <div className="w-16 h-16 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center shadow-inner">
                      <Truck size={32} />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-gray-900 leading-tight">{maq.tipo}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <Settings size={14} className="text-gray-300" />
                        <span className="text-sm font-bold text-gray-400">{maq.modelo}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                    <button 
                      onClick={() => openEdit(maq)}
                      className="p-3 text-gray-400 hover:text-whatsapp-teal hover:bg-whatsapp-teal/5 rounded-2xl transition-all"
                    >
                      <Edit size={20} />
                    </button>
                    <button 
                      onClick={() => handleDelete(maq.id_maquina)}
                      className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-50 text-green-600 rounded-xl flex items-center justify-center">
                      <DollarSign size={18} />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">Custo/Hora</p>
                      <p className="font-bold text-gray-700">R$ {maq.valor_hora.toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-yellow-50 text-yellow-600 rounded-xl flex items-center justify-center">
                      <Zap size={18} />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">Consumo</p>
                      <p className="font-bold text-gray-700">{maq.consumo_medio} L/h</p>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Overlay */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-sm rounded-[2.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="bg-whatsapp-teal p-6 text-white flex justify-between items-center">
                <h3 className="text-xl font-black">{editingMaq ? 'Editar Máquina' : 'Nova Máquina'}</h3>
                <button onClick={() => setIsModalOpen(false)} className="active:scale-90 transition-all">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-8 space-y-6">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">Tipo de Máquina</label>
                  <div className="relative">
                    <Truck size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input 
                      type="text" 
                      required
                      value={form.tipo}
                      onChange={e => setForm({...form, tipo: e.target.value})}
                      placeholder="Ex: Trator, Colheitadeira..."
                      className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-gray-800 outline-none focus:ring-2 focus:ring-whatsapp-teal transition-all font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">Modelo / Marca</label>
                  <div className="relative">
                    <Settings size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input 
                      type="text" 
                      required
                      value={form.modelo}
                      onChange={e => setForm({...form, modelo: e.target.value})}
                      placeholder="Ex: John Deere 6125J"
                      className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-gray-800 outline-none focus:ring-2 focus:ring-whatsapp-teal transition-all font-medium"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">Valor/Hora (R$)</label>
                    <div className="relative">
                      <DollarSign size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input 
                        type="number" 
                        step="0.01"
                        required
                        value={form.valor_hora}
                        onChange={e => setForm({...form, valor_hora: e.target.value})}
                        placeholder="0.00"
                        className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-gray-800 outline-none focus:ring-2 focus:ring-whatsapp-teal transition-all font-medium"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">Consumo (L/h)</label>
                    <div className="relative">
                      <Zap size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input 
                        type="number" 
                        step="0.1"
                        required
                        value={form.consumo_medio}
                        onChange={e => setForm({...form, consumo_medio: e.target.value})}
                        placeholder="0.0"
                        className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-gray-800 outline-none focus:ring-2 focus:ring-whatsapp-teal transition-all font-medium"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-4 text-gray-400 font-black hover:bg-gray-50 rounded-2xl transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-2 py-4 bg-whatsapp-teal text-white font-black rounded-2xl shadow-xl shadow-whatsapp-teal/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                    <Check size={20} />
                    {editingMaq ? 'Salvar Alterações' : 'Cadastrar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </Layout>
  );
};

export default MaquinariosPage;
