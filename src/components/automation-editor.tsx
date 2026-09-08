import {
  ArrowDown,
  ArrowUp,
  Bot,
  Clock,
  Edit2,
  GitBranch,
  Mail,
  MessageCircle,
  MessageSquare,
  Plus,
  Send,
  Tag,
  Trash2,
  UserCog,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  acaoLabel,
  condicaoCampoLabel,
  equipa,
  labelPasso,
  operadorLabel,
  resumoPasso,
  type Automation,
  type AutomationStatus,
  type AutomationStep,
  type CampoCondicao,
  type Canal,
  type MessageTemplate,
  type OperadorCondicao,
  type TipoAcao,
} from "@/lib/demo-data";
import { useEtapas, useModelos } from "@/lib/repo";

const gatilhos = [
  "Contacto criado",
  "Oportunidade mudou de etapa",
  "Mensagem recebida",
  "Consulta agendada",
  "Consulta confirmada",
  "Tempo sem resposta",
  "Data/hora relativa",
  "Webhook recebido",
];

const canais: Canal[] = ["whatsapp", "instagram", "facebook", "email"];

const responsaveis = Array.from(new Set(equipa.map((m) => m.nome)));

function gerarId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function passoDefault(tipo: AutomationStep["tipo"]): AutomationStep {
  const id = gerarId();
  switch (tipo) {
    case "condicao":
      return { tipo: "condicao", id, campo: "etapa", operador: "igual", valor: "" };
    case "acao":
      return { tipo: "acao", id, acao: "enviar_whatsapp", parametros: {} };
    case "espera":
      return { tipo: "espera", id, duracao: 1, unidade: "horas" };
    case "texto":
      return { tipo: "texto", id, texto: "" };
  }
}

function iconePasso(tipo: AutomationStep["tipo"]) {
  switch (tipo) {
    case "condicao":
      return <GitBranch className="size-4" />;
    case "acao":
      return <Send className="size-4" />;
    case "espera":
      return <Clock className="size-4" />;
    case "texto":
      return <MessageSquare className="size-4" />;
  }
}

type DraftAutomation = {
  id?: string;
  nome: string;
  descricao: string;
  gatilho: string;
  status: AutomationStatus;
  passos: AutomationStep[];
};

type AutomationEditorProps = {
  automation: Automation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: DraftAutomation) => void;
  isSaving?: boolean;
};

