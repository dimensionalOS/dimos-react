// Demo: a blueprint's module graph (remembered layout, search, highlight, the view report, comments on nodes and edges)
// and the comment toolkit on its own, against a stand-in Desktop (demo/mock_desktop.ts).
import { useMemo, useRef, useState } from "react"
import { Button, Card, CodeBlock, Row, Text } from "../../src/index.ts"
import {
    BlueprintGraph,
    type BlueprintGraphHandle,
    type BlueprintModule,
    type GraphViewState,
    putView,
} from "../../src/graph.ts"
import {
    CommentBadge,
    CommentComposer,
    commentsClient,
    type CommentTarget,
    CommentThread,
    useComments,
} from "../../src/comments.ts"
import { mockDesktop } from "../mock_desktop.ts"

const stream = (name: string, type: string, direction: "in" | "out") => ({ name, type, direction })

export const DEMO_MODULES: BlueprintModule[] = [
    {
        name: "go2",
        class: "dimos.robot.unitree.GO2Connection",
        streams: [
            stream("color_image", "sensor_msgs.Image", "out"),
            stream("lidar", "sensor_msgs.PointCloud2", "out"),
            stream("odom", "nav_msgs.Odometry", "out"),
            stream("cmd_vel", "geometry_msgs.Twist", "in"),
        ],
    },
    {
        name: "mapper",
        class: "dimos.mapping.VoxelGridMapper",
        streams: [
            stream("lidar", "sensor_msgs.PointCloud2", "in"),
            stream("odom", "nav_msgs.Odometry", "in"),
            stream("global_map", "sensor_msgs.PointCloud2", "out"),
        ],
    },
    {
        name: "costmap",
        class: "dimos.navigation.CostMapper",
        streams: [
            stream("global_map", "sensor_msgs.PointCloud2", "in"),
            stream("costmap", "nav_msgs.OccupancyGrid", "out"),
        ],
    },
    {
        name: "planner",
        class: "dimos.navigation.ReplanningAStarPlanner",
        streams: [
            stream("costmap", "nav_msgs.OccupancyGrid", "in"),
            stream("odom", "nav_msgs.Odometry", "in"),
            stream("goal", "geometry_msgs.PoseStamped", "in"),
            stream("cmd_vel", "geometry_msgs.Twist", "out"),
            stream("path", "nav_msgs.Path", "out"),
        ],
    },
    {
        name: "detector",
        class: "dimos.perception.Detection2DModule",
        streams: [
            stream("color_image", "sensor_msgs.Image", "in"),
            stream("detections", "vision_msgs.Detection2DArray", "out"),
        ],
    },
    {
        name: "agent",
        class: "dimos.agents.Agent",
        streams: [
            stream("detections", "vision_msgs.Detection2DArray", "in"),
            stream("goal", "geometry_msgs.PoseStamped", "out"),
        ],
    },
]

const SOURCE = (target: CommentTarget) =>
    target.kind === "module"
        ? `class ${target.label}(Module):\n    # … the module's source, as the host app fetches it\n`
        : undefined

export function GraphSection() {
    // a Desktop with the comments endpoints, whose agent answers each comment a moment later
    const desktop = useMemo(() => {
        const desktop = mockDesktop({ agentReplyMs: 1500 })
        desktop.comments.push({
            id: "seed",
            app: "demo",
            target: { kind: "module", id: "planner", label: "ReplanningAStarPlanner", blueprint: "unitree_go2" },
            text: "Why does this replan every frame when the costmap barely changes?",
            author: "user",
            at: new Date(Date.now() - 12 * 60_000).toISOString(),
            status: "open",
            replies: [{
                id: "seed-r",
                text: "It replans on every costmap message. I'll gate it on a costmap diff above a threshold.",
                author: "claude-code",
                at: new Date(Date.now() - 9 * 60_000).toISOString(),
            }],
        })
        return desktop
    }, [])
    const client = useMemo(() => commentsClient({ fetch: desktop.fetch, events: desktop.events }), [desktop])
    const graph = useRef<BlueprintGraphHandle>(null)
    const [view, setView] = useState<GraphViewState | null>(null)
    return (
        <>
            <Text muted={true} small={true}>
                The layout picked last is remembered (Desktop's UI setting{" "}
                <code>graphLayout</code>, else this browser). Move the pointer over the graph for the search box; right
                click (or long press) a module, topic or edge to comment; a badge opens its thread.
            </Text>
            <Row gap={8} wrap={true}>
                <Button size="sm" onClick={() => graph.current?.highlight("module", "ReplanningAStarPlanner")}>
                    Highlight the planner
                </Button>
                <Button size="sm" onClick={() => graph.current?.highlight("topic", "/odom", 3)}>
                    Highlight /odom (3×)
                </Button>
                <Button size="sm" onClick={() => graph.current?.highlight("edge", "mapper>global_map")}>
                    Highlight mapper → /global_map
                </Button>
            </Row>
            <BlueprintGraph
                ref={graph}
                app="demo"
                blueprint="unitree_go2"
                modules={DEMO_MODULES}
                commentsClient={client}
                commentSource={SOURCE}
                onViewChange={(state) => {
                    setView(state)
                    putView("demo", { ...state, blueprint: "unitree_go2" }, { fetch: desktop.fetch })
                }}
                style={{ height: 460, border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
            />
            <details>
                <summary>
                    <Text small={true} muted={true}>What an agent sees (PUT /gateways/desktop/views/demo)</Text>
                </summary>
                <CodeBlock language="json" code={JSON.stringify(view, null, 2)} />
            </details>
            <StandaloneComments client={client} />
        </>
    )
}

/** The comment toolkit outside a graph: any app can comment on its own things. */
function StandaloneComments({ client }: { client: ReturnType<typeof commentsClient> }) {
    const target: CommentTarget = { kind: "file", id: "maps/office.pcd", label: "maps/office.pcd" }
    const store = useComments("demo-files", {}, { client })
    return (
        <div className="demo-grid">
            <Card title="CommentComposer">
                <CommentComposer target={target} onSubmit={(text) => store.create(target, text)} autoFocus={false} />
            </Card>
            <Card
                title={
                    <Row gap={8}>
                        <span>CommentThread</span>
                        <CommentBadge count={store.counts.get(`file:${target.id}`) ?? 0} />
                    </Row>
                }
            >
                {store.comments.length
                    ? store.comments.map((comment) => (
                        <CommentThread
                            key={comment.id}
                            comment={comment}
                            onReply={(text) => store.reply(comment.id, text)}
                            onResolve={(resolved) => store.resolve(comment.id, resolved)}
                        />
                    ))
                    : <Text muted={true} small={true}>No comments yet: write one on the left.</Text>}
            </Card>
        </div>
    )
}
