import React, { useMemo, useRef, useState, useEffect } from "react"
import styled from "styled-components"
import { UIResource, ResourceStatus, UIResourceStatus } from "./types"

interface UIResourceStatusWithDeps extends UIResourceStatus {
  resourceDependencies?: string[]
}

interface UIResourceWithDeps extends Omit<UIResource, "status"> {
  status?: UIResourceStatusWithDeps
}

interface Node {
  id: string
  x: number
  y: number
  resource: UIResourceWithDeps
  status: ResourceStatus
}

interface Edge {
  from: string
  to: string
}

interface ResourceDAGProps {
  resources: UIResource[]
}

const NODE_WIDTH = 160
const NODE_HEIGHT = 60
const NODE_H_SPACING = 80
const NODE_V_SPACING = 40
const PADDING = 50

const DAGContainer = styled.div`
  width: 100%;
  height: 100%;
  overflow: hidden;
  cursor: grab;
  background: #1a1a2e;
  position: relative;

  &:active {
    cursor: grabbing;
  }
`

const SVGWrapper = styled.svg`
  width: 100%;
  height: 100%;
  user-select: none;
`

const NodeGroup = styled.g<{ $status: ResourceStatus }>`
  cursor: pointer;

  rect {
    fill: ${(props) => {
      switch (props.$status) {
        case ResourceStatus.Healthy:
          return "#16a34a"
        case ResourceStatus.Unhealthy:
          return "#dc2626"
        case ResourceStatus.Building:
          return "#2563eb"
        case ResourceStatus.Pending:
          return "#ca8a04"
        case ResourceStatus.Warning:
          return "#ea580c"
        case ResourceStatus.Disabled:
          return "#6b7280"
        default:
          return "#374151"
      }
    }};
    rx: 8;
    ry: 8;
    stroke: rgba(255, 255, 255, 0.2);
    stroke-width: 2;
    transition: all 0.2s ease;
  }

  &:hover rect {
    stroke: rgba(255, 255, 255, 0.8);
    stroke-width: 3;
    filter: brightness(1.2);
  }

  text {
    fill: white;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
    pointer-events: none;
  }
`

const EdgePath = styled.path`
  fill: none;
  stroke: rgba(255, 255, 255, 0.3);
  stroke-width: 2;
  marker-end: url(#arrowhead);
`

const Tooltip = styled.div<{ $x: number; $y: number }>`
  position: absolute;
  background: rgba(0, 0, 0, 0.9);
  color: white;
  padding: 12px 16px;
  border-radius: 8px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  pointer-events: none;
  z-index: 1000;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  transform: translate(${(props) => props.$x}px, ${(props) => props.$y}px);
  min-width: 180px;
`

const TooltipTitle = styled.div`
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
`

const TooltipRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin: 4px 0;
`

const TooltipLabel = styled.span`
  color: rgba(255, 255, 255, 0.6);
`

const TooltipValue = styled.span`
  font-weight: 500;
`

const StatusBadge = styled.span<{ $status: ResourceStatus }>`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  background: ${(props) => {
    switch (props.$status) {
      case ResourceStatus.Healthy:
        return "#16a34a"
      case ResourceStatus.Unhealthy:
        return "#dc2626"
      case ResourceStatus.Building:
        return "#2563eb"
      case ResourceStatus.Pending:
        return "#ca8a04"
      case ResourceStatus.Warning:
        return "#ea580c"
      case ResourceStatus.Disabled:
        return "#6b7280"
      default:
        return "#374151"
    }
  }};
  color: white;
`

const ZoomControls = styled.div`
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 100;
`

const ZoomButton = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: white;
  font-size: 18px;
  font-weight: bold;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.4);
  }

  &:active {
    transform: scale(0.95);
  }
`

const ZoomLevel = styled.div`
  position: absolute;
  bottom: 16px;
  left: 16px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 6px 12px;
  border-radius: 6px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 12px;
  z-index: 100;
`

const Legend = styled.div`
  position: absolute;
  top: 16px;
  left: 16px;
  background: rgba(0, 0, 0, 0.7);
  padding: 12px 16px;
  border-radius: 8px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 12px;
  color: white;
  z-index: 100;
`

