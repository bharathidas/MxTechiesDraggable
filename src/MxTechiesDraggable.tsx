import { ReactElement, useCallback, useEffect, useRef, useState } from "react";
import ReactDraggable, { DraggableBounds, DraggableData, DraggableEvent } from "react-draggable";
import classNames from "classnames";
import { Big } from "big.js";
import { EditableValue } from "mendix";

import { MxTechiesDraggableContainerProps } from "../typings/MxTechiesDraggableProps";

import "./ui/MxTechiesDraggable.css";

interface Position {
    x: number;
    y: number;
}

/** Reads a numeric attribute, falling back when the attribute is absent, still loading or empty. */
function readOffset(attribute: EditableValue<Big> | undefined, fallback: number): number {
    const value = attribute?.value;
    return value ? value.toNumber() : fallback;
}

/** Writes a rounded pixel offset back to an attribute when it is present and writable. */
function writeOffset(attribute: EditableValue<Big> | undefined, offset: number): void {
    if (attribute && !attribute.readOnly) {
        attribute.setValue(new Big(Math.round(offset)));
    }
}

export function MxTechiesDraggable(props: MxTechiesDraggableContainerProps): ReactElement {
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
        display,
        showPosition,
        liftWhileDragging,
        onDragStart,
        onDragStop,
        content,
        class: className,
        style,
        tabIndex
    } = props;

    // react-draggable needs a DOM ref: React 19 has no findDOMNode.
    const nodeRef = useRef<HTMLDivElement>(null);
    const dragging = useRef(false);
    // Mirrors dragging.current in state so the badge and lift styling re-render.
    const [isDragging, setIsDragging] = useState(false);

    const [position, setPosition] = useState<Position>(() => ({
        x: readOffset(xAttribute, defaultX),
        y: readOffset(yAttribute, defaultY)
    }));

    // Follow the attributes when they change from outside (microflow, nanoflow, another widget),
    // but never while the user is mid-drag, or the content would jump under the pointer.
    const externalX = readOffset(xAttribute, defaultX);
    const externalY = readOffset(yAttribute, defaultY);
    useEffect(() => {
        if (!dragging.current) {
            setPosition({ x: externalX, y: externalY });
        }
    }, [externalX, externalY]);

    const isDisabled = disabled?.value === true;

    const handleStart = useCallback(
        (_event: DraggableEvent, _data: DraggableData): void => {
            dragging.current = true;
            setIsDragging(true);
            if (onDragStart?.canExecute && !onDragStart.isExecuting) {
                onDragStart.execute();
            }
        },
        [onDragStart]
    );

    // The position is controlled, so react-draggable leaves axis locking to us: it reports
    // movement on both axes and only filters at render time when it owns the position.
    const canDragX = axis === "both" || axis === "x";
    const canDragY = axis === "both" || axis === "y";
    const constrain = useCallback(
        (data: DraggableData): ((previous: Position) => Position) =>
            previous => ({ x: canDragX ? data.x : previous.x, y: canDragY ? data.y : previous.y }),
        [canDragX, canDragY]
    );

    const handleDrag = useCallback(
        (_event: DraggableEvent, data: DraggableData): void => {
            setPosition(constrain(data));
        },
        [constrain]
    );

    const handleStop = useCallback(
        (_event: DraggableEvent, data: DraggableData): void => {
            dragging.current = false;
            setIsDragging(false);
            setPosition(previous => {
                const next = constrain(data)(previous);
                // Persist first, so an "On drag stop" microflow reads the final coordinates.
                writeOffset(xAttribute, next.x);
                writeOffset(yAttribute, next.y);
                return next;
            });
            if (onDragStop?.canExecute && !onDragStop.isExecuting) {
                onDragStop.execute();
            }
        },
        [constrain, xAttribute, yAttribute, onDragStop]
    );

    let resolvedBounds: string | false | DraggableBounds = false;
    if (bounds === "parent") {
        resolvedBounds = "parent";
    } else if (bounds === "body") {
        resolvedBounds = "body";
    } else if (bounds === "selector" && boundsSelector) {
        resolvedBounds = boundsSelector;
    } else if (bounds === "offset") {
        // Limits are relative to the start position (translate 0,0), as react-draggable expects.
        resolvedBounds = { left: -boundsLeft, top: -boundsTop, right: boundsRight, bottom: boundsBottom };
    }
    const grid: [number, number] | undefined = gridX > 0 && gridY > 0 ? [gridX, gridY] : undefined;

    return (
        <ReactDraggable
            nodeRef={nodeRef}
            axis={axis}
            handle={handle || undefined}
            cancel={cancel || undefined}
            disabled={isDisabled}
            bounds={resolvedBounds}
            grid={grid}
            position={position}
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
                    "mxt-draggable--active": isDragging
                })}
                style={style}
                tabIndex={tabIndex}
            >
                {content}
                {showPosition && isDragging && (
                    <span className="mxt-draggable__badge" aria-hidden="true">
                        {Math.round(position.x)}, {Math.round(position.y)}
                    </span>
                )}
            </div>
        </ReactDraggable>
    );
}
