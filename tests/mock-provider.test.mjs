import { test } from "node:test";
import assert from "node:assert/strict";
import { startMockProvider } from "../scripts/mock-provider.mjs";

test("the mock provider streams a chat completion and records the request", async () => {
  const provider = await startMockProvider();
  try {
    const response = await fetch(`${provider.apiBase}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    assert.match(response.headers.get("content-type"), /^text\/event-stream/);

    const body = await response.text();
    assert.ok(body.trimEnd().endsWith("data: [DONE]"), `body does not end with the done marker:\n${body}`);

    const chunks = body
      .split("\n\n")
      .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
      .map((line) => JSON.parse(line.slice("data: ".length)));

    assert.equal(chunks.filter((chunk) => chunk.usage).length, 1, "exactly one chunk must carry usage");
    assert.equal(chunks[0].choices[0].delta.content, "ok");
    assert.equal(provider.requests[0].messages[0].content, "hi");
  } finally {
    await provider.close();
  }
});
