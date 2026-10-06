import { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { Navigate, Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  cadastrar: (email: string, senha: string, nome: string) => Promise<void>;
  sair: () => Promise<void>;
  pedirReset: (email: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    // getSession() é assíncrono. Sem esperar, a guarda de rota veria
    // session === null no primeiro render e jogaria o usuário logado para
    // /welcome a cada F5.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // O cache do React Query é persistido em localStorage por 7 dias. Sem
  // limpar na troca de sessão, os dados do usuário anterior continuam no
  // dispositivo e a tela seguinte renderiza antes de qualquer fetch.
  useEffect(() => {
    const onLogout = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        queryClient.clear();
        localStorage.removeItem('onboarding_complete');
        localStorage.removeItem('user_name');
        localStorage.removeItem('user_photo');
      }
    });
    return () => onLogout.data.subscription.unsubscribe();
  }, [queryClient]);

  const entrar = async (email: string, senha: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) throw new Error(error.message);
  };

  const cadastrar = async (email: string, senha: string, nome: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: senha,
      options: { data: { nome } },
    });
    if (error) throw new Error(error.message);

    // Sem "Confirm email" no Auth, o signUp já loga. Com a confirmação ativa,
    // data.session vem nulo e o usuário precisa confirmar o e-mail antes.
    if (!data.session) {
      throw new Error('CONFIRMACAO_NECESSARIA');
    }
  };

  const sair = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  };

  const pedirReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    if (error) throw new Error(error.message);
  };

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, loading, entrar, cadastrar, sair, pedirReset }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function RotaPrivada() {
  const { session, loading } = useAuth();

  if (loading) return null;

  if (!session) return <Navigate to="/login" replace />;

  return <Outlet />;
}