
  // Pesquisar informações relevantes nas memórias
  server.registerTool(
    "search_memory",
    {
      description:
        "Pesquisa informações relevantes nas memórias salvas, incluindo busca por chave exata, frases e palavras. Percorre todas as páginas do KV.",
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        max_results: z.number().int().min(1).max(10).default(5),
      }),
    },
    async ({ query, max_results }) => {
      const normalizeSearch = (value: string): string =>
        normalizeText(value)
          .replace(/[^a-z0-9]+/g, " ")
          .trim()
          .replace(/\s+/g, " ");

      const normalizedQuery = normalizeSearch(query);

      const terms = [
        ...new Set(
          normalizedQuery
            .split(" ")
            .filter(term => term.length >= 2)
        ),
      ];

      // Primeiro: tenta recuperar diretamente pela chave exata.
      const exactKey = query.trim().replace(/^project:/, "");
      const exactContent = await env.VIDEO_MEMORY.get(
        `project:${exactKey}`
      );

      if (exactContent !== null) {
        return {
          content: [{
            type: "text",
            text:
              `## Memória: ${exactKey}\n` +
              "Correspondência: chave exata\n\n" +
              exactContent,
          }],
        };
      }

      // Segundo: percorre todas as páginas do KV.
      const allKeys: { name: string }[] = [];
      let cursor: string | undefined;
      let listComplete = false;

      while (!listComplete) {
        const page = await env.VIDEO_MEMORY.list({
          prefix: "project:",
          limit: 1000,
          ...(cursor ? { cursor } : {}),
        });

        allKeys.push(...page.keys);
        listComplete = page.list_complete;
        cursor = page.cursor;

        if (!listComplete && !cursor) {
          break;
        }
      }

      const memories = await Promise.all(
        allKeys.map(async item => {
          const content = await env.VIDEO_MEMORY.get(item.name);

          if (content === null) return null;

          const key = item.name.replace(/^project:/, "");
          const searchable = normalizeSearch(
            `${key} ${content}`
          );

          let score = 0;

          // Correspondência da frase completa.
          if (
            normalizedQuery.length >= 3 &&
            searchable.includes(normalizedQuery)
          ) {
            score += terms.length + 3;
          }

          // Correspondência individual dos termos.
          for (const term of terms) {
            if (searchable.split(" ").includes(term)) {
              score += 1;
            }
          }

          if (score === 0) return null;

          return { key, content, score };
        })
      );

      const results = memories
        .filter(
          (item): item is NonNullable<typeof item> =>
            item !== null
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, max_results);

      if (results.length === 0) {
        return {
          content: [{
            type: "text",
            text:
              "Nenhuma memória relevante encontrada.\n" +
              `Pesquisa: ${query}\n` +
              `Chaves consultadas: ${allKeys.length}\n` +
              `Termos identificados: ${terms.join(", ") || "nenhum"}`,
          }],
        };
      }

      const output = results.map(item =>
        `## Memória: ${item.key}\n` +
        `Relevância: ${item.score}\n` +
        item.content
      ).join("\n\n---\n\n");

      return {
        content: [{
          type: "text",
          text:
            `Memórias encontradas: ${results.length}\n\n` +
            output,
        }],
      };
    }
  );
