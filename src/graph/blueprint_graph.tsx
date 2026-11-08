/** @jsxRuntime automatic */
/** @jsxImportSource react */
// <BlueprintGraph>: a dimos blueprint's module graph (the gateway's GET blueprints/{name} modules: each module and the
// topics it writes and reads), drawn by GraphView in the theme's tokens, with zoom/layout controls and a fullscreen toggle.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import type { CSSProperties, ForwardRefExoticComponent, ReactNode, Ref, RefAttributes } from "react"
import { cx } from "../cx.ts"
import { Button } from "../components/controls.tsx"
import { MenuAt } from "../components/nav.tsx"
import { formatRate, messageTypeColor } from "../components/topics.tsx"
import { useTheme } from "../theme/provider.tsx"
import { type CommentsClient, type CommentTarget, targetKey } from "../comments/client.ts"
import { CommentComposer, CommentThread, targetLabel } from "../comments/components.tsx"
import { desktopEvents } from "../comments/desktop.ts"
import { useComments } from "../comments/use_comments.ts"
import { type GraphViewState, useGraphLayoutSetting } from "./desktop_state.ts"
import { GraphControls } from "./graph_controls.tsx"
import { GraphSearch } from "./graph_search.tsx"
import { GraphView, type GraphViewHandle } from "./graph_view.tsx"
import type { LayoutId } from "./layout.ts"
import { edgeKey, textWidth } from "./paths.ts"

/** A module's stream, as the gateway describes it. */
export interface BlueprintStream {
    name: string
    type: string
    /** "in", "out" (anything else reads and writes) */
    direction: string
    /** the name it's wired under in the blueprint (a remapped stream) */
    wire?: string | null
    /** the topic it's pinned to */
    topic?: string | null
}

/** A module of a blueprint, as GET blueprints/{name} lists it (other fields are ignored). */
export interface BlueprintModule {
    name: string
    /** the dotted class path */
    class: string
    streams: BlueprintStream[]
}

/** A topic heard on the bus that no module of the blueprint wires. */
export interface ExtraTopic {
    topic: string
    type: string
}

/** What's lit: a module, or a topic. */
export type BlueprintSpot = { module: string } | { topic: string } | null

/** The topic a stream lands on: its pinned topic, else its wired name, else its own name (no leading slash). */
export const topicOf = (stream: BlueprintStream): string =>
    (stream.topic ?? stream.wire ?? stream.name).replace(/^\/+/, "")

/** A module's class name (the last part of its dotted path), or its name. */
export const moduleClassName = (module: BlueprintModule): string => module.class.split(".").pop() || module.name

const MODULE_H = 46
const MODULE_BAR = 4
const MODULE_PAD_X = 16
const TAG_GAP = 10
const CHEV_W = 22
const TOPIC_H = 30
const PAD_X = 9
const PORT = 7
const RATE_RESERVE = "999.9 Hz"

export interface BlueprintModuleNode {
    id: string
    kind: "module"
    name: string
    label: string
    tagW: number
    w: number
    h: number
}

export interface BlueprintTopicNode {
    id: string
    kind: "topic"
    topic: string
    type: string
    /** heard on the bus, not wired by the blueprint */
    extra: boolean
    /** only written, or only read, here */
    loose: boolean
    w: number
    h: number
}

export type BlueprintNode = BlueprintModuleNode | BlueprintTopicNode
export interface BlueprintEdge {
    from: string
    to: string
    topic: string
}

/** Text width in px for a CSS font; a rough per-character width where there's no canvas (tests, server rendering). */
export type MeasureText = (text: string, font: string) => number

function fontOf(token: string, fallback: string): string {
    if (typeof document === "undefined") {
        return fallback
    }
    return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback
}

const measureText: MeasureText = (text, font) => {
    try {
        return textWidth(text, font)
    } catch {
        const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 12)
        return text.length * px * 0.6
    }
}

