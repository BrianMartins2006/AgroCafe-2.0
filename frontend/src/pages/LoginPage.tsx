import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, ArrowRight, Coffee, Check, Eye, EyeOff } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';

const LoginPage = () => {
  const navigate = useNavigate();
  const { entrar } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    email: '',
    senha: ''
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.senha) {
      return toast.error('Preencha e-mail e senha');
    }

    setLoading(true);
    try {
      await entrar(form.email, form.senha);
      toast.success('Bem-vindo de volta!');
      navigate('/', { replace: true });
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : 'E-mail ou senha incorretos';
      if (mensagem.toLowerCase().includes('invalid login')) {
        toast.error('E-mail ou senha incorretos');
      } else {
        toast.error(mensagem);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-full bg-white flex flex-col items-center justify-center relative overflow-hidden font-sans">
      {/* Background Image with Overlay */}
      <div className="absolute inset-0 z-0">
        <img 
          src="https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1920&q=80" 
          className="w-full h-full object-cover" 
          alt="Coffee plantation" 
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-whatsapp-teal/60 to-whatsapp-teal/95"></div>
      </div>

      <div className="relative z-10 w-full max-w-md px-8 text-center text-white flex flex-col h-full py-20">
        <div className="flex-1 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-700">
          <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-8 shadow-2xl">
            <Coffee size={40} className="text-whatsapp-teal" />
          </div>
          <h1 className="text-4xl font-black mb-10 tracking-tighter">Acessar AgroCafé</h1>

          <form onSubmit={handleLogin} className="w-full space-y-6">
            <div className="space-y-4">
              <div className="relative">
                <Mail size={20} className="absolute left-5 top-1/2 -translate-y-1/2 text-white/40" />
                <input 
                  type="email" 
                  value={form.email}
                  onChange={(e) => setForm({...form, email: e.target.value})}
                  placeholder="Seu e-mail"
                  className="w-full bg-white/10 border-2 border-white/20 rounded-2xl py-4 pl-14 pr-6 text-lg font-bold outline-none focus:border-white focus:bg-white/20 transition-all placeholder:text-white/30"
                />
              </div>

              <div className="relative">
                <Lock size={20} className="absolute left-5 top-1/2 -translate-y-1/2 text-white/40" />
                <input 
                  type={showPassword ? "text" : "password"} 
                  value={form.senha}
                  onChange={(e) => setForm({...form, senha: e.target.value})}
                  placeholder="Sua senha"
                  className="w-full bg-white/10 border-2 border-white/20 rounded-2xl py-4 pl-14 pr-14 text-lg font-bold outline-none focus:border-white focus:bg-white/20 transition-all placeholder:text-white/30"
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <button 
              type="submit"
              disabled={loading}
              className="w-full bg-whatsapp-green text-white py-5 rounded-[2rem] font-black text-xl shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3"
            >
              {loading ? (
                <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <><Check size={24} /> ENTRAR AGORA</>
              )}
            </button>
          </form>

          <div className="mt-8 space-y-4">
            <Link 
              to="/forgot-password"
              className="block text-white/50 font-bold uppercase text-xs tracking-widest hover:text-white"
            >
              Esqueci minha senha
            </Link>
            <Link 
              to="/welcome"
              className="block text-white/70 font-bold uppercase text-sm tracking-widest hover:text-white flex items-center justify-center gap-2"
            >
              Não tenho conta, quero criar uma <ArrowRight size={16} />
            </Link>
          </div>
        </div>

        <div className="mt-auto pt-8">
          <p className="text-[10px] text-white/40 font-bold uppercase tracking-[0.2em]">
            AgroCafé • Acesso Seguro
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
