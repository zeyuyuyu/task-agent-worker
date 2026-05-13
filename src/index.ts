import { Hono } from "hono";
import type { Env } from "./types";
import { api } from "./routes/api";
import { html } from "./ui/app";

const app = new Hono<{ Bindings: Env }>();

app.route("/api", api);

app.get("*", (c) => {
  return c.html(html, 200, {
    "set-cookie": ensureSessionCookie(c.req.raw),
    "cache-control": "no-store"
  });
});

function ensureSessionCookie(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  const existing = cookie.match(/(?:^|;\s*)task_agent_session=([^;]+)/)?.[1];
  const value = existing || crypto.randomUUID();
  return `task_agent_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
}

export default app;