/** Modules become module nodes, each topic a topic node; an edge runs module → topic it writes, topic → module reading it. */
export function buildBlueprintGraph(
    modules: BlueprintModule[],
    extras: ExtraTopic[] = [],
    measure: MeasureText = measureText,
): { nodes: BlueprintNode[]; edges: BlueprintEdge[] } {
    const sans = fontOf("--sans", "sans-serif")
    const mono = fontOf("--mono", "monospace")
    const nodes: BlueprintNode[] = []
    const edges: BlueprintEdge[] = []
    const topics = new Map<string, { type: string; extra: boolean }>()
    const tagW = Math.ceil(measure("MOD", `600 9.5px ${sans}`) * 1.25)
    for (const module of modules) {
        const label = moduleClassName(module)
        const labelW = Math.ceil(measure(label, `600 15px ${sans}`))
        nodes.push({
            id: `m:${module.name}`,
            kind: "module",
            name: module.name,
            label,
            tagW,
            w: MODULE_BAR + MODULE_PAD_X + tagW + TAG_GAP + labelW + CHEV_W,
            h: MODULE_H,
        })
        for (const stream of module.streams) {
            const topic = topicOf(stream)
            if (!topics.has(topic)) {
                topics.set(topic, { type: stream.type, extra: false })
            }
            if (stream.direction !== "in") {
                edges.push({ from: `m:${module.name}`, to: `t:${topic}`, topic })
            }
            if (stream.direction !== "out") {
                edges.push({ from: `t:${topic}`, to: `m:${module.name}`, topic })
            }
        }
    }
    for (const extra of extras) {
        if (!topics.has(extra.topic)) {
            topics.set(extra.topic, { type: extra.type, extra: true })
        }
    }
    const written = new Set(edges.filter((edge) => edge.from.startsWith("m:")).map((edge) => edge.topic))
    const read = new Set(edges.filter((edge) => edge.to.startsWith("m:")).map((edge) => edge.topic))
    for (const [topic, { type, extra }] of topics) {
        const width = Math.max(measure(topic, `500 12px ${mono}`), measure(RATE_RESERVE, `10px ${mono}`))
        nodes.push({
            id: `t:${topic}`,
            kind: "topic",
            topic,
            type,
            extra,
            loose: !(written.has(topic) && read.has(topic)),
            w: Math.ceil(width) + PAD_X * 2,
            h: TOPIC_H,
        })
    }
    return { nodes, edges }
}

/** Two fingers over `element` zoom only the graph, never the page (even with Android's "force enable zoom"). */
export function useNoPagePinch(element: HTMLElement | null): void {
    useEffect(() => {
        if (!element) {
            return
        }
        const onTouchMove = (event: TouchEvent) => {
            if (event.touches.length > 1) {
                event.preventDefault()
            }
        }
        // iOS Safari's own pinch
        const onGesture = (event: Event) => event.preventDefault()
        element.addEventListener("touchmove", onTouchMove, { passive: false })
        element.addEventListener("gesturestart", onGesture)
        element.addEventListener("gesturechange", onGesture)
        return () => {
            element.removeEventListener("touchmove", onTouchMove)
            element.removeEventListener("gesturestart", onGesture)
            element.removeEventListener("gesturechange", onGesture)
        }
    }, [element])
}

/** "native": the Fullscreen API has the element; "overlay": it fills the window (no Fullscreen API, or it refused). */
export type FullscreenMode = "native" | "overlay" | null

/**
 * Fullscreen for an element: the Fullscreen API where there is one, else (or when it refuses, e.g. in an iframe
 * without allow="fullscreen") a full-window overlay the caller styles. Esc leaves either.
 */
