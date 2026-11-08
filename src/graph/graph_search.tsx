/** @jsxRuntime automatic */
/** @jsxImportSource react */
// <GraphSearch>: a small search box laid over a graph (top right): type, pick a hit with the arrows + Enter or a click.
// Icon-only when `compact` (a narrow graph) until tapped; hidden (faded out) unless `shown`, focused or holding text.
import { useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { cx } from "../cx.ts"
import { IconButton, SearchInput } from "../components/controls.tsx"
import { type GraphSearchItem, searchGraph } from "./search.ts"

export interface GraphSearchProps<T extends GraphSearchItem> {
    items: readonly T[]
    onPick: (item: T) => void
    /** visible (e.g. the pointer moved over the graph lately) */
    shown?: boolean
    /** a magnifier button that opens the box (narrow screens) */
    compact?: boolean
    placeholder?: string
    /** a hit's small kind tag ("MOD", "TOPIC") */
    kindLabel?: (item: T) => string
    /** a hit's own style (e.g. its type color) */
    itemStyle?: (item: T) => CSSProperties | undefined
    /** reports when it's in use (focused, or holding text), so the host keeps it shown */
    onBusyChange?: (busy: boolean) => void
    className?: string
}

/** A graph's search box: finds `items` by name (see searchGraph) and hands the picked one to `onPick`. */
export function GraphSearch<T extends GraphSearchItem>({
    items,
    onPick,
    shown = true,
    compact = false,
    placeholder = "Find a module or topic",
    kindLabel = (item) => item.kind.toUpperCase().slice(0, 5),
    itemStyle,
    onBusyChange,
    className,
}: GraphSearchProps<T>) {
    const [query, setQuery] = useState("")
    const [focused, setFocused] = useState(false)
    const [expanded, setExpanded] = useState(false)
    const [active, setActive] = useState(0)
    const box = useRef<HTMLDivElement>(null)
    const hits = searchGraph(items, query)
    const busy = focused || !!query
    useEffect(() => onBusyChange?.(busy), [busy])
    useEffect(() => setActive(0), [query])
    const open = !compact || expanded
    const focusInput = () => setTimeout(() => box.current?.querySelector("input")?.focus())
    const pick = (item: T | undefined) => {
        if (!item) {
            return
        }
        onPick(item)
        setQuery("")
        setExpanded(false)
        box.current?.querySelector("input")?.blur()
    }
    const listId = "dr-graph-search-hits"
    return (
        <div
            ref={box}
            className={cx(
                "dr-bpgraph__search",
                !(shown || busy || expanded) && "dr-bpgraph__search--hidden",
                className,
            )}
            role="search"
        >
            {open
                ? (
                    <SearchInput
                        value={query}
                        onChange={setQuery}
                        placeholder={placeholder}
                        aria-label={placeholder}
                        aria-controls={listId}
                        aria-expanded={!!query}
                        autoComplete="off"
                        spellCheck={false}
                        onFocus={() => setFocused(true)}
                        onBlur={() => {
                            setFocused(false)
                            if (!query) {
                                setExpanded(false)
                            }
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                                event.preventDefault()
                                const step = event.key === "ArrowDown" ? 1 : -1
                                setActive((at) => (at + step + hits.length) % Math.max(hits.length, 1))
                            } else if (event.key === "Enter") {
                                event.preventDefault()
                                pick(hits[active]?.item)
                            } else if (event.key === "Escape") {
                                event.stopPropagation()
                                setQuery("")
                                setExpanded(false)
                                event.currentTarget.blur()
                            }
                        }}
                    />
                )
                : (
                    <IconButton
                        icon="search"
                        size="sm"
                        variant="default"
                        label="Find a module or topic"
                        onClick={() => {
                            setExpanded(true)
                            focusInput()
                        }}
                    />
                )}
            {query
                ? (
                    <ul className="dr-bpgraph__hits" id={listId} role="listbox">
                        {hits.length
                            ? hits.map(({ item }, index) => (
                                <li
                                    key={item.id}
                                    role="option"
                                    aria-selected={index === active}
                                    className={cx("dr-bpgraph__hit", `dr-bpgraph__hit--${item.kind}`)}
                                    style={itemStyle?.(item)}
                                    data-hit={item.id}
                                    // pick before the input's blur collapses the list
                                    onPointerDown={(event) => event.preventDefault()}
                                    onPointerEnter={() => setActive(index)}
                                    onClick={() => pick(item)}
                                >
                                    <span className="dr-bpgraph__hit-kind">{kindLabel(item)}</span>
                                    <span className="dr-bpgraph__hit-name">{item.label}</span>
                                    {item.also?.[0] && item.also[0] !== item.label
                                        ? <span className="dr-bpgraph__hit-also">{item.also[0]}</span>
                                        : null}
                                </li>
                            ))
                            : <li className="dr-bpgraph__nohit">Nothing called that</li>}
                    </ul>
                )
                : null}
        </div>
    )
}
