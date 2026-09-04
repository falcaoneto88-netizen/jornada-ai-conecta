import { Link, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Inbox,
  Route as RouteIcon,
  Workflow,
  Users,
  MessageSquareText,
  PlugZap,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useAppMode } from "@/lib/app-mode";
import { supabase } from "@/integrations/supabase/client";
import { desativarDemo, useSessao } from "@/lib/session";

const navItems = [
  { to: "/", label: "Visão Geral", icon: LayoutDashboard },
  { to: "/caixa-de-entrada", label: "Caixa de Entrada IA", icon: Inbox },
  { to: "/jornada", label: "Jornada do Cliente", icon: RouteIcon },
  { to: "/automacoes", label: "Automações", icon: Workflow },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/modelos", label: "Modelos de Mensagem", icon: MessageSquareText },
  { to: "/integracoes", label: "Integrações", icon: PlugZap },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

export function ConnectionBadge() {
  const modo = useAppMode();
  const conectado = modo === "conectado";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        conectado
          ? "border-success/30 bg-success/10 text-success"
          : "border-primary/40 bg-primary/10 text-accent-foreground",
      )}
    >
      <span className={cn("size-1.5 rounded-full", conectado ? "bg-success" : "bg-primary")} />
      {conectado ? "GoHighLevel conectado" : "GoHighLevel não ligado"}
    </span>
  );
}

export function ModoBadge() {
  const { modo } = useSessao();
  if (modo === "conta") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-medium text-success">
        <span className="size-1.5 rounded-full bg-success" />
        Conta ativa
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-accent-foreground">
      <span className="size-1.5 rounded-full bg-primary" />
      Modo demonstração
    </span>
  );
}

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 px-3">
      {navItems.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          onClick={onNavigate}
          title={collapsed ? label : undefined}
          activeOptions={{ exact: to === "/" }}
          activeProps={{ className: "bg-sidebar-accent text-heading font-medium" }}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            collapsed && "justify-center px-2",
          )}
        >
          <Icon className="size-4 shrink-0 text-primary" aria-hidden />
          {!collapsed && <span className="truncate">{label}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function AppShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { modo, carregando } = useSessao();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!carregando && modo === "anonimo") {
      void navigate({ to: "/auth", replace: true });
    }
  }, [carregando, modo, navigate]);

  async function sair() {
    await queryClient.cancelQueries();
    queryClient.clear();
    desativarDemo();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  }

  if (carregando || modo === "anonimo") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground" role="status">
          A carregar…
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar desktop */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200 md:flex",
          collapsed ? "w-[76px]" : "w-[264px]",
        )}
      >
        <div className={cn("flex items-center gap-3 px-5 py-6", collapsed && "justify-center px-2")}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-heading text-sm font-semibold text-background">
            JF
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="display-title truncate text-base leading-tight">Jornada AI</p>
              <p className="truncate text-xs text-muted-foreground">Dr. João Falcão</p>
            </div>
          )}
        </div>
        <NavList collapsed={collapsed} />
        <div className="mt-auto p-3">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-sidebar-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-heading"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && "Recolher menu"}
          </button>
        </div>
      </aside>

      {/* Sidebar mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            className="absolute inset-0 bg-heading/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative flex h-full w-[264px] flex-col bg-sidebar shadow-xl">
            <div className="flex items-center justify-between px-5 py-6">
              <div>
                <p className="display-title text-base leading-tight">Jornada AI</p>
                <p className="text-xs text-muted-foreground">Dr. João Falcão</p>
              </div>
              <button type="button" aria-label="Fechar menu" onClick={() => setMobileOpen(false)}>
                <X className="size-5" />
              </button>
            </div>
            <NavList collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className={cn("transition-all duration-200", collapsed ? "md:pl-[76px]" : "md:pl-[264px]")}>
        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
            <button
              type="button"
              aria-label="Abrir menu"
              className="rounded-lg border border-border p-2 md:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="size-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="display-title truncate text-xl sm:text-2xl">{title}</h1>
              {description && <p className="mt-0.5 truncate text-sm text-muted-foreground">{description}</p>}
            </div>
            <div className="flex items-center gap-3">
              <ConnectionBadge />
              {actions}
            </div>
          </div>
        </header>
        <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