export function useFullscreen(element: HTMLElement | null): {
    mode: FullscreenMode
    enter: () => void
    exit: () => void
    toggle: () => void
} {
    const [mode, setMode] = useState<FullscreenMode>(null)
    useEffect(() => {
        if (typeof document === "undefined") {
            return
        }
        const onChange = () => {
            setMode((was) =>
                document.fullscreenElement && document.fullscreenElement === element
                    ? "native"
                    : was === "native"
                    ? null
                    : was
            )
        }
        document.addEventListener("fullscreenchange", onChange)
        return () => document.removeEventListener("fullscreenchange", onChange)
    }, [element])
    // Esc leaves the overlay, and the native mode too where the browser doesn't (a frame, a headless page)
    useEffect(() => {
        if (!mode) {
            return
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation()
                if (document.fullscreenElement) {
                    document.exitFullscreen().catch(() => {})
                }
                setMode(null)
            }
        }
        window.addEventListener("keydown", onKey, true)
        return () => window.removeEventListener("keydown", onKey, true)
    }, [mode])
    const enter = useCallback(() => {
        if (!element) {
            return
        }
        if (document.fullscreenEnabled && element.requestFullscreen) {
            element.requestFullscreen().then(
                () => setMode("native"),
                () => setMode("overlay"),
            )
        } else {
            setMode("overlay")
        }
    }, [element])
    const exit = useCallback(() => {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {})
        }
        setMode(null)
    }, [])
    const toggle = useCallback(() => (mode ? exit() : enter()), [mode, enter, exit])
    return { mode, enter, exit, toggle }
}

/** Where a highlight lands: a node (its id), or an edge (its key, `<from>><to>` of node ids). */
export type BlueprintTargetRef = { node: string } | { edge: string; from: string; to: string }

/**
 * Find what an agent names: a module (its name, its class name or `m:<name>`), a topic (with or without its slash, or
 * `t:<topic>`), or an edge (`<from>><to>`, each end a node id or a module / topic name). Null when there's no such thing.
 */
export function findBlueprintTarget(
    nodes: readonly BlueprintNode[],
    edges: readonly BlueprintEdge[],
    kind: string,
    id: string,
): BlueprintTargetRef | null {
    const byId = (wanted: string) => nodes.find((node) => node.id === wanted)
    const moduleNode = (name: string) =>
        byId(name) ?? nodes.find((node) => node.kind === "module" && node.name === name.replace(/^m:/, "")) ??
            nodes.find((node) => node.kind === "module" && node.label === name)
    const topicNode = (name: string) => byId(`t:${name.replace(/^t:/, "").replace(/^\/+/, "")}`)
    if (kind === "module" || kind === "topic") {
        const node = kind === "module" ? moduleNode(id) : topicNode(id)
        return node ? { node: node.id } : null
    }
    if (kind === "edge") {
        const at = id.indexOf(">")
        if (at < 0) {
            return null
        }
        const end = (name: string) => byId(name)?.id ?? moduleNode(name)?.id ?? topicNode(name)?.id
        const from = end(id.slice(0, at).trim())
        const to = end(id.slice(at + 1).trim())
        const edge = edges.find((edge) => edge.from === from && edge.to === to)
        return edge ? { edge: edgeKey(edge), from: edge.from, to: edge.to } : null
    }
    return null
}

/** What a comment on a node or edge is about. */
export function blueprintTarget(
    node: BlueprintNode | { edge: BlueprintEdge; nodes: ReadonlyMap<string, BlueprintNode> },
    blueprint?: string,
): CommentTarget {
    const extra = blueprint ? { blueprint } : {}
    if ("edge" in node) {
        const name = (id: string) => {
            const end = node.nodes.get(id)
            return !end ? id : end.kind === "module" ? end.label : `/${end.topic}`
        }
        return {
            kind: "edge",
            id: edgeKey(node.edge),
            label: `${name(node.edge.from)} → ${name(node.edge.to)}`,
            ...extra,
        }
    }
    return node.kind === "module"
        ? { kind: "module", id: node.name, label: node.label, ...extra }
        : { kind: "topic", id: node.topic, label: `/${node.topic}`, ...extra }
}

/** What's selected in a blueprint graph: a module (by name) or a topic. */
export type BlueprintSelection = { kind: "module" | "topic"; id: string } | null

/**
 * What the user sees, for Desktop's view report: the modules on screen (`visible`: node ids), the connections (a
 * module writing a topic another module reads) with either end on screen, the selection and the layout.
 */
