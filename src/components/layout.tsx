/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Surfaces and layout: cards, panels (collapsible / floating), split panes, bars, stacks, HUD overlays, type.
import { useRef, useState } from "react"
import type {
    AnchorHTMLAttributes,
    ButtonHTMLAttributes,
    CSSProperties,
    ElementType,
    HTMLAttributes,
    IframeHTMLAttributes,
    PointerEvent as ReactPointerEvent,
    ReactNode,
    Ref,
} from "react"
import { cx } from "../cx.ts"
import { useDrag, usePersistentState } from "../hooks.ts"
import { Icon } from "./icon.tsx"

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
    ref?: Ref<HTMLElement>
    title?: ReactNode
    description?: ReactNode
    /** the right side of the header */
    actions?: ReactNode
    padded?: boolean
    glass?: boolean
}

/** A bordered surface. `title`, `description`, `actions` (right side of the header); `padded` (default true). */
export function Card({
    title,
    description,
    actions,
    padded = true,
    glass = false,
    className,
    children,
    ...rest
}: CardProps) {
    return (
        <section className={cx("dr-card", padded && "dr-card--padded", glass && "dr-glass", className)} {...rest}>
            {title || actions
                ? (
                    <header className="dr-card-head">
                        <div className="dr-card-titles">
                            {title ? <h3 className="dr-card-title">{title}</h3> : null}
                            {description ? <div className="dr-card-desc">{description}</div> : null}
                        </div>
                        {actions ? <div className="dr-card-actions">{actions}</div> : null}
                    </header>
                )
                : null}
            {children}
        </section>
    )
}

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
    title?: ReactNode
    icon?: string
    actions?: ReactNode
    collapsible?: boolean
    /** controlled open state (with onOpenChange) */
    open?: boolean
    onOpenChange?: (open: boolean) => void
    defaultOpen?: boolean
    /** remembers the open state (localStorage) under this key */
    persistKey?: string
    glass?: boolean
    bodyClassName?: string
}

/**
 * A panel with a header that can collapse its body. `collapsible`, `open`/`onOpenChange` (controlled) or
 * `defaultOpen`; `persistKey` remembers it; `glass` for panels floating over a 3D/video view; `icon`, `actions`.
 */
export function Panel({
    title,
    icon,
    actions,
    collapsible = false,
    open,
    onOpenChange,
    defaultOpen = true,
    persistKey,
    glass = false,
    className,
    bodyClassName,
    children,
    ...rest
}: PanelProps) {
    const [savedOpen, setSavedOpen] = usePersistentState(
        persistKey ? `dr.panel.${persistKey}` : "dr.panel.__unsaved",
        defaultOpen,
    )
    const [localOpen, setLocalOpen] = useState(defaultOpen)
    const isOpen = !collapsible || (open ?? (persistKey ? savedOpen : localOpen))
    const setOpen = (next: boolean) => {
        onOpenChange?.(next)
        if (open === undefined) {
            if (persistKey) {
                setSavedOpen(next)
            } else {
                setLocalOpen(next)
            }
        }
    }
    return (
        <section className={cx("dr-panel", glass && "dr-glass", !isOpen && "dr-panel--closed", className)} {...rest}>
            {title || actions
                ? (
                    <header className="dr-panel-head">
                        {collapsible
                            ? (
                                <button
                                    type="button"
                                    className="dr-panel-toggle"
                                    aria-expanded={isOpen}
                                    onClick={() => setOpen(!isOpen)}
                                >
                                    <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={14} />
                                    {icon ? <Icon name={icon} size={15} /> : null}
                                    <span className="dr-panel-title">{title}</span>
                                </button>
                            )
                            : (
                                <div className="dr-panel-toggle dr-panel-toggle--static">
                                    {icon ? <Icon name={icon} size={15} /> : null}
                                    <span className="dr-panel-title">{title}</span>
                                </div>
                            )}
                        {actions ? <div className="dr-panel-actions">{actions}</div> : null}
                    </header>
                )
                : null}
            {isOpen ? <div className={cx("dr-panel-body", bodyClassName)}>{children}</div> : null}
        </section>
    )
}

