import {
    CSSProperties,
    KeyboardEvent as ReactKeyboardEvent,
    MouseEvent as ReactMouseEvent,
    PointerEvent as ReactPointerEvent,
    ReactElement,
    TransitionEvent as ReactTransitionEvent,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState
} from "react";
import { createPortal, flushSync } from "react-dom";
import ReactDraggable, { DraggableBounds, DraggableData, DraggableEvent } from "react-draggable";
import classNames from "classnames";
import { Big } from "big.js";
import { ActionValue, EditableValue } from "mendix";

import { MxTechiesDraggableContainerProps } from "../typings/MxTechiesDraggableProps";
import {
    Limits,
    NO_LIMITS,
    Position,
    Rect,
    clampToLimits,
    limitsFromBox,
    limitsFromOffsets,
    offsetRect,
    pickZone,
    relativeTo,
    resolveTargetId
} from "./utils/geometry";
import { Guide, computeSnap } from "./utils/snapping";
import { SpacingHint, computeSpacing } from "./utils/spacing";
import { Sample, projectThrow, pushSample, springCurve, tiltFor, velocityFromSamples } from "./utils/motion";
import { isGrabKey, keyboardDelta, keyboardMove } from "./utils/keyboard";
import { loadNumber, loadPosition, loadSize, saveNumber, savePosition, saveSize } from "./utils/persistence";
import {
    CollisionMode,
    ResizeEdge,
    Size,
    edgeScrollSpeed,
    keyboardResize,
    resizeTo,
    resolveCollision,
    sizeLimits,
    zoneAccepts
} from "./utils/layout";
import {
    ZONE_ARMED,
    ZONE_OVER,
    contentBox,
    findSiblings,
    findZones,
    flashZone,
    layoutRect,
    pointerOf,
    prefersReducedMotion,
    readVisualTranslate,
    spawnRipple,
    timeOf,
    toRect
} from "./utils/dom";
import {
    FollowStart,
    Handle,
    HistoryChange,
    applyHistoryEntry,
    getHandle,
    historyLength,
    members,
    nextInstanceId,
    popHistoryEntry,
    pushHistoryEntry,
    register,
    selectionOf,
    setSelection
} from "./utils/registry";
import { clickSelection, groupDeltaLimits, pressSelection } from "./utils/selection";
import { SortAxis, keyboardSortIndex } from "./utils/sortable";
import {
    SortResult,
    SortSession,
    SortTarget,
    candidateContainers,
    containerOf,
    hold,
    logicalOrder,
    membersOf,
    pruneHeld,
    writeOrders
} from "./utils/sortController";
import { ZOperation, applyZOrder, keyboardRotation, normaliseAngle, rotateBy, zShortcut } from "./utils/rotation";
import {
    ItemState,
    LayoutCommand,
    changedFields,
    nextSnapshotName,
    parseCommand,
    snapshotNames
} from "./utils/snapshots";
import {
    applyLayout,
    deleteSnapshot,
    readStore,
    restoreSnapshot,
    saveSnapshot,
    snapshotMembers
} from "./utils/layoutStore";
import { attachLasso } from "./utils/lasso";
import { LongPressGate, haptic } from "./utils/longPress";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ContextMenu, MenuItem } from "./components/ContextMenu";

import "./ui/MxTechiesDraggable.css";
import { ListLift, liftListItem, liftZIndex, listItemOf } from "./utils/listItem";

/** Appended to repeat an identical live announcement. */
const NBSP = String.fromCharCode(160);
/** Return and settle animation: a soft spring with a little overshoot. */
const SETTLE_SPRING = springCurve({ stiffness: 170, damping: 19 });
/** Quick, stiff spring used to glide between grid steps and keyboard steps. */
const GLIDE_SPRING = springCurve({ stiffness: 420, damping: 32 });
/** Arrow key moves outside a pick-up are reported to On drag stop after this pause. */
const KEYBOARD_STOP_DELAY_MS = 450;
/** Tilt fades back to upright when the pointer rests this long. */
const TILT_REST_MS = 120;
/** A press shorter than this is a click, not a drag, so it never counts as a drop. */
const MIN_MOVE_PX = 3;
/** Zones that do not accept the dragged item's type (2.1). */
const ZONE_REJECTED = "mxt-drop-zone--rejected";
/** A rejected zone the item is over right now (2.2, Drop preview). */
const ZONE_INVALID = "mxt-drop-zone--invalid";
/** Undo steps kept for a single item (2.1) and for a group (2.2). */
const HISTORY_CAP = 20;
const GROUP_HISTORY_CAP = 50;
/** FLIP animation after the list re-rendered in the new order. */
const FLIP_MS = 220;
/** Search radius of the live collision preview (smaller than the drop itself, it runs on every move). */
const PREVIEW_RINGS = 16;

/** Replaces [name] placeholders in a translatable text. */
function fill(template: string, values: Record<string, string | number>): string {
    return template.replace(/\[(\w+)\]/g, (whole, key: string) =>
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole
    );
}

/** The text of a text template, or the English default while it loads or when it is empty. */
function textOf(value: { value?: string } | undefined, fallback: string): string {
    return value?.value ? value.value : fallback;
}

/** A zone accept list: the data-accept attribute, or classes such as "accept-task accept-bug" (easy to set in Studio Pro). */
function acceptListOf(zone: HTMLElement): string | null {
    const attribute = zone.getAttribute("data-accept");
    if (attribute !== null) {
        return attribute;
    }
    const fromClasses = Array.from(zone.classList)
        .filter(name => name.startsWith("accept-") && name.length > 7)
        .map(name => name.slice(7));
    return fromClasses.length ? fromClasses.join(" ") : null;
}

/** The nearest ancestor that scrolls, or undefined when the page itself scrolls. */
function scrollParent(node: HTMLElement): HTMLElement | undefined {
    for (let el = node.parentElement; el && el !== node.ownerDocument.body; el = el.parentElement) {
        const style = getComputedStyle(el);
        if (
            /(auto|scroll)/.test(style.overflowY + style.overflowX) &&
            (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)
        ) {
            return el;
        }
    }
    return undefined;
}

interface Settle {
    duration: number;
    easing: string;
}

interface GroupDrag {
    followers: Handle[];
    starts: FollowStart[];
    range: Limits;
}

/** Everything measured once at the start of a pointer drag. */
interface DragSession {
    start: Position;
    /** Zones armed but not accepting this item's type (2.1). */
    rejected: HTMLElement[];
    /** Rects of the other draggables, for collision avoidance (2.1). */
    obstacles: Rect[];
    /** Element to auto-scroll, or undefined for the window (2.1). */
    scroller?: HTMLElement;
    rect: Rect;
    limits: Limits;
    zones: HTMLElement[];
    snapTargets: Rect[];
    /** Sibling rects only (no container box), for equal spacing (2.2). */
    spacingTargets: Rect[];
    samples: Sample[];
    over: HTMLElement | null;
    /** Rejected zone under the pointer (2.2, Drop preview). */
    invalid: HTMLElement | null;
    raw: Position;
    snap: Position;
    pointer?: Position;
    moved: boolean;
    motion: boolean;
    /** Selected items moving along (2.2). */
    group?: GroupDrag;
    /** Sortable session (2.2). */
    sort?: SortSession;
    landing?: Rect;
    ghostKey?: string;
}

/** State of a keyboard pick-up (Enter or Space). */
interface KeyboardSession {
    origin: Position;
    zones: HTMLElement[];
    rejected: HTMLElement[];
    over: HTMLElement | null;
    invalid: HTMLElement | null;
    sort?: SortSession;
}

interface Timers {
    scroll?: number;
    settle?: number;
    tilt?: number;
    keyboardStop?: number;
    command?: number;
}

interface Ghost {
    rect: Rect;
    kind: "valid" | "invalid" | "placeholder";
}

/** Methods of a registry handle, rebuilt every render. */
type HandleApi = Omit<Handle, "id" | "node">;

interface LatestApi {
    snapshotCommand: (command: LayoutCommand) => void;
    moveSortTo: (target: SortTarget) => void;
    handle: HandleApi;
}

interface Notice {
    message: string;
    retry?: () => void;
}

/** Reads a numeric attribute, or undefined when it is absent, still loading or empty. */
function readAttribute(attribute: EditableValue<Big> | undefined): number | undefined {
    const value = attribute?.value;
    return value ? value.toNumber() : undefined;
}

/** A configured attribute that cannot be written: a change to it would be lost (2.2 reports it). */
function blocked(attribute: { readOnly: boolean } | undefined): boolean {
    return attribute !== undefined && attribute.readOnly;
}

/** Writes a rounded pixel offset back to an attribute when it is present and writable. */
function writeOffset(attribute: EditableValue<Big> | undefined, offset: number): void {
    if (attribute && !attribute.readOnly) {
        attribute.setValue(new Big(Math.round(offset)));
    }
}

function canRun(action: Pick<ActionValue, "canExecute" | "isExecuting"> | undefined): boolean {
    return action?.canExecute === true && !action.isExecuting;
}

function run(action: ActionValue | undefined): void {
    if (action && canRun(action)) {
        action.execute();
    }
}

function writeSize(attribute: EditableValue<Big> | undefined, value: number): void {
    if (attribute && !attribute.readOnly) {
        attribute.setValue(new Big(Math.round(value)));
    }
}

function setRejected(zones: readonly HTMLElement[], on: boolean): void {
    zones.forEach(zone => zone.classList.toggle(ZONE_REJECTED, on));
}

function setZoneClasses(zones: readonly HTMLElement[], armed: boolean, over: HTMLElement | null): void {
    zones.forEach(zone => {
        zone.classList.toggle(ZONE_ARMED, armed);
        zone.classList.toggle(ZONE_OVER, armed && zone === over);
    });
}

function hitZone(zones: readonly HTMLElement[], point: Position): HTMLElement | null {
    const index = pickZone(
        point,
        zones.map(zone => toRect(zone.getBoundingClientRect()))
    );
    return index >= 0 ? zones[index] : null;
}

