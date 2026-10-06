import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Key, ArrowRight, Check, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

const RedefinirSenhaPage = () => {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [loadingEnvio, setLoadingEnvio] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ senha: '', confirmacao: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.senha.length < 6) return toast.error('A senha precisa de ao menos 6 caracteres');
    if (form.senha !== form.confirmacao) return toast.error('As senhas não conferem');

    setLoadingEnvio(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: form.senha });
      if (error) throw error;
      toast.success('Senha atualizada!');
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível atualizar a senha');
    } finally {
      setLoadingEnvio(false);
    }
  };

  const semLink = !loading && !session;

  return (
    <div className="h-screen w-full bg-white flex flex-col items-center justify-center relative overflow-hidden font-sans">
      <div className="absolute inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1920&q=80"
          className="w-full h-full object-cover shadow-inner"
          alt="Coffee plantation"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-whatsapp-teal/60 to-whatsapp-teal/95"></div>
      </div>

      <div className="relative z-10 w-full max-w-md px-8 text-center text-white flex flex-col h-full py-20">
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-8 shadow-2xl">
            <Key size={40} className="text-whatsapp-teal" />
          </div>

          {semLink ? (
            <div className="w-full animate-in zoom-in duration-500">
              <div className="w-24 h-24 bg-amber-400 rounded-full flex items-center justify-center mb-8 mx-auto shadow-2xl">
                <AlertTriangle size={48} className="text-white" />
              </div>
              <h1 className="text-3xl font-black mb-4 tracking-tighter">Link expirado</h1>
              <p className="text-white/70 mb-10 font-medium leading-relaxed">
                Abra esta página pelo link que enviamos para o seu e-mail. Sem ele, não há como
                confirmar que é você.
              </p>
              <Link
                to="/forgot-password"
                className="w-full bg-white text-whatsapp-teal py-5 rounded-[2rem] font-black text-xl shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3"
              >
                PEDIR UM NOVO <ArrowRight size={24} />
              </Link>
            </div>
          ) : (
            <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h1 className="text-3xl font-black mb-4 tracking-tighter">Criar nova senha</h1>
              <p className="text-white/70 mb-10 font-medium leading-relaxed">
                Escolha uma senha com pelo menos 6 caracteres.
              </p>

              <form onSubmit={handleSubmit} className="w-full space-y-5 text-left">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-white/60 ml-4 block">
                    Nova Senha
                  </label>
                  <div className="relative">
                    <Key size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={form.senha}
                      onChange={(e) => setForm({ ...form, senha: e.target.value })}
                      placeholder="Mínimo 6 caracteres"
                      className="w-full bg-white/10 border-2 border-white/20 rounded-2xl py-4 pl-14 pr-12 text-lg font-bold outline-none focus:border-white transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-white/60 ml-4 block">
                    Confirmar Senha
                  </label>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={form.confirmacao}
                    onChange={(e) => setForm({ ...form, confirmacao: e.target.value })}
                    placeholder="Repita a senha"
                    className="w-full bg-white/10 border-2 border-white/20 rounded-2xl py-4 px-6 text-lg font-bold outline-none focus:border-white transition-all"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loadingEnvio}
                  className="w-full bg-whatsapp-green text-white py-5 rounded-[2rem] font-black text-xl shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3 mt-4"
                >
                  {loadingEnvio ? (
                    <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <><Check size={24} /> SALVAR NOVA SENHA</>
                  )}
                </button>
              </form>
            </div>
          )}
        </div>

        <div className="mt-auto pt-8">
          <p className="text-[10px] text-white/40 font-bold uppercase tracking-[0.2em]">
            AgroCafé • Recuperação Rural
          </p>
        </div>
      </div>
    </div>
  );
};

export default RedefinirSenhaPage;