export interface DisclosureProps extends Omit<HTMLAttributes<HTMLDetailsElement>, "title"> {
    /** the summary, in the theme's micro-label type */
    title: ReactNode
    /** after the title ("· 9"); hidden when null */
    count?: ReactNode
    defaultOpen?: boolean
    /** remembers the open state (localStorage) under this key */
    persistKey?: string
    /** "card": one rounded, bordered box holding the title row and (open) the body, chevron on the right */
    variant?: "plain" | "card"
}

/** A section that folds under its label (▸ / ▾), remembering whether it's open with `persistKey`. */
export function Disclosure({
    title,
    count,
    defaultOpen = true,
    persistKey,
    variant = "plain",
    className,
    children,
    ...rest
}: DisclosureProps) {
    const [open, setOpen] = usePersistentState(persistKey ?? "dr.disclosure.__unsaved", defaultOpen)
    return (
        <details
            className={cx("dr-disclosure", variant === "card" && "dr-disclosure--card", className)}
            open={open}
            onToggle={(event) => setOpen(event.currentTarget.open)}
            {...rest}
        >
            <summary className="dr-disclosure__summary dr-label">
                {title}
                {count !== undefined && count !== null ? <span className="dr-disclosure__count">· {count}</span> : null}
            </summary>
            {children}
        </details>
    )
}

/** px from the top-left; negative = from the right/bottom */
export interface PanelPosition {
    x: number
    y: number
}

export interface FloatingPanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
    title?: ReactNode
    icon?: string
    actions?: ReactNode
    onClose?: () => void
    defaultPosition?: PanelPosition
    /** remembers the position (localStorage) under this key */
    persistKey?: string
    width?: CSSProperties["width"]
}

/**
 * A panel that floats over the page and can be dragged by its header (position remembered with `persistKey`).
 * `defaultPosition` { x, y } (px from the top-left; negative = from the right/bottom); `onClose` adds an ✕.
 */
export function FloatingPanel({
    title,
    icon,
    actions,
    onClose,
    defaultPosition = { x: 16, y: 16 },
    persistKey,
    width = 300,
    className,
    style,
    children,
    ...rest
}: FloatingPanelProps) {
    const [saved, setSaved] = usePersistentState(
        persistKey ? `dr.float.${persistKey}` : "dr.float.__unsaved",
        defaultPosition,
    )
    const [local, setLocal] = useState(defaultPosition)
    const position = persistKey ? saved : local
    const setPosition = persistKey ? setSaved : setLocal
    const start = useRef(position)
    const panel = useRef<HTMLElement>(null)
    const drag = useDrag({
        onStart: () => {
            const rect = panel.current!.getBoundingClientRect()
            start.current = { x: rect.left, y: rect.top }
        },
        onMove: ({ dx, dy }: { dx: number; dy: number }) => {
            const rect = panel.current!.getBoundingClientRect()
            const x = Math.min(Math.max(0, start.current.x + dx), innerWidth - rect.width)
            const y = Math.min(Math.max(0, start.current.y + dy), innerHeight - 40)
            setPosition({ x, y })
        },
    })
    const placement = {
        left: position.x >= 0 ? position.x : undefined,
        right: position.x < 0 ? -position.x : undefined,
        top: position.y >= 0 ? position.y : undefined,
        bottom: position.y < 0 ? -position.y : undefined,
    }
    return (
        <section
            ref={panel}
            className={cx("dr-panel dr-glass dr-floating", className)}
            style={{ width, ...placement, ...style }}
            {...rest}
        >
            <header className="dr-panel-head dr-floating-head" {...drag}>
                <div className="dr-panel-toggle dr-panel-toggle--static">
                    <Icon name="grip" size={14} />
                    {icon ? <Icon name={icon} size={15} /> : null}
                    <span className="dr-panel-title">{title}</span>
                </div>
                <div className="dr-panel-actions" onPointerDown={(event) => event.stopPropagation()}>
                    {actions}
                    {onClose
                        ? (
                            <button type="button" className="dr-panel-close" aria-label="Close" onClick={onClose}>
                                <Icon name="close" size={14} />
                            </button>
                        )
                        : null}
                </div>
            </header>
            <div className="dr-panel-body">{children}</div>
        </section>
    )
}

export interface SplitPaneProps extends HTMLAttributes<HTMLDivElement> {
    direction?: "row" | "column"
    /** the first pane's size: px (a number) or a CSS length like "40%"; controlled with onSizeChange */
    size?: number | string
    /** the new size in px, while dragging */
    onSizeChange?: (size: number) => void
    defaultSize?: number | string
    /** px */
    min?: number
    /** px */
    max?: number
    persistKey?: string
}