function centreOf(rect: Rect): Position {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function same(a: Position, b: Position): boolean {
    return a.x === b.x && a.y === b.y;
}

function has<T extends object>(value: T, key: keyof T): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

/** Widget entry: the draggable inside an error boundary (2.2). */
export function MxTechiesDraggable(props: MxTechiesDraggableContainerProps): ReactElement {
    return (
        <ErrorBoundary
            message={textOf(props.errorText, "This item could not be shown.")}
            retryLabel={textOf(props.tryAgainText, "Try again")}
        >
            <DraggableItem {...props} />
        </ErrorBoundary>
    );
}

function DraggableItem(props: MxTechiesDraggableContainerProps): ReactElement {
    const {
        axis,
        handle,
        cancel,
        disabled,
        bounds,
        boundsSelector,
        boundsLeft,
        boundsTop,
        boundsRight,
        boundsBottom,
        gridX,
        gridY,
        xAttribute,
        yAttribute,
        defaultX,
        defaultY,
        persistKey,
        display,
        showPosition,
        liftWhileDragging,
        raiseListRows,
        animate,
        momentum,
        dropTargetSelector,
        dropIdClassPrefix,
        returnIfNotDropped,
        snapToSiblings,
        snapThreshold,
        keyboardEnabled,
        keyboardStep,
        keyboardInstructions,
        onDragStart,
        onDragStop,
        onDrop,
        onPositionChange,
        onResize,
        resizable,
        widthAttribute,
        heightAttribute,
        keepAspectRatio,
        collision,
        autoScroll,
        undoEnabled,
        resetEnabled,
        dragType,
        motion: motionMode,
        content,
        class: className,
        style,
        tabIndex
    } = props;
    // 2.2 options. Read defensively: pages saved with 2.1 do not pass them until Studio Pro updates the widget.
    const touchDelay = Math.max(0, props.touchDelay ?? 0);
    const hapticFeedback = props.hapticFeedback !== false;
    const rotatable = props.rotatable === true;
    const rotationAttribute = props.rotationAttribute;
    const rotationStep = Math.max(1, props.rotationStep ?? 15);
    const zOrderOn = props.zOrder === true;
    const zIndexAttribute = props.zIndexAttribute;
    const dropPreview = props.dropPreview === true;
    const equalSpacing = props.equalSpacing === true;
    const contextMenuOn = props.contextMenu === true;
    const multiSelect = props.multiSelect === true;
    const lassoOn = props.lasso === true;
    const groupNameValue = props.groupName?.trim() || "default";
    const selectedAttribute = props.selectedAttribute;
    const sortAxis: SortAxis | undefined =
        props.sortMode && props.sortMode !== "off" ? (props.sortMode as SortAxis) : undefined;
    const sortSelector = props.sortContainerSelector ?? "";
    const sortCross = props.sortCrossContainer === true;
    const orderAttribute = props.orderAttribute;
    const orderOffset = props.orderOffset ?? 0;
    const sortTimeout = Math.max(0, props.sortTimeout ?? 6000);
    const snapshotsEnabled = props.snapshotsEnabled === true;
    const snapshotAttribute = props.snapshotAttribute;
    const layoutCommand = props.layoutCommand;
    const resetSnapshot = props.resetSnapshot?.trim() ?? "";
    const { onSelectionChange, onReorder, onRotate, onZOrderChange, onSnapshot } = props;

    // react-draggable needs a DOM ref: React 19 has no findDOMNode.
    const nodeRef = useRef<HTMLDivElement>(null);
    const session = useRef<DragSession | null>(null);
    const keyboardSession = useRef<KeyboardSession | null>(null);
    const timers = useRef<Timers>({});
    const instructionsId = useId();
    const selectedId = useId();
    const [instanceId] = useState(nextInstanceId);

    const [isDragging, setIsDragging] = useState(false);
    const [grabbed, setGrabbed] = useState(false);
    const [snap, setSnap] = useState<Position>({ x: 0, y: 0 });
    const [guides, setGuides] = useState<Guide[]>([]);
    const [hints, setHints] = useState<SpacingHint[]>([]);
    const [tilt, setTilt] = useState(0);
    const [overZone, setOverZone] = useState(false);
    const [settle, setSettle] = useState<Settle | undefined>(undefined);
    const [announcement, setAnnouncement] = useState("");
    const resizeSession = useRef<{
        pointerId: number;
        edge: ResizeEdge;
        start: Size;
        from: Position;
        max: Size;
    } | null>(null);
    const scrollSpeed = useRef<Position>({ x: 0, y: 0 });
    const [resizing, setResizing] = useState(false);
    // 2.2 state
    const [selected, setSelectedState] = useState(false);
    const selectedRef = useRef(false);
    const pendingNarrow = useRef(false);
    const [followDelta, setFollowDelta] = useState<Position | null>(null);
    const [displaced, setDisplaced] = useState(false);
    const [ghost, setGhost] = useState<Ghost | null>(null);
    const [menu, setMenu] = useState<{ at: Position; rtl: boolean; items: MenuItem[] } | null>(null);
    const api = useRef<LatestApi | null>(null);
    const [notice, setNotice] = useState<Notice | null>(null);
    const [armed, setArmed] = useState(false);
    const [rotating, setRotating] = useState(false);
    const rotateSession = useRef<{
        pointerId: number;
        centre: Position;
        from: Position;
        start: number;
        last: number;
    } | null>(null);
    const flipFrom = useRef<Rect | undefined>(undefined);
    const gate = useRef<LongPressGate | null>(null);
    const pendingTouch = useRef<{ target: EventTarget; touch: Touch } | null>(null);

    const texts = {
        pickUp: textOf(
            props.pickUpText,
            "Picked up. Move with the arrow keys, press Enter or Space to put down, Escape to cancel."
        ),
        pickUpZones: textOf(
            props.pickUpZonesText,
            "Picked up. Move with the arrow keys, press Enter or Space to drop, Escape to cancel."
        ),
        moved: textOf(props.movedText, "Moved to [x], [y]."),
        overZone: textOf(props.overZoneText, "Over [zone]. Press Enter to drop."),
        droppedOn: textOf(props.droppedOnText, "Dropped on [zone]."),
        droppedAt: textOf(props.droppedAtText, "Dropped at [x], [y]."),
        cancelled: textOf(props.cancelledText, "Cancelled. Back at the start."),
        edge: textOf(props.edgeText, "Edge reached."),
        resized: textOf(props.resizedText, "Resized to [width] by [height]."),
        undone: textOf(props.undoneText, "Moved back to [x], [y]."),
        reset: textOf(props.resetText, "Back at the default position."),
        nudged: textOf(props.nudgedText, "Moved to the nearest free spot."),
        reverted: textOf(props.revertedText, "That spot is taken. Back at the start."),
        rejected: textOf(props.rejectedText, "[zone] does not accept this item."),
        selectedCount: textOf(props.selectedCountText, "[count] selected."),
        selectionCleared: textOf(props.selectionClearedText, "Selection cleared."),
        selectedState: textOf(props.selectedStateText, "Selected."),
        groupMoved: textOf(props.groupMovedText, "Moved [count] items."),
        lifted: textOf(
            props.liftedText,
            "Lifted. Position [index] of [count]. Use the arrow keys to move, Space to drop, Escape to cancel."
        ),
        sortMoved: textOf(props.sortMovedText, "Position [index] of [count]."),
        sortList: textOf(props.sortListText, "Moved to [list], position [index] of [count]."),
        sortDropped: textOf(props.sortDroppedText, "Dropped at position [index] of [count]."),
        sortCancelled: textOf(props.sortCancelledText, "Reorder cancelled. Back at position [index]."),
        sortInstructions: textOf(
            props.sortInstructionsText,
            "Sortable item. Press Space to lift it, the arrow keys to move it, Space to drop it and Escape to cancel."
        ),
        rotated: textOf(props.rotatedText, "Rotated to [angle] degrees."),
        layer: textOf(props.layerText, "Layer [layer] of [count]."),
        snapshotSaved: textOf(props.snapshotSavedText, "Layout [name] saved."),
        snapshotRestored: textOf(props.snapshotRestoredText, "Layout [name] restored."),
        snapshotMissing: textOf(props.snapshotMissingText, "There is no layout called [name]."),
        saveFailed: textOf(props.saveFailedText, "This change could not be saved, so it was undone."),
        reorderFailed: textOf(props.reorderFailedText, "The new order was not saved, so it was undone."),
        retry: textOf(props.retryText, "Retry"),
        dismiss: textOf(props.dismissText, "Dismiss"),
        saving: textOf(props.savingText, "Saving"),
        menuLabel: textOf(props.menuLabelText, "Item actions"),
        menuFront: textOf(props.menuFrontText, "Bring to front"),
        menuForward: textOf(props.menuForwardText, "Bring forward"),
        menuBackward: textOf(props.menuBackwardText, "Send backward"),
        menuBack: textOf(props.menuBackText, "Send to back"),
        menuRotateLeft: textOf(props.menuRotateLeftText, "Rotate left"),
        menuRotateRight: textOf(props.menuRotateRightText, "Rotate right"),
        menuResetRotation: textOf(props.menuResetRotationText, "Reset rotation"),
        menuMoveUp: textOf(props.menuMoveUpText, "Move up"),
        menuMoveDown: textOf(props.menuMoveDownText, "Move down"),
        menuMoveFirst: textOf(props.menuMoveFirstText, "Move to start"),
        menuMoveLast: textOf(props.menuMoveLastText, "Move to end"),
        menuSaveSnapshot: textOf(props.menuSaveSnapshotText, "Save layout snapshot"),
        menuRestoreSnapshot: textOf(props.menuRestoreSnapshotText, "Restore [name]"),
        menuSelectAll: textOf(props.menuSelectAllText, "Select all"),
        menuClearSelection: textOf(props.menuClearSelectionText, "Clear selection"),
        menuUndo: textOf(props.menuUndoText, "Undo"),
        menuReset: textOf(props.menuResetText, "Reset position")
    };
    const xy = (at: Position): { x: number; y: number } => ({ x: Math.round(at.x), y: Math.round(at.y) });
    // Where the position comes from: the attributes win, then the browser store, then the defaults.
    // Sortable items (2.2) are never positioned freely: their rest offset is 0, 0.
    const persistKeyValue = persistKey?.value || undefined;
    const attributeX = readAttribute(xAttribute);
    const attributeY = readAttribute(yAttribute);
    const resolveSource = (): Position => {
        if (sortAxis) {
            return { x: 0, y: 0 };
        }
        const stored = attributeX === undefined || attributeY === undefined ? loadPosition(persistKeyValue) : undefined;
        return { x: attributeX ?? stored?.x ?? defaultX, y: attributeY ?? stored?.y ?? defaultY };
    };
    const sourceSignature = `${sortAxis ?? ""}|${attributeX}|${attributeY}|${
        persistKeyValue ?? ""
    }|${defaultX}|${defaultY}`;
    const [position, setPosition] = useState<Position>(resolveSource);
    const [seenSignature, setSeenSignature] = useState(sourceSignature);
    // Follow the attributes (or a newly available storage key) when they change from outside, but never
    // mid-drag or mid-pick-up, or the content would jump under the pointer. Adjusting state while
    // rendering is React's recommended replacement for a syncing effect.
    if (seenSignature !== sourceSignature) {
        setSeenSignature(sourceSignature);
        if (!isDragging && !grabbed) {
            setPosition(resolveSource());
        }
    }

    // Size (2.1): the attributes win, then the browser store, then the natural size.
    const attributeW = readAttribute(widthAttribute);
    const attributeH = readAttribute(heightAttribute);
    const resolveSize = (): Size | undefined => {
        if (!resizable) {
            return undefined;
        }
        const stored = attributeW === undefined || attributeH === undefined ? loadSize(persistKeyValue) : undefined;
        const w = attributeW ?? stored?.w;
        const h = attributeH ?? stored?.h;
        return w !== undefined && h !== undefined && w > 0 && h > 0 ? { w, h } : undefined;
    };
    const sizeSignature = `${resizable}|${attributeW}|${attributeH}|${persistKeyValue ?? ""}`;
    const [size, setSize] = useState<Size | undefined>(resolveSize);
    const [seenSize, setSeenSize] = useState(sizeSignature);
    if (seenSize !== sizeSignature) {
        setSeenSize(sizeSignature);
        if (!resizing) {
            setSize(resolveSize());
        }
    }

    // Rotation (2.2): the attribute wins, then the browser store, then 0.
    const attributeR = readAttribute(rotationAttribute);
    const resolveRotation = (): number =>
        rotatable ? normaliseAngle(attributeR ?? loadNumber(persistKeyValue, "rotation") ?? 0) : 0;
    const rotationSignature = `${rotatable}|${attributeR}|${persistKeyValue ?? ""}`;
    const [rotation, setRotation] = useState<number>(resolveRotation);
    const [seenRotation, setSeenRotation] = useState(rotationSignature);
    if (seenRotation !== rotationSignature) {
        setSeenRotation(rotationSignature);
        if (!rotating) {
            setRotation(resolveRotation());
        }
    }

    // Z-index (2.2): the attribute wins, then the browser store; undefined leaves the stacking to the page.
    const attributeZ = readAttribute(zIndexAttribute);
    const resolveZ = (): number | undefined =>
        zOrderOn ? attributeZ ?? loadNumber(persistKeyValue, "z") ?? undefined : undefined;
    const zSignature = `${zOrderOn}|${attributeZ}|${persistKeyValue ?? ""}`;
    const [zIndex, setZIndex] = useState<number | undefined>(resolveZ);
    const [seenZ, setSeenZ] = useState(zSignature);
    if (seenZ !== zSignature) {
        setSeenZ(zSignature);
        setZIndex(resolveZ());
    }

    const limitsOfSize = sizeLimits(props.minWidth, props.minHeight, props.maxWidth, props.maxHeight);
    const typeValue = dragType?.value ?? "";
    const collisionMode: CollisionMode = collision ?? "none";

    const isDisabled = disabled?.value === true;
    const canDragX = axis === "both" || axis === "x";
    const canDragY = axis === "both" || axis === "y";
    // Sortable lists are not snapped to a grid; the slots are the grid.
    const grid: [number, number] | undefined = !sortAxis && gridX > 0 && gridY > 0 ? [gridX, gridY] : undefined;
    const keyboardOn = keyboardEnabled && !isDisabled;
    const selectionOn = multiSelect && !isDisabled;
    const inGroup = multiSelect || zOrderOn || snapshotsEnabled;
    const historyScope = inGroup ? `group:${groupNameValue}` : instanceId;
    const historyCap = inGroup ? GROUP_HISTORY_CAP : HISTORY_CAP;
    const itemKeyValue = props.itemKey?.value || persistKeyValue || props.name;
    const longPressOn = touchDelay > 0 && !isDisabled;
    const actions = [onDragStop, onDrop, onPositionChange, onResize, onReorder, onRotate, onZOrderChange, onSnapshot];
    const busy = actions.some(action => action?.isExecuting === true);

    // Refs that group operations read synchronously (state updates only land on the next render).
    const committed = useRef<Position>(position);
    const sizeRef = useRef<Size | undefined>(size);
    const rotationRef = useRef(rotation);
    const zRef = useRef<number | undefined>(zIndex);
    useLayoutEffect(() => {
        sizeRef.current = size;
        if (!rotating) {
            rotationRef.current = rotation;
        }
        zRef.current = zIndex;
        if (!isDragging && !grabbed && !followDelta && !sortAxis) {
            // External changes (attributes, browser store) are the committed position too.
            committed.current = position;
        }
    });

    // Clean up timers and zone classes if the page closes mid-drag.
    useEffect(() => {
        const pending = timers.current;
        return () => {
            window.clearTimeout(pending.settle);
            window.clearTimeout(pending.tilt);
            window.clearTimeout(pending.keyboardStop);
            window.clearTimeout(pending.command);
            window.cancelAnimationFrame(pending.scroll ?? 0);
            const drag = session.current;
            if (drag) {
                setZoneClasses(drag.zones, false, null);
                setRejected(drag.rejected, false);
                drag.invalid?.classList.remove(ZONE_INVALID);
                drag.group?.followers.forEach(f => f.follow(null));
            }
            const keys = keyboardSession.current;
            if (keys) {
                setZoneClasses(keys.zones, false, null);
                setRejected(keys.rejected, false);
                keys.invalid?.classList.remove(ZONE_INVALID);
            }
            gate.current?.dispose();
        };
    }, []);

    const motionAllowed = (): boolean => animate && motionMode !== "off" && !prefersReducedMotion();
    /** Playful extras (tilt, ripple, zone flash) only run with Motion = Full. */
    const fullMotion = (): boolean => motionAllowed() && motionMode !== "subtle";

    /** Zones for a drag: the accepting ones are armed, the others marked rejected. */
    const armZones = (node: HTMLElement): { zones: HTMLElement[]; rejected: HTMLElement[] } => {
        const all = findZones(dropTargetSelector ?? "", node);
        const zones = all.filter(zone => zoneAccepts(acceptListOf(zone), typeValue));
        const rejected = all.filter(zone => !zones.includes(zone));
        setZoneClasses(zones, true, null);
        setRejected(rejected, true);
        return { zones, rejected };
    };

    /** The bounds element (parent, body or custom selector), if any. */
    const boundsBox = (node: HTMLElement): Element | null => {
        if (bounds === "parent") {
            return node.parentElement;
        }
        if (bounds === "body") {
            return node.ownerDocument.body;
        }
        if (bounds === "selector" && boundsSelector) {
            try {
                return node.ownerDocument.querySelector(boundsSelector);
            } catch {
                return null;
            }
        }
        return null;
    };

    /** The container whose draggables are obstacles and snap targets. */
    const siblingContainer = (node: HTMLElement): Element | null =>
        bounds === "parent" || bounds === "selector" ? boundsBox(node) : null;

    const zoneId = (zone: HTMLElement): string =>
        resolveTargetId(
            { dataDropId: zone.getAttribute("data-drop-id"), id: zone.id, classNames: Array.from(zone.classList) },
            dropIdClassPrefix
        );

    const listId = (list: HTMLElement): string =>
        resolveTargetId(
            {
                dataDropId: list.getAttribute("data-sort-id") ?? list.getAttribute("data-drop-id"),
                id: list.id,
                classNames: Array.from(list.classList)
            },
            dropIdClassPrefix
        );

    const announce = (text: string): void => {
        // A trailing no-break space toggles so repeating the same message is still announced.
        setAnnouncement(previous => (previous === text ? text + NBSP : text));
    };

    const startSettle = (next: Settle | undefined): void => {
        window.clearTimeout(timers.current.settle);
        setSettle(next);
        if (next) {
            timers.current.settle = window.setTimeout(() => setSettle(undefined), next.duration + 120);
        }
    };

    const handleTransitionEnd = (event: ReactTransitionEvent<HTMLDivElement>): void => {
        if (event.target === event.currentTarget && event.propertyName === "transform" && settle) {
            window.clearTimeout(timers.current.settle);
            setSettle(undefined);
        }
    };

    /** Translate limits for the current bounds setting, measured with the content at `at`. */
    const measureLimits = (node: HTMLElement, at: Position, rect: Rect): Limits => {
        if (sortAxis) {
            return NO_LIMITS;
        }
        if (bounds === "offset") {
            return limitsFromOffsets(boundsLeft, boundsTop, boundsRight, boundsBottom);
        }
        const box = boundsBox(node);
        return box ? limitsFromBox(at, rect, contentBox(box)) : NO_LIMITS;
    };

    /** Layout rect of the content when its translate equals `at`, even while an animation is running. */
    const rectAt = (node: HTMLElement, at: Position): Rect => {
        const visual = readVisualTranslate(node) ?? position;
        const drawn = layoutRect(node, { x: visual.x - position.x, y: visual.y - position.y });
        return offsetRect(drawn, at.x - position.x, at.y - position.y);
    };

    // ---- Failures (2.2): never lose a change silently ------------------------------------------

    const fail = (message: string, retry?: () => void): void => {
        announce(message);
        setNotice({ message, retry });
    };

    const remember = (changes: HistoryChange[]): void => {
        if (undoEnabled) {
            pushHistoryEntry(historyScope, { changes }, historyCap);
        }
    };

    const commit = (next: Position, rememberIt = true): boolean => {
        if (sortAxis) {
            return true;
        }
        if (blocked(xAttribute) || blocked(yAttribute)) {
            // The attributes cannot take the new position: put the item back and offer a retry.
            const back = committed.current;
            setPosition(back);
            startSettle(motionAllowed() ? SETTLE_SPRING : undefined);
            fail(texts.saveFailed, () => {
                setNotice(null);
                setPosition(next);
                commit(next, rememberIt);
            });
            return false;
        }
        const before = committed.current;
        if (rememberIt && !same(before, next)) {
            remember([{ id: instanceId, before: { x: before.x, y: before.y } }]);
        }
        committed.current = next;
        // Persist first, so an "On drag stop" microflow reads the final coordinates.
        writeOffset(xAttribute, next.x);
        writeOffset(yAttribute, next.y);
        savePosition(persistKeyValue, next);
        if (onPositionChange && canRun(onPositionChange)) {
            onPositionChange.execute({ x: new Big(Math.round(next.x)), y: new Big(Math.round(next.y)) });
        }
        return true;
    };

    /** Collision avoidance at the end of a move; returns the position to use and announces a change. */
    const avoidOverlap = (
        target: Position,
        rectAtTarget: Rect,
        start: Position,
        obstacles: Rect[],
        limits: Limits
    ): Position => {
        if (collisionMode === "none" || obstacles.length === 0) {
            return target;
        }
        const result = resolveCollision(collisionMode, {
            target,
            rect: rectAtTarget,
            obstacles,
            start,
            limits,
            step: grid ? Math.max(gridX, gridY) : 8,
            canMoveX: canDragX,
            canMoveY: canDragY
        });
        if (result.outcome === "nudged") {
            announce(texts.nudged);
        } else if (result.outcome === "reverted") {
            announce(texts.reverted);
        }
        return result.position;
    };

    const obstaclesFor = (node: HTMLElement, exclude: readonly HTMLElement[] = []): Rect[] =>
        collisionMode === "none"
            ? []
            : findSiblings(node, siblingContainer(node))
                  .filter(sibling => !exclude.includes(sibling))
                  .map(sibling => toRect(sibling.getBoundingClientRect()));

    // ---- Rotation and z-order (2.2) ------------------------------------------------------------

    const commitRotation = (
        angle: number,
        rememberIt: boolean,
        before = rotationRef.current,
        speak = true
    ): boolean => {
        const next = Math.round(normaliseAngle(angle));
        if (blocked(rotationAttribute)) {
            rotationRef.current = before;
            setRotation(before);
            fail(texts.saveFailed, () => {
                setNotice(null);
                commitRotation(next, rememberIt, before, speak);
            });
            return false;
        }
        if (rememberIt && before !== next) {
            remember([{ id: instanceId, before: { r: before } }]);
        }
        rotationRef.current = next;
        setRotation(next);
        if (rotationAttribute && !rotationAttribute.readOnly) {
            rotationAttribute.setValue(new Big(next));
        }
        saveNumber(persistKeyValue, "rotation", next);
        if (onRotate && canRun(onRotate)) {
            onRotate.execute({ angle: new Big(next) });
        }
        if (speak) {
            announce(fill(texts.rotated, { angle: next }));
        }
        return true;
    };

    const commitZ = (z: number | undefined): boolean => {
        if (blocked(zIndexAttribute)) {
            fail(texts.saveFailed);
            return false;
        }
        zRef.current = z;
        setZIndex(z);
        if (zIndexAttribute && !zIndexAttribute.readOnly) {
            zIndexAttribute.setValue(z === undefined ? undefined : new Big(Math.round(z)));
        }
        if (z !== undefined) {
            saveNumber(persistKeyValue, "z", z);
        }
        if (z !== undefined && onZOrderChange && canRun(onZOrderChange)) {
            onZOrderChange.execute({ z: new Big(Math.round(z)) });
        }
        return true;
    };

    const zOperation = (operation: ZOperation): void => {
        const peers = members(groupNameValue, h => h.zOrder());
        if (peers.length === 0) {
            return;
        }
        const next = applyZOrder(
            peers.map(h => ({ id: h.id, z: h.state().z })),
            instanceId,
            operation
        );
        const changes: HistoryChange[] = [];
        peers.forEach(h => {
            const before = h.state().z;
            const after = next.get(h.id);
            if (after !== undefined && after !== before) {
                changes.push({ id: h.id, before: { z: before } });
                h.apply({ z: after }, false);
            }
        });
        remember(changes);
        announce(fill(texts.layer, { layer: next.get(instanceId) ?? 1, count: peers.length }));
    };

    // ---- Selection (2.2) -------------------------------------------------------------------

    const selectedCountText = (count: number): string =>
        count === 0 ? texts.selectionCleared : fill(texts.selectedCount, { count });

    const changeSelection = (ids: string[]): void => {
        if (setSelection(groupNameValue, ids)) {
            announce(selectedCountText(selectionOf(groupNameValue).length));
        }
    };

    const groupSelection = (): Handle[] => {
        if (!selectionOn || !selectedRef.current) {
            return [];
        }
        const ids = selectionOf(groupNameValue);
        return ids.length > 1 ? ids.map(id => getHandle(id)).filter((h): h is Handle => !!h) : [];
    };

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (!selectionOn || (event.pointerType === "mouse" && event.button !== 0)) {
            return;
        }
        const target = event.target as Element;
        if (
            target.closest?.(".mxt-draggable__resize, .mxt-draggable__rotate, .mxt-draggable__notice") ||
            target.closest?.(".mxt-draggable") !== nodeRef.current
        ) {
            return;
        }
        const additive = event.shiftKey || event.ctrlKey || event.metaKey;
        const { next, kind } = pressSelection(selectionOf(groupNameValue), instanceId, additive);
        pendingNarrow.current = kind === "keep";
        if (kind !== "keep") {
            changeSelection(next);
        }
    };

    // ---- Auto-scroll (2.1) --------------------------------------------------------------------

    const scrollTick = (): void => {
        const drag = session.current;
        const speed = scrollSpeed.current;
        timers.current.scroll = undefined;
        if (!drag || (speed.x === 0 && speed.y === 0)) {
            return;
        }
        if (drag.scroller) {
            drag.scroller.scrollBy(speed.x, speed.y);
        } else {
            window.scrollBy(speed.x, speed.y);
        }
        timers.current.scroll = window.requestAnimationFrame(scrollTick);
    };

    const updateAutoScroll = (drag: DragSession): void => {
        if (!autoScroll || !drag.pointer) {
            return;
        }
        const view = drag.scroller
            ? toRect(drag.scroller.getBoundingClientRect())
            : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        scrollSpeed.current = edgeScrollSpeed(drag.pointer, view);
        if ((scrollSpeed.current.x !== 0 || scrollSpeed.current.y !== 0) && timers.current.scroll === undefined) {
            timers.current.scroll = window.requestAnimationFrame(scrollTick);
        }
    };

    const stopAutoScroll = (): void => {
        scrollSpeed.current = { x: 0, y: 0 };
        window.cancelAnimationFrame(timers.current.scroll ?? 0);
        timers.current.scroll = undefined;
    };

    const dropOn = (zone: HTMLElement, finalRect: Rect, point: Position, motion: boolean): void => {
        const targetId = zoneId(zone);
        const inZone = relativeTo(finalRect, toRect(zone.getBoundingClientRect()));
        if (motion && fullMotion()) {
            spawnRipple(zone.ownerDocument, point);
            flashZone(zone);
        }
        announce(fill(texts.droppedOn, { zone: targetId || "drop zone" }));
        if (onDrop && canRun(onDrop)) {
            onDrop.execute({ targetId, x: new Big(inZone.x), y: new Big(inZone.y) });
        }
    };

    // ---- Drop preview (2.2) -----------------------------------------------------------------

    const showGhost = (holder: { ghostKey?: string }, next: Ghost | null): void => {
        const key = next
            ? `${next.kind}|${Math.round(next.rect.left)}|${Math.round(next.rect.top)}|${Math.round(
                  next.rect.width
              )}|${Math.round(next.rect.height)}`
            : "";
        if (holder.ghostKey !== key) {
            holder.ghostKey = key;
            setGhost(next);
        }
    };

    const markInvalid = (holder: { invalid: HTMLElement | null }, zone: HTMLElement | null): void => {
        if (holder.invalid !== zone) {
            holder.invalid?.classList.remove(ZONE_INVALID);
            zone?.classList.add(ZONE_INVALID);
            holder.invalid = zone;
        }
    };

    /** Where a pointer drag will land if released now (zones, return, collision), drawn as a ghost. */
    const previewLanding = (drag: DragSession, shown: Position): void => {
        const refused = drag.pointer && !drag.over && drag.moved ? hitZone(drag.rejected, drag.pointer) : null;
        markInvalid(drag, refused);
        let landing = shown;
        let valid = !refused;
        if (!drag.over && drag.moved) {
            if (returnIfNotDropped) {
                landing = drag.start;
            } else if (collisionMode !== "none" && drag.obstacles.length > 0) {
                const result = resolveCollision(collisionMode, {
                    target: shown,
                    rect: offsetRect(drag.rect, shown.x - drag.start.x, shown.y - drag.start.y),
                    obstacles: drag.obstacles,
                    start: drag.start,
                    limits: drag.limits,
                    step: grid ? Math.max(gridX, gridY) : 8,
                    rings: PREVIEW_RINGS,
                    canMoveX: canDragX,
                    canMoveY: canDragY
                });
                landing = result.position;
                valid = valid && result.outcome !== "reverted";
            }
        }
        const differs = Math.abs(landing.x - shown.x) > 1 || Math.abs(landing.y - shown.y) > 1;
        showGhost(
            drag,
            drag.moved && (differs || refused)
                ? {
                      rect: offsetRect(drag.rect, landing.x - drag.start.x, landing.y - drag.start.y),
                      kind: valid ? "valid" : "invalid"
                  }
                : null
        );
    };

    // ---- Sortable (2.2) ----------------------------------------------------------------------

    const thisHandle = (): Handle | undefined => getHandle(instanceId);

    const newSortSession = (node: HTMLElement): SortSession | undefined => {
        const own = thisHandle();
        if (!sortAxis || !own || !containerOf(node, sortSelector)) {
            return undefined;
        }
        return new SortSession(own, sortAxis, candidateContainers(node, sortSelector, sortCross), sortSelector);
    };

    const isRtl = (node: HTMLElement): boolean => {
        try {
            return getComputedStyle(node).direction === "rtl";
        } catch {
            return false;
        }
    };

    /** Writes the orders, keeps them on screen until the list shows them, and runs On reorder. */
    const finishSort = (result: SortResult, sort: SortSession): void => {
        const ok = writeOrders(result.orders, true);
        if (!ok) {
            writeOrders(result.orders, false);
            setPosition(sort.cancel(motionAllowed()));
            startSettle(motionAllowed() ? SETTLE_SPRING : undefined);
            fail(texts.saveFailed);
            return;
        }
        const target: SortTarget = { container: result.toContainer, index: result.toIndex };
        const toList = result.toContainer;
        hold(result, {
            selector: sortSelector,
            axis: sort.axis,
            timeout: onReorder ? sortTimeout : 0,
            animate: motionAllowed,
            busy: () => getHandle(instanceId)?.busy() ?? false,
            onFailed: () => {
                const owner = getHandle(instanceId) ?? membersOf(toList, sortSelector)[0];
                owner?.notify(texts.reorderFailed, () => getHandle(instanceId) && api.current?.moveSortTo(target));
            }
        });
        const count = sort.countIn(result.toContainer);
        announce(fill(texts.sortDropped, { index: result.toIndex + 1, count }));
        if (onReorder && canRun(onReorder)) {
            onReorder.execute({
                oldIndex: new Big(result.fromIndex),
                newIndex: new Big(result.toIndex),
                containerId: listId(result.toContainer),
                fromContainerId: listId(result.fromContainer)
            });
        }
    };

    /** Moves this sortable item to a target without dragging (menu, retry). */
    const moveSortTo = (target: SortTarget): void => {
        const node = nodeRef.current;
        const sort = node ? newSortSession(node) : undefined;
        if (!node || !sort) {
            return;
        }
        const landing = sort.show(target, motionAllowed());
        setPosition(sort.landingOffset(landing));
        startSettle(motionAllowed() ? SETTLE_SPRING : undefined);
        const result = sort.result();
        if (result.changed) {
            finishSort(result, sort);
        }
    };

    const sortIndex = (): { container: HTMLElement; index: number; count: number } | undefined => {
        const node = nodeRef.current;
        const container = node && sortAxis ? containerOf(node, sortSelector) : null;
        if (!container) {
            return undefined;
        }
        const order = logicalOrder(container, sortSelector);
        return { container, index: order.indexOf(instanceId), count: order.length };
    };

    // ---- Pointer dragging -------------------------------------------------------------------

    const handleStart = (event: DraggableEvent, data: DraggableData): false | void => {
        const node = nodeRef.current;
        // While picked up with the keyboard the pointer cannot start a second drag; drop or Escape first.
        if (!node || keyboardSession.current || rotateSession.current) {
            return false;
        }
        // Touch long-press (2.2): the first touchstart only starts the timer; the drag begins when it fires.
        if (longPressOn && event.type === "touchstart") {
            const touchGate = getGate();
            if (!touchGate.consume()) {
                const touchEvent = event as unknown as TouchEvent;
                const touch = touchEvent.targetTouches?.[0] ?? touchEvent.changedTouches?.[0];
                if (touch && touchEvent.target) {
                    pendingTouch.current = { target: touchEvent.target, touch };
                    touchGate.start({ x: touch.clientX, y: touch.clientY });
                }
                return false;
            }
        }
        window.clearTimeout(timers.current.keyboardStop);
        setMenu(null);
        let start: Position = { x: data.x, y: data.y };
        if (settle) {
            // Grabbed mid-animation: continue from where it is drawn instead of jumping to the target.
            const visual = readVisualTranslate(node);
            startSettle(undefined);
            if (visual) {
                start = visual;
                setPosition(visual);
            }
        }
        const drawnAt = readVisualTranslate(node) ?? start;
        const rect = layoutRect(node, { x: drawnAt.x - start.x, y: drawnAt.y - start.y });
        const limits = measureLimits(node, start, rect);
        const { zones, rejected } = sortAxis ? { zones: [], rejected: [] } : armZones(node);

        // Group drag (2.2): the other selected items follow, clamped so none leaves its own bounds.
        let group: GroupDrag | undefined;
        const followers = sortAxis ? [] : groupSelection().filter(h => h.id !== instanceId);
        if (followers.length > 0) {
            const starts = followers.map(f => f.followStart());
            group = { followers, starts, range: groupDeltaLimits([{ at: start, limits }, ...starts]) };
        }
        const followerNodes = followers.map(f => f.node()).filter((n): n is HTMLElement => !!n);

        let snapTargets: Rect[] = [];
        let spacingTargets: Rect[] = [];
        if (snapToSiblings && !sortAxis) {
            const container = siblingContainer(node);
            spacingTargets = findSiblings(node, container)
                .filter(sibling => !followerNodes.includes(sibling))
                .map(sibling => toRect(sibling.getBoundingClientRect()));
            snapTargets = [...spacingTargets];
            if (container) {
                snapTargets.push(contentBox(container));
            }
        }

        let sort: SortSession | undefined;
        if (sortAxis) {
            sort = newSortSession(node);
            if (!sort) {
                return false;
            }
        }

        session.current = {
            start,
            rejected,
            obstacles: group ? [] : obstaclesFor(node),
            scroller: autoScroll ? scrollParent(node) : undefined,
            rect,
            limits,
            zones,
            snapTargets,
            spacingTargets,
            samples: [{ x: start.x, y: start.y, t: timeOf(event) }],
            over: null,
            invalid: null,
            raw: start,
            snap: { x: 0, y: 0 },
            moved: false,
            motion: motionAllowed(),
            group,
            sort
        };
        if (sort) {
            const landing = sort.show(sort.target, false);
            session.current.landing = landing;
            showGhost(session.current, { rect: landing, kind: "placeholder" });
        }
        setIsDragging(true);
        setTilt(0);
        run(onDragStart);
    };

    // The position is controlled, so react-draggable leaves axis locking to us: it reports
    // movement on both axes and only filters at render time when it owns the position.
    const constrain = (data: DraggableData, previous: Position): Position => ({
        x: canDragX ? data.x : previous.x,
        y: canDragY ? data.y : previous.y
    });

    const handleDrag = (event: DraggableEvent, data: DraggableData): void => {
        const drag = session.current;
        if (!drag) {
            return;
        }
        const raw = constrain(data, drag.raw);
        drag.raw = raw;
        drag.moved =
            drag.moved ||
            Math.abs(raw.x - drag.start.x) >= MIN_MOVE_PX ||
            Math.abs(raw.y - drag.start.y) >= MIN_MOVE_PX;
        // Keep the controlled position equal to react-draggable's own state, or it would reset mid-drag.
        setPosition(raw);

        let shown = raw;
        if (snapToSiblings && drag.snapTargets.length > 0) {
            const moving = offsetRect(drag.rect, raw.x - drag.start.x, raw.y - drag.start.y);
            const options = { threshold: Math.max(0, snapThreshold), snapX: canDragX, snapY: canDragY };
            const result = computeSnap(moving, drag.snapTargets, options);
            let dx = result.dx;
            let dy = result.dy;
            let spacing: SpacingHint[] = [];
            if (equalSpacing && drag.spacingTargets.length > 1) {
                // Equal gaps only on an axis that did not already snap to an edge or centre.
                const freeX = dx === 0 && !result.guides.some(g => g.orientation === "vertical");
                const freeY = dy === 0 && !result.guides.some(g => g.orientation === "horizontal");
                const gaps = computeSpacing(moving, drag.spacingTargets, {
                    threshold: options.threshold,
                    snapX: canDragX && freeX,
                    snapY: canDragY && freeY
                });
                dx += gaps.dx;
                dy += gaps.dy;
                spacing = gaps.hints;
            }
            const wanted = { x: raw.x + dx, y: raw.y + dy };
            const snapped = clampToLimits(wanted, drag.limits);
            shown = snapped;
            const exact = snapped.x === wanted.x && snapped.y === wanted.y;
            setGuides(exact ? result.guides : []);
            if (equalSpacing) {
                setHints(exact ? spacing : []);
            }
        }
        if (drag.group) {
            const delta = clampToLimits({ x: shown.x - drag.start.x, y: shown.y - drag.start.y }, drag.group.range);
            shown = { x: drag.start.x + delta.x, y: drag.start.y + delta.y };
            drag.group.followers.forEach(f => f.follow(delta));
        }
        const offset = { x: shown.x - raw.x, y: shown.y - raw.y };
        if (offset.x !== drag.snap.x || offset.y !== drag.snap.y) {
            drag.snap = offset;
            setSnap(offset);
        }

        const pointer = pointerOf(event);
        if (pointer) {
            drag.pointer = pointer;
            updateAutoScroll(drag);
        }
        if (drag.zones.length > 0 && drag.pointer) {
            const over = drag.moved ? hitZone(drag.zones, drag.pointer) : null;
            if (over !== drag.over) {
                drag.over = over;
                setZoneClasses(drag.zones, true, over);
                setOverZone(over !== null);
            }
        }
        if (drag.sort) {
            const centre = centreOf(offsetRect(drag.rect, raw.x - drag.start.x, raw.y - drag.start.y));
            const target = drag.sort.targetFor(centre, drag.pointer);
            if (target.container !== drag.sort.target.container || target.index !== drag.sort.target.index) {
                drag.landing = drag.sort.show(target, drag.motion);
                showGhost(drag, { rect: drag.landing, kind: "placeholder" });
            }
        } else if (dropPreview && !drag.group) {
            previewLanding(drag, shown);
        }

        drag.samples = pushSample(drag.samples, { x: raw.x, y: raw.y, t: timeOf(event) });
        if (drag.motion && fullMotion() && liftWhileDragging && canDragX && !drag.sort) {
            setTilt(tiltFor(velocityFromSamples(drag.samples).vx));
            window.clearTimeout(timers.current.tilt);
            timers.current.tilt = window.setTimeout(() => setTilt(0), TILT_REST_MS);
        }
    };

    const handleStop = (event: DraggableEvent, data: DraggableData): void => {
        const drag = session.current;
        session.current = null;
        stopAutoScroll();
        window.clearTimeout(timers.current.tilt);
        setIsDragging(false);
        setArmed(false);
        setTilt(0);
        setGuides([]);
        setHints([]);
        setSnap({ x: 0, y: 0 });
        setOverZone(false);
        setGhost(null);
        if (!drag) {
            return;
        }
        drag.invalid?.classList.remove(ZONE_INVALID);
        if (pendingNarrow.current && !drag.moved) {
            changeSelection(clickSelection(selectionOf(groupNameValue), instanceId));
        }
        pendingNarrow.current = false;

        if (drag.sort) {
            const result = drag.sort.result();
            if (result.changed && drag.landing) {
                setPosition(drag.sort.landingOffset(drag.landing));
                startSettle(drag.motion ? SETTLE_SPRING : undefined);
                run(onDragStop);
                finishSort(result, drag.sort);
            } else {
                setPosition(drag.sort.cancel(drag.motion));
                startSettle(drag.motion ? SETTLE_SPRING : undefined);
                run(onDragStop);
            }
            return;
        }

        const raw = constrain(data, drag.raw);
        let final: Position = { x: raw.x + drag.snap.x, y: raw.y + drag.snap.y };
        const pointer = pointerOf(event) ?? drag.pointer;
        const zone = drag.moved && drag.zones.length > 0 && pointer ? hitZone(drag.zones, pointer) : null;
        setZoneClasses(drag.zones, false, null);
        setRejected(drag.rejected, false);

        let nextSettle: Settle | undefined;
        if (!zone && returnIfNotDropped && drag.moved) {
            final = drag.start;
            nextSettle = drag.motion ? SETTLE_SPRING : undefined;
        } else if (!zone && momentum && drag.motion && drag.moved && !drag.group) {
            const velocity = velocityFromSamples(drag.samples);
            const thrown = projectThrow(
                final,
                { vx: canDragX ? velocity.vx : 0, vy: canDragY ? velocity.vy : 0 },
                { limits: drag.limits, gridX: grid ? gridX : 0, gridY: grid ? gridY : 0 }
            );
            if (thrown) {
                final = thrown.target;
                nextSettle = { duration: thrown.duration, easing: thrown.easing };
            }
        }
        if (!zone && drag.moved && !drag.group) {
            const avoided = avoidOverlap(
                final,
                offsetRect(drag.rect, final.x - drag.start.x, final.y - drag.start.y),
                drag.start,
                drag.obstacles,
                drag.limits
            );
            if (avoided !== final) {
                final = avoided;
                nextSettle = drag.motion ? SETTLE_SPRING : undefined;
            }
        }
        if (drag.group) {
            const delta = clampToLimits({ x: final.x - drag.start.x, y: final.y - drag.start.y }, drag.group.range);
            final = { x: drag.start.x + delta.x, y: drag.start.y + delta.y };
            const changes: HistoryChange[] = [
                { id: instanceId, before: { x: drag.start.x, y: drag.start.y } },
                ...drag.group.followers.map((f, i) => ({
                    id: f.id,
                    before: { x: drag.group?.starts[i].at.x, y: drag.group?.starts[i].at.y }
                }))
            ];
            drag.group.followers.forEach(f => f.followEnd(delta, zone ?? undefined));
            if (delta.x !== 0 || delta.y !== 0) {
                remember(changes);
            }
            setPosition(final);
            startSettle(nextSettle);
            commit(final, false);
        } else {
            setPosition(final);
            startSettle(nextSettle);
            if (drag.moved || final.x !== drag.start.x || final.y !== drag.start.y) {
                commit(final);
            } else {
                commit(final, false);
            }
        }
        run(onDragStop);
        if (zone && pointer) {
            dropOn(zone, offsetRect(drag.rect, final.x - drag.start.x, final.y - drag.start.y), pointer, drag.motion);
        }
    };

    // ---- Keyboard dragging ------------------------------------------------------------------

    const keyboardOptions = { axis, gridX: grid ? gridX : 0, gridY: grid ? gridY : 0, step: keyboardStep };

    const finishKeyboardSort = (sort: SortSession, drop: boolean): void => {
        const result = sort.result();
        const motion = motionAllowed();
        if (!drop || !result.changed) {
            setPosition(sort.cancel(motion));
            startSettle(motion ? SETTLE_SPRING : undefined);
            run(onDragStop);
            announce(
                drop
                    ? fill(texts.sortDropped, { index: sort.fromIndex + 1, count: sort.countIn(sort.fromContainer) })
                    : fill(texts.sortCancelled, { index: sort.fromIndex + 1 })
            );
            return;
        }
        run(onDragStop);
        finishSort(result, sort);
    };

    const finishKeyboard = (drop: boolean): void => {
        const keys = keyboardSession.current;
        const node = nodeRef.current;
        keyboardSession.current = null;
        setGrabbed(false);
        setOverZone(false);
        setGhost(null);
        if (!keys || !node) {
            return;
        }
        keys.invalid?.classList.remove(ZONE_INVALID);
        if (keys.sort) {
            finishKeyboardSort(keys.sort, drop);
            return;
        }
        setZoneClasses(keys.zones, false, null);
        setRejected(keys.rejected, false);
        const motion = motionAllowed();
        const moved = keys.origin.x !== position.x || keys.origin.y !== position.y;
        const zone = drop ? keys.over : null;
        let final = position;
        if (!drop || (!zone && returnIfNotDropped && moved)) {
            final = keys.origin;
        } else if (!zone && moved) {
            final = avoidOverlap(
                position,
                rectAt(node, position),
                keys.origin,
                obstaclesFor(node),
                measureLimits(node, position, rectAt(node, position))
            );
        }
        if (final !== position) {
            setPosition(final);
            startSettle(motion ? SETTLE_SPRING : undefined);
        }
        // The undo entry is the position before the pick-up.
        committed.current = keys.origin;
        commit(final);
        run(onDragStop);
        if (zone) {
            const finalRect = rectAt(node, final);
            dropOn(zone, finalRect, centreOf(finalRect), motion);
        } else {
            if (drop && final === position) {
                announce(fill(texts.droppedAt, xy(final)));
            } else if (!drop || final === keys.origin) {
                if (!drop || returnIfNotDropped) {
                    announce(texts.cancelled);
                }
            }
        }
    };

    /** Keyboard moves of a lifted sortable item (2.2). */
    const keyboardSortMove = (
        event: ReactKeyboardEvent<HTMLDivElement>,
        node: HTMLElement,
        sort: SortSession
    ): void => {
        let target: SortTarget | undefined;
        if ((event.key === "PageUp" || event.key === "PageDown") && sortCross) {
            const lists = sort.containers;
            const at = lists.indexOf(sort.target.container) + (event.key === "PageDown" ? 1 : -1);
            if (at >= 0 && at < lists.length) {
                target = {
                    container: lists[at],
                    index: Math.min(sort.target.index, sort.countIn(lists[at]) - 1)
                };
            } else {
                event.preventDefault();
                announce(texts.edge);
                return;
            }
        } else {
            const index = keyboardSortIndex(
                sort.axis,
                event.key,
                sort.target.index,
                sort.countIn(sort.target.container),
                sort.columnsIn(sort.target.container),
                isRtl(node)
            );
            if (index !== undefined) {
                target = { container: sort.target.container, index };
            }
        }
        if (!target) {
            return;
        }
        event.preventDefault();
        if (target.container === sort.target.container && target.index === sort.target.index) {
            announce(texts.edge);
            return;
        }
        const changedList = target.container !== sort.target.container;
        const landing = sort.show(target, motionAllowed());
        setPosition(sort.landingOffset(landing));
        startSettle(motionAllowed() ? GLIDE_SPRING : undefined);
        const values = {
            index: target.index + 1,
            count: sort.countIn(target.container),
            list: listId(target.container)
        };
        announce(fill(changedList ? texts.sortList : texts.sortMoved, values));
    };

    /** Arrow keys with several items selected: all of them move, as one undo step (2.2). */
    const keyboardGroupMove = (key: string, shiftKey: boolean, group: Handle[]): void => {
        const delta = keyboardDelta(key, shiftKey, keyboardOptions);
        if (!delta) {
            return;
        }
        const starts = group.map(h => h.followStart());
        const moved = clampToLimits(delta, groupDeltaLimits(starts));
        if (moved.x === 0 && moved.y === 0) {
            announce(texts.edge);
            return;
        }
        remember(group.map((h, i) => ({ id: h.id, before: { x: starts[i].at.x, y: starts[i].at.y } })));
        group.forEach(h => h.followEnd(moved));
        announce(fill(texts.groupMoved, { count: group.length }));
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        const node = nodeRef.current;
        // Only react when the widget itself has focus, so inputs and buttons inside keep their keys.
        if (!keyboardOn || !node || event.target !== event.currentTarget || session.current) {
            return;
        }
        const keys = keyboardSession.current;
        const ctrl = event.ctrlKey || event.metaKey;
        if (!keys && contextMenuOn && ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu")) {
            event.preventDefault();
            openMenuAtNode();
            return;
        }
        if (undoEnabled && !keys && ctrl && !event.shiftKey && event.key.toLowerCase() === "z") {
            event.preventDefault();
            undo();
            return;
        }
        if (resetEnabled && !keys && event.key === "Home" && !sortAxis) {
            event.preventDefault();
            reset();
            return;
        }
        // 2.2: selection keys.
        if (selectionOn && !keys) {
            if (ctrl && (event.key === " " || event.key === "Spacebar")) {
                event.preventDefault();
                const { next } = pressSelection(selectionOf(groupNameValue), instanceId, true);
                changeSelection(next);
                return;
            }
            if (ctrl && event.key.toLowerCase() === "a") {
                event.preventDefault();
                changeSelection(members(groupNameValue, h => h.selectable()).map(h => h.id));
                return;
            }
            if (event.key === "Escape" && selectionOf(groupNameValue).length > 0) {
                event.preventDefault();
                changeSelection([]);
                return;
            }
        }
        // 2.2: z-order shortcuts (Ctrl+] / Ctrl+[ with Shift for front / back).
        if (zOrderOn && !keys) {
            const operation = zShortcut(event.nativeEvent.code ?? "", event.key, ctrl, event.shiftKey);
            if (operation) {
                event.preventDefault();
                zOperation(operation);
                return;
            }
        }
        // 2.2: rotation with [ and ].
        if (rotatable && !keys && !ctrl && !event.altKey) {
            const turn = keyboardRotation(event.nativeEvent.code ?? "", event.key, event.shiftKey, rotationStep);
            if (turn !== undefined) {
                event.preventDefault();
                commitRotation(rotationRef.current + turn, true);
                return;
            }
        }
        if (resizable && !keys && event.altKey && !sortAxis) {
            const delta = keyboardResize(event.key, event.shiftKey, keyboardStep);
            if (delta) {
                event.preventDefault();
                const start = currentSize(node);
                const next = resizeTo(start, delta, "se", limitsOfSize, undefined, keepAspectRatio);
                const capped = capToBounds(node, next);
                setSize(capped);
                finishResize(capped);
                return;
            }
        }
        if (isGrabKey(event.key) && !ctrl) {
            event.preventDefault();
            if (keys) {
                finishKeyboard(true);
            } else if (sortAxis) {
                const sort = newSortSession(node);
                if (!sort) {
                    return;
                }
                window.clearTimeout(timers.current.keyboardStop);
                keyboardSession.current = {
                    origin: position,
                    zones: [],
                    rejected: [],
                    over: null,
                    invalid: null,
                    sort
                };
                setGrabbed(true);
                run(onDragStart);
                announce(fill(texts.lifted, { index: sort.fromIndex + 1, count: sort.countIn(sort.fromContainer) }));
            } else {
                window.clearTimeout(timers.current.keyboardStop);
                const { zones, rejected } = armZones(node);
                keyboardSession.current = { origin: position, zones, rejected, over: null, invalid: null };
                setGrabbed(true);
                run(onDragStart);
                announce(zones.length > 0 ? texts.pickUpZones : texts.pickUp);
            }
            return;
        }
        if (event.key === "Escape" && keys) {
            event.preventDefault();
            finishKeyboard(false);
            return;
        }
        if (keys?.sort) {
            keyboardSortMove(event, node, keys.sort);
            return;
        }
        if (sortAxis || !keyboardDelta(event.key, event.shiftKey, keyboardOptions)) {
            return;
        }
        // An arrow along a free axis: never scroll the page, even at the edge.
        event.preventDefault();
        const group = keys ? [] : groupSelection();
        if (group.length > 1) {
            keyboardGroupMove(event.key, event.shiftKey, group);
            return;
        }
        const currentRect = rectAt(node, position);
        const next = keyboardMove(
            position,
            event.key,
            event.shiftKey,
            keyboardOptions,
            measureLimits(node, position, currentRect)
        );
        if (!next) {
            announce(texts.edge);
            return;
        }
        setPosition(next);
        startSettle(motionAllowed() ? GLIDE_SPRING : undefined);

        if (keys) {
            const centre = centreOf(offsetRect(currentRect, next.x - position.x, next.y - position.y));
            const over = keys.zones.length > 0 ? hitZone(keys.zones, centre) : null;
            if (over !== keys.over) {
                keys.over = over;
                setZoneClasses(keys.zones, true, over);
                setOverZone(over !== null);
            }
            const refused = over ? null : hitZone(keys.rejected, centre);
            if (dropPreview) {
                markInvalid(keys, refused);
                const back = !over && returnIfNotDropped;
                showGhost(
                    keys as { ghostKey?: string },
                    back || refused
                        ? {
                              rect: offsetRect(
                                  currentRect,
                                  (back ? keys.origin.x : next.x) - position.x,
                                  (back ? keys.origin.y : next.y) - position.y
                              ),
                              kind: refused ? "invalid" : "valid"
                          }
                        : null
                );
            }
            if (over) {
                announce(fill(texts.overZone, { zone: zoneId(over) || "a drop zone" }));
            } else if (refused) {
                announce(fill(texts.rejected, { zone: zoneId(refused) || "This zone" }));
            } else {
                announce(fill(texts.moved, xy(next)));
            }
            return;
        }
        commit(next);
        announce(fill(texts.moved, xy(next)));
        // Report a burst of arrow presses as one move.
        window.clearTimeout(timers.current.keyboardStop);
        timers.current.keyboardStop = window.setTimeout(() => run(onDragStop), KEYBOARD_STOP_DELAY_MS);
    };

    // ---- Undo and reset (2.1, group history 2.2) ----------------------------------------------

    const moveTo = (target: Position, rememberIt: boolean): void => {
        setPosition(target);
        startSettle(motionAllowed() ? SETTLE_SPRING : undefined);
        commit(target, rememberIt);
        run(onDragStop);
    };

    const undo = (): void => {
        const entry = popHistoryEntry(historyScope);
        if (!entry) {
            announce(texts.edge);
            return;
        }
        applyHistoryEntry(entry, motionAllowed());
        const own = entry.changes.find(change => change.id === instanceId)?.before;
        const at = {
            x: own?.x ?? committed.current.x,
            y: own?.y ?? committed.current.y
        };
        announce(fill(texts.undone, xy(at)));
    };

    const defaultState = (): Partial<ItemState> => {
        if (snapshotsEnabled && resetSnapshot) {
            const stored = readStore(groupNameValue).store.snapshots[resetSnapshot]?.items[itemKeyValue];
            if (stored) {
                return stored;
            }
        }
        return { x: defaultX, y: defaultY };
    };

    const currentState = (): ItemState => {
        const out: ItemState = { x: committed.current.x, y: committed.current.y };
        const s = sizeRef.current;
        if (resizable && s) {
            out.w = s.w;
            out.h = s.h;
        }
        if (rotatable) {
            out.r = rotationRef.current;
        }
        if (zOrderOn && zRef.current !== undefined) {
            out.z = zRef.current;
        }
        return out;
    };

    const reset = (): void => {
        const target = defaultState();
        const keysUsed = Object.keys(target);
        if (keysUsed.length === 2 && target.x !== undefined && target.y !== undefined) {
            if (target.x === position.x && target.y === position.y) {
                return;
            }
            moveTo({ x: target.x, y: target.y }, true);
            announce(texts.reset);
            return;
        }
        const before = currentState();
        const diff = changedFields(before, { ...before, ...target });
        if (Object.keys(diff).length === 0) {
            return;
        }
        remember([{ id: instanceId, before: diff }]);
        applyState(target, true);
        announce(texts.reset);
    };

    const handleDoubleClick = (): void => {
        if (resetEnabled && !isDisabled && !session.current && !keyboardSession.current && !sortAxis) {
            reset();
        }
    };

    // ---- Layout snapshots (2.2) --------------------------------------------------------------

    const runSnapshot = (operation: string, name: string, json: string | undefined): void => {
        if (onSnapshot && canRun(onSnapshot)) {
            onSnapshot.execute({ operation, name, json: json ?? readStoreJson() });
        }
    };

    const readStoreJson = (): string => JSON.stringify(readStore(groupNameValue).store);

    const snapshotCommand = (command: LayoutCommand): void => {
        if (!snapshotsEnabled) {
            return;
        }
        if (command.op === "save") {
            const json = saveSnapshot(groupNameValue, command.name);
            if (!json) {
                fail(texts.saveFailed, () => {
                    setNotice(null);
                    snapshotCommand(command);
                });
                return;
            }
            announce(fill(texts.snapshotSaved, { name: command.name }));
            runSnapshot("save", command.name, json);
        } else if (command.op === "restore") {
            const changed = restoreSnapshot(groupNameValue, command.name, motionAllowed(), historyScope, historyCap);
            announce(
                fill(changed === undefined ? texts.snapshotMissing : texts.snapshotRestored, { name: command.name })
            );
            if (changed !== undefined) {
                runSnapshot("restore", command.name, undefined);
            }
        } else if (command.op === "delete") {
            const json = deleteSnapshot(groupNameValue, command.name);
            runSnapshot("delete", command.name, json);
        } else {
            const states: Record<string, Partial<ItemState>> = {};
            snapshotMembers(groupNameValue).forEach(h => {
                states[h.itemKey()] = h.defaultState();
            });
            applyLayout(groupNameValue, states, motionAllowed(), historyScope, historyCap);
            announce(texts.reset);
            runSnapshot("reset", "", undefined);
        }
    };

    // The Layout command attribute: run once per new value, then clear it.
    const commandValue = layoutCommand?.value ?? "";
    useEffect(() => {
        if (!commandValue.trim() || !snapshotsEnabled) {
            return;
        }
        // Let the other members of the group register first (they mount in the same commit).
        timers.current.command = window.setTimeout(() => {
            const command = parseCommand(commandValue);
            if (layoutCommand && !layoutCommand.readOnly) {
                layoutCommand.setValue("");
            }
            if (command) {
                api.current?.snapshotCommand(command);
            }
        }, 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [commandValue, snapshotsEnabled]);

    // ---- Resizing (2.1) ---------------------------------------------------------------------

    const currentSize = (node: HTMLElement): Size => size ?? { w: node.offsetWidth, h: node.offsetHeight };

    /** The largest size that still fits in the bounds element (parent, body or selector). */
    const maxInBounds = (node: HTMLElement): Size => {
        const box = boundsBox(node);
        if (!box) {
            return { w: Infinity, h: Infinity };
        }
        const outer = contentBox(box);
        const rect = node.getBoundingClientRect();
        return { w: outer.left + outer.width - rect.left, h: outer.top + outer.height - rect.top };
    };

    const capToBounds = (node: HTMLElement, next: Size): Size => {
        const max = maxInBounds(node);
        return {
            w: Math.max(1, Math.min(next.w, Math.floor(max.w))),
            h: Math.max(1, Math.min(next.h, Math.floor(max.h)))
        };
    };

    const finishResize = (final: Size): void => {
        writeSize(widthAttribute, final.w);
        writeSize(heightAttribute, final.h);
        saveSize(persistKeyValue, final);
        announce(fill(texts.resized, { width: Math.round(final.w), height: Math.round(final.h) }));
        if (onResize && canRun(onResize)) {
            onResize.execute({ width: new Big(Math.round(final.w)), height: new Big(Math.round(final.h)) });
        }
    };

    const onResizeDown =
        (edge: ResizeEdge) =>
        (event: ReactPointerEvent<HTMLSpanElement>): void => {
            const node = nodeRef.current;
            if (!node || isDisabled || (event.pointerType === "mouse" && event.button !== 0)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            try {
                event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
                // Synthetic events cannot be captured.
            }
            resizeSession.current = {
                pointerId: event.pointerId,
                edge,
                start: currentSize(node),
                from: { x: event.clientX, y: event.clientY },
                max: maxInBounds(node)
            };
            setResizing(true);
        };

    const onResizeMove = (event: ReactPointerEvent<HTMLSpanElement>): void => {
        const active = resizeSession.current;
        if (!active || active.pointerId !== event.pointerId) {
            return;
        }
        const next = resizeTo(
            active.start,
            { x: event.clientX - active.from.x, y: event.clientY - active.from.y },
            active.edge,
            limitsOfSize,
            grid,
            keepAspectRatio
        );
        setSize({ w: Math.min(next.w, Math.floor(active.max.w)), h: Math.min(next.h, Math.floor(active.max.h)) });
    };

    const onResizeUp = (event: ReactPointerEvent<HTMLSpanElement>): void => {
        const active = resizeSession.current;
        if (!active || active.pointerId !== event.pointerId) {
            return;
        }
        resizeSession.current = null;
        setResizing(false);
        const node = nodeRef.current;
        if (node) {
            finishResize(currentSize(node));
        }
    };

    // ---- Rotate handle (2.2) -------------------------------------------------------------------

    const onRotateDown = (event: ReactPointerEvent<HTMLSpanElement>): void => {
        const node = nodeRef.current;
        if (!node || isDisabled || (event.pointerType === "mouse" && event.button !== 0)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Synthetic events cannot be captured.
        }
        const rect = node.getBoundingClientRect();
        rotateSession.current = {
            pointerId: event.pointerId,
            centre: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
            from: { x: event.clientX, y: event.clientY },
            start: rotationRef.current,
            last: rotationRef.current
        };
        setRotating(true);
    };

    const onRotateMove = (event: ReactPointerEvent<HTMLSpanElement>): void => {
        const active = rotateSession.current;
        if (!active || active.pointerId !== event.pointerId) {
            return;
        }
        const next = rotateBy(
            active.start,
            active.centre,
            active.from,
            { x: event.clientX, y: event.clientY },
            event.shiftKey ? rotationStep : 0
        );
        active.last = next;
        rotationRef.current = next;
        setRotation(next);
    };

    const onRotateUp = (event: ReactPointerEvent<HTMLSpanElement>): void => {
        const active = rotateSession.current;
        if (!active || active.pointerId !== event.pointerId) {
            return;
        }
        rotateSession.current = null;
        setRotating(false);
        if (Math.round(active.last) !== Math.round(active.start)) {
            commitRotation(active.last, true, active.start);
        } else {
            rotationRef.current = active.start;
            setRotation(active.start);
        }
    };

    // ---- Touch long-press (2.2) ----------------------------------------------------------------

    const getGate = (): LongPressGate => {
        if (!gate.current) {
            gate.current = new LongPressGate(touchDelay, {
                onArm: () => {
                    const pending = pendingTouch.current;
                    pendingTouch.current = null;
                    if (!pending) {
                        return;
                    }
                    if (hapticFeedback) {
                        haptic();
                    }
                    setArmed(true);
                    try {
                        const touches = [pending.touch];
                        const restart = new TouchEvent("touchstart", {
                            bubbles: true,
                            cancelable: true,
                            touches,
                            targetTouches: touches,
                            changedTouches: touches
                        });
                        pending.target.dispatchEvent(restart);
                    } catch {
                        // No TouchEvent constructor: the long-press cannot hand over to the drag.
                        gate.current?.consume();
                        setArmed(false);
                    }
                },
                onCancel: () => {
                    pendingTouch.current = null;
                }
            });
        }
        return gate.current;
    };

    useEffect(() => {
        // A changed delay needs a new gate.
        gate.current?.dispose();
        gate.current = null;
    }, [touchDelay]);

    useEffect(() => {
        const node = nodeRef.current;
        if (!node || !longPressOn) {
            return;
        }
        const onMove = (event: TouchEvent): void => {
            const touch = event.touches[0];
            const current = gate.current;
            if (current?.isPending && touch) {
                current.move({ x: touch.clientX, y: touch.clientY });
            } else if (session.current && event.cancelable) {
                // Dragging after a long-press: the finger moves the item, not the page.
                event.preventDefault();
            }
        };
        const onEnd = (): void => {
            gate.current?.end();
            if (!session.current) {
                setArmed(false);
            }
        };
        const onContext = (event: Event): void => {
            if (gate.current?.isPending || session.current) {
                event.preventDefault();
            }
        };
        node.addEventListener("touchmove", onMove, { passive: false });
        node.addEventListener("touchend", onEnd);
        node.addEventListener("touchcancel", onEnd);
        node.addEventListener("contextmenu", onContext);
        return () => {
            node.removeEventListener("touchmove", onMove);
            node.removeEventListener("touchend", onEnd);
            node.removeEventListener("touchcancel", onEnd);
            node.removeEventListener("contextmenu", onContext);
        };
    }, [longPressOn]);

    // ---- Menu (2.2) ------------------------------------------------------------------------

    const openMenuAtNode = (): void => {
        const node = nodeRef.current;
        if (!node) {
            return;
        }
        const rect = node.getBoundingClientRect();
        setMenu({
            at: { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + Math.min(24, rect.height / 2) },
            rtl: isRtl(node),
            items: menuItems()
        });
    };

    const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
        if (!contextMenuOn || isDisabled || gate.current?.isPending) {
            return;
        }
        const target = event.target as Element;
        if (target.closest?.(".mxt-draggable") !== nodeRef.current) {
            return;
        }
        event.preventDefault();
        setMenu({ at: { x: event.clientX, y: event.clientY }, rtl: isRtl(event.currentTarget), items: menuItems() });
    };

    const closeMenu = (restoreFocus: boolean): void => {
        setMenu(null);
        if (restoreFocus && keyboardOn) {
            nodeRef.current?.focus();
        }
    };

    const menuItems = (): MenuItem[] => {
        const sections: MenuItem[][] = [];
        const where = sortAxis ? sortIndex() : undefined;
        if (where && where.index >= 0) {
            const go = (index: number) => () => moveSortTo({ container: where.container, index });
            const first = where.index === 0;
            const last = where.index >= where.count - 1;
            sections.push([
                { id: "move-up", label: texts.menuMoveUp, onSelect: go(where.index - 1), disabled: first },
                { id: "move-down", label: texts.menuMoveDown, onSelect: go(where.index + 1), disabled: last },
                { id: "move-first", label: texts.menuMoveFirst, onSelect: go(0), disabled: first },
                { id: "move-last", label: texts.menuMoveLast, onSelect: go(where.count - 1), disabled: last }
            ]);
        }
        if (zOrderOn) {
            sections.push([
                { id: "z-front", label: texts.menuFront, onSelect: () => zOperation("front"), hint: "Ctrl+Shift+]" },
                { id: "z-forward", label: texts.menuForward, onSelect: () => zOperation("forward"), hint: "Ctrl+]" },
                { id: "z-backward", label: texts.menuBackward, onSelect: () => zOperation("backward"), hint: "Ctrl+[" },
                { id: "z-back", label: texts.menuBack, onSelect: () => zOperation("back"), hint: "Ctrl+Shift+[" }
            ]);
        }
        if (rotatable) {
            sections.push([
                {
                    id: "rotate-left",
                    label: texts.menuRotateLeft,
                    onSelect: () => commitRotation(rotationRef.current - rotationStep, true),
                    hint: "["
                },
                {
                    id: "rotate-right",
                    label: texts.menuRotateRight,
                    onSelect: () => commitRotation(rotationRef.current + rotationStep, true),
                    hint: "]"
                },
                {
                    id: "rotate-reset",
                    label: texts.menuResetRotation,
                    onSelect: () => commitRotation(0, true),
                    disabled: rotationRef.current === 0
                }
            ]);
        }
        if (selectionOn) {
            sections.push([
                {
                    id: "select-all",
                    label: texts.menuSelectAll,
                    onSelect: () => changeSelection(members(groupNameValue, h => h.selectable()).map(h => h.id)),
                    hint: "Ctrl+A"
                },
                {
                    id: "select-none",
                    label: texts.menuClearSelection,
                    onSelect: () => changeSelection([]),
                    disabled: selectionOf(groupNameValue).length === 0
                }
            ]);
        }
        const general: MenuItem[] = [];
        if (undoEnabled) {
            general.push({
                id: "undo",
                label: texts.menuUndo,
                onSelect: undo,
                disabled: historyLength(historyScope) === 0,
                hint: "Ctrl+Z"
            });
        }
        if (resetEnabled && !sortAxis) {
            general.push({ id: "reset", label: texts.menuReset, onSelect: reset, hint: "Home" });
        }
        if (general.length > 0) {
            sections.push(general);
        }
        if (snapshotsEnabled) {
            const store = readStore(groupNameValue).store;
            const names = snapshotNames(store).slice(-5).reverse();
            sections.push([
                {
                    id: "snapshot-save",
                    label: texts.menuSaveSnapshot,
                    onSelect: () => snapshotCommand({ op: "save", name: nextSnapshotName(store) })
                },
                ...names.map(name => ({
                    id: `snapshot-restore-${name}`,
                    label: fill(texts.menuRestoreSnapshot, { name }),
                    onSelect: () => snapshotCommand({ op: "restore", name })
                }))
            ]);
        }
        const items: MenuItem[] = [];
        sections.forEach((section, index) => {
            section.forEach((item, i) => items.push(index > 0 && i === 0 ? { ...item, separator: true } : item));
        });
        return items;
    };

    const handleBlur = (): void => {
        if (keyboardSession.current) {
            finishKeyboard(false);
        }
    };

    // ---- Registry handle (2.2) ---------------------------------------------------------------

    /** Closures of the latest render, called by the registry, other instances and timers. */
    const applyState = (state: Partial<ItemState>, animateIt: boolean): void => {
        if (state.x !== undefined || state.y !== undefined) {
            const target = { x: state.x ?? committed.current.x, y: state.y ?? committed.current.y };
            setPosition(target);
            startSettle(animateIt && motionAllowed() ? SETTLE_SPRING : undefined);
            commit(target, false);
            run(onDragStop);
        }
        if (state.w !== undefined && state.h !== undefined && resizable) {
            const next = { w: state.w, h: state.h };
            sizeRef.current = next;
            setSize(next);
            writeSize(widthAttribute, next.w);
            writeSize(heightAttribute, next.h);
            saveSize(persistKeyValue, next);
        }
        if (state.r !== undefined && rotatable) {
            commitRotation(state.r, false, rotationRef.current, false);
        }
        if (has(state, "z") && zOrderOn) {
            commitZ(state.z);
        }
    };
    const handleApi: HandleApi = {
        group: () => (inGroup ? groupNameValue : undefined),
        selectable: () => selectionOn,
        zOrder: () => zOrderOn,
        snapshots: () => snapshotsEnabled,
        sortAxis: () => sortAxis,
        itemKey: () => itemKeyValue,
        state: currentState,
        apply: applyState,
        setSelected: (on: boolean) => {
            selectedRef.current = on;
            setSelectedState(on);
            if (selectedAttribute && !selectedAttribute.readOnly) {
                selectedAttribute.setValue(on);
            }
            if (onSelectionChange && canRun(onSelectionChange)) {
                onSelectionChange.execute({ count: new Big(selectionOf(groupNameValue).length) });
            }
        },
        followStart: () => {
            const node = nodeRef.current;
            const at = committed.current;
            return { at, limits: node ? measureLimits(node, at, rectAt(node, at)) : NO_LIMITS };
        },
        follow: (delta: Position | null) => setFollowDelta(delta),
        followEnd: (delta: Position | undefined, zone?: HTMLElement) => {
            setFollowDelta(null);
            const node = nodeRef.current;
            if (!delta || (delta.x === 0 && delta.y === 0)) {
                startSettle(motionAllowed() ? SETTLE_SPRING : undefined);
                return;
            }
            const target = { x: committed.current.x + delta.x, y: committed.current.y + delta.y };
            setPosition(target);
            startSettle(motionAllowed() ? GLIDE_SPRING : undefined);
            commit(target, false);
            run(onDragStop);
            if (zone && node && zoneAccepts(acceptListOf(zone), typeValue)) {
                const rect = rectAt(node, target);
                dropOn(zone, rect, centreOf(rect), false);
            }
        },
        setSortOffset: (offset: Position, animateIt: boolean) => {
            setDisplaced(animateIt);
            setPosition(previous => (same(previous, offset) ? previous : offset));
        },
        release: (from: Rect | undefined) => {
            flipFrom.current = from;
            flushSync(() => {
                setDisplaced(false);
                setPosition({ x: 0, y: 0 });
            });
        },
        restRect: () => {
            const node = nodeRef.current;
            return node
                ? layoutRect(node, readVisualTranslate(node) ?? { x: 0, y: 0 })
                : { left: 0, top: 0, width: 0, height: 0 };
        },
        writeOrder: (index: number) => {
            if (!orderAttribute) {
                return true;
            }
            if (orderAttribute.readOnly) {
                return false;
            }
            orderAttribute.setValue(new Big(index + orderOffset));
            return true;
        },
        busy: () => busy,
        hasStore: () => snapshotAttribute !== undefined,
        readStore: () => snapshotAttribute?.value,
        writeStore: (json: string) => {
            if (!snapshotAttribute || snapshotAttribute.readOnly) {
                return false;
            }
            snapshotAttribute.setValue(json);
            return true;
        },
        defaultState,
        announce,
        notify: (message: string, retry?: () => void) =>
            fail(
                message,
                retry
                    ? () => {
                          setNotice(null);
                          retry();
                      }
                    : undefined
            ),
        selectedCountText
    };

    // The latest closures for the registry, other instances and timers (updated after every render,
    // before the registration below runs on mount).
    useLayoutEffect(() => {
        api.current = { snapshotCommand, moveSortTo, handle: handleApi };
    });

    // Register once; every method reads the latest closures through `api`.
    useLayoutEffect(() => {
        const delegate = (): HandleApi => (api.current as LatestApi).handle;
        const registered: Handle = {
            id: instanceId,
            node: () => nodeRef.current,
            group: () => delegate().group(),
            selectable: () => delegate().selectable(),
            zOrder: () => delegate().zOrder(),
            snapshots: () => delegate().snapshots(),
            sortAxis: () => delegate().sortAxis(),
            itemKey: () => delegate().itemKey(),
            state: () => delegate().state(),
            apply: (s, a) => delegate().apply(s, a),
            setSelected: on => delegate().setSelected(on),
            followStart: () => delegate().followStart(),
            follow: d => delegate().follow(d),
            followEnd: (d, z) => delegate().followEnd(d, z),
            setSortOffset: (o, a) => delegate().setSortOffset(o, a),
            release: r => delegate().release(r),
            restRect: () => delegate().restRect(),
            writeOrder: i => delegate().writeOrder(i),
            busy: () => delegate().busy(),
            hasStore: () => delegate().hasStore(),
            readStore: () => delegate().readStore(),
            writeStore: j => delegate().writeStore(j),
            defaultState: () => delegate().defaultState(),
            announce: t => delegate().announce(t),
            notify: (m, r) => delegate().notify(m, r),
            selectedCountText: c => delegate().selectedCountText(c)
        };
        const unregister = register(registered);
        return () => {
            unregister();
            pruneHeld();
        };
    }, [instanceId]);

    // List rows (2.0): a freely moved item inside a list view row is lifted above the rows that follow it.
    const listLift: ListLift =
        raiseListRows === false || sortAxis
            ? "none"
            : isDragging
            ? "dragging"
            : position.x !== 0 || position.y !== 0
            ? "resting"
            : "none";
    useEffect(() => {
        const row = listItemOf(nodeRef.current);
        liftListItem(row, instanceId, listLift);
        return () => liftListItem(row, instanceId, "none");
    }, [listLift, instanceId]);

    // Lasso (2.2): one controller per lasso area, shared by the group.
    useEffect(() => {
        const node = nodeRef.current;
        if (!node || !lassoOn || !multiSelect) {
            return;
        }
        let area: HTMLElement | null = null;
        const selector = props.lassoSelector?.trim();
        if (selector) {
            try {
                area =
                    node.parentElement?.closest<HTMLElement>(selector) ??
                    node.ownerDocument.querySelector<HTMLElement>(selector);
            } catch {
                area = null;
            }
        } else {
            const box = bounds === "parent" || bounds === "selector" ? boundsBox(node) : null;
            area = (box as HTMLElement | null) ?? node.parentElement;
        }
        return area ? attachLasso(area, groupNameValue) : undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lassoOn, multiSelect, props.lassoSelector, groupNameValue, bounds, boundsSelector]);

    // Selection of an item that is disabled or leaves the group is dropped.
    useEffect(() => {
        if (!selectionOn && selectedRef.current) {
            setSelection(
                groupNameValue,
                selectionOf(groupNameValue).filter(id => id !== instanceId)
            );
            selectedRef.current = false;
            setSelectedState(false);
        }
    }, [selectionOn, groupNameValue, instanceId]);

    // FLIP (2.2): after the list re-rendered in the new order, glide from where the item was drawn.
    useLayoutEffect(() => {
        const node = nodeRef.current;
        const from = flipFrom.current;
        flipFrom.current = undefined;
        if (!node || !from || !motionAllowed() || typeof node.animate !== "function") {
            return;
        }
        const now = node.getBoundingClientRect();
        const dx = from.left - now.left;
        const dy = from.top - now.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
            return;
        }
        node.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0px 0px" }], {
            duration: FLIP_MS,
            easing: "cubic-bezier(0.2, 0.8, 0.2, 1)"
        });
    });

    // ---- Render -----------------------------------------------------------------------------

    let resolvedBounds: string | false | DraggableBounds = false;
    if (sortAxis) {
        resolvedBounds = false;
    } else if (bounds === "parent") {
        resolvedBounds = "parent";
    } else if (bounds === "body") {
        resolvedBounds = "body";
    } else if (bounds === "selector" && boundsSelector) {
        resolvedBounds = boundsSelector;
    } else if (bounds === "offset") {
        // Limits are relative to the start position (translate 0,0), as react-draggable expects.
        resolvedBounds = { left: -boundsLeft, top: -boundsTop, right: boundsRight, bottom: boundsBottom };
    }

    // `translate` and `rotate` are separate CSS properties that compose with react-draggable's
    // `transform`, so snapping and tilt never fight the library for the transform. The `rotate`
    // property is applied before `transform`, so a real rotation (2.2) turns an inner body instead:
    // on the outer element it would also turn the translate and move the item.
    const turn = rotation + tilt;
    const motionStyle: Record<string, string | number | undefined> = {
        translate: snap.x !== 0 || snap.y !== 0 ? `${snap.x}px ${snap.y}px` : undefined,
        rotate: turn !== 0 && !rotatable ? `${turn}deg` : undefined
    };
    if (animate) {
        motionStyle["--mxt-draggable-glide-ease"] = GLIDE_SPRING.easing;
        motionStyle["--mxt-draggable-glide-duration"] = `${GLIDE_SPRING.duration}ms`;
    }
    if (settle) {
        motionStyle["--mxt-draggable-settle-ease"] = settle.easing;
        motionStyle["--mxt-draggable-settle-duration"] = `${settle.duration}ms`;
    }
    if (zOrderOn && zIndex !== undefined && !isDragging && !grabbed) {
        motionStyle.zIndex = zIndex;
    }
    const listZ = liftZIndex(listLift, motionStyle.zIndex as number | undefined);
    if (listZ !== undefined && listLift !== "none") {
        motionStyle.zIndex = listZ;
    }
    const sizeStyle: Record<string, string | undefined> =
        resizable && size ? { width: `${size.w}px`, height: `${size.h}px` } : {};
    const mergedStyle = { ...style, ...sizeStyle, ...motionStyle } as CSSProperties;
    const drawnPosition = followDelta ? { x: position.x + followDelta.x, y: position.y + followDelta.y } : position;
    const shown = { x: drawnPosition.x + snap.x, y: drawnPosition.y + snap.y };
    const instructions = sortAxis ? texts.sortInstructions : keyboardInstructions?.value;
    const liveOn = keyboardOn || selectionOn || !!sortAxis || rotatable || zOrderOn || snapshotsEnabled;
    const describedBy = [keyboardOn && instructions ? instructionsId : "", selected ? selectedId : ""]
        .filter(Boolean)
        .join(" ");
    const cancelSelector = [
        cancel,
        resizable ? ".mxt-draggable__resize" : "",
        rotatable ? ".mxt-draggable__rotate" : "",
        ".mxt-draggable__notice"
    ]
        .filter(Boolean)
        .join(", ");

    return (
        <ReactDraggable
            nodeRef={nodeRef}
            // A fixed reference for the pointer maths (2.0): an ancestor that gets a transform mid-drag (for example a
            // hover lift on a list row) would otherwise become the offset parent and make the item jump.
            offsetParent={typeof document === "undefined" ? undefined : document.body}
            axis={axis}
            handle={handle || undefined}
            cancel={cancelSelector || undefined}
            disabled={isDisabled}
            bounds={resolvedBounds}
            grid={grid}
            position={drawnPosition}
            allowMobileScroll={longPressOn}
            onStart={handleStart}
            onDrag={handleDrag}
            onStop={handleStop}
        >
            <div
                ref={nodeRef}
                className={classNames("mxt-draggable", `mxt-draggable--${display}`, className, {
                    "mxt-draggable--grab": !handle,
                    "mxt-draggable--disabled": isDisabled,
                    "mxt-draggable--lift": liftWhileDragging,
                    "mxt-draggable--animated": animate && motionMode !== "off",
                    "mxt-draggable--active": isDragging,
                    "mxt-draggable--grabbed": grabbed,
                    "mxt-draggable--glide": animate && motionMode !== "off" && isDragging && grid !== undefined,
                    "mxt-draggable--settling": settle !== undefined,
                    "mxt-draggable--over-zone": overZone,
                    "mxt-draggable--keyboard": keyboardOn,
                    "mxt-draggable--resizable": resizable && !isDisabled,
                    "mxt-draggable--sized": resizable && size !== undefined,
                    "mxt-draggable--resizing": resizing,
                    [`mxt-draggable--motion-${animate ? motionMode : "off"}`]: true,
                    // 2.2
                    "mxt-draggable--selectable": selectionOn,
                    "mxt-draggable--selected": selected,
                    "mxt-draggable--following": followDelta !== null,
                    "mxt-draggable--sortable": !!sortAxis,
                    "mxt-draggable--displaced": displaced && !isDragging,
                    "mxt-draggable--rotatable": rotatable && !isDisabled,
                    "mxt-draggable--rotating": rotating,
                    "mxt-draggable--long-press": longPressOn,
                    "mxt-draggable--armed": armed,
                    "mxt-draggable--saving": busy
                })}
                style={mergedStyle}
                tabIndex={keyboardOn ? tabIndex ?? 0 : tabIndex}
                role={keyboardOn ? "group" : undefined}
                aria-roledescription={keyboardOn ? (sortAxis ? "sortable item" : "draggable") : undefined}
                aria-grabbed={keyboardOn ? grabbed || isDragging : undefined}
                aria-describedby={keyboardOn && describedBy ? describedBy : undefined}
                aria-busy={busy || undefined}
                data-mxt-id={instanceId}
                onKeyDown={keyboardOn ? handleKeyDown : undefined}
                onBlur={keyboardOn ? handleBlur : undefined}
                onTransitionEnd={handleTransitionEnd}
                onDoubleClick={resetEnabled ? handleDoubleClick : undefined}
                onPointerDown={selectionOn ? handlePointerDown : undefined}
                onContextMenu={contextMenuOn ? handleContextMenu : undefined}
            >
                {rotatable ? (
                    <div className="mxt-draggable__body" style={{ rotate: turn !== 0 ? `${turn}deg` : undefined }}>
                        {content}
                        {!isDisabled && (
                            <span
                                className="mxt-draggable__rotate"
                                aria-hidden="true"
                                onPointerDown={onRotateDown}
                                onPointerMove={onRotateMove}
                                onPointerUp={onRotateUp}
                                onPointerCancel={onRotateUp}
                            />
                        )}
                    </div>
                ) : (
                    content
                )}
                {resizable &&
                    !isDisabled &&
                    (["e", "s", "se"] as const).map(edge => (
                        <span
                            key={edge}
                            className={`mxt-draggable__resize mxt-draggable__resize--${edge}`}
                            aria-hidden="true"
                            onPointerDown={onResizeDown(edge)}
                            onPointerMove={onResizeMove}
                            onPointerUp={onResizeUp}
                            onPointerCancel={onResizeUp}
                        />
                    ))}
                {rotating && showPosition && (
                    <span className="mxt-draggable__badge" aria-hidden="true">
                        {Math.round(rotation)}°
                    </span>
                )}
                {resizable && (resizing || grabbed) && showPosition && size && (
                    <span className="mxt-draggable__badge mxt-draggable__badge--size" aria-hidden="true">
                        {Math.round(size.w)} x {Math.round(size.h)}
                    </span>
                )}
                {showPosition && (isDragging || grabbed) && !sortAxis && (
                    <span className="mxt-draggable__badge" aria-hidden="true">
                        {Math.round(shown.x)}, {Math.round(shown.y)}
                    </span>
                )}
                {busy && <span className="mxt-draggable__saving" aria-hidden="true" title={texts.saving} />}
                {notice && (
                    <span className="mxt-draggable__notice" role="alert">
                        <span className="mxt-draggable__notice-text">{notice.message}</span>
                        {notice.retry && (
                            <button type="button" className="mxt-draggable__notice-button" onClick={notice.retry}>
                                {texts.retry}
                            </button>
                        )}
                        <button
                            type="button"
                            className="mxt-draggable__notice-button mxt-draggable__notice-button--quiet"
                            onClick={() => {
                                setNotice(null);
                                if (keyboardOn) {
                                    nodeRef.current?.focus();
                                }
                            }}
                        >
                            {texts.dismiss}
                        </button>
                    </span>
                )}
                {keyboardOn && instructions && (
                    <span id={instructionsId} className="mxt-draggable__sr-only">
                        {instructions}
                    </span>
                )}
                {selected && (
                    <span id={selectedId} className="mxt-draggable__sr-only">
                        {texts.selectedState}
                    </span>
                )}
                {liveOn && (
                    <span className="mxt-draggable__sr-only" role="status" aria-live="polite">
                        {announcement}
                    </span>
                )}
                {(guides.length > 0 || hints.length > 0) &&
                    createPortal(
                        <div className="mxt-snap-guides" aria-hidden="true">
                            {guides.map(guide => (
                                <span
                                    key={`${guide.orientation}-${guide.at}`}
                                    className={`mxt-snap-guide mxt-snap-guide--${guide.orientation}`}
                                    style={
                                        guide.orientation === "vertical"
                                            ? { left: guide.at, top: guide.from, height: guide.to - guide.from }
                                            : { top: guide.at, left: guide.from, width: guide.to - guide.from }
                                    }
                                />
                            ))}
                            {hints.map(hint => (
                                <span
                                    key={`${hint.axis}-${hint.from}-${hint.at}`}
                                    className={`mxt-spacing-hint mxt-spacing-hint--${hint.axis}`}
                                    style={
                                        hint.axis === "x"
                                            ? { left: hint.from, top: hint.at, width: hint.to - hint.from }
                                            : { top: hint.from, left: hint.at, height: hint.to - hint.from }
                                    }
                                >
                                    <span className="mxt-spacing-hint__label">{hint.gap}</span>
                                </span>
                            ))}
                        </div>,
                        document.body
                    )}
                {ghost &&
                    createPortal(
                        <div
                            className={`mxt-drop-ghost mxt-drop-ghost--${ghost.kind}`}
                            aria-hidden="true"
                            style={{
                                left: ghost.rect.left,
                                top: ghost.rect.top,
                                width: ghost.rect.width,
                                height: ghost.rect.height
                            }}
                        />,
                        document.body
                    )}
                {menu && (
                    <ContextMenu
                        items={menu.items}
                        at={menu.at}
                        label={texts.menuLabel}
                        rtl={menu.rtl}
                        onClose={closeMenu}
                    />
                )}
            </div>
        </ReactDraggable>
    );
}
