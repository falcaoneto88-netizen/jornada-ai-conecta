import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BrandSignaturePanel } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Redefinir palavra-passe — Jornada AI" },
      { name: "description", content: "Defina uma nova palavra-passe para a sua conta Jornada AI." },
      { property: "og:title", content: "Redefinir palavra-passe — Jornada AI" },
      { property: "og:description", content: "Defina uma nova palavra-passe para a sua conta." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RedefinirSenha,
});

function RedefinirSenha() {
  const navigate = useNavigate();
  const [pronto, setPronto] = useState(false);
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [linkInvalido, setLinkInvalido] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === "PASSWORD_RECOVERY") setPronto(true);
    });
    const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
    if (params.get("error") || params.get("error_code")) setLinkInvalido(true);
    if (window.location.hash.includes("type=recovery")) setPronto(true);
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) setPronto(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 8) {
      toast.error("A palavra-passe deve ter pelo menos 8 caracteres.");
      return;
    }
    if (senha !== confirmar) {
      toast.error("As palavras-passe não coincidem.");
      return;
    }
    setOcupado(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setOcupado(false);
    if (error) {
      toast.error(`Não foi possível guardar: ${error.message}`);
      return;
    }
    toast.success("Palavra-passe atualizada.");
    void navigate({ to: "/", replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <BrandSignaturePanel className="mb-5" />
          <h1 className="display-title text-2xl text-heading">Nova palavra-passe</h1>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          {!pronto ? (
            <p className="text-sm text-muted-foreground">
              {linkInvalido
                ? "Este link já foi usado ou expirou. Cada link funciona uma só vez: peça um novo em “Esqueci a palavra-passe” e abra apenas o e-mail mais recente."
                : "Abra esta página pelo link recebido por e-mail. Se o link expirou, peça um novo em “Esqueci a palavra-passe”."}
            </p>
          ) : (
            <form onSubmit={guardar} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nova">Nova palavra-passe</Label>
                <Input id="nova" type="password" required minLength={8} autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmar">Confirmar palavra-passe</Label>
                <Input id="confirmar" type="password" required minLength={8} autoComplete="new-password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={ocupado}>
                {ocupado ? "A guardar…" : "Guardar palavra-passe"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
