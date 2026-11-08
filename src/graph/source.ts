// Source code for a comment on a blueprint graph (BlueprintGraph's `commentSource`): the Python class of the module it
// is on, read through whatever the app has (the dimos gateway's `GET source?file=`), so the agent gets the code with it.
import type { CommentTarget } from "../comments/client.ts"
import { type BlueprintModule, topicOf } from "./blueprint_graph.tsx"

/** A module as the dimos gateway's catalog lists it: where its class is defined (relative to the dimos checkout). */
export interface SourcedModule extends BlueprintModule {
    file?: string | null
    line?: number | null
}

/**
 * The Python block starting at 1-based `line` (a class or def): its decorators above it, and its body up to the next
 * line indented no deeper than it (at most `maxLines`).
 */
export function pythonBlockAt(text: string, line: number, maxLines = 300): string {
    const lines = text.split("\n")
    let start = Math.min(Math.max(line - 1, 0), lines.length - 1)
    const indent = (row: string) => row.length - row.trimStart().length
    const depth = indent(lines[start] ?? "")
    while (start > 0 && lines[start - 1].trimStart().startsWith("@") && indent(lines[start - 1]) === depth) {
        start--
    }
    let end = Math.max(line, start + 1)
    while (end < lines.length && end - start < maxLines) {
        const row = lines[end]
        if (row.trim() && indent(row) <= depth && !/^\s*[)\]}]/.test(row)) {
            break
        }
        end++
    }
    return lines.slice(start, end).join("\n").trimEnd()
}

/**
 * A BlueprintGraph `commentSource`: a module's class (its file at its line), for a topic the class of the module that
 * writes it (else reads it), for an edge its module end's. `read(file)` gives a file's text, e.g.
 * `(file) => fetch("../source?file=" + encodeURIComponent(file)).then((r) => r.json()).then((a) => a.text)`.
 */
export function blueprintCommentSource(
    modules: readonly SourcedModule[],
    read: (file: string) => Promise<string>,
): (target: CommentTarget) => Promise<string | null> {
    const files = new Map<string, Promise<string>>()
    const moduleFor = (target: CommentTarget): SourcedModule | undefined => {
        const named = (name: string) => modules.find((module) => module.name === name.replace(/^m:/, ""))
        if (target.kind === "module") {
            return named(target.id)
        }
        const topic = target.kind === "topic"
            ? target.id.replace(/^\/+/, "")
            : target.kind === "edge"
            ? null
            : undefined
        if (topic === undefined) {
            return undefined
        }
        if (topic === null) {
            const end = target.id.split(">").find((part) => part.startsWith("m:"))
            return end ? named(end) : undefined
        }
        const touching = (writes: boolean) =>
            modules.find((module) =>
                module.streams.some((stream) =>
                    topicOf(stream) === topic && (writes ? stream.direction !== "in" : stream.direction !== "out")
                )
            )
        return touching(true) ?? touching(false)
    }
    return async (target) => {
        const module = moduleFor(target)
        if (!module?.file) {
            return null
        }
        const file = module.file
        if (!files.has(file)) {
            const text = read(file)
            text.catch(() => files.delete(file))
            files.set(file, text)
        }
        const block = pythonBlockAt(await files.get(file)!, module.line ?? 1)
        return `# ${file}:${module.line ?? 1} (${module.class})\n${block}`
    }
}
