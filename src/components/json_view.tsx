/** @jsxRuntime automatic */
/** @jsxImportSource react */
// JSON values drawn for reading: JsonView for people (no braces or quotes, an object as a table of its fields, a list as
// a row of chips that becomes a numbered column once it no longer fits) and JsonLine for a one-line colored preview.
import { useLayoutEffect, useRef } from "react"
import type { HTMLAttributes, ReactNode } from "react"
import { cx } from "../cx.ts"

/** A number at most 4 decimals long, in the reader's locale. */
export function formatJsonNumber(value: number): string {
    return Number.isInteger(value)
        ? value.toLocaleString()
        : (+value.toFixed(4)).toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function friendly(value: unknown): ReactNode {
    if (value === null || value === undefined) {
        return <span className="dr-json-empty">empty</span>
    }
    if (typeof value === "boolean") {
        return <span className={cx("dr-json-bool", `dr-json-${value}`)}>{value ? "✓ true" : "✗ false"}</span>
    }
    if (typeof value === "number") {
        return <span className="dr-json-num">{formatJsonNumber(value)}</span>
    }
    if (typeof value === "string") {
        return value === ""
            ? <span className="dr-json-empty">empty text</span>
            : <span className="dr-json-str">{value}</span>
    }
    if (Array.isArray(value)) {
        if (!value.length) {
            return <span className="dr-json-empty">empty list</span>
        }
        return (
            <ol className="dr-json-list dr-json-inline">
                {value.map((item, index) => <li key={index} className="dr-json-item">{friendly(item)}</li>)}
            </ol>
        )
    }
    const entries = Object.entries(value as Record<string, unknown>)
    if (!entries.length) {
        return <span className="dr-json-empty">nothing</span>
    }
    return (
        <div className="dr-json-table">
            {entries.flatMap(([key, item]) => [
                <span key={`k:${key}`} className="dr-json-key">{key}</span>,
                <div key={`v:${key}`} className="dr-json-value">{friendly(item)}</div>,
            ])}
        </div>
    )
}

export interface JsonViewProps extends HTMLAttributes<HTMLDivElement> {
    /** any JSON value */
    value: unknown
}

/** A JSON value for people: fields as a table, lists as chips (a numbered column once too wide), no braces or quotes. */
export function JsonView({ value, className, ...rest }: JsonViewProps) {
    const root = useRef<HTMLDivElement>(null)
    // every list that runs past its box becomes a column, outermost first (an inner list measures in what's left)
    useLayoutEffect(() => {
        for (const list of root.current?.querySelectorAll(".dr-json-list") ?? []) {
            list.classList.replace("dr-json-column", "dr-json-inline")
            if (list.scrollWidth > list.clientWidth + 1) {
                list.classList.replace("dr-json-inline", "dr-json-column")
            }
        }
    })
    return <div ref={root} className={cx("dr-json", className)} {...rest}>{friendly(value)}</div>
}

function scalar(value: unknown): ReactNode {
    if (value === null || value === undefined) {
        return <span className="dr-jl-null">null</span>
    }
    if (typeof value === "boolean") {
        return <span className={cx("dr-jl-bool", `dr-json-${value}`)}>{String(value)}</span>
    }
    if (typeof value === "number") {
        return <span className="dr-jl-num">{String(value)}</span>
    }
    return <span className="dr-jl-str">{JSON.stringify(value)}</span>
}

export interface JsonLineProps extends HTMLAttributes<HTMLSpanElement> {
    value: unknown
    /** about how many characters it shows before an … (default 160) */
    budget?: number
}

/** A JSON value on one line, colored by kind, cut with an … once `budget` characters are shown. */
export function JsonLine({ value, budget = 160, className, ...rest }: JsonLineProps) {
    let left = budget
    let key = 0
    const punct = (text: string) => <span key={key++} className="dr-jl-punct">{text}</span>
    const walk = (item: unknown): ReactNode[] => {
        if (left <= 0) {
            return []
        }
        if (item === null || typeof item !== "object") {
            left -= JSON.stringify(item ?? null)?.length ?? 4
            return [<span key={key++}>{scalar(item)}</span>]
        }
        const isArray = Array.isArray(item)
        const entries: [string | number, unknown][] = isArray
            ? item.map((one, index) => [index, one])
            : Object.entries(item)
        const parts: ReactNode[] = [punct(isArray ? "[" : "{ ")]
        for (const [index, [name, one]] of entries.entries()) {
            if (left <= 0) {
                parts.push(punct("…"))
                return parts
            }
            if (!isArray) {
                left -= String(name).length + 2
                parts.push(<span key={key++} className="dr-jl-key">{name}</span>, punct(": "))
            }
            parts.push(...walk(one))
            if (index < entries.length - 1) {
                parts.push(punct(", "))
            }
        }
        parts.push(punct(isArray ? "]" : " }"))
        return parts
    }
    return <span className={cx("dr-json-line", className)} {...rest}>{walk(value)}</span>
}
