import { toast } from 'react-hot-toast';

const API_URL = import.meta.env.VITE_API_URL || '';

let isWakingUpToastShown = false;

export const apiFetch = async (endpoint: string, options: RequestInit = {}, retries = 3): Promise<Response> => {
  const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;
  
  // Garantir que as credenciais (cookies) sejam enviadas
  const defaultOptions: RequestInit = {
    ...options,
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
      ...options.headers,
    }
  };

  if (defaultOptions.body && !(defaultOptions.body instanceof FormData)) {
    defaultOptions.headers = {
      ...defaultOptions.headers,
      'Content-Type': 'application/json',
    };
  }

  let toastId: string | undefined;
  
  // Se demorar mais de 3 segundos, assume que o servidor do Render está acordando
  const timeoutId = setTimeout(() => {
    if (!isWakingUpToastShown) {
      toastId = toast.loading('☕ Café sendo passado... Servidor acordando (até 50s na primeira vez).', {
        duration: 60000,
        style: {
          background: '#fff3cd',
          color: '#856404',
          fontWeight: 'bold',
          border: '1px solid #ffeeba'
        }
      });
      isWakingUpToastShown = true;
    }
  }, 3000);

  try {
    const response = await fetch(url, defaultOptions);
    clearTimeout(timeoutId);
    
    if (toastId) {
      toast.dismiss(toastId);
      toast.success('Servidor online e pronto!');
      isWakingUpToastShown = false;
    }

    // Se o Render retornar 502 ou 503 enquanto acorda, tratamos como erro para fazer retry
    if (response.status === 502 || response.status === 503) {
      throw new Error(`Server waking up: ${response.status}`);
    }

    if (response.status === 401) {
      // Sessão expirada ou não autenticado
      if (!url.includes('/auth/login') && !url.includes('/auth/register')) {
        localStorage.removeItem('onboarding_complete');
        localStorage.removeItem('user_name');
        localStorage.removeItem('user_photo');
        window.location.href = '/welcome'; // Redireciona para o início
      }
    }

    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Se ainda houver retries, espera com timeout progressivo e tenta de novo
    if (retries > 0) {
      const delays = [5000, 8000, 12000];
      const delay = delays[delays.length - retries] || 10000;
      console.log(`Falha na conexão, o servidor pode estar acordando. Tentando novamente em ${delay/1000}s... (${retries} retries restantes)`);
      await new Promise(res => setTimeout(res, delay));
      return apiFetch(endpoint, options, retries - 1);
    }
    
    if (toastId) {
      toast.dismiss(toastId);
      toast.error('O servidor demorou muito para responder. Tente novamente mais tarde.');
      isWakingUpToastShown = false;
    }

    throw error;
  }
};

export const api = {
  get: (endpoint: string) => apiFetch(endpoint, { method: 'GET' }),
  post: (endpoint: string, body: any) => apiFetch(endpoint, { 
    method: 'POST', 
    body: body instanceof FormData ? body : JSON.stringify(body) 
  }),
  put: (endpoint: string, body: any) => apiFetch(endpoint, { 
    method: 'PUT', 
    body: body instanceof FormData ? body : JSON.stringify(body) 
  }),
  patch: (endpoint: string, body: any) => apiFetch(endpoint, { 
    method: 'PATCH', 
    body: body instanceof FormData ? body : JSON.stringify(body) 
  }),
  delete: (endpoint: string) => apiFetch(endpoint, { method: 'DELETE' }),
};
