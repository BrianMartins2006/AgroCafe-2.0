/**
 * Upload direto do navegador para o Cloudinary, sem passar pelo backend.
 *
 * O modo unsigned é o que torna isso possível: o preset no painel do Cloudinary
 * autoriza o upload por nome, e não há api_secret no frontend. Isso é seguro
 * *se* o preset for unsigned — se for signed, a assinatura exigiria o secret, e
 * ele nunca pode ir para o bundle. Por isso os dois valores vêm do .env e
 * nunca são hardcoded.
 *
 * Consequência de projeto: o preset precisa estar configurado no painel com
 * "unsigned" ligado. Se alguém trocar para signed, este módulo passa a falhar
 * — e é assim que deve falhar, em vez de vazar o secret para tentar.
 */

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined;

function exigirConfig(): { cloud: string; preset: string } {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error(
      'VITE_CLOUDINARY_CLOUD_NAME e VITE_CLOUDINARY_UPLOAD_PRESET não definidas. ' +
        'Copie .env.local.example para .env.local e preencha. ' +
        'O preset precisa estar criado como unsigned em Cloudinary → Settings → Upload presets.'
    );
  }
  return { cloud: CLOUD_NAME, preset: UPLOAD_PRESET };
}

export interface UploadResult {
  url: string;
  publicId: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Sobe uma imagem e devolve a URL pública.
 *
 * `fetch` e não o SDK: o SDK da Cloudinary puxa ~300kB de polyfill de Node
 * (fs, http) para o bundle do navegador, e aqui só é preciso POST num endpoint.
 */
export async function uploadImagem(
  arquivo: File,
  opcoes: { folder?: string } = {}
): Promise<UploadResult> {
  const { cloud, preset } = exigirConfig();

  const body = new FormData();
  body.append('file', arquivo);
  body.append('upload_preset', preset);
  if (opcoes.folder) body.append('folder', opcoes.folder);

  const resposta = await fetch(
    `https://api.cloudinary.com/v1_1/${cloud}/image/upload`,
    { method: 'POST', body }
  );

  // O Cloudinary responde 200 com {error:{message}} em vários casos de preset,
  // então o corpo precisa ser lido antes de decidir se deu certo.
  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok || !dados || dados.error) {
    const mensagem =
      dados?.error?.message ??
      `HTTP ${resposta.status} no upload para o Cloudinary`;
    throw new Error(mensagem);
  }

  return {
    url: dados.secure_url,
    publicId: dados.public_id,
    width: dados.width,
    height: dados.height,
    bytes: dados.bytes,
  };
}

/**
 * Converte o que o app guarda (URL absoluta do Cloudinary) no mesmo formato.
 *
 * Existe porque o `MediaPicker` e o backend antigo falavam em path relativo
 * (`/static/uploads/x.jpg`). URLs absolutos passam direto — é o caso de tudo o
 * que foi enviado por este módulo.
 */
export function ehUrlCloudinary(url: string | null | undefined): boolean {
  return Boolean(url && url.includes('res.cloudinary.com') && url.includes('/upload/'));
}