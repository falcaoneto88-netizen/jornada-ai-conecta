/** Apenas caminhos internos, sem normalizações que possam mudar a origem. */
export function caminhoSeguro(valor: unknown): string {
  if (typeof valor !== "string" || !valor.startsWith("/") || valor.startsWith("//")) return "";
  if (valor.includes("\\") || Array.from(valor).some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)) return "";
  try {
    const url = new URL(valor, "https://jornada.invalid");
    if (url.origin !== "https://jornada.invalid" || url.pathname.startsWith("//")) return "";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
}
