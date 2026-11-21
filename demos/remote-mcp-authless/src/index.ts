
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

function createServer() {
  const server = new McpServer({
    name: "Video Context Assistant",
    version: "1.0.0",
  });

  server.registerTool(
    "compact_text",
    {
      description:
        "Remove linhas vazias e duplicadas e organiza um texto para economizar espaço.",
      inputSchema: z.object({
        text: z.string(),
        max_characters: z.number().int().min(100).max(20000).default(6000),
      }),
    },
    async ({ text, max_characters }) => {
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      const uniqueLines = [...new Set(lines)];
      let result = uniqueLines.join("\n");

      const truncated = result.length > max_characters;

      if (truncated) {
        result =
          result.slice(0, max_characters) +
          "\n[Texto cortado: limite de caracteres atingido.]";
      }

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    }
  );

  server.registerTool(
    "prepare_handoff",
    {
      description:
        "Cria um resumo organizado para continuar um projeto de vídeos em outra conversa.",
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
        "",
        "## PROJETO",
        data.project,
        "",
        "## REGRAS IMPORTANTES",
        data.rules,
        "",
        "## IDENTIDADE VISUAL",
        data.visual_style,
        "",
        "## DECISÕES JÁ TOMADAS",
        data.decisions,
        "",
        "## TAREFA ATUAL",
        data.current_task,
        "",
        "## PRÓXIMO PASSO",
        data.next_step,
        "",
        "INSTRUÇÃO: Continue o projeto respeitando as regras e decisões acima. Não refaça etapas já concluídas."
      ].join("\n");

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    }
  );

  server.registerTool(
    "count_text",
    {
      description:
        "Conta palavras, caracteres e linhas de um texto.",
      inputSchema: z.object({
        text: z.string(),
      }),
    },
    async ({ text }) => {
      const words = text.trim()
        ? text.trim().split(/\s+/).length
        : 0;

      const result = [
        `Palavras: ${words}`,
        `Caracteres: ${text.length}`,
        `Linhas: ${text.split("\n").length}`,
      ].join("\n");

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
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
