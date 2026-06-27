import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/official-source") {
      await handleOfficialSource(url, response);
      return;
    }

    await handleStaticFile(url, response);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Server error");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Building History App running at http://127.0.0.1:${port}/index.html`);
});

async function handleOfficialSource(url, response) {
  const target = url.searchParams.get("url") || "";
  if (!/^https?:\/\//i.test(target)) {
    response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Missing URL" }));
    return;
  }

  const upstream = await fetch(target, {
    headers: {
      accept: "text/html,text/plain",
      "user-agent": "BuildingHistoryApp/0.1 source verifier",
    },
  });

  if (!upstream.ok) {
    response.writeHead(upstream.status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: `Official source returned ${upstream.status}` }));
    return;
  }

  const text = await upstream.text();
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=3600",
  });
  response.end(JSON.stringify({ url: target, html: text }));
}

async function handleStaticFile(url, response) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const path = normalize(join(root, requested));
  if (!path.startsWith(root)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  const file = await readFile(path);
  response.writeHead(200, {
    "content-type": contentTypes[extname(path)] || "application/octet-stream",
  });
  response.end(file);
}
