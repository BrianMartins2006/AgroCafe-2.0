import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Falha no boot, e não no primeiro clique. Sem isso o app sobe normal e o
// primeiro erro aparece como "Failed to fetch" numa tela de cadastro, que
// parece bug de layout em vez de configuração faltando.
if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não definidas. ' +
      'Copie .env.local.example para .env.local e preencha. ' +
      'A URL e a anon key ficam em Project Settings → API no painel do Supabase.'
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // Sessão guardada em localStorage. O app é um PWA mobile-first: a sessão
    // precisa sobreviver ao app ser fechado pelo celular.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});