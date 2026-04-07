<svelte:options runes={true} />

<script>
  import { onMount } from 'svelte';

  import { computeMultiWorkflowLayout, getScreenTitle, offsetLayout } from '../lib/flow.js';
  import FlowArrow from '../lib/FlowArrow.svelte';
  import GroupFrame from '../lib/GroupFrame.svelte';
  import StoryboardNode from '../nodes/StoryboardNode.svelte';

  const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
  const DESKTOP_SCREEN_SCALE = 0.34;
  const MOBILE_SCREEN_SCALE = 0.54;
  const DESKTOP_VARIANT_SCALE = 0.22;
  const MOBILE_VARIANT_SCALE = 0.3;
  const DESKTOP_NODE_SEP = 72;
  const MOBILE_NODE_SEP = 52;
  const DESKTOP_RANK_SEP = 132;
  const MOBILE_RANK_SEP = 88;
  const CANVAS_MARGIN = 48;
  const CLUSTER_GAP = 200;
  const ARROW_MARKER_ID = 'canvas-flow-arrow-head';
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 2;
  const ZOOM_FACTOR = 1.05;
  const TRANSFORM_TRANSITION_MS = 120;
  const NODE_TARGET_SELECTOR = '[data-screen-id]';
  const PAN_THRESHOLD = 5;

  let {
    workflows = [],
    viewport = DEFAULT_VIEWPORT,
    onOpenScreen = () => {},
    onViewportChange = () => {},
    onSelectionChange = () => {},
    clearSelectionRequest = 0,
    focusRequest = null,
    activeWorkflowId = '',
    selectedScreenId = null
  } = $props();

  let viewportWidth = $derived(Number(viewport?.width) > 0 ? Number(viewport.width) : DEFAULT_VIEWPORT.width);
  let isMobile = $derived(viewportWidth <= 480);

  let layout = $derived.by(() => {
    return computeMultiWorkflowLayout(workflows, viewport, {
      screenScale: isMobile ? MOBILE_SCREEN_SCALE : DESKTOP_SCREEN_SCALE,
      variantScale: isMobile ? MOBILE_VARIANT_SCALE : DESKTOP_VARIANT_SCALE,
      includeVariants: true,
      nodeSep: isMobile ? MOBILE_NODE_SEP : DESKTOP_NODE_SEP,
      rankSep: isMobile ? MOBILE_RANK_SEP : DESKTOP_RANK_SEP,
      marginX: CANVAS_MARGIN,
      marginY: CANVAS_MARGIN,
      clusterGap: CLUSTER_GAP
    });
  });

  let containerElement = $state(null);
  let containerWidth = $state(0);
  let containerHeight = $state(0);
  let panX = $state(0);
  let panY = $state(0);
  let zoom = $state(1);
  let animateTransform = $state(false);
  let isPanning = $state(false);
  let spacePressed = $state(false);
  let dragPointerId = $state(null);
  let dragStartX = $state(0);
  let dragStartY = $state(0);
  let dragOriginX = $state(0);
  let dragOriginY = $state(0);
  let pendingPan = $state(false);
  let pendingPointerId = $state(null);
  let pendingStartX = $state(0);
  let pendingStartY = $state(0);
  let pendingTarget = $state(null);
  let lastFocusRequestKey = $state('');
  let lastViewTargetKey = $state('');
  let focusedWorkflowId = $state('');
  let lastClearSelectionRequest = $state(0);

  // Multi-pointer pinch state
  let pointers = new Map();  // pointerId → { clientX, clientY }
  let isPinching = false;
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let pinchStartPanX = 0;
  let pinchStartPanY = 0;
  let selectedNodeIds = $state(new Set());

  let transitionResetTimer = null;

  let canvasStyle = $derived(
    `width:${Math.max(layout.width, 0)}px;height:${Math.max(layout.height, 0)}px;transform:translate(${panX}px, ${panY}px) scale(${zoom});transform-origin:0 0;will-change:transform;transition:${animateTransform ? 'transform 0.1s ease-out' : 'none'};`
  );
  let lod = $derived(zoom < 0.15 ? 'minimal' : zoom < 0.5 ? 'card' : 'full');
  let zoomLabel = $derived(`${Math.round(zoom * 100)}%`);
  let selectableNodes = $derived.by(() => {
    const lookup = new Map();

    for (const cluster of layout.clusters) {
      const workflowId = cluster.workflow?.id ?? '';

      if (!workflowId) {
        continue;
      }

      for (const node of cluster.layout.nodes) {
        if (!node?.id) {
          continue;
        }

        lookup.set(`${workflowId}/${node.id}`, {
          workflowId,
          screenId: node.id,
          title: getScreenTitle(node.screen)
        });
      }
    }

    return lookup;
  });

  onMount(() => {
    emitSelectionChange(selectedNodeIds);

    const handleWindowKeydown = (event) => {
      if (event.key === 'Escape') {
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleWindowKeydown);

    // Register pointer handlers with { passive: false } so preventDefault()
    // works on mobile. Svelte's inline on* handlers may register as passive
    // on touch devices, causing the browser to intercept the gesture.
    const el = containerElement;
    if (el) {
      el.addEventListener('pointerdown', handlePointerDown, { passive: false });
      el.addEventListener('pointermove', handlePointerMove, { passive: false });
      el.addEventListener('pointerup', stopPanning, { passive: false });
      el.addEventListener('pointercancel', stopPanning, { passive: false });
      el.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      window.removeEventListener('keydown', handleWindowKeydown);

      if (el) {
        el.removeEventListener('pointerdown', handlePointerDown);
        el.removeEventListener('pointermove', handlePointerMove);
        el.removeEventListener('pointerup', stopPanning);
        el.removeEventListener('pointercancel', stopPanning);
        el.removeEventListener('wheel', handleWheel);
      }

      if (transitionResetTimer !== null) {
        window.clearTimeout(transitionResetTimer);
      }

      if (typeof onSelectionChange === 'function') {
        onSelectionChange([]);
      }
    };
  });

  $effect(() => {
    if (typeof onViewportChange === 'function') {
      onViewportChange(zoom, panX, panY);
    }
  });

  $effect(() => {
    if (layout.width <= 0 || layout.height <= 0 || containerWidth <= 0 || containerHeight <= 0) {
      return;
    }

    const requestType = focusRequest?.type === 'overview' ? 'overview' : 'workflow';
    const requestedWorkflowId = requestType === 'workflow' && typeof focusRequest?.workflowId === 'string'
      ? focusRequest.workflowId
      : '';
    const requestedRevision = focusRequest?.revision ?? '';
    const requestKey = requestedRevision !== ''
      ? `${requestType}:${requestedWorkflowId}:${requestedRevision}`
      : '';

    if (requestKey && requestKey !== lastFocusRequestKey) {
      if (requestType === 'overview') {
        focusedWorkflowId = '';
        fitCanvas({ animate: true });
      } else {
        focusedWorkflowId = requestedWorkflowId;
        focusWorkflowById(requestedWorkflowId, { animate: true });
      }
      lastFocusRequestKey = requestKey;
      lastViewTargetKey = `${focusedWorkflowId || 'overview'}:${layout.width}:${layout.height}:${containerWidth}:${containerHeight}`;
      return;
    }

    const viewTargetKey = `${focusedWorkflowId || 'overview'}:${layout.width}:${layout.height}:${containerWidth}:${containerHeight}`;

    if (viewTargetKey === lastViewTargetKey) {
      return;
    }

    if (focusedWorkflowId) {
      focusWorkflowById(focusedWorkflowId, { animate: false });
    } else {
      fitCanvas({ animate: false });
    }

    lastViewTargetKey = viewTargetKey;
  });

  $effect(() => {
    if (clearSelectionRequest === lastClearSelectionRequest) {
      return;
    }

    lastClearSelectionRequest = clearSelectionRequest;
    clearSelection();
  });

  $effect(() => {
    if (selectedNodeIds.size === 0) {
      return;
    }

    const nextSelectedNodeIds = new Set(
      [...selectedNodeIds].filter((selectionKey) => selectableNodes.has(selectionKey))
    );

    if (setsEqual(selectedNodeIds, nextSelectedNodeIds)) {
      return;
    }

    setSelectedNodeIds(nextSelectedNodeIds);
  });

  function setsEqual(left, right) {
    if (left === right) {
      return true;
    }

    if (left.size !== right.size) {
      return false;
    }

    for (const value of left) {
      if (!right.has(value)) {
        return false;
      }
    }

    return true;
  }

  function emitSelectionChange(nextSelectedNodeIds = selectedNodeIds) {
    if (typeof onSelectionChange !== 'function') {
      return;
    }

    onSelectionChange(
      [...nextSelectedNodeIds].flatMap((selectionKey) => {
        const selectedNode = selectableNodes.get(selectionKey);
        return selectedNode ? [selectedNode] : [];
      })
    );
  }

  function setSelectedNodeIds(nextSelectedNodeIds) {
    if (setsEqual(selectedNodeIds, nextSelectedNodeIds)) {
      return;
    }

    selectedNodeIds = nextSelectedNodeIds;
    emitSelectionChange(nextSelectedNodeIds);
  }

  function toggleSelection(compositeId) {
    if (!compositeId) {
      return;
    }

    const nextSelectedNodeIds = new Set(selectedNodeIds);

    if (nextSelectedNodeIds.has(compositeId)) {
      nextSelectedNodeIds.delete(compositeId);
    } else {
      nextSelectedNodeIds.add(compositeId);
    }

    setSelectedNodeIds(nextSelectedNodeIds);
  }

  function clearSelection() {
    if (selectedNodeIds.size === 0) {
      return;
    }

    setSelectedNodeIds(new Set());
  }

  function isNodeSelected(workflowId, nodeId) {
    if (selectedNodeIds.size > 0) {
      return selectedNodeIds.has(`${workflowId}/${nodeId}`);
    }

    return activeWorkflowId === workflowId && selectedScreenId === nodeId;
  }

  function handleNodeSelect(workflowId, nodeId) {
    if (!workflowId || !nodeId) {
      return;
    }

    toggleSelection(`${workflowId}/${nodeId}`);
  }

  function clampScale(value) {
    const normalizedValue = Number.isFinite(value) ? value : 1;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, normalizedValue));
  }

  function disableTransformAnimation() {
    animateTransform = false;

    if (transitionResetTimer !== null) {
      window.clearTimeout(transitionResetTimer);
      transitionResetTimer = null;
    }
  }

  function enableTransformAnimation() {
    animateTransform = true;

    if (transitionResetTimer !== null) {
      window.clearTimeout(transitionResetTimer);
    }

    transitionResetTimer = window.setTimeout(() => {
      animateTransform = false;
      transitionResetTimer = null;
    }, TRANSFORM_TRANSITION_MS);
  }

  function setTransformAnimation(animate) {
    if (animate) {
      enableTransformAnimation();
    } else {
      disableTransformAnimation();
    }
  }

  function resolveFitScale(bounds) {
    const width = Math.max(bounds?.width ?? 0, 1);
    const height = Math.max(bounds?.height ?? 0, 1);
    const scaleX = containerWidth / width;
    const scaleY = containerHeight / height;

    return clampScale(Math.min(scaleX, scaleY, 1) * 0.9);
  }

  function applyView(bounds, scale, { animate = true } = {}) {
    const safeBounds = bounds ?? { x: 0, y: 0, width: layout.width, height: layout.height };
    const nextScale = clampScale(scale);

    setTransformAnimation(animate);
    zoom = nextScale;
    panX = ((containerWidth - (safeBounds.width * nextScale)) / 2) - (safeBounds.x * nextScale);
    panY = ((containerHeight - (safeBounds.height * nextScale)) / 2) - (safeBounds.y * nextScale);
  }

  function fitCanvas({ animate = true } = {}) {
    applyView(
      { x: 0, y: 0, width: Math.max(layout.width, 1), height: Math.max(layout.height, 1) },
      resolveFitScale({ width: layout.width, height: layout.height }),
      { animate }
    );
  }

  function focusWorkflowById(workflowId, { animate = true } = {}) {
    const cluster = layout.clusters.find((entry) => entry.workflow?.id === workflowId);

    if (!cluster) {
      fitCanvas({ animate });
      return;
    }

    applyView(cluster.frameBounds, resolveFitScale(cluster.frameBounds), { animate });
  }

  function zoomAroundPoint(localX, localY, nextScale, { animate = false } = {}) {
    const currentScale = Math.max(zoom, MIN_ZOOM);
    const targetScale = clampScale(nextScale);
    const worldX = (localX - panX) / currentScale;
    const worldY = (localY - panY) / currentScale;

    setTransformAnimation(animate);
    zoom = targetScale;
    panX = localX - (worldX * targetScale);
    panY = localY - (worldY * targetScale);
  }

  function zoomAtCenter(multiplier, { animate = true } = {}) {
    if (containerWidth <= 0 || containerHeight <= 0) {
      return;
    }

    zoomAroundPoint(containerWidth / 2, containerHeight / 2, zoom * multiplier, { animate });
  }

  function getLocalPoint(event) {
    const rect = containerElement?.getBoundingClientRect();

    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0)
    };
  }

  function getPointerDist() {
    const pts = [...pointers.values()];
    if (pts.length < 2) return 0;
    const dx = pts[0].clientX - pts[1].clientX;
    const dy = pts[0].clientY - pts[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function getPointerCenter() {
    const pts = [...pointers.values()];
    if (pts.length < 2) return { clientX: 0, clientY: 0 };
    return {
      clientX: (pts[0].clientX + pts[1].clientX) / 2,
      clientY: (pts[0].clientY + pts[1].clientY) / 2
    };
  }

  function startPinch() {
    isPinching = true;
    pinchStartDist = getPointerDist();
    pinchStartZoom = zoom;
    pinchStartPanX = panX;
    pinchStartPanY = panY;
    disableTransformAnimation();

    if (isPanning) {
      resetPanning();
    }
  }

  function updatePinch() {
    if (!isPinching || pinchStartDist === 0) return;

    const currentDist = getPointerDist();
    const scale = currentDist / pinchStartDist;
    const newZoom = clampScale(pinchStartZoom * scale);

    const center = getPointerCenter();
    const rect = containerElement?.getBoundingClientRect();
    if (!rect) return;

    const cx = center.clientX - rect.left;
    const cy = center.clientY - rect.top;
    const zoomRatio = newZoom / pinchStartZoom;

    panX = cx - (cx - pinchStartPanX) * zoomRatio;
    panY = cy - (cy - pinchStartPanY) * zoomRatio;
    zoom = newZoom;
  }

  function endPinch() {
    isPinching = false;
    pinchStartDist = 0;

    // Release captures
    for (const pid of pointers.keys()) {
      if (containerElement?.hasPointerCapture?.(pid)) {
        containerElement.releasePointerCapture(pid);
      }
    }
  }

  function handleWheel(event) {
    if (layout.width <= 0 || layout.height <= 0) {
      return;
    }

    event.preventDefault();
    containerElement?.focus();

    const isPinchGesture = event.ctrlKey;
    const direction = event.deltaY < 0 ? 1 : -1;
    const steps = isPinchGesture ? Math.max(1, Math.abs(event.deltaY) / 8) : 1;
    const factor = Math.pow(ZOOM_FACTOR, direction * steps);
    const { x, y } = getLocalPoint(event);

    zoomAroundPoint(x, y, zoom * factor, { animate: false });
  }

  function isBackgroundTarget(target) {
    if (!(target instanceof Element)) {
      return true;
    }

    if (target.closest('[data-canvas-controls]')) {
      return false;
    }

    return !target.closest(NODE_TARGET_SELECTOR);
  }

  function isNodeTarget(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    if (target.closest('[data-canvas-controls]')) {
      return false;
    }

    return Boolean(target.closest(NODE_TARGET_SELECTOR));
  }

  function canStartPanning(event) {
    if (event.button === 1) {
      return true;
    }

    if (spacePressed) {
      return true;
    }

    if (event.button !== 0) {
      return false;
    }

    return isBackgroundTarget(event.target);
  }

  function handlePointerDown(event) {
    // Always prevent default for touch to stop browser gesture interference
    if (event.pointerType === 'touch') {
      event.preventDefault();
    }

    // A new primary touch means a fresh gesture — clear stale pointers
    // left over from a previous gesture whose pointerup was missed.
    if (event.pointerType === 'touch' && event.isPrimary && pointers.size > 0) {
      pointers.clear();
      if (isPinching) endPinch();
      if (isPanning || pendingPan) resetPanning();
    }

    // Track all pointers for pinch detection
    pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });

    if (pointers.size === 2) {
      pendingPan = false;
      pendingPointerId = null;
      pendingTarget = null;

      // Two fingers down → start pinch, cancel any pan
      // Capture both pointers so move events fire reliably
      for (const pid of pointers.keys()) {
        containerElement?.setPointerCapture?.(pid);
      }
      startPinch();
      return;
    }

    if (pointers.size > 2 || isPinching) {
      return;
    }

    if (dragPointerId !== null || pendingPointerId !== null) {
      return;
    }

    if (canStartPanning(event)) {
      containerElement?.focus();
      disableTransformAnimation();
      event.preventDefault();

      isPanning = true;
      dragPointerId = event.pointerId;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      dragOriginX = panX;
      dragOriginY = panY;

      containerElement?.setPointerCapture?.(event.pointerId);
      return;
    }

    if (event.button !== 0 || !isNodeTarget(event.target)) {
      return;
    }

    containerElement?.focus();
    pendingPan = true;
    pendingPointerId = event.pointerId;
    pendingStartX = event.clientX;
    pendingStartY = event.clientY;
    pendingTarget = event.target;
    dragOriginX = panX;
    dragOriginY = panY;

    containerElement?.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    // Update tracked pointer position
    if (pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    }

    if (isPinching && pointers.size >= 2) {
      event.preventDefault();
      updatePinch();
      return;
    }

    if (pendingPan && event.pointerId === pendingPointerId) {
      const distance = Math.hypot(event.clientX - pendingStartX, event.clientY - pendingStartY);

      if (distance <= PAN_THRESHOLD) {
        return;
      }

      disableTransformAnimation();
      isPanning = true;
      pendingPan = false;
      pendingPointerId = null;
      pendingTarget = null;
      dragPointerId = event.pointerId;
      dragStartX = pendingStartX;
      dragStartY = pendingStartY;

      event.preventDefault();
      panX = dragOriginX + (event.clientX - dragStartX);
      panY = dragOriginY + (event.clientY - dragStartY);
      return;
    }

    if (!isPanning || event.pointerId !== dragPointerId) {
      return;
    }

    event.preventDefault();
    panX = dragOriginX + (event.clientX - dragStartX);
    panY = dragOriginY + (event.clientY - dragStartY);
  }

  function resetPanning() {
    isPanning = false;
    pendingPan = false;
    pendingPointerId = null;
    pendingTarget = null;
    dragPointerId = null;
  }

  function stopPanning(event) {
    pointers.delete(event.pointerId);

    if (pendingPan && event.pointerId === pendingPointerId) {
      pendingPan = false;
      pendingPointerId = null;
      pendingTarget = null;

      if (event.currentTarget?.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      return;
    }

    if (isPinching) {
      if (pointers.size < 2) {
        endPinch();
      }
      return;
    }
    if (event.pointerId !== dragPointerId) {
      return;
    }

    if (event.currentTarget?.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    resetPanning();
  }

  function handleLostPointerCapture(event) {
    pointers.delete(event.pointerId);

    if (event.pointerId === pendingPointerId) {
      pendingPan = false;
      pendingPointerId = null;
      pendingTarget = null;
    }

    if (event.pointerId === dragPointerId) {
      resetPanning();
    }

    if (isPinching && pointers.size < 2) {
      endPinch();
    }
  }

  function handleKeyDown(event) {
    if (event.code === 'Space') {
      spacePressed = true;
      event.preventDefault();
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomAtCenter(ZOOM_FACTOR, { animate: true });
      return;
    }

    if (event.key === '-') {
      event.preventDefault();
      zoomAtCenter(1 / ZOOM_FACTOR, { animate: true });
      return;
    }

    if (event.key === '0') {
      event.preventDefault();
      fitCanvas({ animate: true });
    }
  }

  function handleKeyUp(event) {
    if (event.code === 'Space') {
      spacePressed = false;
    }
  }

  function handleBlur() {
    spacePressed = false;

    // Release all pointer captures and clear tracking
    for (const pid of pointers.keys()) {
      if (containerElement?.hasPointerCapture?.(pid)) {
        containerElement.releasePointerCapture(pid);
      }
    }
    pointers.clear();

    if (isPinching) {
      isPinching = false;
      pinchStartDist = 0;
    }

    resetPanning();
  }
</script>

<div class="relative h-full w-full overflow-hidden bg-muted/25">
  <div class="pointer-events-none absolute inset-0 opacity-60 bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] [background-size:24px_24px]"></div>

  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={containerElement}
    bind:clientWidth={containerWidth}
    bind:clientHeight={containerHeight}
    class={`relative h-full w-full overflow-hidden touch-none outline-none ${isPanning ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
    role="application"
    tabindex="0"
    aria-label="Workflow canvas"
    aria-roledescription="pan and zoom canvas"
    onlostpointercapture={handleLostPointerCapture}
    onkeydown={handleKeyDown}
    onkeyup={handleKeyUp}
    onblur={handleBlur}
  >
    <div class="absolute left-0 top-0" style={canvasStyle}>
      {#each layout.clusters as cluster (cluster.workflow?.id ?? cluster.frameBounds.x)}
        {@const clusterLayout = offsetLayout(cluster.layout, cluster.offsetX, cluster.offsetY)}
        {@const isActiveWorkflow = activeWorkflowId === cluster.workflow?.id}

        <div
          class={`pointer-events-none absolute z-[3] inline-flex items-center gap-2 rounded-md border border-border bg-background/95 px-3 py-1 text-sm font-semibold shadow-sm backdrop-blur-sm ${isActiveWorkflow ? 'text-foreground' : 'text-muted-foreground'}`}
          style={`left:${cluster.frameBounds.x}px;top:${Math.max(cluster.frameBounds.y, 0)}px;`}
          data-workflow-id={cluster.workflow?.id ?? undefined}
        >
          <span class="truncate">{cluster.workflow?.title ?? cluster.workflow?.id ?? 'Workflow'}</span>
          <span class="text-xs font-medium text-muted-foreground/70">{cluster.screenCount} screens</span>
        </div>

        {#each clusterLayout.groups as group (group.id)}
          <GroupFrame {group} />
        {/each}

        {#if clusterLayout.nodes.length === 0}
          <div
            class="pointer-events-none absolute flex items-center justify-center rounded-xl border border-dashed border-border bg-background/80 px-4 text-center text-xs text-muted-foreground shadow-sm"
            style={`left:${cluster.frameBounds.x + 24}px;top:${cluster.frameBounds.y + 56}px;width:${Math.max(cluster.frameBounds.width - 48, 120)}px;height:${Math.max(cluster.frameBounds.height - 80, 72)}px;`}
          >
            This workflow has no screens yet.
          </div>
        {/if}

        {#each clusterLayout.nodes as node (node.id)}
          <div
            class="absolute z-[2]"
            style={`left:${node.left}px;top:${node.top}px;width:${node.width}px;`}
          >
            <StoryboardNode
              {node}
              {viewport}
              {lod}
              selected={isNodeSelected(cluster.workflow?.id ?? '', node.id)}
              screenScale={cluster.layout.screenScale}
              variantScale={cluster.layout.variantScale}
              workflowId={cluster.workflow?.id ?? ''}
              onOpen={onOpenScreen}
              onSelect={(nodeId) => handleNodeSelect(cluster.workflow?.id ?? '', nodeId)}
            />
          </div>
        {/each}
      {/each}

      <svg
        class="pointer-events-none absolute inset-0 z-[1] overflow-visible"
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        aria-hidden="true"
      >
        <defs>
          <marker
            id={ARROW_MARKER_ID}
            viewBox="0 0 12 12"
            refX="10"
            refY="6"
            markerWidth="10"
            markerHeight="10"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 12 6 L 0 12 z" fill="var(--color-border)" />
          </marker>
        </defs>

        {#each layout.clusters as cluster (cluster.workflow?.id ?? `${cluster.frameBounds.x}-edges`)}
          {@const clusterLayout = offsetLayout(cluster.layout, cluster.offsetX, cluster.offsetY)}
          {#each clusterLayout.treeEdges as edge (edge.id)}
            <FlowArrow
              fromRect={edge.fromRect}
              toRect={edge.toRect}
              label={edge.label}
              fromId={edge.from}
              toId={edge.to}
              markerId={ARROW_MARKER_ID}
            />
          {/each}
        {/each}
      </svg>
    </div>

    <div
      data-canvas-controls
      class="absolute bottom-4 right-4 z-10 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur-sm"
    >
      <button
        type="button"
        class="inline-flex size-7 items-center justify-center rounded-md text-sm font-semibold text-muted-foreground transition-colors duration-200 hover:bg-accent/50 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        title="Zoom out (-)"
        aria-label="Zoom out"
        onclick={() => zoomAtCenter(1 / ZOOM_FACTOR, { animate: true })}
      >
        −
      </button>

      <div class="min-w-12 px-1 text-center text-[11px] font-semibold text-muted-foreground">
        {zoomLabel}
      </div>

      <button
        type="button"
        class="inline-flex size-7 items-center justify-center rounded-md text-sm font-semibold text-muted-foreground transition-colors duration-200 hover:bg-accent/50 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        title="Zoom in (+)"
        aria-label="Zoom in"
        onclick={() => zoomAtCenter(ZOOM_FACTOR, { animate: true })}
      >
        +
      </button>

      <button
        type="button"
        class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-accent/50 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        title="Fit to content (0)"
        aria-label="Fit to content"
        onclick={() => fitCanvas({ animate: true })}
      >
        <span class="sr-only">Fit to content</span>
        <svg class="size-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2.5 6V2.5H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M10 2.5H13.5V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M13.5 10V13.5H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M6 13.5H2.5V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
  </div>
</div>
