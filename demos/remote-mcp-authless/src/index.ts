
import { env } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

function createServer() {
  const server = new McpServer({
    name: "Video Context Assistant",
    version: "1.1.0",
  });

  server.registerTool(
    "compact_text",
    {
      description:
        "Compacta textos removendo linhas vazias e duplicadas. Use quando receber textos longos ou repetitivos para reduzir conteúdo desnecessário.",
      inputSchema: z.object({
        text: z.string(),
        max_characters: z.number().int().min(100).max(20000).default(6000),
      }),
    },
    async ({ text, max_characters }) => {
      const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
      let result = [...new Set(lines)].join("\n");

      if (result.length > max_characters) {
        result = result.slice(0, max_characters) +
          "\n[Texto cortado: limite de caracteres atingido.]";
      }

      return { content: [{ type: "text", text: result }] };
    }
  );

  server.registerTool(
    "prepare_handoff",
    {
      description:
        "Cria um resumo organizado para continuar um projeto em outra conversa.",
      inputSchema: z.object({
        project: z.string(),
        rules: z.string(),
        visual_style: z.string(),
        decisions: z.string(),
        current_task: z.string(),
        next_step: z.string(),
      }),
    },
    async (data) => {
      const result = [
        "# RESUMO DE CONTINUIDADE",
        "## PROJETO", data.project,
        "## REGRAS IMPORTANTES", data.rules,
        "## IDENTIDADE VISUAL", data.visual_style,
        "## DECISÕES JÁ TOMADAS", data.decisions,
        "## TAREFA ATUAL", data.current_task,
        "## PRÓXIMO PASSO", data.next_step,
        "Continue respeitando as regras e decisões acima."
      ].join("\n\n");

      return { content: [{ type: "text", text: result }] };
    }
  );

  server.registerTool(
    "count_text",
    {
      description: "Conta palavras, caracteres e linhas de um texto.",
      inputSchema: z.object({ text: z.string() }),
    },
    async ({ text }) => {
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;

      return {
        content: [{
          type: "text",
          text: [
            `Palavras: ${words}`,
            `Caracteres: ${text.length}`,
            `Linhas: ${text.split("\n").length}`,
          ].join("\n"),
        }],
      };
    }
  );

  server.registerTool(
    "save_memory",
    {
      description:
        "Salva informações importantes e duradouras do projeto na memória persistente. Use para guardar regras do canal, identidade visual, preferências e decisões aprovadas. Não salve senhas ou dados secretos.",
      inputSchema: z.object({
        key: z.string().min(1).max(100),
        content: z.string().min(1).max(20000),
      }),
    },
    async ({ key, content }) => {
      await env.VIDEO_MEMORY.put(
        `project:${key}`,
        content,
        { metadata: { updatedAt: new Date().toISOString() } }
      );

      return {
        content: [{
          type: "text",
          text: `Memória "${key}" salva com sucesso.`,
        }],
      };
    }
  );

  server.registerTool(
    "load_memory",
    {
      description:
        "Recupera informações da memória persistente. Consulte no início de novos trabalhos para recuperar regras, identidade visual e decisões anteriores do projeto.",
      inputSchema: z.object({
        key: z.string().min(1).max(100),
      }),
    },
    async ({ key }) => {
      const content = await env.VIDEO_MEMORY.get(`project:${key}`);

      return {
        content: [{
          type: "text",
          text: content ?? `Nenhuma memória encontrada para "${key}".`,
        }],
      };
    }
  );

  return server;
}

const handler = createMcpHandler(createServer);

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
