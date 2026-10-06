import { useState, useEffect } from 'react';
import { User, Mail, Lock, Camera, Check, Eye, EyeOff, X } from 'lucide-react';
import Layout from '../components/Layout';
import MediaPicker from '../components/MediaPicker';
import { buscarPerfil, atualizarPerfil, type UserProfile } from '../services/perfil';
import { uploadImagem } from '../services/cloudinary';
import { getMediaUrl } from '../utils/media';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';

const ProfilePage = () => {
  const queryClient = useQueryClient();
  const { data: profile, isLoading: loading } = useQuery<UserProfile>({
    queryKey: ['perfil'],
    queryFn: buscarPerfil
  });

  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  
  const [form, setForm] = useState({
    nome: '',
    email: '',
    senha: ''
  });
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (profile) {
      setForm({
        nome: profile.nome,
        email: profile.email,
        senha: ''
      });
    }
  }, [profile]);

  const handleFilesSelected = async (files: File[]) => {
    const file = files[0];
    if (!file) return;

    try {
      setSaving(true);
      const up = await uploadImagem(file, { folder: 'perfil' });
      await atualizarPerfil({ nome: form.nome, foto_url: up.url });
      queryClient.invalidateQueries({ queryKey: ['perfil'] });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error("Erro ao subir foto:", err);
      toast.error(err instanceof Error ? err.message : 'Erro ao subir foto');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    
    try {
      await atualizarPerfil({ nome: form.nome, foto_url: profile?.foto_url ?? null });
      queryClient.invalidateQueries({ queryKey: ['perfil'] });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error("Erro ao salvar perfil:", err);
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar perfil');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout title="Meu Perfil" showBackButton={true}>
      <div className="bg-[#f0f2f5] min-h-full">
        {/* Profile Header (WhatsApp Style) */}
        <div className="bg-white p-8 flex flex-col items-center border-b border-gray-100 shadow-sm">
          <div className="relative group">
            <div 
              onClick={() => profile?.foto_url && setLightboxImage(getMediaUrl(profile.foto_url))}
              className="w-40 h-40 bg-gray-100 rounded-full flex items-center justify-center overflow-hidden border-4 border-gray-50 shadow-xl cursor-pointer active:scale-95 transition-all"
            >
              {profile?.foto_url ? (
                <img src={getMediaUrl(profile.foto_url)} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User size={80} className="text-gray-300" />
              )}
            </div>
            <button 
              onClick={() => setShowMediaPicker(true)}
              className="absolute bottom-1 right-1 w-12 h-12 bg-whatsapp-teal text-white rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-all border-4 border-white cursor-pointer"
            >
              <Camera size={20} />
            </button>
          </div>
          <h2 className="mt-6 text-2xl font-black text-gray-900">{profile?.nome || 'Carregando...'}</h2>
          <p className="text-gray-400 font-medium">{profile?.email}</p>
        </div>

        {/* Edit Form */}
        <div className="p-6 max-w-md mx-auto">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-white rounded-[2rem] p-8 shadow-sm space-y-6 border border-gray-50">
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">Nome Completo</label>
                <div className="relative">
                  <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    type="text" 
                    value={form.nome}
                    onChange={e => setForm({...form, nome: e.target.value})}
                    placeholder="Seu nome"
                    className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-whatsapp-teal transition-all text-gray-800 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">E-mail</label>
                <div className="relative">
                  <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    type="email" 
                    value={form.email}
                    onChange={e => setForm({...form, email: e.target.value})}
                    placeholder="Seu e-mail"
                    className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-whatsapp-teal transition-all text-gray-800 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-2">Alterar Senha</label>
                <div className="relative">
                  <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    type={showPass ? "text" : "password"} 
                    value={form.senha}
                    onChange={e => setForm({...form, senha: e.target.value})}
                    placeholder="Deixe em branco para manter"
                    className="w-full pl-12 pr-12 py-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-whatsapp-teal transition-all text-gray-800 font-medium"
                  />
                  <button 
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-whatsapp-teal transition-colors"
                  >
                    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>

            <button 
              type="submit" 
              disabled={saving || loading}
              className={`w-full py-5 rounded-2xl font-black text-lg shadow-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-3 ${
                success 
                ? 'bg-whatsapp-green text-white shadow-whatsapp-green/20' 
                : 'bg-whatsapp-teal text-white shadow-whatsapp-teal/20 hover:bg-whatsapp-teal-dark'
              }`}
            >
              {saving ? (
                <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : success ? (
                <><Check size={24} /> Salvo com Sucesso!</>
              ) : (
                'Salvar Alterações'
              )}
            </button>
          </form>
          <p className="text-center text-[10px] text-gray-300 mt-8 font-black uppercase tracking-widest">AgroCafé • Segurança de Dados</p>
        </div>
      </div>
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

      {/* Seletor de Mídia */}
      <MediaPicker 
        isOpen={showMediaPicker}
        onClose={() => setShowMediaPicker(false)}
        onSelect={handleFilesSelected}
        multiple={false}
      />
    </Layout>
  );
};

export default ProfilePage;