export function blueprintViewState(
    nodes: readonly BlueprintNode[],
    edges: readonly BlueprintEdge[],
    visible: ReadonlySet<string>,
    selected: BlueprintSelection,
    layout: LayoutId,
): GraphViewState {
    const modules = nodes.flatMap((node) =>
        node.kind === "module" && visible.has(node.id) ? [{ id: node.name, label: node.label }] : []
    )
    const name = (id: string) => id.replace(/^m:/, "")
    const connections: GraphViewState["visible"]["connections"] = []
    for (const write of edges) {
        if (!write.from.startsWith("m:")) {
            continue
        }
        for (const read of edges) {
            if (
                read.from === write.to && read.to.startsWith("m:") && (visible.has(write.from) || visible.has(read.to))
            ) {
                connections.push({ from: name(write.from), to: name(read.to), topic: write.topic })
            }
        }
    }
    return { visible: { modules, connections }, selected, layout }
}

export interface BlueprintGraphHandle extends GraphViewHandle {
    /**
     * Softly flash a module, topic or edge (see findBlueprintTarget for the ids it takes) `times` times (default 2),
     * scrolling it into view. False when there's no such thing in this graph.
     */
    highlight(kind: string, id: string, times?: number): boolean
}

export interface BlueprintGraphProps {
    modules: BlueprintModule[]
    /** topics heard on the bus that the blueprint doesn't wire, drawn dashed */
    extras?: ExtraTopic[]
    /** the layout (uncontrolled: the one the user picked last, remembered by Desktop or this browser) */
    layout?: LayoutId
    onLayoutChange?: (layout: LayoutId) => void
    /** uncontrolled layout: start from (and save) the remembered pick (default on; off: "hierarchy", kept here only) */
    rememberLayout?: boolean
    /** what's lit (uncontrolled: whatever's hovered, else what's selected) */
    spot?: BlueprintSpot
    /** Hz per topic while the blueprint runs: live topics show their rate and their edges flow */
    rates?: Map<string, number> | null
    onModule?: (name: string) => void
    onTopic?: (topic: string | null) => void
    onHover?: (spot: BlueprintSpot) => void
    /** the smallest zoom a fit may pick, per layout (GraphView's; `{}` always fits the whole graph, for a small box) */
    fitMinScale?: Partial<Record<LayoutId, number>>
    /** the zoom buttons and layout picker (default on) */
    controls?: boolean
    /** the fullscreen toggle, top right (default on) */
    fullscreen?: boolean
    /** the search box, top right (default on) */
    search?: boolean
    /**
     * The Desktop app this graph is in: it flashes what Desktop's `view-highlight` events for this app name, and (with
     * `comments`) takes comments on nodes and edges
     */
    app?: string
    /** the blueprint shown (put on comments and view reports) */
    blueprint?: string
    /** right click → Comment, badges on what has open comments, their threads (default on when there's an `app`) */
    comments?: boolean
    /** source code for what a comment is on, attached for the agent (`context.source`) */
    commentSource?: (target: CommentTarget) => string | null | undefined | Promise<string | null | undefined>
    /** where comments go (default: Desktop on this origin) */
    commentsClient?: CommentsClient
    /** what the user sees, after each pan, zoom, layout or selection (debounced): e.g. `putView(app, state)` */
    onViewChange?: (state: GraphViewState) => void
    /** the debounce, ms (default 400) */
    viewChangeDelay?: number
    /** shown when there are no modules */
    empty?: ReactNode
    className?: string
    style?: CSSProperties
    "aria-label"?: string
    /** laid over the graph (a heading, a legend) */
    children?: ReactNode
}

/** An open card over the graph: the right-click menu, the composer, or a target's threads. */
type Card = { kind: "menu" | "compose" | "thread"; x: number; y: number; target: CommentTarget }

/** A comment count drawn in the graph (a node's corner, an edge's middle); a click opens its threads. */
function Badge_({ id, count, x, y }: { id: string; count: number; x: number; y: number }) {
    return (
        <g className="comment-badge" data-graph-badge={id} transform={`translate(${x} ${y})`}>
            <title>{`${count} open comment${count === 1 ? "" : "s"}`}</title>
            <circle r={8.5} />
            <text>{count > 9 ? "9+" : count}</text>
        </g>
    )
}

