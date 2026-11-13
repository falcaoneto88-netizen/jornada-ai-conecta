import { cn } from "@/lib/utils";

export const BRAND_MONOGRAM_SRC = "/brand/jf-monograma.png";
export const BRAND_SIGNATURE_SRC = "/brand/dr-joao-falcao-assinatura.jpeg";

/** Monograma JF dourado. `decorative` = nome da marca está visível ao lado. */
export function BrandMonogram({
  decorative = false,
  className,
}: {
  decorative?: boolean;
  className?: string;
}) {
  return (
    <span
      data-app-brand
      className={cn("flex size-9 shrink-0 items-center justify-center", className)}
    >
      <img
        src={BRAND_MONOGRAM_SRC}
        alt={decorative ? "" : "Jornada AI — Dr. João Falcão"}
        width={34}
        height={34}
        className="size-[34px] object-contain"
        draggable={false}
      />
    </span>
  );
}

/** Assinatura original (500x500) enquadrada por CSS, sem cortar letras. */
export function BrandSignaturePanel({ className }: { className?: string }) {
  return (
    <div
      data-brand-signature
      className={cn(
        "relative mx-auto flex h-[150px] w-[200px] items-center justify-center overflow-hidden rounded-2xl sm:h-[176px] sm:w-[236px]",
        className,
      )}
    >
      <img
        src={BRAND_SIGNATURE_SRC}
        alt="Dr. João Falcão — Estética Avançada"
        width={350}
        height={350}
        className="size-[298px] max-w-none shrink-0 object-contain sm:size-[350px]"
        draggable={false}
      />
    </div>
  );
}
