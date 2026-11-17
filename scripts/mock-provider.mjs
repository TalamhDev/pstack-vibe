// The usage chunk is mandatory: without it vibe 3.1.2 dies with "the provider
// reply is unusable: the server returned no token usage".
import { createServer } from "node:http";

const MODEL = "mock-model";

function event(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function streamBody(reply) {
  const base = { id: "x", object: "chat.completion.chunk", created: 0, model: MODEL };
  return [
    event({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }] }),
    event({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
    event({ ...base, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
    "data: [DONE]\n\n",
  ].join("");
}

export async function startMockProvider({ reply = "ok" } = {}) {
  const requests = [];
  const body = streamBody(reply);

  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        requests.push(JSON.parse(text));
      } catch {
        requests.push({ raw: text });
      }
      if (!request.url.endsWith("/chat/completions")) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.end(body);
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    apiBase: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
