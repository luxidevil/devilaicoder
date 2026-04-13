import { db, settingsTable } from "@workspace/db";

export type ProviderName = "gemini" | "anthropic" | "openai";

export interface ProviderSettings {
  provider: ProviderName;
  apiKey: string;
  model: string;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamChunk {
  text?: string;
  done?: boolean;
  error?: string;
}

export interface AgentResponse {
  textParts: string[];
  toolCalls: { name: string; args: Record<string, any> }[];
  finishReason?: string;
}

let cachedSettings: Record<string, string> = {};
let cacheTime = 0;
let cacheResolved = false;
const CACHE_TTL = 30_000;

export function invalidateSettingsCache() {
  cacheTime = 0;
  cacheResolved = false;
}

async function loadAllSettings(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cacheResolved && now - cacheTime < CACHE_TTL) {
    return cachedSettings;
  }
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  cachedSettings = map;
  cacheTime = now;
  cacheResolved = true;
  return map;
}

export async function getActiveProvider(): Promise<ProviderSettings | null> {
  const s = await loadAllSettings();
  const provider = (s["ai_provider"] ?? "gemini") as ProviderName;

  const keyMap: Record<ProviderName, string> = {
    gemini: "gemini_api_key",
    anthropic: "anthropic_api_key",
    openai: "openai_api_key",
  };

  const modelMap: Record<ProviderName, string> = {
    gemini: "gemini-2.0-flash",
    anthropic: "claude-sonnet-4-20250514",
    openai: "gpt-4o",
  };

  const apiKey = s[keyMap[provider]];
  if (!apiKey) return null;

  const model = s["ai_model"] ?? modelMap[provider];
  return { provider, apiKey, model };
}

export const PROVIDER_MODELS: Record<ProviderName, { value: string; label: string }[]> = {
  gemini: [
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash (Fast)" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Smarter)" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Most capable)" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro (Legacy)" },
  ],
  anthropic: [
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (Balanced)" },
    { value: "claude-opus-4-20250514", label: "Claude Opus 4 (Most capable)" },
    { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (Fast)" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o (Balanced)" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini (Fast)" },
    { value: "o3", label: "o3 (Reasoning)" },
    { value: "o4-mini", label: "o4-mini (Fast reasoning)" },
  ],
};

function geminiToolFormat(tools: ToolDeclaration[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: "OBJECT",
      properties: Object.keys(t.parameters.properties).length === 0
        ? undefined
        : Object.fromEntries(
            Object.entries(t.parameters.properties).map(([k, v]) => [
              k,
              { type: v.type.toUpperCase(), description: v.description },
            ])
          ),
      required: t.parameters.required,
    },
  }));
}

function openaiToolFormat(tools: ToolDeclaration[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(t.parameters.properties).map(([k, v]) => [
            k,
            { type: v.type.toLowerCase() === "number" ? "number" : "string", description: v.description },
          ])
        ),
        required: t.parameters.required ?? [],
      },
    },
  }));
}

function anthropicToolFormat(tools: ToolDeclaration[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object" as const,
      properties: Object.fromEntries(
        Object.entries(t.parameters.properties).map(([k, v]) => [
          k,
          { type: v.type.toLowerCase() === "number" ? "number" : "string", description: v.description },
        ])
      ),
      required: t.parameters.required ?? [],
    },
  }));
}

export async function streamChat(
  settings: ProviderSettings,
  systemPrompt: string,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<ReadableStream<StreamChunk>> {
  switch (settings.provider) {
    case "gemini":
      return streamGeminiChat(settings, systemPrompt, messages, signal);
    case "anthropic":
      return streamAnthropicChat(settings, systemPrompt, messages, signal);
    case "openai":
      return streamOpenAIChat(settings, systemPrompt, messages, signal);
  }
}

async function streamGeminiChat(
  settings: ProviderSettings,
  systemPrompt: string,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<ReadableStream<StreamChunk>> {
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:streamGenerateContent?alt=sse&key=${settings.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 65536, temperature: 0.3 },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    return new ReadableStream({
      start(controller) {
        controller.enqueue({ error: `Gemini API error ${response.status}: ${errText.slice(0, 200)}` });
        controller.enqueue({ done: true });
        controller.close();
      },
    });
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            const line = buffer.trim();
            if (line.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(line.slice(6));
                const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) controller.enqueue({ text });
              } catch {}
            }
          }
          controller.enqueue({ done: true });
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) controller.enqueue({ text });
            } catch {}
          }
        }
      } catch (err: any) {
        controller.enqueue({ error: err.message ?? "Stream read error" });
        controller.enqueue({ done: true });
        controller.close();
      }
    },
  });
}

