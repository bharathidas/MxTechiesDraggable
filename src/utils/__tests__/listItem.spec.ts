import {
    DRAGGING_Z,
    LIST_ITEM_DRAGGING,
    LIST_ITEM_RAISED,
    RESTING_Z,
    liftListItem,
    liftZIndex,
    listItemOf
} from "../listItem";

function listView(): { rows: HTMLElement[]; widgets: HTMLElement[] } {
    document.body.innerHTML = "";
    const view = document.createElement("div");
    view.className = "mx-listview";
    const ul = document.createElement("ul");
    view.appendChild(ul);
    const rows: HTMLElement[] = [];
    const widgets: HTMLElement[] = [];
    for (let i = 0; i < 3; i++) {
        const li = document.createElement("li");
        li.className = "mx-listview-item";
        const dataView = document.createElement("div");
        dataView.className = "mx-dataview";
        const widget = document.createElement("div");
        widget.className = "mxt-draggable";
        dataView.appendChild(widget);
        li.appendChild(dataView);
        ul.appendChild(li);
        rows.push(li);
        widgets.push(widget);
    }
    document.body.appendChild(view);
    return { rows, widgets };
}

describe("list rows (2.0)", () => {
    it("finds the row through a data view", () => {
        const { rows, widgets } = listView();
        expect(listItemOf(widgets[1])).toBe(rows[1]);
    });

    it("finds rows of galleries, template grids and marked containers, and nothing outside a list", () => {
        document.body.innerHTML =
            '<div class="widget-gallery-item"><div id="a"></div></div><div class="mx-templategrid-item"><div id="b"></div></div>' +
            '<div data-mxt-list-item><div id="c"></div></div><div><div id="d"></div></div>';
        expect(listItemOf(document.getElementById("a"))?.className).toBe("widget-gallery-item");
        expect(listItemOf(document.getElementById("b"))?.className).toBe("mx-templategrid-item");
        expect(listItemOf(document.getElementById("c"))?.hasAttribute("data-mxt-list-item")).toBe(true);
        expect(listItemOf(document.getElementById("d"))).toBeNull();
        expect(listItemOf(null)).toBeNull();
    });

    it("lifts the dragged row above the others, stops it clipping, and lowers it to resting after the drop", () => {
        const { rows } = listView();
        liftListItem(rows[0], "w1", "dragging");
        expect(rows[0].style.overflow).toBe("visible");
        expect(rows[0].style.position).toBe("relative");
        expect(rows[0].style.zIndex).toBe(String(DRAGGING_Z));
        expect(rows[0].classList.contains(LIST_ITEM_DRAGGING)).toBe(true);
        liftListItem(rows[0], "w1", "resting");
        expect(rows[0].style.zIndex).toBe(String(RESTING_Z));
        expect(rows[0].classList.contains(LIST_ITEM_RAISED)).toBe(true);
        expect(rows[0].classList.contains(LIST_ITEM_DRAGGING)).toBe(false);
        expect(rows[1].className).toBe("mx-listview-item");
    });

    it("gives the draggable a z-index above the rows, keeping a higher z-order of its own", () => {
        expect(liftZIndex("dragging", undefined)).toBe(DRAGGING_Z);
        expect(liftZIndex("resting", undefined)).toBe(RESTING_Z);
        expect(liftZIndex("resting", 7)).toBe(7);
        expect(liftZIndex("dragging", 5000)).toBe(5000);
        expect(liftZIndex("none", 3)).toBe(3);
        expect(liftZIndex("none", undefined)).toBeUndefined();
    });

    it("restores the row's own inline styles exactly", () => {
        const { rows } = listView();
        rows[2].style.overflow = "hidden";
        rows[2].style.zIndex = "5";
        liftListItem(rows[2], "w", "dragging");
        expect(rows[2].style.overflow).toBe("visible");
        liftListItem(rows[2], "w", "none");
        expect(rows[2].style.overflow).toBe("hidden");
        expect(rows[2].style.zIndex).toBe("5");
        expect(rows[2].style.position).toBe("");
        expect(rows[2].classList.contains(LIST_ITEM_RAISED)).toBe(false);
    });

    it("keeps the strongest request when one row holds several draggables", () => {
        const { rows } = listView();
        liftListItem(rows[1], "a", "resting");
        liftListItem(rows[1], "b", "dragging");
        expect(rows[1].classList.contains(LIST_ITEM_DRAGGING)).toBe(true);
        expect(rows[1].style.zIndex).toBe(String(DRAGGING_Z));
        liftListItem(rows[1], "b", "none");
        expect(rows[1].style.zIndex).toBe(String(RESTING_Z));
        expect(rows[1].classList.contains(LIST_ITEM_DRAGGING)).toBe(false);
        expect(rows[1].classList.contains(LIST_ITEM_RAISED)).toBe(true);
        liftListItem(rows[1], "a", "none");
        expect(rows[1].classList.contains(LIST_ITEM_RAISED)).toBe(false);
        expect(rows[1].style.overflow).toBe("");
    });

    it("ignores a missing row and 'none' for a row it never lifted", () => {
        const { rows } = listView();
        expect(() => liftListItem(null, "x", "dragging")).not.toThrow();
        liftListItem(rows[0], "x", "none");
        expect(rows[0].getAttribute("style")).toBeNull();
    });
});
