// Entrega ao navegador um arquivo que a API devolveu em base64 (planilhas de exportação).
export function baixarArquivo(res: { filename: string; mime: string; base64: string }) {
  const bin = atob(res.base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([arr], { type: res.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = res.filename;
  a.click();
  URL.revokeObjectURL(url);
}
