import { describe, expect, it } from "vitest";
import { buildOpenAIRequest, extractResponseText } from "../src/openaiClient";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("buildOpenAIRequest", () => {
  it("targets the Responses API with note context and plugin instructions", () => {
    const request = buildOpenAIRequest({
      settings: {
        ...DEFAULT_SETTINGS,
        openAIApiKey: "sk-test",
        openAIBaseUrl: "https://api.openai.com/v1/",
        openAIModel: "gpt-5.2"
      },
      task: "Suggest edits",
      notePath: "20-notes/example.md",
      noteContent: "# Example\n\nA rough note.",
      vaultInstructions: "Do not publish private notes."
    });

    expect(request.url).toBe("https://api.openai.com/v1/responses");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toMatchObject({
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json"
    });

    const body = JSON.parse(String(request.init.body));
    expect(body.model).toBe("gpt-5.2");
    expect(body.instructions).toContain("Obsidian vault");
    expect(body.input).toContain("20-notes/example.md");
    expect(body.input).toContain("Do not publish private notes.");
    expect(body.input).toContain("# Example");
  });
});

describe("extractResponseText", () => {
  it("prefers output_text when present", () => {
    expect(extractResponseText({ output_text: "Use this" })).toBe("Use this");
  });

  it("falls back to nested message content text", () => {
    expect(
      extractResponseText({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "Nested text"
              }
            ]
          }
        ]
      })
    ).toBe("Nested text");
  });
});
