import { RenderResult, act, fireEvent, render, screen, within } from "@testing-library/react";
import { Big } from "big.js";
import { ActionValue } from "mendix";
import { ReactElement } from "react";

import { MxTechiesDraggable } from "../MxTechiesDraggable";
import { MxTechiesDraggableContainerProps } from "../../typings/MxTechiesDraggableProps";
import { registrySize } from "../utils/registry";
import { heldCount, resetHeld } from "../utils/sortController";
import { action, attribute, dynamic, numberAttribute, props } from "./testProps";

type Props = MxTechiesDraggableContainerProps;
type Attr<T extends string | boolean | Big> = ReturnType<typeof attribute<T>>;
interface GroupView {
    view: RenderResult;
    selected: Array<Attr<boolean>>;
    onSelectionChange: ReturnType<typeof action<NonNullable<Props["onSelectionChange"]>>>;
}
interface ListView {
    view: RenderResult;
    order: Array<Attr<Big>>;
    onReorder: ReturnType<typeof action<NonNullable<Props["onReorder"]>>>;
}

function items(): HTMLElement[] {
    return screen.getAllByRole("group");
}

function body(node: HTMLElement): HTMLElement {
    return node.querySelector(".mxt-draggable__body") as HTMLElement;
}

function live(node: HTMLElement): string {
    return (node.querySelector("[role='status']")?.textContent ?? "").trim();
}

/** Gives every draggable a layout box: `item-<n>` classes are stacked 60 px apart, 50 px tall. */
function mockLayout(): () => void {
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
        const match = /(?:^|\s)item-(\d+)/.exec(this.className);
        if (match) {
            const n = Number(match[1]);
            return {
                left: 0,
                top: n * 60,
                width: 200,
                height: 50,
                right: 200,
                bottom: n * 60 + 50,
                x: 0,
                y: n * 60,
                toJSON: () => ({})
            } as DOMRect;
        }
        if (this.classList.contains("list")) {
            return {
                left: 0,
                top: 0,
                width: 200,
                height: 400,
                right: 200,
                bottom: 400,
                x: 0,
                y: 0,
                toJSON: () => ({})
            } as DOMRect;
        }
        return original.call(this);
    };
    return () => {
        HTMLElement.prototype.getBoundingClientRect = original;
    };
}

