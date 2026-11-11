import { act, fireEvent, render, screen } from "@testing-library/react";
import { Big } from "big.js";
import { ActionValue, DynamicValue, EditableValue } from "mendix";

import { MxTechiesDraggable } from "../MxTechiesDraggable";
import { MxTechiesDraggableContainerProps } from "../../typings/MxTechiesDraggableProps";

function action<T extends ActionValue<any>>(): T & { execute: jest.Mock } {
    return { canExecute: true, isExecuting: false, execute: jest.fn() } as unknown as T & { execute: jest.Mock };
}

function dynamic<T>(value: T): DynamicValue<T> {
    return { status: "available", value } as DynamicValue<T>;
}

function attribute(value?: number): EditableValue<Big> & { setValue: jest.Mock } {
    return {
        status: "available",
        readOnly: false,
        value: value === undefined ? undefined : new Big(value),
        setValue: jest.fn()
    } as unknown as EditableValue<Big> & { setValue: jest.Mock };
}

function props(overrides: Partial<MxTechiesDraggableContainerProps> = {}): MxTechiesDraggableContainerProps {
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
        animate: true,
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
        // 2.2 defaults (same values as the widget XML).
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

function widget(): HTMLElement {
    return screen.getByRole("group");
}

describe("MxTechiesDraggable", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        window.localStorage.clear();
    });

    afterEach(() => {
        act(() => {
            jest.runOnlyPendingTimers();
        });
        jest.useRealTimers();
        document.querySelectorAll(".drop-zone").forEach(zone => zone.remove());
    });

    it("is focusable and describes its keyboard controls", () => {
        render(<MxTechiesDraggable {...props()} />);
        const node = widget();
        expect(node.tabIndex).toBe(0);
        expect(node.getAttribute("aria-roledescription")).toBe("draggable");
        expect(node.getAttribute("aria-grabbed")).toBe("false");
        const describedBy = node.getAttribute("aria-describedby") ?? "";
        expect(document.getElementById(describedBy)?.textContent).toBe("Use the arrow keys to move.");
    });

    it("is not a tab stop when keyboard dragging is off", () => {
        const { container } = render(<MxTechiesDraggable {...props({ keyboardEnabled: false })} />);
        const node = container.querySelector(".mxt-draggable") as HTMLElement;
        expect(node.hasAttribute("tabindex")).toBe(false);
        expect(node.getAttribute("role")).toBeNull();
    });

    it("moves with the arrow keys, writes the attributes and reports one drag stop per burst", () => {
        const x = attribute(0);
        const y = attribute(0);
        const onDragStop = action<ActionValue>();
        render(<MxTechiesDraggable {...props({ xAttribute: x, yAttribute: y, onDragStop })} />);
        const node = widget();

        fireEvent.keyDown(node, { key: "ArrowRight" });
        fireEvent.keyDown(node, { key: "ArrowDown", shiftKey: true });
        expect(node.style.transform).toBe("translate(10px,100px)");
        expect(x.setValue).toHaveBeenLastCalledWith(new Big(10));
        expect(y.setValue).toHaveBeenLastCalledWith(new Big(100));
        expect(onDragStop.execute).not.toHaveBeenCalled();

        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(onDragStop.execute).toHaveBeenCalledTimes(1);
    });

    it("moves one grid step per key press and respects the axis", () => {
        render(<MxTechiesDraggable {...props({ gridX: 25, gridY: 25, axis: "x" })} />);
        const node = widget();
        fireEvent.keyDown(node, { key: "ArrowRight" });
        fireEvent.keyDown(node, { key: "ArrowDown" });
        expect(node.style.transform).toBe("translate(25px,0px)");
    });

    it("keeps keys typed into inner controls", () => {
        render(<MxTechiesDraggable {...props({ content: <input aria-label="name" /> })} />);
        const input = screen.getByLabelText("name");
        fireEvent.keyDown(input, { key: "ArrowRight" });
        expect(widget().style.transform).toBe("translate(0px,0px)");
    });

    it("picks up with Enter and returns to the start on Escape", () => {
        const onDragStart = action<ActionValue>();
        const onDragStop = action<ActionValue>();
        render(<MxTechiesDraggable {...props({ onDragStart, onDragStop })} />);
        const node = widget();

        fireEvent.keyDown(node, { key: "Enter" });
        expect(node.getAttribute("aria-grabbed")).toBe("true");
        expect(onDragStart.execute).toHaveBeenCalledTimes(1);

        fireEvent.keyDown(node, { key: "ArrowLeft" });
        expect(node.style.transform).toBe("translate(-10px,0px)");

        fireEvent.keyDown(node, { key: "Escape" });
        expect(node.getAttribute("aria-grabbed")).toBe("false");
        expect(node.style.transform).toBe("translate(0px,0px)");
        expect(onDragStop.execute).toHaveBeenCalledTimes(1);
        expect(screen.getByRole("status").textContent).toContain("Cancelled");
    });

    it("drops on a zone with the keyboard and passes the zone id and position to On drop", () => {
        const zone = document.createElement("div");
        zone.className = "drop-zone zone-backlog";
        zone.getBoundingClientRect = () => ({ left: -100, top: -50, width: 400, height: 300 } as DOMRect);
        document.body.appendChild(zone);
        const onDrop = action<NonNullable<MxTechiesDraggableContainerProps["onDrop"]>>();

        render(<MxTechiesDraggable {...props({ dropTargetSelector: ".drop-zone", onDrop })} />);
        const node = widget();

        fireEvent.keyDown(node, { key: " " });
        expect(zone.classList.contains("mxt-drop-zone--armed")).toBe(true);
        fireEvent.keyDown(node, { key: "ArrowRight" });
        expect(zone.classList.contains("mxt-drop-zone--over")).toBe(true);
        expect(screen.getByRole("status").textContent).toContain("Over backlog");

        fireEvent.keyDown(node, { key: "Enter" });
        // jsdom has no layout, so the widget measures as a zero-size box at the origin: x = 0 - (-100).
        // In a browser the measured box includes the translate, giving 110 here.
        expect(onDrop.execute).toHaveBeenCalledWith({ targetId: "backlog", x: new Big(100), y: new Big(50) });
        expect(zone.classList.contains("mxt-drop-zone--armed")).toBe(false);
        expect(zone.classList.contains("mxt-drop-zone--over")).toBe(false);
    });

    it("returns when put down outside every zone and Return if not dropped is on", () => {
        const x = attribute(0);
        render(<MxTechiesDraggable {...props({ returnIfNotDropped: true, xAttribute: x })} />);
        const node = widget();
        fireEvent.keyDown(node, { key: "Enter" });
        fireEvent.keyDown(node, { key: "ArrowRight" });
        fireEvent.keyDown(node, { key: "Enter" });
        expect(node.style.transform).toBe("translate(0px,0px)");
        expect(x.setValue).toHaveBeenLastCalledWith(new Big(0));
    });

    it("stays inside 'Distance from start' bounds", () => {
        render(<MxTechiesDraggable {...props({ bounds: "offset", boundsRight: 15 })} />);
        const node = widget();
        fireEvent.keyDown(node, { key: "ArrowRight", shiftKey: true });
        expect(node.style.transform).toBe("translate(15px,0px)");
    });

    it("restores and saves the position in the browser when a persist key is set", () => {
        window.localStorage.setItem("mxt-draggable:notes", JSON.stringify({ x: 30, y: 40 }));
        render(<MxTechiesDraggable {...props({ persistKey: dynamic("notes") })} />);
        const node = widget();
        expect(node.style.transform).toBe("translate(30px,40px)");
        fireEvent.keyDown(node, { key: "ArrowUp" });
        expect(JSON.parse(window.localStorage.getItem("mxt-draggable:notes") ?? "{}")).toEqual({ x: 30, y: 30 });
    });

    it("lets bound attributes win over the browser store", () => {
        window.localStorage.setItem("mxt-draggable:notes", JSON.stringify({ x: 30, y: 40 }));
        render(
            <MxTechiesDraggable
                {...props({ persistKey: dynamic("notes"), xAttribute: attribute(5), yAttribute: attribute(6) })}
            />
        );
        expect(widget().style.transform).toBe("translate(5px,6px)");
    });

    it("follows attribute changes made by logic", () => {
        const { rerender } = render(
            <MxTechiesDraggable {...props({ xAttribute: attribute(5), yAttribute: attribute(6) })} />
        );
        rerender(<MxTechiesDraggable {...props({ xAttribute: attribute(50), yAttribute: attribute(60) })} />);
        expect(widget().style.transform).toBe("translate(50px,60px)");
    });

    function pointerDrag(node: HTMLElement, path: Array<[number, number]>): void {
        const [startX, startY] = path[0];
        fireEvent.mouseDown(node, { clientX: startX, clientY: startY, button: 0 });
        path.slice(1).forEach(([clientX, clientY]) => fireEvent.mouseMove(document, { clientX, clientY }));
        const [endX, endY] = path[path.length - 1];
        fireEvent.mouseUp(document, { clientX: endX, clientY: endY });
    }

    it("drags with the mouse, writes the attributes and fires the events in order", () => {
        const x = attribute(0);
        const y = attribute(0);
        const onDragStart = action<ActionValue>();
        const onDragStop = action<ActionValue>();
        render(<MxTechiesDraggable {...props({ xAttribute: x, yAttribute: y, onDragStart, onDragStop })} />);
        const node = widget();
        pointerDrag(node, [
            [0, 0],
            [20, 10],
            [60, 30]
        ]);
        expect(onDragStart.execute).toHaveBeenCalledTimes(1);
        expect(onDragStop.execute).toHaveBeenCalledTimes(1);
        expect(x.setValue).toHaveBeenLastCalledWith(new Big(60));
        expect(y.setValue).toHaveBeenLastCalledWith(new Big(30));
        expect(node.style.transform).toBe("translate(60px,30px)");
    });

    it("highlights the zone under the pointer and runs On drop on release", () => {
        const zone = document.createElement("div");
        zone.className = "drop-zone";
        zone.setAttribute("data-drop-id", "done");
        zone.getBoundingClientRect = () => ({ left: 100, top: 0, width: 100, height: 100 } as DOMRect);
        document.body.appendChild(zone);
        const onDrop = action<NonNullable<MxTechiesDraggableContainerProps["onDrop"]>>();
        render(<MxTechiesDraggable {...props({ dropTargetSelector: ".drop-zone", onDrop })} />);
        const node = widget();

        fireEvent.mouseDown(node, { clientX: 0, clientY: 0, button: 0 });
        fireEvent.mouseMove(document, { clientX: 150, clientY: 50 });
        expect(zone.classList.contains("mxt-drop-zone--over")).toBe(true);
        expect(node.classList.contains("mxt-draggable--over-zone")).toBe(true);
        fireEvent.mouseUp(document, { clientX: 150, clientY: 50 });

        expect(onDrop.execute).toHaveBeenCalledWith({ targetId: "done", x: new Big(50), y: new Big(50) });
        expect(zone.classList.contains("mxt-drop-zone--over")).toBe(false);
    });

    it("does not count a click as a drop", () => {
        const zone = document.createElement("div");
        zone.className = "drop-zone zone-a";
        zone.getBoundingClientRect = () => ({ left: -10, top: -10, width: 100, height: 100 } as DOMRect);
        document.body.appendChild(zone);
        const onDrop = action<NonNullable<MxTechiesDraggableContainerProps["onDrop"]>>();
        render(<MxTechiesDraggable {...props({ dropTargetSelector: ".drop-zone", onDrop })} />);
        pointerDrag(widget(), [
            [0, 0],
            [1, 0]
        ]);
        expect(onDrop.execute).not.toHaveBeenCalled();
    });

    it("returns to the start when released outside every zone", () => {
        const x = attribute(0);
        render(
            <MxTechiesDraggable
                {...props({ returnIfNotDropped: true, xAttribute: x, dropTargetSelector: ".drop-zone" })}
            />
        );
        const node = widget();
        pointerDrag(node, [
            [0, 0],
            [80, 0]
        ]);
        expect(node.style.transform).toBe("translate(0px,0px)");
        expect(x.setValue).toHaveBeenLastCalledWith(new Big(0));
    });

    it("keeps the vertical position when the axis is horizontal only", () => {
        render(<MxTechiesDraggable {...props({ axis: "x" })} />);
        const node = widget();
        pointerDrag(node, [
            [0, 0],
            [40, 40]
        ]);
        expect(node.style.transform).toBe("translate(40px,0px)");
    });
});

