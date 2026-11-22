
import { env } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function createServer() {
  const server = new McpServer({
    name: "Video Context Assistant",
    version: "1.3.0",
  });

  // Compactação simples de textos
  server.registerTool(
    "compact_text",
    {
      description:
        "Remove linhas vazias e duplicadas e limita o tamanho do texto. Use para reduzir resultados extensos sem repetir informações.",
      inputSchema: z.object({
        text: z.string(),
        max_characters: z.number().int().min(100).max(20000).default(6000),
      }),
    },
    async ({ text, max_characters }) => {
      const lines = text
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

      let result = [...new Set(lines)].join("\n");

      if (result.length > max_characters) {
        result =
          result.slice(0, max_characters) +
          "\n[Texto cortado: limite de caracteres atingido.]";
      }

      return { content: [{ type: "text", text: result }] };
    }
  );

  // Resumo para continuar projetos
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
    async data => {
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

  // Contagem de texto
  server.registerTool(
    "count_text",
    {
      description: "Conta palavras, caracteres e linhas de um texto.",
      inputSchema: z.object({ text: z.string() }),
    },
    async ({ text }) => {
      const words = text.trim()
        ? text.trim().split(/\s+/).length
        : 0;

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

  // Salvar memória
  server.registerTool(
    "save_memory",
    {
      description:
        "Salva informações duradouras do projeto na memória persistente. Não salve senhas ou dados secretos.",
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

  // Recuperar memória pelo nome
  server.registerTool(
    "load_memory",
    {
      description:
        "Recupera uma memória pelo nome exato da chave.",
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

  // Pesquisar informações relevantes nas memórias
  server.registerTool(
    "search_memory",
    {
      description:
        "Pesquisa informações relevantes nas memórias salvas. Use quando precisar encontrar decisões, regras ou detalhes sem carregar todas as memórias.",
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        max_results: z.number().int().min(1).max(10).default(5),
      }),
    },
    async ({ query, max_results }) => {
      const listing = await env.VIDEO_MEMORY.list({
        prefix: "project:",
        limit: 1000,
      });

      const terms = [
        ...new Set(
          normalizeText(query).match(/[a-z0-9]{3,}/g) ?? []
        ),
      ];

      const memories = await Promise.all(
        listing.keys.map(async item => {
          const content = await env.VIDEO_MEMORY.get(item.name);

          if (!content) return null;

          const searchable = normalizeText(
            item.name + " " + content
          );

          const score = terms.reduce(
            (total, term) =>
              total + (searchable.includes(term) ? 1 : 0),
            0
          );

          if (score === 0) return null;

          return {
            key: item.name.replace("project:", ""),
            content,
            score,
          };
        })
      );

      const results = memories
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, max_results);

      if (results.length === 0) {
        return {
          content: [{
            type: "text",
            text: "Nenhuma memória relevante encontrada para essa pesquisa.",
          }],
        };
      }

      const output = results.map(item =>
        `## Memória: ${item.key}\n` +
        `Relevância: ${item.score}/${terms.length}\n` +
        item.content
      ).join("\n\n---\n\n");

      return {
        content: [{
          type: "text",
          text: output,
        }],
      };
    }
  );

  // Estatísticas da memória
  server.registerTool(
    "ctx_stats",
    {
      description:
        "Mostra estatísticas das memórias persistentes, incluindo quantidade de registros e caracteres armazenados.",
      inputSchema: z.object({}),
    },
    async () => {
      const listing = await env.VIDEO_MEMORY.list({
        prefix: "project:",
        limit: 1000,
      });

      const contents = await Promise.all(
        listing.keys.map(item =>
          env.VIDEO_MEMORY.get(item.name)
        )
      );

      const totalCharacters = contents.reduce(
        (total, content) => total + (content?.length ?? 0),
        0
      );

      return {
        content: [{
          type: "text",
          text: [
            "ESTATÍSTICAS DO CONTEXT BRIDGE",
            `Memórias encontradas: ${listing.keys.length}`,
            `Caracteres armazenados: ${totalCharacters}`,
            `Limite desta consulta: 1000 registros`,
            `Listagem completa: ${listing.list_complete ? "Sim" : "Não"}`,
          ].join("\n"),
        }],
      };
    }
  );

  // Diagnóstico da conexão
  server.registerTool(
    "ctx_doctor",
    {
      description:
        "Verifica se a conexão com o armazenamento persistente está funcionando.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        if (!env.VIDEO_MEMORY) {
          throw new Error("Binding VIDEO_MEMORY não encontrado.");
        }

        await env.VIDEO_MEMORY.list({
          prefix: "project:",
          limit: 1,
        });

        return {
          content: [{
            type: "text",
            text:
              "DIAGNÓSTICO: APROVADO\n" +
              "Binding VIDEO_MEMORY: disponível\n" +
              "Acesso ao KV: funcionando",
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text:
              "DIAGNÓSTICO: FALHOU\n" +
              `Erro: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    }
  );

  // Compressão real usando o Headroom Proxy
  server.registerTool(
    "headroom_compress",
    {
      description:
        "Envia mensagens ao Headroom Proxy para compressão. Retorna mensagens resultantes, estatísticas e transformações aplicadas. Só processa o conteúdo enviado explicitamente nesta chamada; não altera automaticamente o histórico interno da conversa.",
      inputSchema: z.object({
        messages: z.array(
          z.object({
            role: z.string(),
            content: z.unknown(),
          }).passthrough()
        ).min(1),
        model: z.string().default("claude-sonnet-4-6"),
        target_ratio: z.number().min(0.1).max(1).optional(),
      }),
    },
    async ({ messages, model, target_ratio }) => {
      const bindings = env as typeof env & {
        HEADROOM_PROXY_URL?: string;
        HEADROOM_PROXY_TOKEN?: string;
      };

      const baseUrl = bindings.HEADROOM_PROXY_URL?.replace(/\/+$/, "");
      const token = bindings.HEADROOM_PROXY_TOKEN;

      // Diagnóstico individual das variáveis
      if (!baseUrl || !token) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text:
              "DIAGNÓSTICO HEADROOM:\n" +
              `HEADROOM_PROXY_URL: ${baseUrl ? "ENCONTRADA" : "AUSENTE"}\n` +
              `HEADROOM_PROXY_TOKEN: ${token ? "ENCONTRADO" : "AUSENTE"}`,
          }],
        };
      }

      try {
        const response = await fetch(`${baseUrl}/v1/compress`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Headroom-Proxy-Token": token,
          },
          body: JSON.stringify({
            messages,
            model,
            config: {
              mode: "lossy_inline",
              compress_user_messages: true,
              target_ratio: target_ratio ?? 0.5,
              protect_recent: 0,
            },
          }),
        });

        const responseText = await response.text();

        if (!response.ok) {
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text:
                `Headroom retornou HTTP ${response.status}: ` +
                responseText.slice(0, 3000),
            }],
          };
        }

        const result = JSON.parse(responseText);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              messages: result.messages,
              tokens_before: result.tokens_before,
              tokens_after: result.tokens_after,
              tokens_saved: result.tokens_saved,
              compression_ratio: result.compression_ratio,
              transforms_applied: result.transforms_applied,
              transforms_summary: result.transforms_summary ?? null,
              compression_skipped: result.compression_skipped ?? false,
              skip_reason: result.skip_reason ?? null,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text:
              `Falha ao conectar ao Headroom: ${
                error instanceof Error ? error.message : String(error)
              }`,
          }],
        };
      }
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