const LegendTitle = styled.div`
  font-weight: 600;
  margin-bottom: 8px;
`

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
`

const LegendColor = styled.div<{ $color: string }>`
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: ${(props) => props.$color};
`

export function ResourceDAG({ resources }: ResourceDAGProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [hoveredNode, setHoveredNode] = useState<Node | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  const { nodes, edges, bounds } = useMemo(() => {
    const resourceMap = new Map<string, UIResourceWithDeps>()
    resources.forEach((r) => resourceMap.set(r.metadata?.name || "", r as UIResourceWithDeps))

    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>()

    resources.forEach((r) => {
      const name = r.metadata?.name || ""
      if (!inDegree.has(name)) inDegree.set(name, 0)
      if (!adjacency.has(name)) adjacency.set(name, [])

      const deps = (r as UIResourceWithDeps).status?.resourceDependencies || []
      deps.forEach((dep) => {
        if (resourceMap.has(dep)) {
          inDegree.set(name, (inDegree.get(name) || 0) + 1)
          const depAdj = adjacency.get(dep) || []
          depAdj.push(name)
          adjacency.set(dep, depAdj)
        }
      })
    })

    const levels: string[][] = []
    const visited = new Set<string>()
    const currentLevel = Array.from(inDegree.entries())
      .filter(([_, degree]) => degree === 0)
      .map(([name]) => name)

    let levelCopy = [...currentLevel]
    while (levelCopy.length > 0) {
      levels.push(levelCopy)
      const nextLevel: string[] = []

      levelCopy.forEach((node) => {
        visited.add(node)
        const neighbors = adjacency.get(node) || []
        neighbors.forEach((neighbor) => {
          if (!visited.has(neighbor)) {
            const degree = (inDegree.get(neighbor) || 0) - 1
            inDegree.set(neighbor, degree)
            if (degree === 0) {
              nextLevel.push(neighbor)
            }
          }
        })
      })

      levelCopy = nextLevel
    }

    resources.forEach((r) => {
      const name = r.metadata?.name || ""
      if (!visited.has(name)) {
        levels.push([name])
        visited.add(name)
      }
    })

    const nodes: Node[] = []
    let maxY = 0
    let maxX = 0

    levels.forEach((level, levelIndex) => {
      const levelHeight =
        level.length * (NODE_HEIGHT + NODE_V_SPACING) - NODE_V_SPACING
      const startY = PADDING + (Math.max(...levels.map((l) => l.length)) * (NODE_HEIGHT + NODE_V_SPACING) - NODE_V_SPACING - levelHeight) / 2

      level.forEach((nodeName, nodeIndex) => {
        const resource = resourceMap.get(nodeName)!

        nodes.push({
          id: nodeName,
          x: PADDING + levelIndex * (NODE_WIDTH + NODE_H_SPACING),
          y: startY + nodeIndex * (NODE_HEIGHT + NODE_V_SPACING),
          resource,
          status: ResourceStatus.None,
        })

        maxX = Math.max(maxX, PADDING + levelIndex * (NODE_WIDTH + NODE_H_SPACING) + NODE_WIDTH)
        maxY = Math.max(maxY, startY + nodeIndex * (NODE_HEIGHT + NODE_V_SPACING) + NODE_HEIGHT)
      })
    })

    const edges: Edge[] = []
    resources.forEach((r) => {
      const name = r.metadata?.name || ""
      const deps = (r as UIResourceWithDeps).status?.resourceDependencies || []
      deps.forEach((dep) => {
        if (resourceMap.has(dep)) {
          edges.push({ from: dep, to: name })
        }
      })
    })

    return {
      nodes,
      edges,
      bounds: { width: maxX + PADDING, height: maxY + PADDING },
    }
  }, [resources])

  const nodesWithStatus = useMemo(() => {
    return nodes.map((node) => {
      let buildStatus = ResourceStatus.None
      let runtimeStatus = ResourceStatus.None

      const res = node.resource
      const status = res.status || {}

      if (status.disableStatus?.state === "Disabled") {
        buildStatus = ResourceStatus.Disabled
        runtimeStatus = ResourceStatus.Disabled
      } else {
        if (status.updateStatus === "in_progress") {
          buildStatus = ResourceStatus.Building
        } else if (status.updateStatus === "pending") {
          buildStatus = ResourceStatus.Pending
        } else if (status.updateStatus === "error") {
          buildStatus = ResourceStatus.Unhealthy
        } else if (status.updateStatus === "ok") {
          buildStatus = ResourceStatus.Healthy
        }

        if (status.composeResourceInfo?.healthStatus === "unhealthy") {
          runtimeStatus = ResourceStatus.Unhealthy
        } else if (status.runtimeStatus === "error") {
          runtimeStatus = ResourceStatus.Unhealthy
        } else if (status.runtimeStatus === "pending") {
          runtimeStatus = ResourceStatus.Pending
        } else if (status.runtimeStatus === "ok") {
          runtimeStatus = ResourceStatus.Healthy
        }
      }

      let finalStatus = runtimeStatus
      if (
        buildStatus !== ResourceStatus.Healthy &&
        buildStatus !== ResourceStatus.None
      ) {
        finalStatus = buildStatus
      }
      if (runtimeStatus === ResourceStatus.None) {
        finalStatus = buildStatus
      }

      return { ...node, status: finalStatus }
    })
  }, [nodes])

  const nodeMap = useMemo(() => {
    const map = new Map<string, Node>()
    nodesWithStatus.forEach((n) => map.set(n.id, n))
    return map
  }, [nodesWithStatus])

  useEffect(() => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth
      const containerHeight = containerRef.current.clientHeight
      const scaleX = containerWidth / bounds.width
      const scaleY = containerHeight / bounds.height
      const initialScale = Math.min(scaleX, scaleY, 1) * 0.9
      const centerX = (containerWidth - bounds.width * initialScale) / 2
      const centerY = (containerHeight - bounds.height * initialScale) / 2
      setTransform({ x: centerX, y: centerY, scale: initialScale })
    }
  }, [bounds.width, bounds.height])

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newScale = Math.max(0.1, Math.min(3, transform.scale * delta))

    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const newX = mouseX - ((mouseX - transform.x) * newScale) / transform.scale
      const newY = mouseY - ((mouseY - transform.y) * newScale) / transform.scale

      setTransform({ x: newX, y: newY, scale: newScale })
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true)
      setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y })
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      setTooltipPos({
        x: e.clientX - rect.left + 15,
        y: e.clientY - rect.top + 15,
      })
    }

    if (isDragging) {
      setTransform({
        ...transform,
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      })
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleMouseLeave = () => {
    setIsDragging(false)
    setHoveredNode(null)
  }

  const zoomIn = () => {
    setTransform((prev) => ({
      ...prev,
      scale: Math.min(3, prev.scale * 1.2),
    }))
  }

  const zoomOut = () => {
    setTransform((prev) => ({
      ...prev,
      scale: Math.max(0.1, prev.scale / 1.2),
    }))
  }

  const resetView = () => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth
      const containerHeight = containerRef.current.clientHeight
      const scaleX = containerWidth / bounds.width
      const scaleY = containerHeight / bounds.height
      const initialScale = Math.min(scaleX, scaleY, 1) * 0.9
      const centerX = (containerWidth - bounds.width * initialScale) / 2
      const centerY = (containerHeight - bounds.height * initialScale) / 2
      setTransform({ x: centerX, y: centerY, scale: initialScale })
    }
  }

  const getEdgePath = (from: Node, to: Node) => {
    const fromX = from.x + NODE_WIDTH
    const fromY = from.y + NODE_HEIGHT / 2
    const toX = to.x
    const toY = to.y + NODE_HEIGHT / 2
    const midX = (fromX + toX) / 2

    return `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`
  }

  const getStatusText = (status: ResourceStatus) => {
    switch (status) {
      case ResourceStatus.Healthy:
        return "Healthy"
      case ResourceStatus.Unhealthy:
        return "Unhealthy"
      case ResourceStatus.Building:
        return "Building"
      case ResourceStatus.Pending:
        return "Pending"
      case ResourceStatus.Warning:
        return "Warning"
      case ResourceStatus.Disabled:
        return "Disabled"
      default:
        return "Unknown"
    }
  }

  return (
    <DAGContainer
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      <SVGWrapper>
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="rgba(255,255,255,0.3)" />
          </marker>
        </defs>

        <g
          transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}
        >
          {edges.map((edge, i) => {
            const fromNode = nodeMap.get(edge.from)
            const toNode = nodeMap.get(edge.to)
            if (!fromNode || !toNode) return null

            return (
              <EdgePath
                key={`edge-${i}`}
                d={getEdgePath(fromNode, toNode)}
              />
            )
          })}

          {nodesWithStatus.map((node) => (
            <NodeGroup
              key={node.id}
              $status={node.status}
              transform={`translate(${node.x}, ${node.y})`}
              onMouseEnter={() => setHoveredNode(node)}
              onMouseLeave={() => setHoveredNode(null)}
            >
              <rect width={NODE_WIDTH} height={NODE_HEIGHT} />
              <text
                x={NODE_WIDTH / 2}
                y={NODE_HEIGHT / 2 - 5}
                textAnchor="middle"
                dominantBaseline="middle"
                fontWeight="600"
              >
                {node.id.length > 20 ? node.id.substring(0, 17) + "..." : node.id}
              </text>
              <text
                x={NODE_WIDTH / 2}
                y={NODE_HEIGHT / 2 + 15}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="10"
                opacity="0.8"
              >
                {getStatusText(node.status)}
              </text>
            </NodeGroup>
          ))}
        </g>
      </SVGWrapper>

      {hoveredNode && (
        <Tooltip $x={tooltipPos.x} $y={tooltipPos.y}>
          <TooltipTitle>{hoveredNode.id}</TooltipTitle>
          <TooltipRow>
            <TooltipLabel>Status:</TooltipLabel>
            <TooltipValue>
              <StatusBadge $status={hoveredNode.status}>
                {getStatusText(hoveredNode.status)}
              </StatusBadge>
            </TooltipValue>
          </TooltipRow>
          <TooltipRow>
            <TooltipLabel>Type:</TooltipLabel>
            <TooltipValue>
              {hoveredNode.resource.status?.k8sResourceInfo
                ? "Kubernetes"
                : hoveredNode.resource.status?.composeResourceInfo
                ? "Docker Compose"
                : hoveredNode.resource.status?.localResourceInfo
                ? "Local"
                : "Unknown"}
            </TooltipValue>
          </TooltipRow>
          {hoveredNode.resource.status?.runtimeStatus && (
            <TooltipRow>
              <TooltipLabel>Runtime:</TooltipLabel>
              <TooltipValue>
                {hoveredNode.resource.status.runtimeStatus}
              </TooltipValue>
            </TooltipRow>
          )}
          {hoveredNode.resource.status?.updateStatus && (
            <TooltipRow>
              <TooltipLabel>Update:</TooltipLabel>
              <TooltipValue>
                {hoveredNode.resource.status.updateStatus}
              </TooltipValue>
            </TooltipRow>
          )}
          {hoveredNode.resource.status?.composeResourceInfo?.healthStatus && (
            <TooltipRow>
              <TooltipLabel>Health:</TooltipLabel>
              <TooltipValue>
                {hoveredNode.resource.status.composeResourceInfo.healthStatus}
              </TooltipValue>
            </TooltipRow>
          )}
          {(() => {
            const deps = (hoveredNode.resource as UIResourceWithDeps).status?.resourceDependencies
            if (deps && deps.length > 0) {
              return (
                <TooltipRow>
                  <TooltipLabel>Dependencies:</TooltipLabel>
                  <TooltipValue>
                    {deps.join(", ")}
                  </TooltipValue>
                </TooltipRow>
              )
            }
            return null
          })()}
        </Tooltip>
      )}

      <Legend>
        <LegendTitle>Legend</LegendTitle>
        <LegendItem>
          <LegendColor $color="#16a34a" />
          <span>Healthy</span>
        </LegendItem>
        <LegendItem>
          <LegendColor $color="#dc2626" />
          <span>Unhealthy</span>
        </LegendItem>
        <LegendItem>
          <LegendColor $color="#2563eb" />
          <span>Building</span>
        </LegendItem>
        <LegendItem>
          <LegendColor $color="#ca8a04" />
          <span>Pending</span>
        </LegendItem>
        <LegendItem>
          <LegendColor $color="#ea580c" />
          <span>Warning</span>
        </LegendItem>
        <LegendItem>
          <LegendColor $color="#6b7280" />
          <span>Disabled</span>
        </LegendItem>
      </Legend>

      <ZoomLevel>{Math.round(transform.scale * 100)}%</ZoomLevel>

      <ZoomControls>
        <ZoomButton onClick={zoomIn} title="Zoom In">
          +
        </ZoomButton>
        <ZoomButton onClick={zoomOut} title="Zoom Out">
          −
        </ZoomButton>
        <ZoomButton onClick={resetView} title="Reset View">
          ⟲
        </ZoomButton>
      </ZoomControls>
    </DAGContainer>
  )
}
