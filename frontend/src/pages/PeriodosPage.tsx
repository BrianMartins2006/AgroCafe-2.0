import { useMemo, useState } from 'react';
import {
  Plus, Edit, Trash2, Search, CalendarDays, DollarSign, Clock, X,
} from 'lucide-react';
import Layout from '../components/Layout';
import toast from 'react-hot-toast';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { listarFuncionarios, type Funcionario } from '../services/funcionarios';
import {
  listarPeriodos,
  criarPeriodo,
  atualizarPeriodo,
  deletarPeriodo,
  type Periodo,
  type PeriodoComFuncionario,
} from '../services/periodos';
import {
  calcularPeriodo, hojeLocal, chaveData, type DataISO,
} from '../services/calculoPeriodo';

/** R$ com 2 casas, sem depender de `toLocaleString` do servidor. */
const brl = (v: number) =>
  `R$ ${v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

const dataBr = (iso: DataISO) => iso.split('-').reverse().join('/');

/** "01/10/2026 a 31/10/2026" ou "01/10/2026 em aberto". */
function rotuloPeriodo(p: { data_inicio: DataISO; data_termino: DataISO | null }) {
  const inicio = dataBr(p.data_inicio);
  return p.data_termino ? `${inicio} a ${dataBr(p.data_termino)}` : `${inicio} em aberto`;
}

const FORM_VAZIO = {
  id_funcionario: '',
  dataInicio: hojeLocal(),
  dataTermino: '',
  valorDia: '',
  diasManuais: '',
  observacao: '',
};

const PeriodosPage = () => {
  const queryClient = useQueryClient();

  const { data: periodos = [], isLoading: loading } = useQuery<PeriodoComFuncionario[]>({
    queryKey: ['periodos'],
    queryFn: listarPeriodos,
  });
  const { data: funcionarios = [] } = useQuery<Funcionario[]>({
    queryKey: ['funcionarios'],
    queryFn: listarFuncionarios,
  });

  const [busca, setBusca] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Periodo | null>(null);
  const [descartados, setDescartados] = useState<DataISO[]>([]);
  const [form, setForm] = useState({ ...FORM_VAZIO });

  // Mesma função usada no save: o que aparece antes de confirmar é o que grava.
  const previa = useMemo(
    () =>
      calcularPeriodo({
        dataInicio: form.dataInicio,
        dataTermino: form.dataTermino || null,
        valorDia: form.valorDia,
        diasDescartados: descartados,
        diasManuais: form.diasManuais ? Number(form.diasManuais) : null,
      }),
    [form.dataInicio, form.dataTermino, form.valorDia, form.diasManuais, descartados],
  );

  const periodoInvalido = !form.dataInicio || !form.id_funcionario || previa.diasEfetivos <= 0;

  const filtrados = useMemo(() => {
    const alvo = busca.trim().toLowerCase();
    if (!alvo) return periodos;
    return periodos.filter(
      (p) =>
        p.funcionario_nome.toLowerCase().includes(alvo) ||
        (p.funcionario_cargo ?? '').toLowerCase().includes(alvo),
    );
  }, [periodos, busca]);

  const totais = useMemo(() => {
    // Soma o valor ao vivo: período em aberto entra no total de hoje.
    const porFuncionario = new Map<string, { nome: string; total: number; aberto: number }>();
    for (const p of periodos) {
      const atual = porFuncionario.get(p.funcionario_nome) ?? { nome: p.funcionario_nome, total: 0, aberto: 0 };
      atual.total += p.aoVivo.valorTotal;
      if (p.aoVivo.emAberto) atual.aberto += 1;
      porFuncionario.set(p.funcionario_nome, atual);
    }
    return {
      geral: [...porFuncionario.values()].reduce((s, f) => s + f.total, 0),
      emAberto: periodos.filter((p) => p.aoVivo.emAberto).length,
      porFuncionario: [...porFuncionario.values()].sort((a, b) => b.total - a.total),
    };
  }, [periodos]);

  const salvarMutation = useMutation({
    mutationFn: () => {
      const payload = {
        id_funcionario: Number(form.id_funcionario),
        dataInicio: form.dataInicio,
        dataTermino: form.dataTermino || null,
        valorDia: form.valorDia,
        diasDescartados: descartados,
        diasManuais: form.diasManuais ? Number(form.diasManuais) : null,
        observacao: form.observacao,
      };
      return editing ? atualizarPeriodo(editing.id, payload) : criarPeriodo(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periodos'] });
      queryClient.invalidateQueries({ queryKey: ['funcionarios'] });
      fecharModal();
      toast.success(editing ? 'Período atualizado.' : 'Período registrado.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletarPeriodo(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periodos'] });
      toast.success('Período excluído.');
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  function fecharModal() {
    setIsModalOpen(false);
    setEditing(null);
    setForm({ ...FORM_VAZIO });
    setDescartados([]);
  }

  function abrirNovo() {
    // Pré-seleciona quando há um único funcionário: evita o clique extra no
    // caso mais comum, que é a equipe de uma pessoa só.
    setEditing(null);
    setForm({ ...FORM_VAZIO, id_funcionario: funcionarios.length === 1 ? String(funcionarios[0].id_funcionario) : '' });
    setDescartados([]);
    setIsModalOpen(true);
  }

  function abrirEdicao(p: Periodo) {
    setEditing(p);
    setForm({
      id_funcionario: String(p.id_funcionario),
      dataInicio: p.data_inicio,
      dataTermino: p.data_termino ?? '',
      valorDia: p.valor_dia.toFixed(2).replace('.', ','),
      // Só reabre o campo de dias digitados quando foi isso que o usuário
      // fez. Deixar vazio e salvar apagaria o lançamento manual, trocando a
      // contagem dele pelo cálculo do calendário.
      diasManuais: p.calculo_manual ? String(p.dias) : '',
      observacao: p.observacao ?? '',
    });
    setDescartados(p.dias_descartados);
    setIsModalOpen(true);
  }

  /** Alterna um dia na lista de não trabalhados. */
  const alternarDescarte = (dia: DataISO) => {
    setDescartados((atuais) =>
      atuais.includes(dia) ? atuais.filter((d) => d !== dia) : [...atuais, dia].sort(),
    );
  };

  const confirmarDelete = (p: PeriodoComFuncionario) => {
    toast((t) => (
      <div>
        <p className="font-bold mb-1">Excluir período?</p>
        <p className="text-xs mb-3">{p.funcionario_nome} — {rotuloPeriodo(p)}</p>
        <button
          onClick={() => { deleteMutation.mutate(p.id); toast.dismiss(t.id); }}
          className="bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs mr-2"
        >
          Sim, excluir
        </button>
        <button onClick={() => toast.dismiss(t.id)} className="bg-gray-100 px-3 py-1.5 rounded-lg text-xs">
          Cancelar
        </button>
      </div>
    ), { duration: 4000 });
  };

  const semFuncionario = funcionarios.length === 0;

  return (
    <Layout title="Períodos" showBackButton={true}>
      <div className="bg-[#f0f2f5] min-h-full pb-24">
        <div className="bg-white p-6 border-b border-gray-100 shadow-sm mb-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-2xl font-black text-gray-900">Períodos de Trabalho</h2>
            <button
              onClick={abrirNovo}
              disabled={semFuncionario}
              className="p-3 bg-whatsapp-teal text-white rounded-2xl shadow-xl shadow-whatsapp-teal/20 active:scale-90 transition-all disabled:opacity-40"
            >
              <Plus size={24} />
            </button>
          </div>
          <p className="text-sm text-gray-400 font-medium">
            Valor por dia, período e total calculado.
          </p>
        </div>

        <div className="px-4 mb-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por funcionário..."
              className="w-full bg-white rounded-2xl py-4 pl-12 pr-4 text-sm font-medium text-gray-700 outline-none shadow-sm border border-gray-50 focus:ring-2 focus:ring-whatsapp-teal/20"
            />
          </div>
        </div>

        {periodos.length > 0 && (
          <div className="px-4 mb-4 grid grid-cols-2 gap-3">
            <div className="bg-whatsapp-teal rounded-3xl p-4 text-white shadow-lg shadow-whatsapp-teal/20">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/70">Total geral</p>
              <p className="text-xl font-black mt-1">{brl(totais.geral)}</p>
            </div>
            <div className="bg-white rounded-3xl p-4 shadow-sm border border-gray-50">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Em aberto</p>
              <p className="text-xl font-black text-gray-900 mt-1">
                {totais.emAberto} <span className="text-sm text-gray-400">período{totais.emAberto === 1 ? '' : 's'}</span>
              </p>
            </div>
          </div>
        )}

        <div className="px-4 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-10 h-10 border-4 border-whatsapp-teal border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-400 font-bold animate-pulse">Carregando períodos...</p>
            </div>
          ) : semFuncionario ? (
            <div className="bg-white rounded-3xl p-12 text-center shadow-sm">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <CalendarDays size={40} className="text-gray-200" />
              </div>
              <h3 className="text-lg font-black text-gray-900 mb-2">Cadastre um funcionário primeiro</h3>
              <p className="text-gray-400 text-sm">
                O período é registrado em cima de alguém da equipe.
              </p>
            </div>
          ) : filtrados.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center shadow-sm">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <CalendarDays size={40} className="text-gray-200" />
              </div>
              <h3 className="text-lg font-black text-gray-900 mb-2">
                {periodos.length === 0 ? 'Nenhum período registrado' : 'Nada encontrado'}
              </h3>
              <p className="text-gray-400 text-sm mb-6">
                {periodos.length === 0
                  ? 'Registre o valor do dia e o período para o total ser calculado.'
                  : 'Tente outro nome.'}
              </p>
              {periodos.length === 0 && (
                <button
                  onClick={abrirNovo}
                  className="px-8 py-3 bg-gray-50 text-whatsapp-teal font-black rounded-xl hover:bg-whatsapp-teal hover:text-white transition-all"
                >
                  Registrar Agora
                </button>
              )}
            </div>
          ) : (
            /* Tabela e não cards: o usuário pediu comparação entre funcionários,
               e numa pilha de cards isso exige abrir um por um. Em tela estreita
               a tabela rola na horizontal em vez de virar cards, para não
               duplicar a markup em dois lugares. */
            <div className="bg-white rounded-3xl shadow-sm border border-gray-50 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left">
                      <th scope="col" className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Funcionário
                      </th>
                      <th scope="col" className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Período
                      </th>
                      <th scope="col" className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Valor/dia
                      </th>
                      <th scope="col" className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Dias
                      </th>
                      <th scope="col" className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Total
                      </th>
                      <th scope="col" className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-gray-400">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtrados.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <span className="font-black text-gray-900 block truncate max-w-[10rem]">
                            {p.funcionario_nome}
                          </span>
                          {p.funcionario_cargo && (
                            <span className="text-[11px] text-gray-400 truncate block max-w-[10rem]">
                              {p.funcionario_cargo}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-gray-600 font-medium whitespace-nowrap">
                            {rotuloPeriodo(p)}
                          </span>
                          <span className="flex flex-wrap gap-1 mt-1">
                            {p.aoVivo.emAberto && (
                              <span className="px-1.5 py-0.5 bg-orange-50 text-orange-600 text-[9px] font-black rounded uppercase tracking-wide">
                                Em aberto
                              </span>
                            )}
                            {p.calculo_manual && (
                              <span className="px-1.5 py-0.5 bg-blue-50 text-blue-500 text-[9px] font-black rounded uppercase tracking-wide">
                                Manual
                              </span>
                            )}
                            {p.aoVivo.diasDescartados > 0 && (
                              <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-[9px] font-black rounded">
                                -{p.aoVivo.diasDescartados} dia(s)
                              </span>
                            )}
                          </span>
                          {p.observacao && (
                            <span className="block text-[11px] text-gray-400 mt-1 max-w-[12rem] truncate">
                              {p.observacao}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600 font-medium whitespace-nowrap">
                          {brl(p.aoVivo.valorDia)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-black text-gray-800">{p.aoVivo.diasEfetivos}</span>
                          <span className="block text-[10px] text-gray-400">
                            {p.aoVivo.diasBrutos} no calendário
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-black text-whatsapp-teal whitespace-nowrap">
                          {brl(p.aoVivo.valorTotal)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => abrirEdicao(p)}
                              className="p-2 text-gray-400 hover:text-whatsapp-teal hover:bg-whatsapp-teal/5 rounded-xl transition-all"
                              aria-label={`Editar período de ${p.funcionario_nome}`}
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => confirmarDelete(p)}
                              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                              aria-label={`Excluir período de ${p.funcionario_nome}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {totais.porFuncionario.length > 1 && (
          <div className="px-4 mt-6">
            <div className="bg-white rounded-[2rem] p-5 shadow-sm border border-gray-50">
              <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider mb-3">Por funcionário</h3>
              <div className="space-y-2">
                {totais.porFuncionario.map((f) => (
                  <div key={f.nome} className="flex items-center justify-between text-sm">
                    <span className="font-bold text-gray-700 truncate">{f.nome}</span>
                    <span className="font-black text-whatsapp-teal">{brl(f.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center animate-in fade-in duration-200">
          <div className="bg-white w-full sm:max-w-lg rounded-t-[2.5rem] sm:rounded-[2.5rem] max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom-4 duration-300">
            <div className="sticky top-0 bg-white p-6 pb-4 flex justify-between items-center border-b border-gray-100 z-10">
              <h3 className="text-xl font-black text-gray-900">
                {editing ? 'Editar Período' : 'Novo Período'}
              </h3>
              <button onClick={fecharModal} className="p-2 text-gray-400 hover:bg-gray-50 rounded-xl" aria-label="Fechar">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 pt-4 space-y-5">
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">
                  Funcionário
                </label>
                <select
                  value={form.id_funcionario}
                  onChange={(e) => setForm({ ...form, id_funcionario: e.target.value })}
                  className="w-full bg-gray-50 rounded-2xl py-3.5 px-4 text-sm font-bold text-gray-700 outline-none border border-gray-100 focus:ring-2 focus:ring-whatsapp-teal/20"
                >
                  <option value="">Selecione...</option>
                  {funcionarios.map((f) => (
                    <option key={f.id_funcionario} value={f.id_funcionario}>
                      {f.nome}{f.cargo ? ` — ${f.cargo}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">
                  Valor do dia (R$)
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.valorDia}
                    onChange={(e) => setForm({ ...form, valorDia: e.target.value })}
                    placeholder="150,00"
                    className="w-full bg-gray-50 rounded-2xl py-3.5 pl-11 pr-4 text-sm font-bold text-gray-700 outline-none border border-gray-100 focus:ring-2 focus:ring-whatsapp-teal/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">
                    Início
                  </label>
                  <input
                    type="date"
                    value={form.dataInicio}
                    onChange={(e) => setForm({ ...form, dataInicio: e.target.value })}
                    className="w-full bg-gray-50 rounded-2xl py-3.5 px-4 text-sm font-bold text-gray-700 outline-none border border-gray-100 focus:ring-2 focus:ring-whatsapp-teal/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">
                    Término
                  </label>
                  <input
                    type="date"
                    value={form.dataTermino}
                    min={form.dataInicio}
                    onChange={(e) => setForm({ ...form, dataTermino: e.target.value })}
                    className="w-full bg-gray-50 rounded-2xl py-3.5 px-4 text-sm font-bold text-gray-700 outline-none border border-gray-100 focus:ring-2 focus:ring-whatsapp-teal/20"
                  />
                </div>
              </div>
              <p className="-mt-2 text-[11px] text-gray-400 font-medium ml-2">
                Sem término: conta até hoje, todos os dias.
              </p>

              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">
                  Dias que não trabalhou
                </label>
                {previa.diasBrutos > 0 ? (
                  <div className="bg-gray-50 rounded-2xl p-3 border border-gray-100">
                    <div className="flex items-center justify-between mb-2 px-1">
                      <span className="text-[11px] font-bold text-gray-500">
                        Toque nos dias para excluir
                      </span>
                      {descartados.length > 0 && (
                        <button
                          onClick={() => setDescartados([])}
                          className="text-[11px] font-black text-whatsapp-teal"
                        >
                          Limpar
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                      {gerarDias(form.dataInicio, previa.dataFim).map((dia) => {
                        const fora = descartados.includes(dia);
                        return (
                          <button
                            key={dia}
                            onClick={() => alternarDescarte(dia)}
                            className={`px-2.5 py-1.5 rounded-xl text-[11px] font-black transition-all ${
                              fora
                                ? 'bg-red-50 text-red-500 line-through'
                                : 'bg-white text-gray-600 border border-gray-100'
                            }`}
                          >
                            {dia.slice(8)}/{dia.slice(5, 7)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400 font-medium">
                    Informe as datas para listar os dias.
                  </p>
                )}
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">
                  Ou informe a quantidade de dias direto
                </label>
                <div className="relative">
                  <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={form.diasManuais}
                    onChange={(e) => setForm({ ...form, diasManuais: e.target.value })}
                    placeholder={String(previa.diasEfetivos || 0)}
                    className="w-full bg-gray-50 rounded-2xl py-3.5 pl-11 pr-4 text-sm font-bold text-gray-700 outline-none border border-gray-100 focus:ring-2 focus:ring-whatsapp-teal/20"
                  />
                </div>
                <p className="text-[11px] text-gray-400 font-medium mt-1 ml-2">
                  Preenchido, ignora as datas e os dias marcados.
                </p>
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">
                  Observação
                </label>
                <input
                  value={form.observacao}
                  onChange={(e) => setForm({ ...form, observacao: e.target.value })}
                  placeholder="Opcional"
                  className="w-full bg-gray-50 rounded-2xl py-3.5 px-4 text-sm font-bold text-gray-700 outline-none border border-gray-100 focus:ring-2 focus:ring-whatsapp-teal/20"
                />
              </div>

              {/* Prévia: o mesmo cálculo que vai para o banco. */}
              <div className="bg-whatsapp-teal/5 rounded-2xl p-4 border border-whatsapp-teal/10">
                <p className="text-[10px] font-black uppercase tracking-widest text-whatsapp-teal/70 mb-2">
                  Total
                </p>
                <p className="text-2xl font-black text-whatsapp-teal">
                  {brl(previa.valorTotal)}
                </p>
                <p className="text-[11px] text-gray-500 font-medium mt-1">
                  {previa.diasEfetivos} dia(s) × {brl(previa.valorDia)}
                  {previa.diasDescartados > 0 && ` · ${previa.diasDescartados} fora do período pago`}
                  {previa.emAberto && ' · em aberto, contando até hoje'}
                </p>
              </div>

              <button
                onClick={() => salvarMutation.mutate()}
                disabled={periodoInvalido || salvarMutation.isPending}
                className="w-full bg-whatsapp-teal text-white py-4 rounded-2xl font-black shadow-xl shadow-whatsapp-teal/20 active:scale-95 transition-all disabled:opacity-40"
              >
                {salvarMutation.isPending ? 'Salvando...' : editing ? 'Salvar Alterações' : 'Registrar Período'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

/** Lista de datas do intervalo, para o seletor de dias não trabalhados. */
function gerarDias(inicio: DataISO, fim: DataISO): DataISO[] {
  const dias: DataISO[] = [];
  const cursor = new Date(
    Number(inicio.slice(0, 4)),
    Number(inicio.slice(5, 7)) - 1,
    Number(inicio.slice(8, 10)),
    12,
  );
  const alvo = new Date(
    Number(fim.slice(0, 4)),
    Number(fim.slice(5, 7)) - 1,
    Number(fim.slice(8, 10)),
    12,
  );
  while (cursor <= alvo) {
    dias.push(chaveData(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

export default PeriodosPage;