async function streamAnthropicChat(
  settings: ProviderSettings,
  systemPrompt: string,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<ReadableStream<StreamChunk>> {
  const anthropicMessages = messages.map((m) => ({
    role: m.role === "user" ? "user" as const : "assistant" as const,
    content: m.content,
  }));

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal,
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 16384,
      system: systemPrompt,
      messages: anthropicMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return new ReadableStream({
      start(controller) {
        controller.enqueue({ error: `Anthropic API error ${response.status}: ${errText.slice(0, 200)}` });
        controller.enqueue({ done: true });
        controller.close();
      },
    });
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.enqueue({ done: true });
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (!data) continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                controller.enqueue({ text: parsed.delta.text });
              }
              if (parsed.type === "message_stop") {
                controller.enqueue({ done: true });
                controller.close();
                return;
              }
            } catch {}
          }
        }
      } catch (err: any) {
        controller.enqueue({ error: err.message ?? "Stream read error" });
        controller.enqueue({ done: true });
        controller.close();
      }
    },
  });
}

async function streamOpenAIChat(
  settings: ProviderSettings,
  systemPrompt: string,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<ReadableStream<StreamChunk>> {
  const oaiMessages = [
    { role: "system" as const, content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const isReasoningModel = settings.model.startsWith("o3") || settings.model.startsWith("o4") || settings.model.startsWith("o1");

  const body: any = {
    model: settings.model,
    messages: oaiMessages,
    stream: true,
  };
  if (!isReasoningModel) {
    body.max_completion_tokens = 16384;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    signal,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    return new ReadableStream({
      start(controller) {
        controller.enqueue({ error: `OpenAI API error ${response.status}: ${errText.slice(0, 200)}` });
        controller.enqueue({ done: true });
        controller.close();
      },
    });
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.enqueue({ done: true });
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              const text = parsed.choices?.[0]?.delta?.content;
              if (text) controller.enqueue({ text });
            } catch {}
          }
        }
      } catch (err: any) {
        controller.enqueue({ error: err.message ?? "Stream read error" });
        controller.enqueue({ done: true });
        controller.close();
      }
    },
  });
}

export async function agentCall(
  settings: ProviderSettings,
  systemPrompt: string,
  contents: any[],
  tools: ToolDeclaration[],
  signal?: AbortSignal
): Promise<AgentResponse> {
  switch (settings.provider) {
    case "gemini":
      return agentCallGemini(settings, systemPrompt, contents, tools, signal);
    case "anthropic":
      return agentCallAnthropic(settings, systemPrompt, contents, tools, signal);
    case "openai":
      return agentCallOpenAI(settings, systemPrompt, contents, tools, signal);
  }
}

async function agentCallGemini(
  settings: ProviderSettings,
  systemPrompt: string,
  contents: any[],
  tools: ToolDeclaration[],
  signal?: AbortSignal
): Promise<AgentResponse> {
  const geminiTools = geminiToolFormat(tools);
  const cleanedTools = geminiTools.map(t => {
    const params: any = { type: "OBJECT" };
    if (t.parameters.properties && Object.keys(t.parameters.properties).length > 0) {
      params.properties = t.parameters.properties;
    }
    if (t.parameters.required && t.parameters.required.length > 0) {
      params.required = t.parameters.required;
    }
    return { name: t.name, description: t.description, parameters: params };
  });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:generateContent?key=${settings.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools: [{ functionDeclarations: cleanedTools }],
        tool_config: { function_calling_config: { mode: "AUTO" } },
        generationConfig: { maxOutputTokens: 65536, temperature: 0.2 },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    return { textParts: [], toolCalls: [], finishReason: `error:${response.status}:${errText.slice(0, 200)}` };
  }

  const data = await response.json() as any;
  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts) {
    return { textParts: [], toolCalls: [], finishReason: "no_content" };
  }

  const parts = candidate.content.parts;
  const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text as string);
  const toolCalls = parts
    .filter((p: any) => p.functionCall)
    .map((p: any) => ({
      name: p.functionCall.name as string,
      args: (p.functionCall.args ?? {}) as Record<string, any>,
    }));

  return { textParts, toolCalls, finishReason: candidate.finishReason };
}

export function buildGeminiContents(
  history: { role: string; content: string }[],
  message: string
): any[] {
  const chatHistory = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  return [...chatHistory, { role: "user", parts: [{ text: message }] }];
}

export function appendGeminiModelParts(contents: any[], parts: any[]) {
  contents.push({ role: "model", parts });
}

export function appendGeminiToolResults(
  contents: any[],
  results: { name: string; result: string }[]
) {
  contents.push({
    role: "user",
    parts: results.map((r) => ({
      functionResponse: { name: r.name, response: { result: r.result } },
    })),
  });
}

async function agentCallAnthropic(
  settings: ProviderSettings,
  systemPrompt: string,
  contents: any[],
  tools: ToolDeclaration[],
  signal?: AbortSignal
): Promise<AgentResponse> {
  const messages = convertContentsToAnthropic(contents);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal,
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 16384,
      system: systemPrompt,
      messages,
      tools: anthropicToolFormat(tools),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return { textParts: [], toolCalls: [], finishReason: `error:${response.status}:${errText.slice(0, 200)}` };
  }

  const data = await response.json() as any;
  const textParts: string[] = [];
  const toolCalls: { name: string; args: Record<string, any> }[] = [];

  for (const block of data.content ?? []) {
    if (block.type === "text") textParts.push(block.text);
    if (block.type === "tool_use") {
      toolCalls.push({ name: block.name, args: block.input ?? {} });
    }
  }

  return { textParts, toolCalls, finishReason: data.stop_reason };
}

