import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PlayCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { ativarDemo, desativarDemo, useSessao } from "@/lib/session";
import { caminhoSeguro } from "@/lib/auth-redirect";


export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({ next: caminhoSeguro(s["next"]) }),

  head: () => ({
    meta: [
      { title: "Acesso — Jornada AI | Dr. João Falcão" },
      {
        name: "description",
        content: "Entre na sua conta da Jornada AI ou experimente o sistema em modo de demonstração com dados fictícios.",
      },
      { property: "og:title", content: "Acesso — Jornada AI" },
      { property: "og:description", content: "Conta de equipa ou modo de demonstração da Jornada AI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Auth,
});

function Auth() {
  const navigate = useNavigate();
  const { user, carregando } = useSessao();
  const { next } = Route.useSearch();

  function irParaDestino() {
    if (next) {
      window.location.href = next;
      return;
    }
    void navigate({ to: "/", replace: true });
  }
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nome, setNome] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aguardaEmail, setAguardaEmail] = useState(false);

  useEffect(() => {
    if (!carregando && user) irParaDestino();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregando, user]);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    desativarDemo();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setOcupado(false);
    if (error) {
      toast.error(
        error.message.includes("Invalid login")
          ? "E-mail ou palavra-passe incorretos."
          : `Não foi possível entrar: ${error.message}`,
      );
      return;
    }
    toast.success("Sessão iniciada.");
    irParaDestino();
  }

  async function criarConta(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("A palavra-passe deve ter pelo menos 8 caracteres.");
      return;
    }
    setOcupado(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: next ? `${window.location.origin}${next}` : window.location.origin,
        data: { full_name: nome },
      },
    });
    setOcupado(false);
    if (error) {
      toast.error(`Não foi possível criar a conta: ${error.message}`);
      return;
    }
    if (!data.session) {
      setAguardaEmail(true);
      toast.success("Conta criada. Confirme o e-mail para entrar.");
      return;
    }
    irParaDestino();
  }

  function entrarDemo() {
    ativarDemo();
    toast.info("Modo demonstração ativo — todos os dados são fictícios.");
    void navigate({ to: "/", replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-heading text-sm font-semibold text-background">
            JF
          </span>
          <h1 className="display-title text-2xl text-heading">Jornada AI</h1>
          <p className="mt-1 text-sm text-muted-foreground">Dr. João Falcão — atendimento e automações</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <Tabs defaultValue="entrar">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="entrar">Acessar conta</TabsTrigger>
              <TabsTrigger value="criar">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="entrar" className="mt-5">
              <form onSubmit={entrar} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Palavra-passe</Label>
                  <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={ocupado}>
                  {ocupado ? "A entrar…" : "Entrar"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="criar" className="mt-5">
              {aguardaEmail ? (
                <p className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-foreground">
                  Enviámos um e-mail de confirmação para <strong>{email}</strong>. Confirme o endereço e volte a esta
                  página para entrar.
                </p>
              ) : (
                <form onSubmit={criarConta} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="nome">Nome completo</Label>
                    <Input id="nome" required value={nome} onChange={(e) => setNome(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email-novo">E-mail</Label>
                    <Input id="email-novo" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password-nova">Palavra-passe</Label>
                    <Input
                      id="password-nova"
                      type="password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Mínimo de 8 caracteres.</p>
                  </div>
                  <Button type="submit" className="w-full" disabled={ocupado}>
                    {ocupado ? "A criar…" : "Criar conta"}
                  </Button>
                </form>
              )}
            </TabsContent>
          </Tabs>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">ou</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button type="button" variant="outline" className="w-full" onClick={entrarDemo}>
            <PlayCircle className="size-4" aria-hidden />
            Entrar em modo demonstração
          </Button>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            No modo demonstração todos os pacientes, conversas e automações são fictícios e nada é enviado ao
            GoHighLevel.
          </p>
        </div>
      </div>
    </main>
  );
}
