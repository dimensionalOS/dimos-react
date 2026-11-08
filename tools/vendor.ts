import { parse as parseJsonc } from "jsr:@std/jsonc@1"

// Copies dim-app's zenoh client (and its gateway client) and the Controller's LCM schemas into src/vendor.
const home = Deno.env.get("HOME")
const dimApp = Deno.env.get("DIM_APP") ?? `${home}/repos/dim-app`
const tag = Deno.args[0] ?? "v0.25.1"

function run(command: string, args: string[], cwd?: string): Uint8Array {
    const { success, stdout, stderr } = new Deno.Command(command, { args, cwd, stderr: "piped" }).outputSync()
    if (!success) {
        throw new Error(`${command} ${args.join(" ")} failed:\n${new TextDecoder().decode(stderr)}`)
    }
    return stdout
}

function filesUnder(dir: string): string[] {
    return [...Deno.readDirSync(dir)].flatMap((entry) => {
        const full = `${dir}/${entry.name}`
        return entry.isDirectory ? filesUnder(full) : [full]
    })
}

// dim-app's Desktop helpers ride along (apps import them as dimos-react/dim-app/<file>), with their types
const files = [
    "source/zenoh.js",
    "source/topic.js",
    "source/desktop.js",
    "source/desktop.d.ts",
    "source/notify.js",
    "source/notify.d.ts",
    "source/events.js",
    "source/events.d.ts",
    "source/vendor/zenoh-gateway/LICENSE",
    "source/vendor/zenoh-gateway/UPSTREAM",
    "source/vendor/zenoh-gateway/zenoh_gateway.js",
    "source/vendor/zenoh-gateway/vendor/fzstd.js",
    "source/vendor/zenoh-gateway/vendor/fzstd.LICENSE",
]
for (const file of files) {
    const out = run("git", ["-C", dimApp, "show", `${tag}:${file}`])
    const target = `src/vendor/dim-app/${file.replace(/^source\//, "")}`
    Deno.mkdirSync(target.replace(/\/[^/]+$/, ""), { recursive: true })
    Deno.writeFileSync(target, out)
}
Deno.writeTextFileSync("src/vendor/dim-app/VERSION", `jeff-hykin/dim-app ${tag}\n`)
// the gateway client's types: declarations emitted from its TypeScript source at the vendored commit (zenoh-gateway's
// client/zenoh_gateway.ts), so apps type-check against the same client they run
const gateway = Deno.env.get("ZENOH_GATEWAY") ?? `${home}/repos/zenoh-gateway`
const upstream = Deno.readTextFileSync("src/vendor/dim-app/vendor/zenoh-gateway/UPSTREAM").trim().split(/\s+/).pop()
const scratch = Deno.makeTempDirSync({ prefix: "dimos-react-gateway-" })
Deno.mkdirSync(`${scratch}/vendor`)
for (const file of ["zenoh_gateway.ts", "vendor/fzstd.ts"]) {
    Deno.writeFileSync(`${scratch}/${file}`, run("git", ["-C", gateway, "show", `${upstream}:client/${file}`]))
}
// tsc from deno.json's typescript, run in the scratch dir so no project config applies
run(
    Deno.execPath(),
    [
        "run",
        "-A",
        `${
            (parseJsonc(Deno.readTextFileSync("deno.json")) as { imports: Record<string, string> }).imports.typescript
        }/tsc`,
        "--declaration",
        "--emitDeclarationOnly",
        "--target",
        "es2022",
        "--module",
        "esnext",
        "--moduleResolution",
        "bundler",
        "--allowImportingTsExtensions",
        "--lib",
        "es2022,dom,dom.iterable",
        "--skipLibCheck",
        "--outDir",
        `${scratch}/out`,
        `${scratch}/zenoh_gateway.ts`,
    ],
    scratch,
)
const declarations = Deno.readTextFileSync(`${scratch}/out/zenoh_gateway.d.ts`)
    .replace(/^\/\/\/ <reference no-default-lib="true"\/>\n/m, "")
Deno.writeTextFileSync("src/vendor/dim-app/vendor/zenoh-gateway/zenoh_gateway.d.ts", declarations)
Deno.removeSync(scratch, { recursive: true })
const controller = Deno.env.get("CONTROLLER") ?? `${home}/repos/dim-live-viewer`
const schemas = Deno.readTextFileSync(`${controller}/frontend/src/core/lcm/schemas.json`)
Deno.writeTextFileSync(
    "src/vendor/lcm_schemas.js",
    `// dimos LCM message schemas (from dim-controller's tools/gen_lcm_schemas.ts output)\nexport default ${schemas.trim()}\n`,
)
// Deno and jsr read a .js file's types only through @ts-self-types (tsc finds the sibling .d.ts on its own)
for (const declaration of filesUnder("src/vendor").filter((file) => file.endsWith(".d.ts"))) {
    const script = declaration.replace(/\.d\.ts$/, ".js")
    let text: string | null = null
    try {
        text = Deno.readTextFileSync(script)
    } catch {
        // a .d.ts with no .js beside it
    }
    if (text !== null && !text.startsWith("// @ts-self-types=")) {
        Deno.writeTextFileSync(script, `// @ts-self-types="./${declaration.split("/").pop()}"\n${text}`)
    }
}
console.log("vendored dim-app", tag)
