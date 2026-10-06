import { useState } from 'react';
import { 
  Plus, Edit, Trash2, User, 
  Briefcase, DollarSign, Phone, Search, X, Check 
} from 'lucide-react';
import Layout from '../components/Layout';
import toast from 'react-hot-toast';
import {
  listarFuncionarios,
  criarFuncionario,
  atualizarFuncionario,
  deletarFuncionario,
  type Funcionario,
} from '../services/funcionarios';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';


const FuncionariosPage = () => {
  const queryClient = useQueryClient();
  const { data: funcionarios = [], isLoading: loading } = useQuery<Funcionario[]>({
    queryKey: ['funcionarios'],
    queryFn: listarFuncionarios
  });
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFunc, setEditingFunc] = useState<Funcionario | null>(null);
  
  const [form, setForm] = useState({
    nome: '',
    cargo: '',
    salario_hora: '',
    contato: ''
  });

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) => {
      const payload = {
        nome: data.nome,
        cargo: data.cargo,
        salario_hora: Number(data.salario_hora),
        contato: data.contato,
      };
      return editingFunc
        ? atualizarFuncionario(editingFunc.id_funcionario, payload)
        : criarFuncionario(payload);
    },
    // O Flask devolvia o registro salvo e a tela recebia o id real do banco. Com
    // o insert otimista o id era Date.now(), que colidiria com o próximo
    // employee criado — então agora a mutação espera o insert e usa o id real.
    onSuccess: () => {
      setIsModalOpen(false);
      setEditingFunc(null);
      setForm({ nome: '', cargo: '', salario_hora: '', contato: '' });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Erro ao salvar funcionário.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['funcionarios'] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletarFuncionario(id),
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ['funcionarios'] });
      const previous = queryClient.getQueryData<Funcionario[]>(['funcionarios']);

      queryClient.setQueryData<Funcionario[]>(['funcionarios'], (old) =>
        old?.filter((f) => f.id_funcionario !== id) ?? old
      );

      return { previous };
    },
    onError: (err: Error, _id, context: { previous: Funcionario[] | undefined } | undefined) => {
      queryClient.setQueryData(['funcionarios'], context?.previous);
      toast.error(err.message || "Erro ao excluir.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['funcionarios'] });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  const handleDelete = (id: number) => {
    toast((t) => (
      <div className="flex flex-col gap-3">
        <span className="font-bold">Excluir este funcionário?</span>
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

  const openEdit = (func: Funcionario) => {
    setEditingFunc(func);
    setForm({ 
      nome: func.nome, 
      cargo: func.cargo ?? '', 
      salario_hora: func.salario_hora.toString(), 
      contato: func.contato ?? '' 
    });
    setIsModalOpen(true);
  };

  return (
    <Layout title="Equipe" showBackButton={true}>
      <div className="bg-[#f0f2f5] min-h-full pb-24">
        
        {/* Header Section */}
        <div className="bg-white p-6 border-b border-gray-100 shadow-sm mb-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-2xl font-black text-gray-900">Gerenciar Equipe</h2>
            <button 
              onClick={() => {
                setEditingFunc(null);
                setForm({ nome: '', cargo: '', salario_hora: '', contato: '' });
                setIsModalOpen(true);
              }}
              className="p-3 bg-whatsapp-teal text-white rounded-2xl shadow-xl shadow-whatsapp-teal/20 active:scale-90 transition-all"
            >
              <Plus size={24} />
            </button>
          </div>
          <p className="text-sm text-gray-400 font-medium">Cadastre e gerencie os trabalhadores da sua lavoura.</p>
        </div>

        {/* Search Bar */}
        <div className="px-4 mb-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="text" 
              placeholder="Buscar por nome ou cargo..."
              className="w-full pl-12 pr-4 py-4 bg-white border-none rounded-2xl shadow-sm outline-none focus:ring-2 focus:ring-whatsapp-teal transition-all text-gray-700 font-medium"
            />
          </div>
        </div>

        {/* List Section */}
        <div className="px-4 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-10 h-10 border-4 border-whatsapp-teal border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-400 font-bold animate-pulse">Carregando equipe...</p>
            </div>
          ) : funcionarios.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center shadow-sm">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <User size={40} className="text-gray-200" />
              </div>
              <h3 className="text-lg font-black text-gray-900 mb-2">Nenhum funcionário</h3>
              <p className="text-gray-400 text-sm mb-6">Comece adicionando seu primeiro trabalhador.</p>
              <button 
                onClick={() => setIsModalOpen(true)}
                className="px-8 py-3 bg-gray-50 text-whatsapp-teal font-black rounded-xl hover:bg-whatsapp-teal hover:text-white transition-all"
              >
                Adicionar Agora
              </button>
            </div>
          ) : (
            funcionarios.map(func => (
              <div key={func.id_funcionario} className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-50 group hover:shadow-md transition-all animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-start justify-between">
                  <div className="flex gap-4">
                    <div className="w-16 h-16 bg-whatsapp-teal/5 text-whatsapp-teal rounded-2xl flex items-center justify-center shadow-inner">
                      <User size={32} />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-gray-900 leading-tight">{func.nome}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <Briefcase size={14} className="text-gray-300" />
                        <span className="text-sm font-bold text-gray-400">{func.cargo}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                    <button 
                      onClick={() => openEdit(func)}
                      className="p-3 text-gray-400 hover:text-whatsapp-teal hover:bg-whatsapp-teal/5 rounded-2xl transition-all"
                    >
                      <Edit size={20} />
                    </button>
                    <button 
                      onClick={() => handleDelete(func.id_funcionario)}
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
                      <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">Valor/Hora</p>
                      <p className="font-bold text-gray-700">R$ {func.salario_hora.toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                      <Phone size={18} />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">Contato</p>
                      <p className="font-bold text-gray-700">{func.contato || 'N/A'}</p>
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
                <h3 className="text-xl font-black">{editingFunc ? 'Editar Funcionário' : 'Novo Funcionário'}</h3>
                <button onClick={() => setIsModalOpen(false)} className="active:scale-90 transition-all">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-8 space-y-6">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">Nome Completo</label>
                  <div className="relative">
                    <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input 
                      type="text" 
                      required
                      value={form.nome}
                      onChange={e => setForm({...form, nome: e.target.value})}
                      placeholder="Ex: João da Silva"
                      className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-gray-800 outline-none focus:ring-2 focus:ring-whatsapp-teal transition-all font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">Cargo / Função</label>
                  <div className="relative">
                    <Briefcase size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input 
                      type="text" 
                      required
                      value={form.cargo}
                      onChange={e => setForm({...form, cargo: e.target.value})}
                      placeholder="Ex: Safrista, Tratorista..."
                      className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-gray-800 outline-none focus:ring-2 focus:ring-whatsapp-teal transition-all font-medium"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">Salário/Hora</label>
                    <div className="relative">
                      <DollarSign size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input 
                        type="number" 
                        step="0.01"
                        required
                        value={form.salario_hora}
                        onChange={e => setForm({...form, salario_hora: e.target.value})}
                        placeholder="0.00"
                        className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-gray-800 outline-none focus:ring-2 focus:ring-whatsapp-teal transition-all font-medium"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">Contato</label>
                    <div className="relative">
                      <Phone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input 
                        type="text" 
                        value={form.contato}
                        onChange={e => setForm({...form, contato: e.target.value})}
                        placeholder="(00) 00000..."
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
                    {editingFunc ? 'Salvar Alterações' : 'Cadastrar'}
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

export default FuncionariosPage;