function convertContentsToAnthropic(contents: any[]): any[] {
  const messages: any[] = [];
  let idCounter = 0;
  let lastModelCallIds: string[] = [];

  for (const c of contents) {
    if (c.role === "user") {
      if (c.parts?.[0]?.functionResponse) {
        const toolResults = c.parts.map((p: any, idx: number) => ({
          type: "tool_result",
          tool_use_id: lastModelCallIds[idx] ?? `call_${idCounter++}`,
          content: typeof p.functionResponse.response?.result === "string"
            ? p.functionResponse.response.result
            : JSON.stringify(p.functionResponse.response),
        }));
        messages.push({ role: "user", content: toolResults });
      } else {
        const text = c.parts?.map((p: any) => p.text).filter(Boolean).join("") ?? c.content ?? "";
        if (text) messages.push({ role: "user", content: text });
      }
    } else if (c.role === "model" || c.role === "assistant") {
      const content: any[] = [];
      lastModelCallIds = [];
      for (const p of c.parts ?? []) {
        if (p.text) content.push({ type: "text", text: p.text });
        if (p.functionCall) {
          const callId = `call_${idCounter++}`;
          lastModelCallIds.push(callId);
          content.push({
            type: "tool_use",
            id: callId,
            name: p.functionCall.name,
            input: p.functionCall.args ?? {},
          });
        }
      }
      if (content.length > 0) messages.push({ role: "assistant", content });
    }
  }

  return messages;
}

async function agentCallOpenAI(
  settings: ProviderSettings,
  systemPrompt: string,
  contents: any[],
  tools: ToolDeclaration[],
  signal?: AbortSignal
): Promise<AgentResponse> {
  const messages = convertContentsToOpenAI(contents, systemPrompt);

  const isReasoningModel = settings.model.startsWith("o3") || settings.model.startsWith("o4") || settings.model.startsWith("o1");
  const body: any = {
    model: settings.model,
    messages,
    tools: openaiToolFormat(tools),
    tool_choice: "auto",
  };
  if (!isReasoningModel) {
    body.max_completion_tokens = 16384;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    signal,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    return { textParts: [], toolCalls: [], finishReason: `error:${response.status}:${errText.slice(0, 200)}` };
  }

  const data = await response.json() as any;
  const choice = data.choices?.[0];
  const msg = choice?.message;

  const textParts: string[] = msg?.content ? [msg.content] : [];
  const toolCalls: { name: string; args: Record<string, any> }[] = [];

  for (const tc of msg?.tool_calls ?? []) {
    if (tc.type === "function") {
      try {
        toolCalls.push({
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments ?? "{}"),
        });
      } catch {
        toolCalls.push({ name: tc.function.name, args: {} });
      }
    }
  }

  return { textParts, toolCalls, finishReason: choice?.finish_reason };
}

function convertContentsToOpenAI(contents: any[], systemPrompt: string): any[] {
  const messages: any[] = [{ role: "system", content: systemPrompt }];
  let idCounter = 0;
  let lastModelCallIds: string[] = [];

  for (const c of contents) {
    if (c.role === "user") {
      if (c.parts?.[0]?.functionResponse) {
        for (let i = 0; i < c.parts.length; i++) {
          const p = c.parts[i];
          messages.push({
            role: "tool",
            tool_call_id: lastModelCallIds[i] ?? `call_${idCounter++}`,
            content: typeof p.functionResponse.response?.result === "string"
              ? p.functionResponse.response.result
              : JSON.stringify(p.functionResponse.response),
          });
        }
      } else {
        const text = c.parts?.map((p: any) => p.text).filter(Boolean).join("") ?? c.content ?? "";
        if (text) messages.push({ role: "user", content: text });
      }
    } else if (c.role === "model" || c.role === "assistant") {
      const textContent = c.parts?.filter((p: any) => p.text).map((p: any) => p.text).join("") ?? "";
      const toolCallParts = c.parts?.filter((p: any) => p.functionCall) ?? [];

      lastModelCallIds = [];
      const msg: any = { role: "assistant" };
      if (textContent) msg.content = textContent;
      else msg.content = null;
      if (toolCallParts.length > 0) {
        msg.tool_calls = toolCallParts.map((p: any) => {
          const callId = `call_${idCounter++}`;
          lastModelCallIds.push(callId);
          return {
            id: callId,
            type: "function",
            function: {
              name: p.functionCall.name,
              arguments: JSON.stringify(p.functionCall.args ?? {}),
            },
          };
        });
      }
      messages.push(msg);
    }
  }

  return messages;
}