/**
 * Two panes with a draggable divider. `direction` "row" (side by side) | "column"; `size` of the first pane (px or
 * %, controlled with onSizeChange) or `defaultSize`; `min` / `max` px; `persistKey`.
 */
export function SplitPane({
    direction = "row",
    size,
    onSizeChange,
    defaultSize = "50%",
    min = 120,
    max,
    persistKey,
    className,
    children,
    ...rest
}: SplitPaneProps) {
    const [saved, setSaved] = usePersistentState<number | string>(
        persistKey ? `dr.split.${persistKey}` : "dr.split.__unsaved",
        defaultSize,
    )
    const [local, setLocal] = useState<number | string>(defaultSize)
    const current = size ?? (persistKey ? saved : local)
    const container = useRef<HTMLDivElement>(null)
    const first = useRef<HTMLDivElement>(null)
    const start = useRef(0)
    const set = (next: number) => {
        onSizeChange?.(next)
        if (size === undefined) {
            ;(persistKey ? setSaved : setLocal)(next)
        }
    }
    const row = direction === "row"
    const drag = useDrag({
        onStart: () => {
            start.current = row ? first.current!.offsetWidth : first.current!.offsetHeight
        },
        onMove: ({ dx, dy }: { dx: number; dy: number }) => {
            const total = row ? container.current!.offsetWidth : container.current!.offsetHeight
            const next = Math.min(max ?? total - min, Math.max(min, start.current + (row ? dx : dy)))
            set(next)
        },
    })
    const [a, b] = Array.isArray(children) ? children : [children, null]
    return (
        <div ref={container} className={cx("dr-split", `dr-split--${direction}`, className)} {...rest}>
            <div
                ref={first}
                className="dr-split-pane"
                style={{ flexBasis: typeof current === "number" ? `${current}px` : current }}
            >
                {a}
            </div>
            <div
                className="dr-split-divider"
                role="separator"
                aria-orientation={row ? "vertical" : "horizontal"}
                tabIndex={0}
                onKeyDown={(event) => {
                    const step = event.shiftKey ? 40 : 10
                    const now = row ? first.current!.offsetWidth : first.current!.offsetHeight
                    if ((row && event.key === "ArrowLeft") || (!row && event.key === "ArrowUp")) {
                        set(Math.max(min, now - step))
                    } else if ((row && event.key === "ArrowRight") || (!row && event.key === "ArrowDown")) {
                        set(now + step)
                    }
                }}
                {...drag}
            />
            <div className="dr-split-pane dr-split-pane--rest">{b}</div>
        </div>
    )
}

export interface ResizeHandleProps extends HTMLAttributes<HTMLDivElement> {
    onResize: (drag: { dx: number; dy: number; done: boolean }) => void
    onStart?: () => void
    corner?: "bottom-right" | "bottom-left"
    label?: string
}

/**
 * A corner grip for resizing a panel: `onResize({ dx, dy, done })` while dragging (px from where it started) and once
 * more with `done: true` on release. `corner` "bottom-right" | "bottom-left" (the one facing into the screen).
 */
export function ResizeHandle({
    onResize,
    onStart,
    corner = "bottom-right",
    label = "Resize",
    className,
    ...rest
}: ResizeHandleProps) {
    const start = useRef<{ x: number; y: number } | null>(null)
    const report = (event: ReactPointerEvent<HTMLDivElement>, done: boolean) =>
        start.current && onResize({ dx: event.clientX - start.current.x, dy: event.clientY - start.current.y, done })
    return (
        <div
            className={cx("dr-resize-handle", `dr-resize-handle--${corner}`, className)}
            role="separator"
            aria-label={label}
            title={label}
            onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                event.currentTarget.setPointerCapture?.(event.pointerId)
                start.current = { x: event.clientX, y: event.clientY }
                onStart?.()
            }}
            onPointerMove={(event) => report(event, false)}
            onPointerUp={(event) => {
                report(event, true)
                start.current = null
            }}
            onPointerCancel={(event) => {
                report(event, true)
                start.current = null
            }}
            {...rest}
        />
    )
}

export interface TopBarProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
    title?: ReactNode
    icon?: string
    left?: ReactNode
    right?: ReactNode
}