/**
 * A blueprint's module graph: modules (a bar, "MOD" and the class name) and the topics between them (tinted by message
 * type), pannable and zoomable (drag, wheel, pinch; two fingers never zoom the page), with a search box and a
 * fullscreen button. A ref gives GraphView's zoom, fit, reveal, center and flash, and `highlight(kind, id, times)` (a
 * module's node id is `m:<name>`, a topic's `t:<topic>`). Given an `app`, Desktop's highlights flash here and nodes and
 * edges take comments.
 */
export const BlueprintGraph = forwardRef<BlueprintGraphHandle, BlueprintGraphProps>(
    function BlueprintGraph(props, ref) {
        const {
            modules,
            extras = [],
            rates = null,
            onModule,
            onTopic,
            onHover,
            controls = true,
            fullscreen = true,
            search = true,
            app,
            blueprint,
            commentSource,
            onViewChange,
            viewChangeDelay = 400,
            rememberLayout = true,
            empty = "No modules to draw.",
        } = props
        const [rememberedLayout, setRememberedLayout] = useGraphLayoutSetting("hierarchy", {
            enabled: props.layout === undefined && rememberLayout,
        })
        const layout = props.layout ?? rememberedLayout
        const setLayout = (next: LayoutId) => {
            setRememberedLayout(next)
            props.onLayoutChange?.(next)
        }
        const [hovered, setHovered] = useState<BlueprintSpot>(null)
        const [selected, setSelected] = useState<BlueprintSelection>(null)
        const selectedSpot: BlueprintSpot = selected
            ? selected.kind === "module" ? { module: selected.id } : { topic: selected.id }
            : null
        const spot = props.spot !== undefined ? props.spot : hovered ?? selectedSpot
        const ownRef = useRef<GraphViewHandle>(null)
        const [box, setBox] = useState<HTMLDivElement | null>(null)
        useNoPagePinch(box)
        const { mode, toggle } = useFullscreen(box)
        // the graph refits to its new size
        useEffect(() => {
            const timer = setTimeout(() => ownRef.current?.fit(), 60)
            return () => clearTimeout(timer)
        }, [mode])

        // sizes follow the skin's fonts; keyed on content, not identity: new arrays would re-bind GraphView's pointer
        // handlers, which drops a pinch mid-gesture
        const { skin } = useTheme()
        const shape = JSON.stringify([modules.map((m) => [m.name, m.class, m.streams]), extras])
        const { nodes, edges } = useMemo(() => buildBlueprintGraph(modules, extras), [shape, skin])
        const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
        const types = useMemo(
            () => new Map(nodes.flatMap((node) => (node.kind === "topic" ? [[node.topic, node.type] as const] : []))),
            [nodes],
        )
        const focus = spot && "module" in spot ? `m:${spot.module}` : spot ? `t:${spot.topic}` : null
        const hz = (topic: string) => rates?.get(topic) ?? 0

        // highlight: an agent (through Desktop) or the app points at something
        const highlight = (kind: string, id: string, times = 2): boolean => {
            const found = findBlueprintTarget(nodes, edges, kind, id)
            const graph = ownRef.current
            if (!found || !graph) {
                return false
            }
            if ("node" in found) {
                graph.reveal(found.node)
                graph.flash(found.node, times)
            } else {
                graph.reveal(found.to)
                graph.flash(found.edge, times)
            }
            return true
        }
        const highlightRef = useRef(highlight)
        highlightRef.current = highlight
        useImperativeHandle(ref, () => ({
            zoom: (factor, x, y) => ownRef.current?.zoom(factor, x, y),
            fit: () => ownRef.current?.fit(),
            reveal: (id) => ownRef.current?.reveal(id),
            center: (id) => ownRef.current?.center(id),
            flash: (id, times) => ownRef.current?.flash(id, times),
            highlight: (kind, id, times) => highlightRef.current(kind, id, times),
        }), [])
        useEffect(() => {
            if (!app) {
                return
            }
            return desktopEvents((event) => {
                if (event.type === "view-highlight" && event.app === app && event.id != null) {
                    highlightRef.current(String(event.kind ?? "module"), String(event.id), Number(event.times) || 2)
                }
            })
        }, [app])

        // what the user sees, reported (debounced) after the view, the layout or the selection changes
        const visible = useRef<string[]>([])
        const reportTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
        const report = useRef(() => {})
        report.current = () => {
            if (!onViewChange) {
                return
            }
            clearTimeout(reportTimer.current)
            reportTimer.current = setTimeout(
                () => onViewChange(blueprintViewState(nodes, edges, new Set(visible.current), selected, layout)),
                viewChangeDelay,
            )
        }
        const onViewport = useCallback((ids: string[]) => {
            visible.current = ids
            report.current()
        }, [])
        useEffect(() => report.current(), [selected, layout])
        useEffect(() => () => clearTimeout(reportTimer.current), [])

        // the search box shows while the pointer moves over the graph, and fades out a while after it stops
        const [pointerActive, setPointerActive] = useState(false)
        const [searchBusy, setSearchBusy] = useState(false)
        const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
        const wake = () => {
            if (!pointerActive) {
                setPointerActive(true)
            }
            clearTimeout(idleTimer.current)
            idleTimer.current = setTimeout(() => setPointerActive(false), 2500)
        }
        useEffect(() => () => clearTimeout(idleTimer.current), [])
        const [narrow, setNarrow] = useState(false)
        useEffect(() => {
            if (!box || typeof ResizeObserver === "undefined") {
                return
            }
            const observer = new ResizeObserver(() => setNarrow(box.getBoundingClientRect().width < 600))
            observer.observe(box)
            return () => observer.disconnect()
        }, [box])
        const searchItems = useMemo(
            () =>
                nodes.map((node) =>
                    node.kind === "module"
                        ? { id: node.id, kind: "module", label: node.label, also: [node.name] }
                        : { id: node.id, kind: "topic", label: node.topic, also: [node.type] }
                ),
            [nodes],
        )
        const select = (node: BlueprintNode) => {
            setSelected(node.kind === "module" ? { kind: "module", id: node.name } : { kind: "topic", id: node.topic })
            if (node.kind === "module") {
                onModule?.(node.name)
            } else {
                onTopic?.(node.topic)
            }
        }

        // comments: a right click on a node or edge, badges where there are open ones, their threads
        const commentsOn = !!app && props.comments !== false
        const store = useComments(commentsOn ? app : null, {}, { client: props.commentsClient })
        const canComment = commentsOn && store.available !== false
        const [card, setCard] = useState<Card | null>(null)
        const targets = useMemo(() => {
            const map = new Map<string, CommentTarget>()
            for (const node of nodes) {
                const target = blueprintTarget(node, blueprint)
                map.set(targetKey(target), target)
            }
            for (const edge of edges) {
                const target = blueprintTarget({ edge, nodes: nodesById }, blueprint)
                map.set(targetKey(target), target)
            }
            return map
        }, [nodes, edges, nodesById, blueprint])
        const counts = canComment ? store.counts : new Map<string, number>()
        const threadsOf = (target: CommentTarget) =>
            store.comments
                .filter((comment) => targetKey(comment.target) === targetKey(target))
                .sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1))
        const comment = async (target: CommentTarget, text: string) => {
            let source: string | null | undefined
            try {
                source = await commentSource?.(target)
            } catch {
                source = undefined
            }
            await store.create(target, text, source ? { source } : undefined)
            setCard(null)
        }

        return (
            <div
                ref={setBox}
                className={cx(
                    "dr-bpgraph",
                    mode === "overlay" && "dr-bpgraph--overlay",
                    mode && "dr-bpgraph--fullscreen",
                    props.className,
                )}
                style={props.style}
                data-fullscreen={mode ?? undefined}
                onPointerMove={search ? wake : undefined}
                onPointerDown={search ? wake : undefined}
            >
                {nodes.length === 0
                    ? <div className="dr-bpgraph__empty">{empty}</div>
                    : (
                        <GraphView<BlueprintNode, BlueprintEdge>
                            ref={ownRef}
                            className={cx("dr-bpgraph__view", rates && "dr-bpgraph__view--running")}
                            aria-label={props["aria-label"] ?? "Module graph"}
                            nodes={nodes}
                            edges={edges}
                            layout={layout}
                            focus={focus}
                            port={PORT}
                            fitMinScale={props.fitMinScale}
                            focusable={(node) => node.kind === "module"}
                            nodeClassName={(node) =>
                                cx(
                                    node.kind,
                                    node.kind === "topic" && node.extra && "extra",
                                    node.kind === "topic" && node.loose && "loose",
                                    node.kind === "topic" && hz(node.topic) > 0 && "live",
                                )}
                            nodeTitle={(node) =>
                                node.kind === "module" ? node.name : `/${node.topic}\n${node.type}` +
                                    (node.extra ? "\n(not wired in this blueprint)" : "") +
                                    (node.loose ? "\n(only written or only read here)" : "")}
                            edgeClassName={(edge) => (hz(edge.topic) > 0 ? "flow" : undefined)}
                            nodeStyle={(node) =>
                                node.kind === "topic"
                                    ? ({ "--dr-bpgraph-type": messageTypeColor(node.type) } as CSSProperties)
                                    : undefined}
                            edgeStyle={(edge) =>
                                ({ "--dr-graph-edge": messageTypeColor(types.get(edge.topic)) }) as CSSProperties}
                            onNodeClick={(node) => select(node)}
                            onBackgroundClick={() => {
                                setSelected(null)
                                onTopic?.(null)
                            }}
                            onHover={(node) => {
                                const next: BlueprintSpot = node
                                    ? node.kind === "module" ? { module: node.name } : { topic: node.topic }
                                    : null
                                setHovered(next)
                                onHover?.(next)
                            }}
                            onViewport={onViewChange ? onViewport : undefined}
                            onNodeContextMenu={canComment
                                ? (node, at) =>
                                    setCard({ kind: "menu", ...at, target: blueprintTarget(node, blueprint) })
                                : undefined}
                            onEdgeContextMenu={canComment
                                ? (edge, _index, at) =>
                                    setCard({
                                        kind: "menu",
                                        ...at,
                                        target: blueprintTarget({ edge, nodes: nodesById }, blueprint),
                                    })
                                : undefined}
                            onBadgeClick={(key, at) => {
                                const target = targets.get(key)
                                if (target) {
                                    setCard({ kind: "thread", ...at, target })
                                }
                            }}
                            edgeDecoration={canComment
                                ? (edge, _index, at) => {
                                    const key = targetKey({ kind: "edge", id: edgeKey(edge) })
                                    const count = counts.get(key) ?? 0
                                    return count ? <Badge_ id={key} count={count} x={at.x} y={at.y} /> : null
                                }
                                : undefined}
                            renderNode={(node) => {
                                const key = targetKey(blueprintTarget(node))
                                const count = counts.get(key) ?? 0
                                return (
                                    <>
                                        <rect className="box" width={node.w} height={node.h} />
                                        {node.kind === "module"
                                            ? (
                                                <>
                                                    <rect className="bar" width={MODULE_BAR} height={node.h} />
                                                    <text x={MODULE_BAR + MODULE_PAD_X} y={node.h / 2} className="tag">
                                                        MOD
                                                    </text>
                                                    <text
                                                        x={MODULE_BAR + MODULE_PAD_X + node.tagW + TAG_GAP}
                                                        y={node.h / 2}
                                                        className="name"
                                                    >
                                                        {node.label}
                                                    </text>
                                                    <text x={node.w - CHEV_W / 2 - 2} y={node.h / 2} className="more">
                                                        ›
                                                    </text>
                                                </>
                                            )
                                            : (
                                                <>
                                                    <text
                                                        x={PAD_X}
                                                        y={hz(node.topic) ? 11 : node.h / 2}
                                                        className="name"
                                                    >
                                                        {node.topic}
                                                    </text>
                                                    <text x={PAD_X} y={22} className="rate">
                                                        {hz(node.topic) ? formatRate(hz(node.topic)) : ""}
                                                    </text>
                                                </>
                                            )}
                                        {[0, node.w].map((x) => (
                                            <rect
                                                key={x}
                                                className="port"
                                                x={x - PORT / 2}
                                                y={node.h / 2 - PORT / 2}
                                                width={PORT}
                                                height={PORT}
                                            />
                                        ))}
                                        {count ? <Badge_ id={key} count={count} x={node.w - 3} y={3} /> : null}
                                    </>
                                )
                            }}
                        >
                            {props.children}
                            {controls && <GraphControls graph={ownRef} layout={layout} onLayoutChange={setLayout} />}
                        </GraphView>
                    )}
                {(fullscreen || (search && nodes.length > 0)) && (
                    <div className="dr-bpgraph__top">
                        {search && nodes.length > 0 && (
                            <GraphSearch
                                items={searchItems}
                                shown={pointerActive}
                                compact={narrow}
                                onBusyChange={setSearchBusy}
                                kindLabel={(item) => (item.kind === "module" ? "MOD" : "TOPIC")}
                                itemStyle={(item) =>
                                    item.kind === "topic"
                                        ? ({ "--dr-bpgraph-type": messageTypeColor(item.also?.[0]) } as CSSProperties)
                                        : undefined}
                                onPick={(item) => {
                                    const node = nodesById.get(item.id)
                                    if (node) {
                                        select(node)
                                        ownRef.current?.center(node.id)
                                        ownRef.current?.flash(node.id, 1)
                                    }
                                }}
                                className={searchBusy ? "dr-bpgraph__search--busy" : undefined}
                            />
                        )}
                        {fullscreen && (
                            <Button
                                size="sm"
                                className="dr-bpgraph__fullscreen"
                                icon={mode ? "fullscreen-exit" : "fullscreen"}
                                title={mode ? "Exit fullscreen (Esc)" : "Show the graph fullscreen"}
                                pressed={!!mode}
                                onClick={toggle}
                            >
                                {mode ? "Exit fullscreen" : "Fullscreen"}
                            </Button>
                        )}
                    </div>
                )}
                {card?.kind === "menu" && (
                    <MenuAt
                        x={card.x}
                        y={card.y}
                        onClose={() => setCard(null)}
                        items={[
                            { heading: targetLabel(card.target) },
                            {
                                label: "Comment…",
                                icon: "comment",
                                keepOpen: true,
                                "data-action": "comment",
                                onSelect: () => setCard({ ...card, kind: "compose" }),
                            },
                            ...(counts.get(targetKey(card.target))
                                ? [{
                                    label: `Show comments (${counts.get(targetKey(card.target))})`,
                                    icon: "list",
                                    keepOpen: true,
                                    onSelect: () => setCard({ ...card, kind: "thread" }),
                                }]
                                : []),
                        ]}
                    />
                )}
                {card?.kind === "compose" && (
                    <MenuAt
                        x={card.x}
                        y={card.y}
                        onClose={() => setCard(null)}
                        className="dr-comment-card"
                    >
                        <CommentComposer
                            target={card.target}
                            onSubmit={(text) => comment(card.target, text)}
                            onCancel={() => setCard(null)}
                        />
                    </MenuAt>
                )}
                {card?.kind === "thread" && (
                    <MenuAt
                        x={card.x}
                        y={card.y}
                        onClose={() => setCard(null)}
                        className="dr-comment-card"
                    >
                        {threadsOf(card.target).map((thread) => (
                            <CommentThread
                                key={thread.id}
                                comment={thread}
                                onReply={(text) => store.reply(thread.id, text)}
                                onResolve={(resolved) => store.resolve(thread.id, resolved)}
                            />
                        ))}
                        <Button
                            size="sm"
                            variant="ghost"
                            icon="plus"
                            onClick={() => setCard({ ...card, kind: "compose" })}
                        >
                            New comment
                        </Button>
                    </MenuAt>
                )}
            </div>
        )
    },
) as ForwardRefExoticComponent<
    BlueprintGraphProps & RefAttributes<BlueprintGraphHandle> & {
        ref?: Ref<BlueprintGraphHandle> | Ref<GraphViewHandle>
    }
>
