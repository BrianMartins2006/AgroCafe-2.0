import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import LavourasPage from './pages/LavourasPage';
import ChatPage from './pages/ChatPage';
import NewLavouraPage from './pages/NewLavouraPage';
import LavouraProfilePage from './pages/LavouraProfilePage';
import SettingsPage from './pages/SettingsPage';
import ActivitiesPage from './pages/ActivitiesPage';
import FuncionariosPage from './pages/FuncionariosPage';
import MaquinariosPage from './pages/MaquinariosPage';
import ProfilePage from './pages/ProfilePage';
import DashboardPage from './pages/DashboardPage';
import WelcomePage from './pages/WelcomePage';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import RedefinirSenhaPage from './pages/RedefinirSenhaPage';

import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { AuthProvider, RotaPrivada } from './hooks/useAuth';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 30, // 30 minutos de cache "fresco"
      gcTime: 1000 * 60 * 60 * 24 * 7, // 7 dias de persistência
      retry: 1,
    },
  },
});

// Usando localStorage para máxima compatibilidade
const persister = createAsyncStoragePersister({
  storage: window.localStorage,
});

function App() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 * 7 }}
    >
      <AuthProvider>
        <BrowserRouter>
          <Toaster
            position="top-center"
            toastOptions={{
              className: 'text-sm font-bold',
              duration: 2000,
              style: { borderRadius: '20px', padding: '16px', zIndex: 9999 }
            }}
          />
          <Routes>
            <Route path="/welcome" element={<WelcomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/redefinir-senha" element={<RedefinirSenhaPage />} />

            <Route element={<RotaPrivada />}>
              <Route path="/" element={<LavourasPage />} />
              <Route path="/chat/:id" element={<ChatPage />} />
              <Route path="/atividades" element={<ActivitiesPage />} />
              <Route path="/lavoura/:id/perfil" element={<LavouraProfilePage />} />
              <Route path="/configuracoes" element={<SettingsPage />} />
              <Route path="/funcionarios" element={<FuncionariosPage />} />
              <Route path="/maquinarios" element={<MaquinariosPage />} />
              <Route path="/perfil" element={<ProfilePage />} />
              <Route path="/nova-lavoura" element={<NewLavouraPage />} />
              <Route path="/editar-lavoura/:id" element={<NewLavouraPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}

export default App;