/** The app's top bar: `title` (and `icon`), `left` / center `children` / `right` slots. */
export function TopBar({ title, icon, left, right, className, children, ...rest }: TopBarProps) {
    return (
        <header className={cx("dr-topbar", className)} {...rest}>
            <div className="dr-topbar-left">
                {icon ? <Icon name={icon} size={18} /> : null}
                {title ? <span className="dr-title">{title}</span> : null}
                {left}
            </div>
            <div className="dr-topbar-center">{children}</div>
            <div className="dr-topbar-right">{right}</div>
        </header>
    )
}

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
    floating?: boolean
    vertical?: boolean
}

/** A row of controls (buttons, selects, separators). `floating` gives it a glass background (over a view). */
export function Toolbar({ floating = false, vertical = false, className, children, ...rest }: ToolbarProps) {
    return (
        <div
            className={cx(
                "dr-toolbar",
                floating && "dr-toolbar--floating dr-glass",
                vertical && "dr-toolbar--vertical",
                className,
            )}
            role="toolbar"
            {...rest}
        >
            {children}
        </div>
    )
}

/** A bar pinned to the bottom of its container, above Desktop's dock (status lines, playback controls). */
export function BottomBar({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
    return (
        <footer className={cx("dr-bottombar", className)} {...rest}>
            {children}
        </footer>
    )
}

export interface SeparatorProps extends HTMLAttributes<HTMLSpanElement> {
    vertical?: boolean
}

/** A thin divider; `vertical` inside rows/toolbars. */
export function Separator({ vertical = false, className, ...rest }: SeparatorProps) {
    return <span className={cx("dr-sep", vertical && "dr-sep--vertical", className)} role="separator" {...rest} />
}

export interface ColumnProps extends HTMLAttributes<HTMLDivElement> {
    /** px, or a CSS length */
    gap?: CSSProperties["gap"]
    align?: CSSProperties["alignItems"]
    justify?: CSSProperties["justifyContent"]
    /** takes the free space in its parent Row/Column */
    grow?: boolean
}

export interface RowProps extends ColumnProps {
    wrap?: boolean
}

/** Flex helpers: `gap` (px), `align`, `justify`, `wrap`, `grow`. */
export function Row({
    gap = 8,
    align = "center",
    justify,
    wrap = false,
    grow = false,
    className,
    style,
    children,
    ...rest
}: RowProps) {
    return (
        <div
            className={cx("dr-row", className)}
            style={{
                gap,
                alignItems: align,
                justifyContent: justify,
                flexWrap: wrap ? "wrap" : undefined,
                flex: grow ? 1 : undefined,
                ...style,
            }}
            {...rest}
        >
            {children}
        </div>
    )
}
export function Column({ gap = 8, align, justify, grow = false, className, style, children, ...rest }: ColumnProps) {
    return (
        <div
            className={cx("dr-col", className)}
            style={{ gap, alignItems: align, justifyContent: justify, flex: grow ? 1 : undefined, ...style }}
            {...rest}
        >
            {children}
        </div>
    )
}
/** Takes the free space in a Row/Column. */
export function Spacer() {
    return <span className="dr-spacer" />
}

export interface HudProps extends HTMLAttributes<HTMLDivElement> {
    position?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top" | "bottom" | "center"
}

/**
 * A HUD overlay pinned to a corner of a positioned parent (a 3D view, a video): `position` "top-left" | "top-right" |
 * "bottom-left" | "bottom-right" | "top" | "bottom" | "center".
 */
export function Hud({ position = "top-left", className, children, ...rest }: HudProps) {
    return (
        <div className={cx("dr-hud", `dr-hud--${position}`, className)} {...rest}>
            {children}
        </div>
    )
}

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
    /** 1 (page title), 2 (section head), 3 (micro-label) */
    level?: 1 | 2 | 3
}