// jsdom has no PointerEvent; a MouseEvent subclass keeps modifier keys and buttons on synthetic presses.
if (typeof window.PointerEvent === "undefined") {
    class PointerEventPolyfill extends MouseEvent {
        pointerId: number;
        pointerType: string;
        constructor(type: string, init: PointerEventInit = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 1;
            this.pointerType = init.pointerType ?? "mouse";
        }
    }
    (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

describe("MxTechiesDraggable 2.2", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        window.localStorage.clear();
    });

    afterEach(() => {
        act(() => {
            jest.runOnlyPendingTimers();
        });
        jest.useRealTimers();
        resetHeld();
    });

    describe("multi-select", () => {
        function renderGroup(extra: Partial<Props> = {}): GroupView {
            const selected = [attribute<boolean>(false), attribute<boolean>(false), attribute<boolean>(false)];
            const onSelectionChange = action<NonNullable<Props["onSelectionChange"]>>();
            const view = render(
                <div className="canvas">
                    {[0, 1, 2].map(i => (
                        <MxTechiesDraggable
                            key={i}
                            {...props({
                                class: `item-${i}`,
                                multiSelect: true,
                                undoEnabled: true,
                                selectedAttribute: selected[i],
                                onSelectionChange,
                                ...extra
                            })}
                        />
                    ))}
                </div>
            );
            return { view, selected, onSelectionChange };
        }

        it("toggles with Ctrl+Space, selects all with Ctrl+A, clears with Escape and announces the count", () => {
            const { selected, onSelectionChange } = renderGroup();
            const [a, b] = items();
            fireEvent.keyDown(a, { key: " ", ctrlKey: true });
            expect(a.classList.contains("mxt-draggable--selected")).toBe(true);
            expect(selected[0].setValue).toHaveBeenLastCalledWith(true);
            expect(live(a)).toBe("1 selected.");
            fireEvent.keyDown(b, { key: "a", ctrlKey: true });
            expect(items().every(n => n.classList.contains("mxt-draggable--selected"))).toBe(true);
            expect(live(b)).toBe("3 selected.");
            expect(onSelectionChange.execute).toHaveBeenLastCalledWith({ count: new Big(3) });
            fireEvent.keyDown(b, { key: "Escape" });
            expect(items().some(n => n.classList.contains("mxt-draggable--selected"))).toBe(false);
            expect(live(b)).toBe("Selection cleared.");
            expect(selected[2].setValue).toHaveBeenLastCalledWith(false);
        });

        it("adds to the selection with Shift+click and narrows it with a plain click", () => {
            renderGroup();
            const [a, b, c] = items();
            fireEvent.pointerDown(a, { button: 0, pointerType: "mouse" });
            fireEvent.pointerDown(b, { button: 0, pointerType: "mouse", shiftKey: true });
            expect([a, b, c].map(n => n.classList.contains("mxt-draggable--selected"))).toEqual([true, true, false]);
            // A plain press on a selected item keeps the group (so it can be dragged together) ...
            fireEvent.pointerDown(a, { button: 0, pointerType: "mouse" });
            fireEvent.mouseDown(a, { clientX: 0, clientY: 0, button: 0 });
            fireEvent.mouseUp(document, { clientX: 0, clientY: 0 });
            // ... and a click without moving narrows it to that item.
            expect([a, b, c].map(n => n.classList.contains("mxt-draggable--selected"))).toEqual([true, false, false]);
            const describedBy = a.getAttribute("aria-describedby") ?? "";
            expect(describedBy.split(" ").some(id => document.getElementById(id)?.textContent === "Selected.")).toBe(
                true
            );
        });

        it("moves every selected item with the arrow keys and undoes the group move in one step", () => {
            renderGroup();
            const [a, b, c] = items();
            fireEvent.keyDown(a, { key: " ", ctrlKey: true });
            fireEvent.keyDown(b, { key: " ", ctrlKey: true });
            fireEvent.keyDown(a, { key: "ArrowRight" });
            expect(a.style.transform).toBe("translate(10px,0px)");
            expect(b.style.transform).toBe("translate(10px,0px)");
            expect(c.style.transform).toBe("translate(0px,0px)");
            expect(live(a)).toBe("Moved 2 items.");
            fireEvent.keyDown(b, { key: "z", ctrlKey: true });
            expect(a.style.transform).toBe("translate(0px,0px)");
            expect(b.style.transform).toBe("translate(0px,0px)");
        });

        it("drags the whole selection with the pointer", () => {
            const x = [numberAttribute(0), numberAttribute(0)];
            render(
                <div>
                    {[0, 1].map(i => (
                        <MxTechiesDraggable
                            key={i}
                            {...props({
                                class: `item-${i}`,
                                multiSelect: true,
                                xAttribute: x[i],
                                yAttribute: numberAttribute(0)
                            })}
                        />
                    ))}
                </div>
            );
            const [a, b] = items();
            fireEvent.keyDown(a, { key: "a", ctrlKey: true });
            fireEvent.pointerDown(a, { button: 0, pointerType: "mouse" });
            fireEvent.mouseDown(a, { clientX: 0, clientY: 0, button: 0 });
            fireEvent.mouseMove(document, { clientX: 30, clientY: 20 });
            expect(b.classList.contains("mxt-draggable--following")).toBe(true);
            expect(b.style.transform).toBe("translate(30px,20px)");
            fireEvent.mouseUp(document, { clientX: 30, clientY: 20 });
            expect(x[0].setValue).toHaveBeenLastCalledWith(new Big(30));
            expect(x[1].setValue).toHaveBeenLastCalledWith(new Big(30));
            expect(b.classList.contains("mxt-draggable--following")).toBe(false);
        });

        it("unregisters on unmount", () => {
            const { view } = renderGroup();
            expect(registrySize()).toBe(3);
            view.unmount();
            expect(registrySize()).toBe(0);
        });
    });

    describe("rotation and z-order", () => {
        it("rotates with ] and [ , writes the attribute and runs On rotate", () => {
            const rotationAttribute = numberAttribute(0);
            const onRotate = action<NonNullable<Props["onRotate"]>>();
            render(<MxTechiesDraggable {...props({ rotatable: true, rotationAttribute, onRotate })} />);
            const node = items()[0];
            fireEvent.keyDown(node, { key: "]", code: "BracketRight" });
            expect(body(node).style.rotate).toBe("15deg");
            expect(rotationAttribute.setValue).toHaveBeenLastCalledWith(new Big(15));
            expect(onRotate.execute).toHaveBeenLastCalledWith({ angle: new Big(15) });
            fireEvent.keyDown(node, { key: "{", code: "BracketLeft", shiftKey: true });
            expect(body(node).style.rotate).toBe("14deg");
            expect(live(node)).toBe("Rotated to 14 degrees.");
            expect(node.querySelector(".mxt-draggable__rotate")).not.toBeNull();
        });

        it("rolls a rotation back and offers a retry when the attribute is read-only", () => {
            const rotationAttribute = numberAttribute(0, true);
            render(<MxTechiesDraggable {...props({ rotatable: true, rotationAttribute })} />);
            const node = items()[0];
            fireEvent.keyDown(node, { key: "]", code: "BracketRight" });
            expect(body(node).style.rotate).toBe("");
            const alert = within(node).getByRole("alert");
            expect(alert.textContent).toContain("could not be saved");
            expect(within(alert).getByText("Retry")).toBeTruthy();
            fireEvent.click(within(alert).getByText("Dismiss"));
            expect(within(node).queryByRole("alert")).toBeNull();
        });

        it("changes the layer with the design tool shortcuts and normalises the group", () => {
            const z = [numberAttribute(undefined), numberAttribute(undefined), numberAttribute(undefined)];
            const onZOrderChange = action<NonNullable<Props["onZOrderChange"]>>();
            render(
                <div>
                    {[0, 1, 2].map(i => (
                        <MxTechiesDraggable
                            key={i}
                            {...props({
                                class: `item-${i}`,
                                zOrder: true,
                                zIndexAttribute: z[i],
                                onZOrderChange,
                                undoEnabled: true
                            })}
                        />
                    ))}
                </div>
            );
            const [a, b, c] = items();
            fireEvent.keyDown(a, { key: "}", code: "BracketRight", ctrlKey: true, shiftKey: true });
            expect(z[0].setValue).toHaveBeenLastCalledWith(new Big(3));
            expect(z[1].setValue).toHaveBeenLastCalledWith(new Big(1));
            expect(z[2].setValue).toHaveBeenLastCalledWith(new Big(2));
            expect(a.style.zIndex).toBe("3");
            expect(live(a)).toBe("Layer 3 of 3.");
            fireEvent.keyDown(c, { key: "[", code: "BracketLeft", ctrlKey: true });
            expect(c.style.zIndex).toBe("1");
            expect(b.style.zIndex).toBe("2");
            expect(onZOrderChange.execute).toHaveBeenCalled();
            fireEvent.keyDown(c, { key: "z", ctrlKey: true });
            expect(c.style.zIndex).toBe("2");
            expect(b.style.zIndex).toBe("1");
        });

        it("opens the item menu with the keyboard and runs an entry", () => {
            render(
                <div>
                    {[0, 1].map(i => (
                        <MxTechiesDraggable
                            key={i}
                            {...props({ class: `item-${i}`, zOrder: true, rotatable: true, contextMenu: true })}
                        />
                    ))}
                </div>
            );
            const [a] = items();
            fireEvent.keyDown(a, { key: "F10", shiftKey: true });
            const menu = screen.getByRole("menu", { name: "Item actions" });
            const entries = within(menu).getAllByRole("menuitem");
            expect(entries.map(e => e.textContent?.replace(/Ctrl.*|\[|\]/g, "").trim())).toEqual([
                "Bring to front",
                "Bring forward",
                "Send backward",
                "Send to back",
                "Rotate left",
                "Rotate right",
                "Reset rotation"
            ]);
            expect(document.activeElement).toBe(entries[0]);
            fireEvent.keyDown(menu, { key: "ArrowDown" });
            expect(document.activeElement).toBe(entries[1]);
            fireEvent.keyDown(menu, { key: "End" });
            expect(document.activeElement).toBe(entries[5]); // "Reset rotation" is disabled at 0 degrees
            fireEvent.click(entries[0]);
            expect(screen.queryByRole("menu")).toBeNull();
            expect(a.style.zIndex).toBe("2");
            fireEvent.contextMenu(a, { clientX: 5, clientY: 5 });
            expect(screen.getByRole("menu")).toBeTruthy();
            fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
            expect(screen.queryByRole("menu")).toBeNull();
        });
    });

    describe("layout snapshots", () => {
        it("saves, restores and undoes a snapshot through the command attribute", () => {
            const store = attribute<string>("");
            const command = attribute<string>("");
            const onSnapshot = action<NonNullable<Props["onSnapshot"]>>();
            const make = (cmd: string): ReactElement => {
                (command as { value?: string }).value = cmd;
                return (
                    <div>
                        <MxTechiesDraggable
                            {...props({
                                class: "item-0",
                                snapshotsEnabled: true,
                                undoEnabled: true,
                                itemKey: dynamic("first"),
                                snapshotAttribute: store,
                                layoutCommand: command,
                                onSnapshot
                            })}
                        />
                        <MxTechiesDraggable
                            {...props({
                                class: "item-1",
                                snapshotsEnabled: true,
                                undoEnabled: true,
                                itemKey: dynamic("second")
                            })}
                        />
                    </div>
                );
            };
            const view = render(make(""));
            const [a, b] = items();
            fireEvent.keyDown(a, { key: "ArrowRight" });
            view.rerender(make("save Morning"));
            act(() => {
                jest.advanceTimersByTime(1);
            });
            expect(command.setValue).toHaveBeenLastCalledWith("");
            const saved = JSON.parse(store.value ?? "{}");
            expect(saved.snapshots.Morning.items).toEqual({ first: { x: 10, y: 0 }, second: { x: 0, y: 0 } });
            expect(onSnapshot.execute).toHaveBeenLastCalledWith(
                expect.objectContaining({ operation: "save", name: "Morning" })
            );

            fireEvent.keyDown(a, { key: "ArrowDown" });
            fireEvent.keyDown(b, { key: "ArrowDown" });
            view.rerender(make("restore Morning"));
            act(() => {
                jest.advanceTimersByTime(1);
            });
            expect(a.style.transform).toBe("translate(10px,0px)");
            expect(b.style.transform).toBe("translate(0px,0px)");
            expect(live(a)).toBe("Layout Morning restored.");
            fireEvent.keyDown(b, { key: "z", ctrlKey: true });
            expect(a.style.transform).toBe("translate(10px,10px)");
            expect(b.style.transform).toBe("translate(0px,10px)");

            view.rerender(make("restore Nope"));
            act(() => {
                jest.advanceTimersByTime(1);
            });
            expect(live(a)).toBe("There is no layout called Nope.");
        });

        it("keeps snapshots in the browser without an attribute and resets to a snapshot", () => {
            render(
                <MxTechiesDraggable
                    {...props({
                        snapshotsEnabled: true,
                        contextMenu: true,
                        resetEnabled: true,
                        resetSnapshot: "Snapshot 1",
                        groupName: "board"
                    })}
                />
            );
            const node = items()[0];
            fireEvent.keyDown(node, { key: "ArrowRight" });
            fireEvent.keyDown(node, { key: "ContextMenu" });
            fireEvent.click(screen.getByText("Save layout snapshot"));
            expect(window.localStorage.getItem("mxt-draggable:layout:board")).toContain("Snapshot 1");
            fireEvent.keyDown(node, { key: "ArrowRight" });
            fireEvent.keyDown(node, { key: "Home" });
            expect(node.style.transform).toBe("translate(10px,0px)");
            fireEvent.keyDown(node, { key: "ContextMenu" });
            expect(screen.getByText("Restore Snapshot 1")).toBeTruthy();
        });
    });

    describe("reliability", () => {
        it("puts the item back and shows a retry message when the position cannot be saved", () => {
            const x = numberAttribute(0, true);
            const y = numberAttribute(0, true);
            const onPositionChange = action<NonNullable<Props["onPositionChange"]>>();
            render(<MxTechiesDraggable {...props({ xAttribute: x, yAttribute: y, onPositionChange })} />);
            const node = items()[0];
            fireEvent.keyDown(node, { key: "ArrowRight" });
            expect(node.style.transform).toBe("translate(0px,0px)");
            expect(x.setValue).not.toHaveBeenCalled();
            expect(onPositionChange.execute).not.toHaveBeenCalled();
            const alert = within(node).getByRole("alert");
            expect(alert.textContent).toContain("This change could not be saved, so it was undone.");
            // Once writable, Retry applies the change.
            (x as { readOnly: boolean }).readOnly = false;
            (y as { readOnly: boolean }).readOnly = false;
            fireEvent.click(within(alert).getByText("Retry"));
            expect(x.setValue).toHaveBeenLastCalledWith(new Big(10));
            expect(node.style.transform).toBe("translate(10px,0px)");
            expect(within(node).queryByRole("alert")).toBeNull();
        });

        it("shows a busy state while an action runs", () => {
            const onDragStop = { canExecute: true, isExecuting: true, execute: jest.fn() } as unknown as ActionValue;
            render(<MxTechiesDraggable {...props({ onDragStop })} />);
            const node = items()[0];
            expect(node.getAttribute("aria-busy")).toBe("true");
            expect(node.classList.contains("mxt-draggable--saving")).toBe(true);
        });

        it("contains a failing content widget behind a retry", () => {
            const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
            let fail = true;
            function Boom(): ReactElement {
                if (fail) {
                    throw new Error("boom");
                }
                return <span>Recovered</span>;
            }
            render(<MxTechiesDraggable {...props({ content: <Boom /> })} />);
            const alert = screen.getByRole("alert");
            expect(alert.textContent).toContain("This item could not be shown.");
            fail = false;
            fireEvent.click(within(alert).getByText("Try again"));
            expect(screen.getByText("Recovered")).toBeTruthy();
            spy.mockRestore();
        });

        it("keeps 2.1 pages unchanged: no new classes, roles or styles by default", () => {
            render(<MxTechiesDraggable {...props()} />);
            const node = items()[0];
            ["selectable", "sortable", "rotatable", "long-press", "saving"].forEach(name =>
                expect(node.classList.contains(`mxt-draggable--${name}`)).toBe(false)
            );
            expect(node.style.zIndex).toBe("");
            expect(node.style.rotate).toBe("");
            expect(node.getAttribute("aria-roledescription")).toBe("draggable");
        });
    });

    describe("sortable list", () => {
        let restore: () => void;
        beforeEach(() => {
            restore = mockLayout();
        });
        afterEach(() => restore());

        function renderList(extra: Partial<Props> = {}): ListView {
            const order = [numberAttribute(1), numberAttribute(2), numberAttribute(3)];
            const onReorder = action<NonNullable<Props["onReorder"]>>();
            const view = render(
                <div className="list" data-sort-id="todo">
                    {[0, 1, 2].map(i => (
                        <MxTechiesDraggable
                            key={i}
                            {...props({
                                class: `item-${i}`,
                                sortMode: "list",
                                orderAttribute: order[i],
                                orderOffset: 1,
                                onReorder,
                                ...extra
                            })}
                        />
                    ))}
                </div>
            );
            return { view, order, onReorder };
        }

        it("lifts with Space, moves with the arrows, drops with Space and reports the reorder", () => {
            const { order, onReorder } = renderList();
            const [a, b, c] = items();
            expect(a.getAttribute("aria-roledescription")).toBe("sortable item");
            fireEvent.keyDown(a, { key: " " });
            expect(live(a)).toContain("Lifted. Position 1 of 3.");
            fireEvent.keyDown(a, { key: "ArrowDown" });
            expect(live(a)).toBe("Position 2 of 3.");
            expect(a.style.transform).toBe("translate(0px,60px)");
            expect(b.style.transform).toBe("translate(0px,-60px)");
            expect(c.style.transform).toBe("translate(0px,0px)");
            fireEvent.keyDown(a, { key: " " });
            expect(order[0].setValue).toHaveBeenLastCalledWith(new Big(2));
            expect(order[1].setValue).toHaveBeenLastCalledWith(new Big(1));
            expect(order[2].setValue).not.toHaveBeenCalled();
            expect(onReorder.execute).toHaveBeenCalledWith({
                oldIndex: new Big(0),
                newIndex: new Big(1),
                containerId: "todo",
                fromContainerId: "todo"
            });
            expect(live(a)).toBe("Dropped at position 2 of 3.");
            expect(heldCount()).toBe(1);
        });

        it("cancels a lift with Escape", () => {
            const { order } = renderList();
            const [a, b] = items();
            fireEvent.keyDown(a, { key: " " });
            fireEvent.keyDown(a, { key: "End" });
            expect(a.style.transform).toBe("translate(0px,120px)");
            fireEvent.keyDown(a, { key: "Escape" });
            expect(a.style.transform).toBe("translate(0px,0px)");
            expect(b.style.transform).toBe("translate(0px,0px)");
            expect(order[0].setValue).not.toHaveBeenCalled();
            expect(live(a)).toBe("Reorder cancelled. Back at position 1.");
        });

        it("rolls the order back with a retry message when the list does not confirm it in time", () => {
            const { order } = renderList({ sortTimeout: 1000 });
            const [a, b] = items();
            fireEvent.keyDown(a, { key: " " });
            fireEvent.keyDown(a, { key: "ArrowDown" });
            fireEvent.keyDown(a, { key: " " });
            act(() => {
                jest.advanceTimersByTime(1100);
            });
            expect(b.style.transform).toBe("translate(0px,0px)");
            expect(order[0].setValue).toHaveBeenLastCalledWith(new Big(1));
            expect(order[1].setValue).toHaveBeenLastCalledWith(new Big(2));
            const alert = within(a).getByRole("alert");
            expect(alert.textContent).toContain("The new order was not saved");
            fireEvent.click(within(alert).getByText("Retry"));
            expect(order[0].setValue).toHaveBeenLastCalledWith(new Big(2));
            expect(b.style.transform).toBe("translate(0px,-60px)");
        });

        it("moves with the item menu (a single-click alternative to dragging)", () => {
            const { onReorder } = renderList({ contextMenu: true });
            const [, b] = items();
            fireEvent.keyDown(b, { key: "ContextMenu" });
            const menu = screen.getByRole("menu");
            expect((within(menu).getByText("Move up").closest("button") as HTMLButtonElement).disabled).toBe(false);
            fireEvent.click(within(menu).getByText("Move to end"));
            expect(onReorder.execute).toHaveBeenCalledWith(
                expect.objectContaining({ oldIndex: new Big(1), newIndex: new Big(2) })
            );
        });

        it("is not positioned freely: arrows without a lift do nothing", () => {
            renderList();
            const [a] = items();
            fireEvent.keyDown(a, { key: "ArrowRight" });
            expect(a.style.transform).toBe("translate(0px,0px)");
        });
    });
});