describe("MxTechiesDraggable 2.1", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        window.localStorage.clear();
    });

    afterEach(() => {
        act(() => {
            jest.runOnlyPendingTimers();
        });
        jest.useRealTimers();
        document.querySelectorAll(".drop-zone").forEach(zone => zone.remove());
    });

    it("reports every committed move with On position change", () => {
        const onPositionChange = action<ActionValue<any>>();
        render(<MxTechiesDraggable {...props({ onPositionChange })} />);
        fireEvent.keyDown(widget(), { key: "ArrowRight" });
        expect(onPositionChange.execute).toHaveBeenLastCalledWith({ x: new Big(10), y: new Big(0) });
    });

    it("undoes moves with Ctrl+Z when undo is on", () => {
        const x = attribute(0);
        render(<MxTechiesDraggable {...props({ undoEnabled: true, xAttribute: x, yAttribute: attribute(0) })} />);
        const node = widget();
        fireEvent.keyDown(node, { key: "ArrowRight" });
        fireEvent.keyDown(node, { key: "ArrowRight" });
        expect(node.style.transform).toBe("translate(20px,0px)");
        fireEvent.keyDown(node, { key: "z", ctrlKey: true });
        expect(node.style.transform).toBe("translate(10px,0px)");
        fireEvent.keyDown(node, { key: "z", ctrlKey: true });
        expect(node.style.transform).toBe("translate(0px,0px)");
        expect(x.setValue).toHaveBeenLastCalledWith(new Big(0));
    });

    it("ignores Ctrl+Z when undo is off", () => {
        render(<MxTechiesDraggable {...props()} />);
        const node = widget();
        fireEvent.keyDown(node, { key: "ArrowRight" });
        fireEvent.keyDown(node, { key: "z", ctrlKey: true });
        expect(node.style.transform).toBe("translate(10px,0px)");
    });

    it("resets to the default position with Home and with a double-click", () => {
        render(<MxTechiesDraggable {...props({ resetEnabled: true, defaultX: 5, defaultY: 5 })} />);
        const node = widget();
        fireEvent.keyDown(node, { key: "ArrowDown" });
        expect(node.style.transform).toBe("translate(5px,15px)");
        fireEvent.keyDown(node, { key: "Home" });
        expect(node.style.transform).toBe("translate(5px,5px)");
        fireEvent.keyDown(node, { key: "ArrowRight" });
        fireEvent.doubleClick(node);
        expect(node.style.transform).toBe("translate(5px,5px)");
    });

    it("renders resize handles and resizes with Alt + arrows within the limits", () => {
        const width = attribute(100);
        const height = attribute(60);
        const onResize = action<ActionValue<any>>();
        const { container } = render(
            <MxTechiesDraggable
                {...props({ resizable: true, widthAttribute: width, heightAttribute: height, maxWidth: 115, onResize })}
            />
        );
        expect(container.querySelectorAll(".mxt-draggable__resize")).toHaveLength(3);
        const node = widget();
        expect(node.style.width).toBe("100px");
        fireEvent.keyDown(node, { key: "ArrowRight", altKey: true });
        expect(node.style.width).toBe("110px");
        fireEvent.keyDown(node, { key: "ArrowRight", altKey: true });
        expect(node.style.width).toBe("115px");
        fireEvent.keyDown(node, { key: "ArrowDown", altKey: true, shiftKey: true });
        expect(node.style.height).toBe("160px");
        expect(height.setValue).toHaveBeenLastCalledWith(new Big(160));
        expect(onResize.execute).toHaveBeenLastCalledWith({ width: new Big(115), height: new Big(160) });
        // Alt + arrow never moves the content.
        expect(node.style.transform).toBe("translate(0px,0px)");
    });

    it("remembers the size in the browser when there are no size attributes", () => {
        const persistKey = dynamic("card-size");
        const first = render(<MxTechiesDraggable {...props({ resizable: true, persistKey })} />);
        fireEvent.keyDown(widget(), { key: "ArrowDown", altKey: true });
        first.unmount();
        render(<MxTechiesDraggable {...props({ resizable: true, persistKey })} />);
        // jsdom has no layout (natural size 0), so the first step lands on the 40 px minimum.
        expect(widget().style.height).toBe("40px");
    });

    it("marks zones that do not accept the item type while it is picked up", () => {
        const accepting = document.createElement("div");
        accepting.className = "drop-zone";
        accepting.setAttribute("data-accept", "task, bug");
        const refusing = document.createElement("div");
        // Accept classes work like data-accept and are easy to set in Studio Pro.
        refusing.className = "drop-zone accept-invoice";
        document.body.append(accepting, refusing);
        render(<MxTechiesDraggable {...props({ dropTargetSelector: ".drop-zone", dragType: dynamic("Task") })} />);
        fireEvent.keyDown(widget(), { key: "Enter" });
        expect(accepting.classList.contains("mxt-drop-zone--armed")).toBe(true);
        expect(refusing.classList.contains("mxt-drop-zone--rejected")).toBe(true);
        expect(refusing.classList.contains("mxt-drop-zone--armed")).toBe(false);
        fireEvent.keyDown(widget(), { key: "Escape" });
        expect(refusing.classList.contains("mxt-drop-zone--rejected")).toBe(false);
    });

    it("announces with the translatable texts", () => {
        render(<MxTechiesDraggable {...props({ movedText: dynamic("Verschoben nach [x], [y].") })} />);
        fireEvent.keyDown(widget(), { key: "ArrowRight" });
        expect(screen.getByRole("status").textContent).toBe("Verschoben nach 10, 0.");
    });

    it("sets the motion class from the Motion property", () => {
        const { container, rerender } = render(<MxTechiesDraggable {...props({ motion: "subtle" })} />);
        expect(container.querySelector(".mxt-draggable--motion-subtle")).not.toBeNull();
        rerender(<MxTechiesDraggable {...props({ motion: "full", animate: false })} />);
        expect(container.querySelector(".mxt-draggable--motion-off")).not.toBeNull();
    });
});
