// Local-only demonstration: actual service + actual temporary PostgreSQL,
// fixture HighLevel/OpenAI, fictional authenticated operator. Never deployed.
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

let service,
  db,
  ORG,
  ACTOR,
  event,
  latest,
  mode = "normal";
const deliveries = [],
  trace = [];
const port = 4191;
const vite = await createServer({
  configFile: false,
  envDir: tmpdir(),
  root: process.cwd(),
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    react(),
    tailwind(),
    {
      name: "fictional-demo-api",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/demo-api/")) return next();
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          if (
            req.headers.host !== `127.0.0.1:${port}` ||
            (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}`)
          ) {
            res.statusCode = 403;
            res.end('{"error":"local_demo_only"}');
            return;
          }
          try {
            let body = "";
            for await (const chunk of req) {
              body += chunk;
              if (body.length > 4096) throw new Error("too_large");
            }
            const input = body ? JSON.parse(body) : {};
            let result = {};
            if (req.method === "GET" && req.url === "/demo-api/state")
              result = { view: await service.list(ORG, ACTOR), trace, deliveries };
            else if (req.method === "POST" && req.url === "/demo-api/receive") {
              mode = input.scenario ?? "normal";
              const text = {
                normal: "Olá, quanto custa a consulta?",
                human: "Quero falar com o Danilo",
                stop: "Parem de me procurar",
                conflict:
                  "No atendimento anterior disseram que a consulta custa 30 €. Esse valor continua?",
                timeout: "Qual é o preço da consulta?",
              }[mode];
              if (!text) throw new Error("invalid_scenario");
              event = {
                type: "InboundMessage",
                locationId: "loc-test",
                contactId: "c-test",
                conversationId: "v-test",
                messageId: `demo-${randomUUID()}`,
              };
              latest = {
                event,
                name: "Ana Teste · contato fictício",
                dnd: false,
                historyHash: event.messageId,
                messages: [
                  {
                    id: "prior-fixture",
                    at: new Date(Date.now() - 3600000).toISOString(),
                    text: "Tenho interesse em uma avaliação em Lisboa.",
                    direction: "inbound",
                    channel: "WhatsApp",
                    attachments: 0,
                    provider: null,
                  },
                  {
                    id: event.messageId,
                    at: new Date().toISOString(),
                    text,
                    direction: "inbound",
                    channel: "WhatsApp",
                    attachments: 0,
                    provider: null,
                  },
                ],
              };
              result = await service.receive(ORG, event);
              trace.push("Webhook recebido e persistido no PostgreSQL de teste");
              await service.work(ORG);
              trace.push("Processador da fila executado sem ChatGPT");
            } else if (req.method === "POST" && req.url === "/demo-api/duplicate") {
              if (!event) throw new Error("receive_first");
              result = await service.receive(ORG, event);
              trace.push(`Webhook repetido: ${result.status}`);
            } else if (req.method === "POST" && req.url === "/demo-api/approve") {
              trace.push("Operador fictício aprovou o texto e a versão específicos");
              result = await service.approve(ORG, ACTOR, input, true);
              trace.push(`Resultado registrado: ${result.state}`);
            } else if (req.method === "POST" && req.url === "/demo-api/reject")
              result = await service.reject(ORG, ACTOR, input);
            else if (req.method === "POST" && req.url === "/demo-api/pause") {
              result = await service.pause(
                ORG,
                ACTOR,
                input.contactId,
                input.expectedVersion,
                input.paused,
              );
              trace.push(
                input.paused ? "Pausa humana persistida" : "Retomada autenticada persistida",
              );
            } else if (req.method === "POST" && req.url === "/demo-api/reset") {
              await db.sql`truncate commercial_agent_drafts,commercial_agent_inbox,commercial_agent_sessions,commercial_agent_audit restart identity cascade`;
              trace.length = 0;
              deliveries.length = 0;
            } else {
              res.statusCode = 404;
              result = { error: "not_found" };
            }
            res.end(JSON.stringify(result));
          } catch (e) {
            res.statusCode = 409;
            res.end(
              JSON.stringify({
                error: /^[a-z_]{1,60}$/.test(e.message) ? e.message : "demo_error",
              }),
            );
          }
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port, strictPort: true, open: false },
});
const pg = await vite.ssrLoadModule("/test/commercial-agent-db.ts");
const { CommercialAgent } = await vite.ssrLoadModule("/src/lib/commercial-agent/service.server.ts");
const { POLICY_HASH } = await vite.ssrLoadModule("/src/lib/commercial-agent/providers.server.ts");
ORG = pg.ORG;
ACTOR = pg.ACTOR;
db = await pg.startCommercialDb();
service = new CommercialAgent({
  store: db.store,
  encryptionKey: randomBytes(32).toString("base64"),
  enabled: true,
  sendEnabled: true,
  provider: {
    history: async () => {
      trace.push("Histórico recuperado do HighLevel simulado pelo ID exato");
      return structuredClone(latest);
    },
    send: async (snapshot, text) => {
      if (mode === "timeout") throw new Error("simulated timeout");
      const sent = {
        conversationId: snapshot.event.conversationId,
        contactId: snapshot.event.contactId,
        message: text,
        messageId: `sent-${randomUUID()}`,
      };
      deliveries.push(sent);
      trace.push("Mensagem aceita na conversa v-test do provedor simulado");
      return { state: "sent", code: null, messageId: sent.messageId };
    },
  },
  generate: async (snapshot) => {
    trace.push("Resposta gerada pelo simulador da OpenAI com a base V02");
    return {
      snapshot,
      policyHash: POLICY_HASH,
      model: "fixture — OpenAI simulada",
      inputTokens: 0,
      outputTokens: 0,
      decision: {
        reply:
          mode === "conflict"
            ? "Há uma diferença em relação ao valor informado anteriormente. A equipe precisa revisar essa informação."
            : "A consulta de avaliação custa 50 €, separadamente do procedimento e sem obrigação de contratá-lo. Posso explicar como funciona?",
        flags: mode === "conflict" ? ["commercial_conflict"] : [],
        handoff: false,
        optOut: false,
      },
    };
  },
});
await vite.listen();
console.log(`Demonstração fictícia: http://127.0.0.1:${port}/demo/commercial-agent.html`);
async function shutdown() {
  await vite.close();
  await db.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
