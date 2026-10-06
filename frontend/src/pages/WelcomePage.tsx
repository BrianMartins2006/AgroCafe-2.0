import { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Camera, Check, ArrowRight, User, Coffee, Mail, Lock, Eye, EyeOff, MailCheck } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import { uploadImagem } from '../services/cloudinary';
import { compressImage } from '../utils/imageCompression';

const WelcomePage = () => {
  const navigate = useNavigate();
  const { cadastrar } = useAuth();
  const [step, setStep] = useState(1);
  const [confirmarEmail, setConfirmarEmail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [form, setForm] = useState({
    nome: '',
    email: '',
    senha: '',
    confirmarSenha: '',
    foto_url: ''
  });

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const comprimido = await compressImage(file);
      const up = await uploadImagem(comprimido, { folder: 'perfil' });
      setForm(prev => ({ ...prev, foto_url: up.url }));
      toast.success('Foto carregada!');
    } catch (err) {
      console.error('Falha no upload da foto:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao subir foto');
    } finally {
      setUploading(false);
    }
  };

  const handleRegister = async () => {
    if (!form.nome || !form.email || !form.senha || !form.confirmarSenha) {
      return toast.error('Preencha todos os campos obrigatórios');
    }

    if (form.senha !== form.confirmarSenha) {
      return toast.error('As senhas não coincidem');
    }

    if (form.senha.length < 6) {
      return toast.error('A senha deve ter pelo menos 6 caracteres');
    }

    setLoading(true);
    try {
      await cadastrar(form.email, form.senha, form.nome, form.foto_url || undefined);
      toast.success(`Bem-vindo, ${form.nome}!`);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof Error && err.message === 'CONFIRMACAO_NECESSARIA') {
        setConfirmarEmail(true);
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Erro ao realizar cadastro');
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

      <div className="relative z-10 w-full max-w-md px-8 text-center text-white flex flex-col h-full py-12">
        
        {confirmarEmail ? (
          <div className="flex-1 flex flex-col items-center justify-center animate-in zoom-in duration-500">
            <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-8 shadow-2xl">
              <MailCheck size={48} className="text-whatsapp-teal" />
            </div>
            <h2 className="text-2xl font-black mb-4">Confirme seu e-mail</h2>
            <p className="text-white/70 mb-10 font-medium leading-relaxed max-w-xs">
              Enviamos um link de confirmação para <span className="font-black">{form.email}</span>.
              Abra o e-mail para ativar sua conta e depois faça o login.
            </p>
            <Link
              to="/login"
              className="w-full bg-white text-whatsapp-teal py-5 rounded-[2rem] font-black text-xl shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3"
            >
              IR PARA O LOGIN <ArrowRight size={24} />
            </Link>
          </div>
        ) : step === 1 ? (
          <div className="flex-1 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-700">
            <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-8 shadow-2xl">
              <Coffee size={48} className="text-whatsapp-teal" />
            </div>
            <h1 className="text-5xl font-black mb-4 tracking-tighter">AgroCafé</h1>
            <p className="text-xl font-medium text-white/80 leading-relaxed mb-12">
              Gestão inteligente para sua lavoura de café, direto no seu bolso.
            </p>
            <div className="w-full space-y-4">
              <button 
                onClick={() => setStep(2)}
                className="w-full bg-white text-whatsapp-teal py-5 rounded-[2rem] font-black text-xl shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3"
              >
                CRIAR MINHA CONTA <ArrowRight size={24} />
              </button>
              <Link 
                to="/login"
                className="block text-white/70 font-bold uppercase text-sm tracking-widest hover:text-white transition-colors"
              >
                Já tenho uma conta
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center overflow-y-auto no-scrollbar py-4 animate-in slide-in-from-right-10 duration-500">
            <h2 className="text-2xl font-black mb-8">Configurar seu Perfil</h2>
            
            {/* Profile Picture Upload */}
            <div className="relative mb-8 group shrink-0">
              <div className="w-28 h-28 rounded-full border-4 border-white/30 overflow-hidden bg-white/10 flex items-center justify-center shadow-2xl relative">
                {form.foto_url ? (
                  <img src={form.foto_url} className="w-full h-full object-cover" alt="Profile" />
                ) : (
                  <User size={56} className="text-white/40" />
                )}
                {uploading && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                  </div>
                )}
              </div>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 right-0 bg-white text-whatsapp-teal p-2.5 rounded-full shadow-xl active:scale-90 transition-all"
              >
                <Camera size={18} />
              </button>
              <input 
                type="file" 
                hidden 
                ref={fileInputRef} 
                onChange={handlePhotoUpload} 
                accept="image/*"
                capture="user"
              />
            </div>

            {/* Registration Form */}
            <div className="w-full space-y-5 mb-8">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-white/60 text-left block ml-4">Nome Completo</label>
                <div className="relative">
                  <User size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-white/40" />
                  <input 
                    type="text" 
                    value={form.nome}
                    onChange={(e) => setForm({...form, nome: e.target.value})}
                    placeholder="Ex: Sr. José da Silva"
                    className="w-full bg-white/10 border-2 border-white/20 rounded-2xl py-3.5 pl-12 pr-6 text-lg font-bold outline-none focus:border-white focus:bg-white/20 transition-all placeholder:text-white/20"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-white/60 text-left block ml-4">E-mail</label>
                <div className="relative">
                  <Mail size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-white/40" />
                  <input 
                    type="email" 
                    value={form.email}
                    onChange={(e) => setForm({...form, email: e.target.value})}
                    placeholder="seu@email.com"
                    className="w-full bg-white/10 border-2 border-white/20 rounded-2xl py-3.5 pl-12 pr-6 text-lg font-bold outline-none focus:border-white focus:bg-white/20 transition-all placeholder:text-white/20"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-white/60 text-left block ml-4">Senha</label>
                <div className="relative">
                  <Lock size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-white/40" />
                  <input 
                    type={showPassword ? "text" : "password"} 
                    value={form.senha}
                    onChange={(e) => setForm({...form, senha: e.target.value})}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full bg-white/10 border-2 border-white/20 rounded-2xl py-3.5 pl-12 pr-12 text-lg font-bold outline-none focus:border-white focus:bg-white/20 transition-all placeholder:text-white/20"
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
                <label className="text-[10px] font-black uppercase tracking-widest text-white/60 text-left block ml-4">Confirmar Senha</label>
                <div className="relative">
                  <Lock size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-white/40" />
                  <input 
                    type={showConfirmPassword ? "text" : "password"} 
                    value={form.confirmarSenha}
                    onChange={(e) => setForm({...form, confirmarSenha: e.target.value})}
                    placeholder="Repita sua senha"
                    className="w-full bg-white/10 border-2 border-white/20 rounded-2xl py-3.5 pl-12 pr-12 text-lg font-bold outline-none focus:border-white focus:bg-white/20 transition-all placeholder:text-white/20"
                  />
                  <button 
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>
            </div>

            <button 
              onClick={handleRegister}
              disabled={loading}
              className="w-full bg-whatsapp-green text-white py-5 rounded-[2rem] font-black text-xl shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3 shrink-0"
            >
              {loading ? (
                <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <><Check size={24} /> FINALIZAR CADASTRO</>
              )}
            </button>
            
            <button 
              onClick={() => setStep(1)}
              className="mt-6 mb-8 text-white/50 font-bold uppercase text-xs tracking-widest"
            >
              Voltar
            </button>
          </div>
        )}

        <div className="mt-auto pt-4 shrink-0">
          <p className="text-[10px] text-white/40 font-bold uppercase tracking-[0.2em]">
            AgroCafé v2.0 • Proteção Multi-Tenant
          </p>
        </div>
      </div>
    </div>
  );
};

export default WelcomePage;
