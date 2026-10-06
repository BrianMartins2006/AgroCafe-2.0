export const getMediaUrl = (path: string | undefined | null) => {
  if (!path) return "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?auto=format&fit=crop&w=800&q=80";

  // Só sobram URLs absolutas do Cloudinary agora. O prefixo de caminho relativo
  // existia para servir `backend/app/static/uploads` pelo Flask e foi removido
  // junto com o backend — sem VITE_API_URL não há mais host para montar.
  let url = path;

  // Otimização automática para Cloudinary (se for o caso)
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    if (!url.includes("q_auto")) {
      // f_auto: formato automático (webp/avif), q_auto: qualidade automática, w_600: largura máxima para miniaturas
      url = url.replace("/upload/", "/upload/f_auto,q_auto,w_600,c_fill,g_auto/");
    }
  }
  
  return url;
};
