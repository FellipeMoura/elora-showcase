// =====================================================================
// imageCompress — redimensiona + recomprime imagens no browser usando
// Canvas 2D. Sem dependências (browser nativo).
//
// Uso típico: capturar foto da câmera (getUserMedia) → frame → Blob ~3MB →
// `compressImageForUpload(blob, { maxSide: 720, mimeType: 'image/webp', quality: 0.75 })`
// → Blob ~50KB. Backend salva direto no MinIO/R2.
//
// WebP é suportado nativamente em todos browsers modernos (caniuse ~98%);
// fallback automático pra PNG quando o navegador não consegue encodar WebP.
// =====================================================================

export interface CompressImageOptions {
  // Lado maior em pixels. Se a imagem já é menor, mantém. Default 720.
  maxSide?: number
  // Default 'image/webp'. Aceita 'image/png' / 'image/jpeg' como override.
  mimeType?: 'image/webp' | 'image/png' | 'image/jpeg'
  // 0-1. Quanto menor, mais compressão (e pior fidelidade). Default 0.75.
  quality?: number
}

export interface CompressedImage {
  blob: Blob
  width: number
  height: number
  mimeType: string
}

export async function compressImage(
  source: Blob,
  options: CompressImageOptions = {},
): Promise<CompressedImage> {
  const { maxSide = 720, mimeType = 'image/webp', quality = 0.75 } = options
  const bitmap = await blobToImageBitmap(source)
  const { width, height } = scaleDimensions(bitmap.width, bitmap.height, maxSide)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D não disponível')
  ctx.drawImage(bitmap, 0, 0, width, height)

  // Libera memória da bitmap depois de usar (Firefox/Safari acumulam).
  if (typeof bitmap.close === 'function') bitmap.close()

  const blob = await canvasToBlob(canvas, mimeType, quality)
  // Se o browser retornar null (não suporta WebP), fallback pra PNG.
  if (!blob) {
    const fallback = await canvasToBlob(canvas, 'image/png', 1)
    if (!fallback) throw new Error('Não foi possível encodar a imagem')
    return { blob: fallback, width, height, mimeType: 'image/png' }
  }
  return { blob, width, height, mimeType: blob.type || mimeType }
}

// Converte Blob/File em base64 data URL (`data:image/webp;base64,...`).
// Útil pra envio em body JSON (a alternativa multipart precisa de multer
// no backend — ver decisão em docs/arquitetura.md).
export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler blob'))
    reader.readAsDataURL(blob)
  })
}

// --- internos ---

function scaleDimensions(
  w: number,
  h: number,
  maxSide: number,
): { width: number; height: number } {
  const longest = Math.max(w, h)
  if (longest <= maxSide) return { width: w, height: h }
  const ratio = maxSide / longest
  return {
    width: Math.round(w * ratio),
    height: Math.round(h * ratio),
  }
}

async function blobToImageBitmap(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob)
  }
  // Fallback raríssimo (Safari muito antigo). Carrega via <img>.
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      // Cast — o ducktype dá conta dos usos abaixo (width/height/drawImage).
      resolve(img as unknown as ImageBitmap)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Falha ao carregar imagem'))
    }
    img.src = url
  })
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality)
  })
}
