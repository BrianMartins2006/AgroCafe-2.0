import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Key, ArrowRight, Check, ChevronLeft, MailCheck } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';

const ForgotPasswordPage = () => {
  const { pedirReset } = useAuth();
  const [enviado, setEnviado] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return toast.error('Digite seu e-mail');

    setLoading(true);
    try {
      await pedirReset(email);
      setEnviado(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível enviar');
    } finally {
      setLoading(false);
    }
  };

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
            {enviado ? (
              <MailCheck size={40} className="text-whatsapp-teal" />
            ) : (
              <Key size={40} className="text-whatsapp-teal" />
            )}
          </div>

          {!enviado ? (
            <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h1 className="text-3xl font-black mb-4 tracking-tighter">Recuperar Senha</h1>
              <p className="text-white/70 mb-10 font-medium leading-relaxed">
                Digite seu e-mail e enviaremos um link para você criar uma nova senha.
              </p>

              <form onSubmit={handleSubmit} className="w-full space-y-6">
                <div className="relative">
                  <Mail size={20} className="absolute left-5 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Seu e-mail cadastrado"
                    className="w-full bg-white/10 border-2 border-white/20 rounded-2xl py-4 pl-14 pr-6 text-lg font-bold outline-none focus:border-white focus:bg-white/20 transition-all"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-white text-whatsapp-teal py-5 rounded-[2rem] font-black text-xl shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3"
                >
                  {loading ? (
                    <div className="w-6 h-6 border-4 border-whatsapp-teal border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <><ArrowRight size={24} /> ENVIAR LINK</>
                  )}
                </button>
              </form>
            </div>
          ) : (
            <div className="w-full animate-in zoom-in duration-500">
              <div className="w-24 h-24 bg-whatsapp-green rounded-full flex items-center justify-center mb-8 mx-auto shadow-2xl">
                <Check size={48} className="text-white" />
              </div>
              <h1 className="text-3xl font-black mb-4 tracking-tighter text-white">Confira seu e-mail</h1>
              <p className="text-white/70 mb-10 font-medium leading-relaxed">
                Se houver uma conta com <span className="font-black">{email}</span>, o link para
                redefinir a senha já está a caminho. Não se esqueça de verificar o spam.
              </p>
              <Link
                to="/login"
                className="w-full bg-white text-whatsapp-teal py-5 rounded-[2rem] font-black text-xl shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3"
              >
                IR PARA O LOGIN <ArrowRight size={24} />
              </Link>
            </div>
          )}

          <Link
            to="/login"
            className="mt-8 text-white/50 font-bold uppercase text-xs tracking-widest hover:text-white flex items-center gap-2"
          >
            <ChevronLeft size={16} /> Voltar para o Login
          </Link>
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

export default ForgotPasswordPage;