import * as vscode from "vscode";
import * as https from "https";
import * as http from "http";
import * as crypto from "crypto"; // Add this if missing

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export class LumoApiClient {
  private defaultEndpoint = "https://lumo.proton.me/api/ai/v1/chat";
  // The Session-Id cookie you found
  // private sessionId = 'aBDCfKlnBlnADwSTIoELcAAAARY';
  // private sessionId = 'adGkSFa-UHuswc6nFvSrtQAAAMM';

  public async chat(
    messages: ChatMessage[],
    accessToken: string,
    workspaceContext?: any,
    useCookieFallback: boolean = false,
  ): Promise<string> {
    const endpoint = this.defaultEndpoint;
    const systemPrompt = this.buildSystemPrompt(workspaceContext);

    const turns = [
      { role: "system", content: systemPrompt, images: [] },
      ...messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        images: [],
      })),
    ];

    const payload = {
      Prompt: {
        type: "generation_request",
        turns: turns,
        options: {
          tools: ["proton_info", "web_search", "weather", "stock", "cryptocurrency"],
        },
      },
      targets: ["message", "title"],
      request_key: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
    };

    const data = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      const url = new URL(endpoint);
      const transport = url.protocol === "https:" ? https : http;

      const headers: any = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "x-pm-appversion": "web-lumo@1.3.3.0", // Revert to the working version!
        Accept: "text/event-stream",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      };

      if (useCookieFallback) {
        // CRITICAL: Read the Session ID from VS Code Settings
        const config = vscode.workspace.getConfiguration("lumo");
        const sessionId = config.get<string>("sessionId");

        if (!sessionId) {
          reject(new Error('Session ID not configured in VS Code settings. Please set "lumo.sessionId".'));
          return;
        }

        headers["Cookie"] = `Session-Id=${sessionId}`;
        console.log("🍪 Using Session ID from settings:", sessionId.substring(0, 10) + "...");
      } else {
        headers["Authorization"] = `Bearer ${accessToken}`;
        console.log("🔑 Using OAuth token");
      }

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: "POST",
        headers: headers,
      };

      // Set a timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        req.destroy();
        reject(new Error("Request timed out after 10 seconds. The cookie might be expired."));
      }, 10000);

      const req = transport.request(options, (res) => {
        clearTimeout(timeoutId);

        let fullResponse = "";

        if (res.statusCode && res.statusCode >= 400) {
          let errorData = "";
          res.on("data", (chunk) => (errorData += chunk));
          res.on("end", () => {
            reject(new Error(`API error: ${res.statusCode} - ${errorData}`));
          });
          return;
        }

        res.on("data", (chunk) => {
          fullResponse += chunk.toString();
        });

        res.on("end", () => {
          try {
            // console.log("fullResponse", fullResponse);
            const lines = fullResponse.split("\n");
            let content = "";

            for (const line of lines) {
              if (line.startsWith("data:")) {
                const jsonStr = line.substring(5).trim();
                if (jsonStr && jsonStr !== "[DONE]") {
                  try {
                    const json = JSON.parse(jsonStr);

                    // CRITICAL FIX: Only process chunks where target is "message"
                    if (json.target === "message" && json.content) {
                      content += json.content;
                    }
                  } catch {
                    // Skip malformed JSON
                  }
                }
              }
            }

            if (content) {
              resolve(content);
            } else {
              reject(new Error("No message content received."));
            }
          } catch (e: any) {
            reject(new Error("Failed to parse response: " + e.message));
          }
        });
      });

      req.on("error", (err) => {
        clearTimeout(timeoutId);
        reject(new Error(`Network error: ${err.message}`));
      });

      req.write(data);
      req.end();
    });
  }

  private buildSystemPrompt(context?: any): string {
    const parts: string[] = [];

    parts.push(
      `
You are Lumo, a highly skilled software engineering assistant.

You treat the user as a competent commander, not a beginner.
Communicate with respect, clarity and precision.

Prioritise:
- Correctness over cleverness
- Readability over brevity
- Minimal necessary changes
- Maintainable solutions

Response format:
- Return valid HTML only
- Never use Markdown
- Use: <p>, <strong>, <em>, <code>, <pre>, <ul>, <ol>, <li>, <blockquote>
- Wrap code examples in <pre><code>
- Do not wrap the entire response in <html> or <body>
  `.trim(),
    );

    if (context) {
      parts.push(
        `
=== CURRENT WORKSPACE CONTEXT ===

Workspace: ${context.workspaceName}
Tracked files: ${context.fileCount}
    `.trim(),
      );

      if (context.activeFile) {
        parts.push(
          `
=== ACTIVE FILE ===

Path: ${context.activeFile.relativePath}
Language: ${context.activeFile.language}
Lines: ${context.activeFile.lineCount}
      `.trim(),
        );

        if (context.activeFile.selection) {
          parts.push(
            `
=== SELECTED CODE ===

\`\`\`${context.activeFile.language}
${context.activeFile.selection}
\`\`\`
        `.trim(),
          );
        }
      }
    }

    parts.push(
      `
=== INSTRUCTIONS ===

- Prioritise selected code when available
- Avoid discussing unrelated files
- Explain reasoning when useful
- Keep answers concise unless deeper explanation is requested
  `.trim(),
    );

    return parts.join("\n\n");
  }
}