export function AutomationEditor({ automation, open, onOpenChange, onSave, isSaving }: AutomationEditorProps) {
  const [draft, setDraft] = useState<DraftAutomation>({
    nome: "",
    descricao: "",
    gatilho: gatilhos[0] ?? "",
    status: "rascunho",
    passos: [],
  });
  const [editandoId, setEditandoId] = useState<string | null>(null);

  const { data: etapas = [] } = useEtapas();
  const { data: modelos = [] } = useModelos();

  useEffect(() => {
    if (!open) return;
    if (automation) {
      setDraft({
        id: automation.id,
        nome: automation.nome,
        descricao: automation.descricao ?? "",
        gatilho: automation.gatilho,
        status: automation.status,
        passos: automation.passos,
      });
    } else {
      setDraft({
        nome: "",
        descricao: "",
        gatilho: gatilhos[0] ?? "",
        status: "rascunho",
        passos: [],
      });
    }
    setEditandoId(null);
  }, [automation, open]);

  function atualizarCampo<K extends keyof DraftAutomation>(campo: K, valor: DraftAutomation[K]) {
    setDraft((d) => ({ ...d, [campo]: valor }));
  }

  function adicionarPasso(tipo: AutomationStep["tipo"]) {
    setDraft((d) => ({ ...d, passos: [...d.passos, passoDefault(tipo)] }));
  }

  function atualizarPasso(id: string, passo: AutomationStep) {
    setDraft((d) => ({ ...d, passos: d.passos.map((p) => (p.id === id ? passo : p)) }));
  }

  function removerPasso(id: string) {
    setDraft((d) => ({ ...d, passos: d.passos.filter((p) => p.id !== id) }));
  }

  function moverPasso(id: string, direcao: "cima" | "baixo") {
    setDraft((d) => {
      const idx = d.passos.findIndex((p) => p.id === id);
      if (idx < 0) return d;
      const novoIdx = direcao === "cima" ? idx - 1 : idx + 1;
      if (novoIdx < 0 || novoIdx >= d.passos.length) return d;
      const passos = [...d.passos];
      const atual = passos[idx];
      const alvo = passos[novoIdx];
      if (!atual || !alvo) return d;
      passos[idx] = alvo;
      passos[novoIdx] = atual;
      return { ...d, passos };
    });
  }

  const passoEditando = draft.passos.find((p) => p.id === editandoId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{automation ? "Editar automação" : "Nova automação"}</DialogTitle>
          <DialogDescription>
            Monte o fluxo da jornada: gatilho, condições, ações e esperas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-4">
          <div className="grid gap-3">
            <div>
              <Label htmlFor="auto-nome">Nome</Label>
              <Input
                id="auto-nome"
                placeholder="Ex: Novo lead — resposta imediata"
                value={draft.nome}
                onChange={(e) => atualizarCampo("nome", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="auto-descricao">Descrição</Label>
              <Textarea
                id="auto-descricao"
                placeholder="Para que serve esta automação?"
                value={draft.descricao}
                onChange={(e) => atualizarCampo("descricao", e.target.value)}
                rows={2}
              />
            </div>
            <div>
              <Label htmlFor="auto-gatilho">Gatilho</Label>
              <Select value={draft.gatilho} onValueChange={(v) => atualizarCampo("gatilho", v)}>
                <SelectTrigger id="auto-gatilho">
                  <SelectValue placeholder="Escolher gatilho" />
                </SelectTrigger>
                <SelectContent>
                  {gatilhos.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Fluxo de passos</Label>
              <span className="text-xs text-muted-foreground">
                {draft.passos.length} passo(s)
              </span>
            </div>

            <div className="space-y-2">
              {draft.passos.map((p, idx) => (
                <div
                  key={p.id}
                  className="surface-card flex items-start gap-3 p-3"
                >
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                    {iconePasso(p.tipo)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{labelPasso(p)}</p>
                    {resumoPasso(p) && (
                      <p className="truncate text-xs text-muted-foreground">{resumoPasso(p)}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => moverPasso(p.id, "cima")}
                      disabled={idx === 0}
                      aria-label="Mover para cima"
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => moverPasso(p.id, "baixo")}
                      disabled={idx === draft.passos.length - 1}
                      aria-label="Mover para baixo"
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => setEditandoId(p.id)}
                      aria-label="Editar passo"
                    >
                      <Edit2 className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-destructive hover:text-destructive"
                      onClick={() => removerPasso(p.id)}
                      aria-label="Remover passo"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              {draft.passos.length === 0 && (
                <p className="surface-card p-6 text-center text-sm text-muted-foreground">
                  Ainda não há passos. Adicione uma condição, ação ou espera.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => adicionarPasso("condicao")}>
                <GitBranch className="size-3.5" /> Condição
              </Button>
              <Button size="sm" variant="outline" onClick={() => adicionarPasso("acao")}>
                <Send className="size-3.5" /> Ação
              </Button>
              <Button size="sm" variant="outline" onClick={() => adicionarPasso("espera")}>
                <Clock className="size-3.5" /> Espera
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 pb-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button
            onClick={() => onSave(draft)}
            disabled={!draft.nome.trim() || !draft.gatilho || isSaving}
          >
            {isSaving ? "A guardar…" : automation ? "Guardar alterações" : "Criar automação"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <Sheet open={editandoId !== null} onOpenChange={(o) => !o && setEditandoId(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Editar passo</SheetTitle>
          </SheetHeader>
          {passoEditando ? (
            <StepForm
              step={passoEditando}
              etapas={etapas}
              modelos={modelos}
              onChange={(s) => {
                atualizarPasso(passoEditando.id, s);
              }}
            />
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">Selecione um passo para editar.</p>
          )}
          <div className="mt-6">
            <Button className="w-full" onClick={() => setEditandoId(null)}>
              <X className="size-4" /> Fechar edição
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </Dialog>
  );
}

type StepFormProps = {
  step: AutomationStep;
  etapas: { id: string; nome: string }[];
  modelos: { id: string; nome: string }[];
  onChange: (step: AutomationStep) => void;
};

function StepForm({ step, etapas, modelos, onChange }: StepFormProps) {
  if (step.tipo === "condicao") {
    return (
      <div className="mt-6 space-y-4">
        <div>
          <Label>Campo</Label>
          <Select
            value={step.campo}
            onValueChange={(v) =>
              onChange({ ...step, campo: v as CampoCondicao })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(condicaoCampoLabel).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Operador</Label>
          <Select
            value={step.operador}
            onValueChange={(v) =>
              onChange({ ...step, operador: v as OperadorCondicao })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(operadorLabel).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Valor</Label>
          <Input
            value={step.valor}
            onChange={(e) => onChange({ ...step, valor: e.target.value })}
            placeholder="Ex: whatsapp, Lead respondido, Ana Ribeiro"
          />
        </div>
      </div>
    );
  }

  if (step.tipo === "acao") {
    return (
      <div className="mt-6 space-y-4">
        <div>
          <Label>Ação</Label>
          <Select
            value={step.acao}
            onValueChange={(v) =>
              onChange({ ...step, acao: v as TipoAcao, parametros: {} })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(acaoLabel).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ActionParams
          acao={step.acao}
          parametros={step.parametros}
          etapas={etapas}
          modelos={modelos as { id: string; nome: string; canal: Canal }[]}
          onChange={(parametros) => onChange({ ...step, parametros })}
        />
      </div>
    );
  }

  if (step.tipo === "espera") {
    return (
      <div className="mt-6 space-y-4">
        <div>
          <Label>Duração</Label>
          <Input
            type="number"
            min={1}
            value={step.duracao}
            onChange={(e) =>
              onChange({ ...step, duracao: Math.max(1, Number(e.target.value) || 1) })
            }
          />
        </div>
        <div>
          <Label>Unidade</Label>
          <Select
            value={step.unidade}
            onValueChange={(v) =>
              onChange({ ...step, unidade: v as "minutos" | "horas" | "dias" })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutos">Minutos</SelectItem>
              <SelectItem value="horas">Horas</SelectItem>
              <SelectItem value="dias">Dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <div>
        <Label>Texto</Label>
        <Textarea
          value={step.texto}
          onChange={(e) => onChange({ ...step, texto: e.target.value })}
          rows={4}
        />
      </div>
    </div>
  );
}

type ActionParamsProps = {
  acao: TipoAcao;
  parametros: Record<string, string>;
  etapas: { id: string; nome: string }[];
  modelos: { id: string; nome: string; canal: Canal }[];
  onChange: (parametros: Record<string, string>) => void;
};

function ActionParams({ acao, parametros, etapas, modelos, onChange }: ActionParamsProps) {
  function setParam(chave: string, valor: string) {
    onChange({ ...parametros, [chave]: valor });
  }

  if (acao.startsWith("enviar_")) {
    const canal = acao.replace("enviar_", "") as Canal;
    const modeloId = parametros["modeloId"] ?? "";
    const modelosFiltrados = modelos.filter((m) => !canal || m.canal === canal);
    return (
      <div className="space-y-4">
        <div>
          <Label>Modelo de mensagem</Label>
          <Select value={modeloId} onValueChange={(v) => setParam("modeloId", v)}>
            <SelectTrigger>
              <SelectValue placeholder="Escolher modelo" />
            </SelectTrigger>
            <SelectContent>
              {modelosFiltrados.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.nome}
                </SelectItem>
              ))}
              {modelosFiltrados.length === 0 && (
                <SelectItem value="" disabled>
                  Nenhum modelo para este canal
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  if (acao === "adicionar_tag" || acao === "remover_tag") {
    return (
      <div className="space-y-4">
        <div>
          <Label>Tag</Label>
          <Input
            value={parametros["tag"] ?? ""}
            onChange={(e) => setParam("tag", e.target.value)}
            placeholder="Ex: Lead respondido"
          />
        </div>
      </div>
    );
  }

  if (acao === "mover_etapa") {
    return (
      <div className="space-y-4">
        <div>
          <Label>Etapa</Label>
          <Select value={parametros["etapa"] ?? ""} onValueChange={(v) => setParam("etapa", v)}>
            <SelectTrigger>
              <SelectValue placeholder="Escolher etapa" />
            </SelectTrigger>
            <SelectContent>
              {etapas.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  if (acao === "atribuir_responsavel") {
    return (
      <div className="space-y-4">
        <div>
          <Label>Responsável</Label>
          <Select value={parametros["responsavel"] ?? ""} onValueChange={(v) => setParam("responsavel", v)}>
            <SelectTrigger>
              <SelectValue placeholder="Escolher responsável" />
            </SelectTrigger>
            <SelectContent>
              {responsaveis.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  if (acao === "criar_tarefa") {
    return (
      <div className="space-y-4">
        <div>
          <Label>Título da tarefa</Label>
          <Input
            value={parametros["titulo"] ?? ""}
            onChange={(e) => setParam("titulo", e.target.value)}
            placeholder="Ex: Follow-up do orçamento"
          />
        </div>
      </div>
    );
  }

  if (acao === "chamar_webhook") {
    return (
      <div className="space-y-4">
        <div>
          <Label>URL do webhook</Label>
          <Input
            type="url"
            value={parametros["url"] ?? ""}
            onChange={(e) => setParam("url", e.target.value)}
            placeholder="https://..."
          />
        </div>
      </div>
    );
  }

  // pedir_sugestao_ia
  return (
    <p className="text-sm text-muted-foreground">
      A IA sugerirá uma resposta baseada no contexto da conversa. A revisão humana é obrigatória antes de enviar.
    </p>
  );
}
