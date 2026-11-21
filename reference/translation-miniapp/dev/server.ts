/**
 * Dev server for iterating on the translation miniapp UI in a desktop browser.
 *
 *   bun dev/server.ts   (or: bun run dev)   ->  http://localhost:3000
 *
 * Bundles dev/index.html's script graph with Bun.build (JS) and compiles
 * src/ui/index.css through Tailwind 4, then serves the results; the HTML at
 * dev/index.html has its dev-source paths rewritten to the built assets.
 * Everything rebuilds on change (node:fs recursive watcher).
 *
 * Note: Bun.serve's HTMLImports route is not used because this Bun/Linux build
 * does not expose it (macOS-only as of 1.4.5).
 */

import {watch} from "node:fs"
import type {BunPlugin} from "bun"

import tailwind from "bun-plugin-tailwind"

const distDir = `${import.meta.dir}/dist`
const port = Number(Bun.env.PORT ?? 3000)

/** main.tsx imports ./index.css; the standalone Tailwind build handles CSS. */
const cssAsNoop: BunPlugin = {
  name: "css-as-noop",
  setup(build) {
    build.onLoad({filter: /\.css$/}, () => ({contents: "", loader: "text"}))
  },
}

async function build(): Promise<void> {
  const [js, css] = await Promise.all([
    Bun.build({
      entrypoints: ["./dev/mock-host.ts", "./src/ui/main.tsx"],
      outdir: distDir,
      target: "browser",
      naming: "[name].js",
      plugins: [cssAsNoop],
    }),
    Bun.build({
      entrypoints: ["./src/ui/index.css"],
      outdir: distDir,
      plugins: [tailwind],
    }),
  ])
  if (!js.success) console.error("[dev] JS build failed:", js.logs)
  if (!css.success) console.error("[dev] CSS build failed:", css.logs)
  if (js.success && css.success) console.log(`[dev] built at ${new Date().toLocaleTimeString()}`)
}

/** The real dev/index.html with dev-source paths swapped for built assets. */
async function pageHtml(): Promise<string> {
  const html = await Bun.file("./dev/index.html").text()
  return html
    .replace('href="./index.css"', 'href="/index.css"')
    .replace('src="./mock-host.ts"', 'src="/mock-host.js"')
    .replace('src="../src/ui/main.tsx"', 'src="/main.js"')
}

await build()

let pending = false
watch(`${import.meta.dir}/../src/ui`, {recursive: true}, () => scheduleBuild())
watch(`${import.meta.dir}/index.html`, () => scheduleBuild())
function scheduleBuild(): void {
  if (pending) return
  pending = true
  setTimeout(() => {
    pending = false
    void build()
  }, 100)
}

const server = Bun.serve({
  port,
  development: true,
  async fetch(req) {
    const path = new URL(req.url).pathname
    if (path === "/" || path === "/index.html") {
      return new Response(await pageHtml(), {headers: {"content-type": "text/html; charset=utf-8"}})
    }
    const file = Bun.file(`${distDir}${path}`)
    if (await file.exists()) {
      const type = path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".map")
            ? "application/json"
            : "application/octet-stream"
      return new Response(file, {headers: {"content-type": type}})
    }
    return new Response(`not found: ${path}`, {status: 404})
  },
})
console.log(`[dev] translation UI (mock host): http://localhost:${server.port}`)
