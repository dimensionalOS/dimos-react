// The source is importable as-is (apps compile it from a tag, Deno runs it): every relative import names its file,
// extension included, and nothing leans on a bundler (no path aliases, import.meta.glob, ?raw or CSS imports).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "vitest"
import { assertEquals } from "./assert.ts"

const SRC = fileURLToPath(new URL("../src", import.meta.url))
// an import/export statement's specifier, or a dynamic import()'s; not prose or template strings that say "from"
const SPECIFIER = /(?:^\s*(?:import|export)\b[^;"'`=(]*?[\s}*]from\s*|^\s*import\s*|\bimport\(\s*)["']([^"'$]+)["']/gm

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            return sourceFiles(full)
        }
        return /\.(tsx?|js)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : []
    })
}

test("every relative import in src/ names an existing file, extension included", () => {
    const bad: string[] = []
    for (const file of sourceFiles(SRC)) {
        for (const [, spec] of fs.readFileSync(file, "utf8").matchAll(SPECIFIER)) {
            if (spec.startsWith(".") && !fs.existsSync(path.join(path.dirname(file), spec))) {
                bad.push(`${path.relative(SRC, file)}: ${spec}`)
            }
        }
    }
    assertEquals(bad, [])
})

test("src/ imports only relative files and the peer dependencies (no aliases or bundler-only imports)", () => {
    const bad: string[] = []
    for (const file of sourceFiles(SRC)) {
        const text = fs.readFileSync(file, "utf8")
        if (text.includes("import.meta.glob")) {
            bad.push(`${path.relative(SRC, file)}: import.meta.glob`)
        }
        for (const [, spec] of text.matchAll(SPECIFIER)) {
            const peer = /^(react|react-dom|three)(\/|$)/.test(spec)
            if ((!spec.startsWith(".") && !peer) || /\?|\.css$/.test(spec)) {
                bad.push(`${path.relative(SRC, file)}: ${spec}`)
            }
        }
    }
    assertEquals(bad, [])
})
