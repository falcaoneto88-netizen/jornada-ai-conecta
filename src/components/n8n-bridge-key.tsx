import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
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
import { criarChaveN8n } from "@/lib/n8n-bridge.functions";

type Props = { configurada: boolean; podeCriar: boolean; schemaDisponivel: boolean };

/**
 * Criação guiada da chave do n8n. A chave vive só em estado React deste diálogo:
 * nunca em storage, URL, cache de queries ou analytics. Limpa ao fechar/desmontar.
 */
export function ChaveN8nSetup({ configurada, podeCriar, schemaDisponivel }: Props) {
  const criar = useServerFn(criarChaveN8n);
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [chave, setChave] = useState<string | null>(null);
  const [aCriar, setACriar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copia, setCopia] = useState<string | null>(null);

  useEffect(() => () => setChave(null), []);

  function fechar() {
    setChave(null);
    setErro(null);
    setCopia(null);
    setAberto(false);
    void qc.invalidateQueries({ queryKey: ["n8n-bridge"] });
  }

  async function confirmar() {
    if (aCriar || chave) return;
    setACriar(true);
    setErro(null);
    try {
      const r = await criar({ data: { confirm: true } });
      if (r.ok) setChave(r.key);
      else setErro(r.message);
    } catch {
      setErro("Não foi possível criar a chave. Nenhuma chave foi mostrada.");
    } finally {
      setACriar(false);
    }
  }

  async function copiar() {
    if (!chave) return;
    try {
      await navigator.clipboard.writeText(chave);
      setCopia("Chave copiada.");
    } catch {
      setCopia("Não foi possível copiar. Selecione o campo e copie manualmente.");
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">Chave de ligação</span>
        <Badge variant={configurada ? "default" : "outline"}>
          {configurada ? "Configurada" : "Por criar"}
        </Badge>
      </div>
      {!configurada && !schemaDisponivel && (
        <p className="text-xs text-muted-foreground">
          Criação indisponível até a atualização do servidor ser aplicada.
        </p>
      )}
      {!configurada && podeCriar && (
        <Button size="sm" variant="outline" onClick={() => setAberto(true)}>
          Criar chave para o n8n
        </Button>
      )}

      <Dialog open={aberto} onOpenChange={(o) => (o ? setAberto(true) : fechar())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chave para o n8n</DialogTitle>
            <DialogDescription>
              Esta chave permite ao seu n8n consultar consultas e contactos e pedir apenas os tipos
              de mensagem configurados, quando a ponte estiver ligada. Criar a chave não ativa
              nenhum envio real. Só será mostrada uma vez.
            </DialogDescription>
          </DialogHeader>

          {!chave ? (
            <>
              {erro && <p className="text-sm text-destructive">{erro}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={fechar}>
                  Cancelar
                </Button>
                <Button onClick={confirmar} disabled={aCriar}>
                  {aCriar ? "A criar…" : "Criar chave"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="n8n-chave">Chave (mostrada só agora)</Label>
                <Input
                  id="n8n-chave"
                  type="password"
                  readOnly
                  value={chave}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <Button size="sm" variant="outline" onClick={copiar}>
                Copiar chave
              </Button>
              {copia && <p className="text-xs text-muted-foreground">{copia}</p>}
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                <li>No n8n, abra o workflow de confirmação de consultas.</li>
                <li>Abra o nó “GHL Contacto Inicial”.</li>
                <li>Em credencial, escolha “Connect to Bearer Auth”.</li>
                <li>
                  Cole a chave no campo “Bearer Token” — só a chave, sem escrever “Bearer” antes.
                </li>
                <li>Clique em “Save”.</li>
              </ol>
              <p className="text-xs text-muted-foreground">
                Depois a mesma credencial guardada será reutilizada nos outros 3 nós HTTP. Nunca
                cole esta chave no chat nem a envie por mensagem.
              </p>
              <DialogFooter>
                <Button onClick={fechar}>Já guardei a chave</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
