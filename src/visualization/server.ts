/**
 * PMM Visualization — Live Dashboard Server
 * ==========================================
 * Bun HTTP server with SSE (Server-Sent Events) for real-time dashboard updates.
 * Serves:
 *   GET /              — Live dashboard HTML (auto-refreshing via SSE)
 *   GET /api/stream    — SSE event stream
 *   GET /api/data      — JSON project/portfolio data
 *
 * Integrates with the PMM SSE system by re-broadcasting events from :9999
 * and serving its own dashboard to port :9998.
 */
import { join } from "node:path";
import { openVisualizationDB, fetchPortfolioData } from "./data";
import { generateLiveDashboardHTML } from "./generator";

const ROOT = join(import.meta.dir, "..", "..", "..");

interface SSEClient {
  id: string;
  controller: ReadableStreamDefaultController;
}

const sseClients = new Map<string, SSEClient>();

function broadcastSSE(event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  for (const [id, client] of sseClients) {
    try {
      client.controller.enqueue(encoder.encode(payload));
    } catch {
      sseClients.delete(id);
    }
  }
}

let clientIdCounter = 0;

/** Start the live dashboard server */
export function startLiveServer(port: number = 9998, autoOpen: boolean = true) {
  console.log(`\n🧠 PMM Live Dashboard starting...`);

  // Proxy: connect to the PMM API SSE stream and re-broadcast
  let pmmStreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let proxyTimer: Timer | null = null;

  function connectPMMProxy() {
    fetch(`http://localhost:9999/api/pmm/stream`)
      .then((res) => {
        if (!res.body) return;
        const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
        pmmStreamReader = reader;
        const decoder = new TextDecoder();

        function pump() {
          reader
            .read()
            .then(({ done, value }) => {
              if (done) {
                pmmStreamReader = null;
                return;
              }
              const text = decoder.decode(value, { stream: true });
              // Parse SSE events and re-broadcast
              for (const line of text.split("\n")) {
                if (line.startsWith("event: ")) {
                  const eventName = line.slice(7).trim();
                  // Read next line for data
                  const dataLine = text.split("\n")[text.split("\n").indexOf(line) + 1];
                  if (dataLine?.startsWith("data: ")) {
                    try {
                      const data = JSON.parse(dataLine.slice(6));
                      broadcastSSE(eventName, data);
                    } catch {
                      /* skip unparseable */
                    }
                  }
                }
              }
              pump();
            })
            .catch(() => {
              pmmStreamReader = null;
            });
        }
        pump();
      })
      .catch(() => {
        // PMM API not running — poll portfolio data instead
      });
  }

  // Periodically fetch health data and broadcast
  function startHealthPoller() {
    proxyTimer = setInterval(() => {
      try {
        const db = openVisualizationDB();
        const data = fetchPortfolioData(db);
        db.close();
        broadcastSSE("health:updated", {
          projects: data.projects,
          timestamp: data.timestamp,
        });
      } catch {
        /* skip if DB locked */
      }
    }, 15000);
  }

  Bun.serve({
    port,
    async fetch(req: Request) {
      const url = new URL(req.url);
      const path = url.pathname;

      const headers: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers });
      }

      // ── SSE Stream ──
      if (path === "/api/stream") {
        const clientId = `client-${++clientIdCounter}`;
        let ctrl: ReadableStreamDefaultController;

        const stream = new ReadableStream({
          start(controller) {
            ctrl = controller;
            sseClients.set(clientId, { id: clientId, controller: ctrl });
            // Send initial connected event
            const encoder = new TextEncoder();
            ctrl.enqueue(
              encoder.encode(`event: connected\ndata: {"client":"${clientId}"}\n\n`),
            );
          },
          cancel() {
            sseClients.delete(clientId);
          },
        });

        return new Response(stream, {
          headers: {
            ...headers,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      // ── Data API ──
      if (path === "/api/data") {
        try {
          const db = openVisualizationDB();
          const type = url.searchParams.get("type") || "health";
          let result: any = {};

          if (type === "health" || type === "portfolio") {
            const data = fetchPortfolioData(db);
            result = {
              projects: data.projects.map((p) => ({
                id: p.id,
                name: p.name,
                health: p.health,
                phase: p.phase,
                priority: p.priority,
                task_count: p.task_count,
                completed_tasks: p.completed_tasks,
                milestone_count: p.milestone_count,
                open_roadblocks: p.open_roadblocks,
                last_active_days: p.last_active_days,
              })),
              timestamp: data.timestamp,
            };
          }

          db.close();
          return Response.json(result, { headers });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500, headers });
        }
      }

      // ── Dashboard HTML ──
      if (path === "/" || path === "") {
        const html = generateLiveDashboardHTML(port);
        return new Response(html, {
          headers: {
            ...headers,
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      return new Response("Not found", { status: 404, headers });
    },
  });

  // Connect to PMM API SSE proxy
  connectPMMProxy();

  // Start health poller
  startHealthPoller();

  const url = `http://localhost:${port}`;
  console.log(`   ${url}  — Live dashboard`);
  console.log(`   ${url}/api/stream  — SSE events`);
  console.log(`   ${url}/api/data   — JSON data`);

  if (autoOpen) {
    const { spawn } = require("child_process");
    const cmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
    try {
      spawn(cmd, [url], { detached: true, stdio: "ignore" });
    } catch {
      /* browser open not critical */
    }
  }

  console.log(`\n💡 Press Ctrl+C to stop the live server.`);
}