/** Headings and text in the theme's type: level 1 (page title), 2 (section head), 3 (micro-label). */
export function Heading({ level = 2, className, children, ...rest }: HeadingProps) {
    const Tag = `h${level}` as const
    return (
        <Tag className={cx(`dr-h${level}`, className)} {...rest}>
            {children}
        </Tag>
    )
}
export function Label({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
    return (
        <span className={cx("dr-label", className)} {...rest}>
            {children}
        </span>
    )
}
export interface TextProps extends HTMLAttributes<HTMLElement> {
    /** the element (default "span") */
    as?: ElementType
    muted?: boolean
    mono?: boolean
    small?: boolean
    tone?: "ok" | "warn" | "danger"
}

/** Text: `muted`, `mono`, `small`, `tone` ("ok" | "warn" | "danger"). */
export function Text({ as = "span", muted, mono, small, tone, className, children, ...rest }: TextProps) {
    const Tag = as
    return (
        <Tag
            className={cx(
                "dr-text",
                muted && "dr-muted",
                mono && "dr-mono",
                small && "dr-small",
                tone && `dr-${tone}`,
                className,
            )}
            {...rest}
        >
            {children}
        </Tag>
    )
}
export function Link({ className, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
    return (
        <a className={cx("dr-link", className)} {...rest}>
            {children}
        </a>
    )
}

export interface AppShellProps extends HTMLAttributes<HTMLDivElement> {
    topBar?: ReactNode
    sidebar?: ReactNode
    bottomBar?: ReactNode
    insetBottom?: boolean
}

/**
 * Full-page app frame: top bar, optional side, main area (fills the viewport). `insetBottom` ends the main area above
 * Desktop's dock (without a bottomBar; a BottomBar already does).
 */
export function AppShell({
    topBar,
    sidebar,
    bottomBar,
    insetBottom = false,
    className,
    children,
    ...rest
}: AppShellProps) {
    return (
        <div className={cx("dr-shell", insetBottom && "dr-shell--inset", className)} {...rest}>
            {topBar}
            <div className="dr-shell-main">
                {sidebar}
                <main className="dr-shell-content">{children}</main>
            </div>
            {bottomBar}
        </div>
    )
}

/**
 * Another page embedded in this one (an iframe that fills its positioned parent, no border, on the page background).
 * `title` names it for screen readers; other props go to the iframe (`src`, `allow`, `sandbox`, …).
 */
export function Embed({ title, className, ...rest }: IframeHTMLAttributes<HTMLIFrameElement>) {
    return <iframe title={title} className={cx("dr-embed", className)} {...rest} />
}

export interface TileProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
    title?: ReactNode
    subtitle?: ReactNode
    /** an image, an icon element */
    media?: ReactNode
    /** an Icon name, when there's no `media` */
    icon?: string
    selected?: boolean
    loading?: boolean
    align?: "center" | "start"
    ref?: Ref<HTMLButtonElement>
}

/**
 * A big selectable card (a picker's choice: a robot, a template, a recording). A button: `onClick`, `selected`,
 * `disabled`. `media` (an image, an icon element) or `icon` (an Icon name) on top, then `title` and `subtitle`, then
 * `children`. `align` "center" (a picker's icons) | "start" (text cards: a featured item with its description). With
 * `loading` it is a placeholder (no click).
 */
export function Tile({
    title,
    subtitle,
    media,
    icon,
    selected,
    loading = false,
    align = "center",
    className,
    children,
    ...rest
}: TileProps) {
    if (loading) {
        return (
            <div className={cx("dr-tile", "dr-tile--loading", className)} aria-hidden={true}>
                <span className="dr-tile__media dr-skeleton" />
                <span className="dr-tile__bar dr-skeleton" />
                <span className="dr-tile__bar dr-tile__bar--short dr-skeleton" />
            </div>
        )
    }
    return (
        <button
            type="button"
            className={cx("dr-tile", align === "start" && "dr-tile--start", selected && "dr-tile--selected", className)}
            aria-pressed={selected === undefined ? undefined : !!selected}
            {...rest}
        >
            {media || icon
                ? <span className="dr-tile__media">{media ?? <Icon name={icon ?? ""} size={40} />}</span>
                : null}
            {title ? <span className="dr-tile__title">{title}</span> : null}
            {subtitle ? <span className="dr-tile__subtitle">{subtitle}</span> : null}
            {children}
        </button>
    )
}

export interface TileGridProps extends HTMLAttributes<HTMLDivElement> {
    /** a column's least width: px, or a CSS length */
    min?: number | string
}

/** Tiles in a responsive grid: as many columns of at least `min` px as fit. */
export function TileGrid({ min = 150, className, style, children, ...rest }: TileGridProps) {
    return (
        <div
            role="list"
            className={cx("dr-tile-grid", className)}
            style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${typeof min === "number" ? `${min}px` : min}, 1fr))`,
                ...style,
            }}
            {...rest}
        >
            {children}
        </div>
    )
}
