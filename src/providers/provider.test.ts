import { describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { serializeChatRequest, OpenAICompatibleProvider } from "./openai-compatible.js";
import type { ProviderRequest } from "../core/types.js";
import { SideSightError, redactSecrets } from "../core/errors.js";

const request: ProviderRequest = {
  model: "vision-test",
  systemPrompt: "safe system",
  userPrompt: "Read the visible text",
  images: [{ data: Buffer.from("png-bytes"), mimeType: "image/png", source: "fixture.png", detail: "high" }],
  videos: [],
  maxTokens: 321,
  timeoutMs: 2_000,
};

describe("OpenAI-compatible provider", () => {
  it("serializes multimodal chat-completions content", () => {
    const body = serializeChatRequest(request, false);
    expect(body.model).toBe("vision-test");
    expect(body.messages[1]?.content).toEqual([
      { type: "text", text: "Read the visible text" },
      { type: "image_url", image_url: { url: "data:image/png;base64,cG5nLWJ5dGVz", detail: "high" } },
    ]);
  });

  it("reads an actual local mock endpoint and normalizes usage", async () => {
    const server = await new Promise<Server>((resolve) => {
      const instance = createServer((incoming: IncomingMessage, outgoing: ServerResponse) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { messages: Array<{ content: unknown }> };
          expect(JSON.stringify(body)).toContain("data:image/png;base64");
          outgoing.setHeader("content-type", "application/json");
          outgoing.end(JSON.stringify({ choices: [{ message: { content: '{"answer":"mocked","confidence":0.95}' } }], usage: { prompt_tokens: 12, completion_tokens: 7 } }));
        });
      });
      instance.listen(0, "127.0.0.1", () => resolve(instance));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock server did not bind");
    const provider = new OpenAICompatibleProvider({ baseUrl: `http://127.0.0.1:${address.port}/v1`, model: "vision-test", profile: "test" });
    const response = await provider.analyze(request);
    expect(response.text).toContain("mocked");
    expect(response.inputTokens).toBe(12);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("normalizes text-only backend failures without leaking credentials", async () => {
    const server = createServer((_incoming, outgoing) => {
      outgoing.statusCode = 400;
      outgoing.setHeader("content-type", "application/json");
      outgoing.end(JSON.stringify({ error: { message: "Model only support text input; image content rejected. Bearer secret-test-key" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock server did not bind");
    const provider = new OpenAICompatibleProvider({ baseUrl: `http://127.0.0.1:${address.port}/v1`, model: "text-only", profile: "test", apiKey: "secret-test-key" });
    try {
      let caught: unknown;
      try {
        await provider.analyze(request);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SideSightError);
      if (caught instanceof SideSightError) {
        expect(caught.code).toBe("TEXT_ONLY_MODEL");
        expect(caught.message).not.toContain("secret-test-key");
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("redacts bearer tokens and media data from diagnostics", () => {
    const redacted = redactSecrets("Bearer secret-token data:image/png;base64,AAAA", ["secret-token"]);
    expect(redacted).not.toContain("secret-token");
    expect(redacted).not.toContain("AAAA");
    expect(redacted).toContain("[MEDIA_REDACTED]");
  });
});
