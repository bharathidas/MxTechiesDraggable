// Shared mocks for the component specs (not a spec itself).
import { Big } from "big.js";
import { ActionValue, DynamicValue, EditableValue } from "mendix";

import { MxTechiesDraggableContainerProps } from "../../typings/MxTechiesDraggableProps";

export function action<T extends ActionValue<any>>(): T & { execute: jest.Mock } {
    return { canExecute: true, isExecuting: false, execute: jest.fn() } as unknown as T & { execute: jest.Mock };
}

export function dynamic<T>(value: T): DynamicValue<T> {
    return { status: "available", value } as DynamicValue<T>;
}

/** A writable attribute that keeps the value it is given (like the Mendix client does). */
export function attribute<T extends string | boolean | Big = Big>(
    value?: T,
    readOnly = false
): EditableValue<T> & { setValue: jest.Mock } {
    const attr = {
        status: "available",
        readOnly,
        value,
        setValue: jest.fn((next: T | undefined) => {
            attr.value = next;
        })
    };
    return attr as unknown as EditableValue<T> & { setValue: jest.Mock };
}

export function numberAttribute(value?: number, readOnly = false): EditableValue<Big> & { setValue: jest.Mock } {
    return attribute<Big>(value === undefined ? undefined : new Big(value), readOnly);
}

export function props(overrides: Partial<MxTechiesDraggableContainerProps> = {}): MxTechiesDraggableContainerProps {
    return {
        name: "draggable1",
        class: "",
        content: <span>Card</span>,
        axis: "both",
        handle: "",
        cancel: "",
        bounds: "none",
        boundsSelector: "",
        boundsLeft: 100,
        boundsTop: 100,
        boundsRight: 100,
        boundsBottom: 100,
        gridX: 0,
        gridY: 0,
        defaultX: 0,
        defaultY: 0,
        display: "inline",
        showPosition: false,
        liftWhileDragging: true,
        raiseListRows: true,
        animate: false,
        momentum: false,
        dropTargetSelector: "",
        dropIdClassPrefix: "zone-",
        returnIfNotDropped: false,
        snapToSiblings: false,
        snapThreshold: 8,
        keyboardEnabled: true,
        keyboardStep: 10,
        keyboardInstructions: dynamic("Use the arrow keys to move."),
        resizable: false,
        minWidth: 40,
        minHeight: 40,
        maxWidth: 0,
        maxHeight: 0,
        keepAspectRatio: false,
        motion: "full",
        collision: "none",
        autoScroll: false,
        undoEnabled: false,
        resetEnabled: false,
        touchDelay: 0,
        hapticFeedback: true,
        rotatable: false,
        rotationStep: 15,
        zOrder: false,
        dropPreview: false,
        equalSpacing: false,
        contextMenu: false,
        multiSelect: false,
        lasso: false,
        lassoSelector: "",
        groupName: "",
        sortMode: "off",
        sortContainerSelector: "",
        sortCrossContainer: false,
        orderOffset: 0,
        sortTimeout: 6000,
        snapshotsEnabled: false,
        resetSnapshot: "",
        ...overrides
    };
}
