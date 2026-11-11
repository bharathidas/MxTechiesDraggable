// 2.2 browser suite: multi-select, lasso, sortable lists and grids, smart guides, rotation, z-order, drop previews,
// touch long-press, layout snapshots, reliability, memory, WCAG checks. Run after build.mjs: node harness/test-v22.mjs
import puppeteer from "puppeteer-core";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const pageUrl = pathToFileURL(fileURLToPath(new URL("index.html", import.meta.url))).href;

let passed = 0;
let failed = 0;
const notes = [];
function check(name, ok, detail = "") {
    if (ok) {
        passed++;
        console.log(`PASS ${name}`);
    } else {
        failed++;
        console.log(`FAIL ${name}${detail ? ` - ${detail}` : ""}`);
    }
}

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--js-flags=--expose-gc"]
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => {
    if (message.type() === "error") {
        errors.push(message.text());
    }
});
// Record vibrations (haptic feedback) without a real device.
await page.evaluateOnNewDocument(() => {
    window.__vibrations = [];
    Object.defineProperty(navigator, "vibrate", {
        configurable: true,
        value: pattern => {
            window.__vibrations.push(pattern);
            return true;
        }
    });
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function open(cfg, width = 1100, height = 900, extra = {}) {
    await page.setViewport({ width, height, ...extra });
    await page.goto(`${pageUrl}?cfg=${encodeURIComponent(JSON.stringify(cfg))}`);
    await page.waitForSelector(".mxt-draggable");
    await sleep(120);
}
const box = async selector => (await page.$(selector)).boundingBox();
const events = (name, item) =>
    page.evaluate((n, i) => window.harness.events.filter(e => e.name === n && (!i || e.item === i)), name, item);
const store = () => page.evaluate(() => JSON.parse(JSON.stringify(window.harness.store)));
const transformOf = selector => page.$eval(selector, el => el.style.transform.replace(/\s+/g, ""));
const classes = selector => page.$eval(selector, el => el.className);
const liveText = selector => page.$eval(`${selector} [role='status']`, el => el.textContent.trim());

async function drag(selector, dx, dy, { steps = 12, hold = 0, at = [20, 20], before } = {}) {
    const b = await box(selector);
    const x = b.x + at[0];
    const y = b.y + at[1];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps });
    if (before) {
        await before();
    }
    if (hold) {
        await sleep(hold);
    }
    await page.mouse.up();
    await sleep(120);
}

async function shiftClick(selector) {
    const b = await box(selector);
    await page.keyboard.down("Shift");
    await page.mouse.click(b.x + 10, b.y + 10);
    await page.keyboard.up("Shift");
    await sleep(40);
}

function luminance([r, g, b]) {
    const c = [r, g, b].map(v => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(fg, bg) {
    const parse = s => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const a = luminance(parse(fg));
    const b = luminance(parse(bg));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const free = (id, props = {}, extra = {}) => ({ id, props: { animate: false, ...props }, ...extra });

try {
    // 1 - multi-select, group drag, group keyboard moves, selection announcements
    {
        const common = { multiSelect: true, undoEnabled: true, bounds: "parent" };
        await open({
            items: [
                free("a", { ...common, defaultX: 0 }, { attrs: { xAttribute: 0, yAttribute: 0 } }),
                free("b", { ...common, defaultX: 150 }, { attrs: { xAttribute: 150, yAttribute: 0 } }),
                free("c", { ...common, defaultX: 300 })
            ]
        });
        await shiftClick(".item-a");
        await shiftClick(".item-b");
        check(
            "Shift+click selects several items",
            (await classes(".item-a")).includes("mxt-draggable--selected") &&
                (await classes(".item-b")).includes("mxt-draggable--selected") &&
                !(await classes(".item-c")).includes("mxt-draggable--selected")
        );
        check("the selection count is announced", (await liveText(".item-b")) === "2 selected.", await liveText(".item-b"));
        await drag(".item-a", 40, 30);
        const s = await store();
        check("dragging a selected item moves the whole selection", s.a.xAttribute === 40 && s.b.xAttribute === 190 && s.b.yAttribute === 30, JSON.stringify(s));
        check("unselected items stay put", (await transformOf(".item-c")) === "translate(300px,0px)", await transformOf(".item-c"));
        await page.focus(".item-a");
        await page.keyboard.press("ArrowDown");
        await sleep(60);
        const s2 = await store();
        check("arrow keys move every selected item", s2.a.yAttribute === 40 && s2.b.yAttribute === 40, JSON.stringify(s2));
        await page.keyboard.down("Control");
        await page.keyboard.press("z");
        await page.keyboard.press("z");
        await page.keyboard.up("Control");
        await sleep(60);
        const s3 = await store();
        check("one Ctrl+Z per group move restores the whole group", s3.a.xAttribute === 0 && s3.a.yAttribute === 0 && s3.b.xAttribute === 150, JSON.stringify(s3));
        // Group moves are clamped so no member leaves its bounds.
        await drag(".item-a", -200, 0);
        const s4 = await store();
        check("a group move stops when a member reaches its bounds", s4.a.xAttribute === 0 && s4.b.xAttribute === 150, JSON.stringify(s4));
    }

    // 2 - lasso
    {
        const common = { multiSelect: true, lasso: true, lassoSelector: ".area" };
        await open({
            items: [free("a", { ...common, defaultX: 20, defaultY: 20 }), free("b", { ...common, defaultX: 200, defaultY: 20 }), free("c", { ...common, defaultX: 400, defaultY: 200 })]
        });
        const area = await box(".area");
        await page.mouse.move(area.x + 5, area.y + 5);
        await page.mouse.down();
        await page.mouse.move(area.x + 340, area.y + 100, { steps: 8 });
        const band = await page.$(".mxt-lasso");
        await page.mouse.up();
        await sleep(60);
        check("dragging on the background draws a lasso", !!band);
        check(
            "the lasso selects the items it touches",
            (await classes(".item-a")).includes("--selected") && (await classes(".item-b")).includes("--selected") && !(await classes(".item-c")).includes("--selected")
        );
        check("the lasso band is removed after release", !(await page.$(".mxt-lasso")));
        await page.mouse.click(area.x + 580, area.y + 340);
        await sleep(60);
        check("a click on the background clears the selection", !(await page.$(".mxt-draggable--selected")));
    }

    // 3 - sortable vertical list: pointer, FLIP displacement, placeholder, data source refresh
    {
        const listProps = { sortMode: "list", sortContainerSelector: ".sort-list", animate: true, motion: "full" };
        const mk = (id, list, extra = {}) => ({ id, in: list, props: { ...listProps, ...extra }, attrs: { orderAttribute: 0 }, actions: ["onReorder"], expr: { itemKey: id } });
        await open({ lists: [{ id: "todo" }], autoReorder: true, items: [mk("a", "todo"), mk("b", "todo"), mk("c", "todo")] });
        const a = await box(".item-a");
        await page.mouse.move(a.x + 20, a.y + 20);
        await page.mouse.down();
        await page.mouse.move(a.x + 20, a.y + 20 + 80, { steps: 10 });
        await sleep(300);
        const placeholder = await page.$(".mxt-drop-ghost--placeholder");
        const bMid = await transformOf(".item-b");
        check("a placeholder shows where the item will land", !!placeholder);
        check("the next item makes room (displaced up)", /translate\(0px,-\d+px\)/.test(bMid), bMid);
        check("displaced items animate", (await classes(".item-b")).includes("mxt-draggable--displaced"));
        await page.mouse.up();
        await sleep(120);
        const reorder = await events("onReorder", "a");
        check("On reorder gets old and new index and the list ids", reorder.length === 1 && reorder[0].args.oldIndex === 0 && reorder[0].args.newIndex === 1 && reorder[0].args.containerId === "todo" && reorder[0].args.fromContainerId === "todo", JSON.stringify(reorder));
        const s = await store();
        check("order attributes are written for every moved item", s.a.orderAttribute === 1 && s.b.orderAttribute === 0, JSON.stringify(s));
        await sleep(500);
        check("the list re-rendered in the new order", JSON.stringify(await page.evaluate(() => window.harness.order("todo"))) === '["b","a","c"]');
        const transforms = await Promise.all(["a", "b", "c"].map(id => transformOf(`.item-${id}`)));
        check("after the refresh every offset is back to 0 (FLIP)", transforms.every(t => t === "translate(0px,0px)"), transforms.join(" "));
        check("nothing stays held after the refresh", (await page.evaluate(() => window.harness.counts().held)) === 0);

        // keyboard reorder
        await page.focus(".item-c");
        await page.keyboard.press("Space");
        await sleep(40);
        check("Space lifts with an announcement", (await liveText(".item-c")).startsWith("Lifted. Position 3 of 3."), await liveText(".item-c"));
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("ArrowUp");
        await sleep(60);
        check("arrows announce the new position", (await liveText(".item-c")) === "Position 1 of 3.", await liveText(".item-c"));
        await page.keyboard.press("Space");
        await sleep(500);
        const kr = await events("onReorder", "c");
        check("Space drops and reports the keyboard reorder", kr.length === 1 && kr[0].args.oldIndex === 2 && kr[0].args.newIndex === 0, JSON.stringify(kr));
        check("the keyboard reorder is applied", JSON.stringify(await page.evaluate(() => window.harness.order("todo"))) === '["c","b","a"]');
        check("focus stays on the moved item", await page.evaluate(() => document.activeElement?.classList.contains("item-c")));
    }

    // 4 - cross-container move into an empty list
    {
        const listProps = { sortMode: "list", sortContainerSelector: ".sort-list", sortCrossContainer: true, animate: false };
        await open({
            lists: [{ id: "todo" }, { id: "done" }],
            autoReorder: true,
            items: ["a", "b"].map(id => ({ id, in: "todo", props: listProps, actions: ["onReorder"] }))
        });
        const a = await box(".item-a");
        const done = await box("[data-sort-id='done']");
        await page.mouse.move(a.x + 20, a.y + 20);
        await page.mouse.down();
        await page.mouse.move(done.x + 40, done.y + 30, { steps: 12 });
        await sleep(100);
        const ghost = await box(".mxt-drop-ghost--placeholder");
        check("the placeholder moves into the other (empty) list", ghost && ghost.x >= done.x - 1 && ghost.x < done.x + done.width, JSON.stringify(ghost));
        await page.mouse.up();
        await sleep(500);
        const r = await events("onReorder", "a");
        check("On reorder reports the target and source list", r.length === 1 && r[0].args.containerId === "done" && r[0].args.fromContainerId === "todo" && r[0].args.newIndex === 0, JSON.stringify(r));
        check("the item now renders in the other list", JSON.stringify(await page.evaluate(() => window.harness.order("done"))) === '["a"]');
        await page.focus(".item-b");
        await page.keyboard.press("Space");
        await page.keyboard.press("PageDown");
        await sleep(40);
        check("PageDown moves a lifted item to the next list", (await liveText(".item-b")).startsWith("Moved to done"), await liveText(".item-b"));
        await page.keyboard.press("Escape");
    }

    // 5 - rollback when the list does not confirm the order
    {
        const listProps = { sortMode: "list", sortContainerSelector: ".sort-list", sortTimeout: 1000, animate: false };
        await open({ lists: [{ id: "todo" }], items: ["a", "b", "c"].map(id => ({ id, in: "todo", props: listProps, actions: ["onReorder"], attrs: { orderAttribute: 0 } })) });
        await page.focus(".item-a");
        await page.keyboard.press("Space");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Space");
        await sleep(200);
        check("the new order is held on screen while waiting", (await transformOf(".item-b")) !== "translate(0px,0px)");
        await sleep(1200);
        const alert = await page.$(".item-a [role='alert']");
        check("without confirmation the order rolls back with a message", !!alert && (await transformOf(".item-b")) === "translate(0px,0px)");
        check("the rollback restores the order attributes", (await store()).a.orderAttribute === 0, JSON.stringify(await store()));
        await page.click(".item-a .mxt-draggable__notice-button");
        await sleep(100);
        check("Retry applies the move again", (await events("onReorder", "a")).length === 2 && (await store()).a.orderAttribute === 1);
    }

    // 6 - wrapping grid
    {
        const gridProps = { sortMode: "grid", sortContainerSelector: ".sort-list", animate: false };
        await open({ lists: [{ id: "g", className: "grid" }], items: ["a", "b", "c", "d", "e", "f"].map(id => ({ id, in: "g", props: gridProps, actions: ["onReorder"] })) });
        const a = await box(".item-a");
        const e = await box(".item-e");
        await drag(".item-a", e.x - a.x, e.y - a.y, { steps: 14 });
        const r = await events("onReorder", "a");
        check("a grid item moves to the cell under it (row and column)", r.length === 1 && r[0].args.newIndex === 4, JSON.stringify(r));
        await page.focus(".item-f");
        await page.keyboard.press("Space");
        await page.keyboard.press("ArrowUp");
        await sleep(40);
        const columns = await page.evaluate(() => {
            const tops = [...document.querySelectorAll(".sort-list .mxt-draggable")].map(n => Math.round(n.getBoundingClientRect().top));
            return tops.filter(t => t === tops[0]).length;
        });
        check("ArrowUp in a grid moves one row up", (await liveText(".item-f")) === `Position ${6 - columns} of 6.`, `${await liveText(".item-f")} columns=${columns}`);
        await page.keyboard.press("Escape");
    }

    // 7 - smart guides: equal spacing
    {
        const p = { snapToSiblings: true, equalSpacing: true, bounds: "parent", animate: false };
        await open({ items: [free("a", { ...p, defaultX: 0, defaultY: 100 }), free("b", { ...p, defaultX: 300, defaultY: 100 }), free("c", { ...p, defaultX: 0, defaultY: 250 })] });
        const a = await box(".item-a");
        const b = await box(".item-b");
        const c = await box(".item-c");
        // Centred between a and b, 4 px off: the snap must take it to the exact middle.
        const middle = (a.x + a.width + b.x - c.width) / 2;
        const gap = Math.round((b.x - (a.x + a.width) - c.width) / 2);
        await page.mouse.move(c.x + 10, c.y + 10);
        await page.mouse.down();
        await page.mouse.move(c.x + 10 + (middle + 4 - c.x), c.y + 10 + (a.y - c.y), { steps: 10 });
        await sleep(60);
        const labels = await page.$$eval(".mxt-spacing-hint__label", els => els.map(e => e.textContent));
        await page.mouse.up();
        await sleep(80);
        const after = await box(".item-c");
        check("equal spacing hints show the gaps in pixels", labels.length >= 2 && labels.every(l => l === String(gap)), `${JSON.stringify(labels)} expected ${gap}`);
        check("the item snaps to the equal-gap position", Math.abs(after.x - middle) < 1 && Math.abs(after.y - a.y) < 1, JSON.stringify({ after, middle }));
    }

    // 8 - rotation and z-order
    {
        await open({
            items: [
                free("a", { rotatable: true, zOrder: true, contextMenu: true, undoEnabled: true, showPosition: true, defaultX: 100, defaultY: 100 }, { attrs: { rotationAttribute: 0, zIndexAttribute: null }, actions: ["onRotate"] }),
                free("b", { zOrder: true, defaultX: 400, defaultY: 200 }, { attrs: { zIndexAttribute: null } })
            ]
        });
        await page.hover(".item-a");
        const handle = await box(".item-a .mxt-draggable__rotate");
        const item = await box(".item-a");
        check("the rotate handle is a 24 px target", Math.round(handle.width) >= 24 && Math.round(handle.height) >= 24);
        const cx = item.x + item.width / 2;
        const cy = item.y + item.height / 2;
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await page.mouse.down();
        await page.mouse.move(cx + 80, cy + 3, { steps: 10 });
        await page.mouse.up();
        await sleep(80);
        const rot = (await store()).a.rotationAttribute;
        check("dragging the handle rotates and stores the angle", Math.abs(rot - 88) <= 4, String(rot));
        const handle2 = await box(".item-a .mxt-draggable__rotate");
        await page.keyboard.down("Shift");
        await page.mouse.move(handle2.x + handle2.width / 2, handle2.y + handle2.height / 2);
        await page.mouse.down();
        await page.mouse.move(cx - 40, cy + 60, { steps: 10 });
        await page.mouse.up();
        await page.keyboard.up("Shift");
        await sleep(80);
        const snapped = (await store()).a.rotationAttribute;
        check("Shift snaps the rotation to 15 degree steps", snapped % 15 === 0, String(snapped));
        check("On rotate receives the angle", (await events("onRotate", "a")).at(-1)?.args.angle === snapped);
        await page.focus(".item-a");
        await page.keyboard.down("Control");
        await page.keyboard.press("z");
        await page.keyboard.up("Control");
        await sleep(40);
        check("Ctrl+Z undoes a rotation", Math.abs((await store()).a.rotationAttribute - rot) < 1);
        await page.keyboard.down("Control");
        await page.keyboard.down("Shift");
        await page.keyboard.press("BracketLeft");
        await page.keyboard.up("Shift");
        await page.keyboard.up("Control");
        await sleep(40);
        const z = await store();
        check("Ctrl+Shift+[ sends the item to the back", z.a.zIndexAttribute === 1 && z.b.zIndexAttribute === 2, JSON.stringify(z));
        const ia = await box(".item-a");
        await page.mouse.click(ia.x + ia.width / 2, ia.y + ia.height / 2, { button: "right" });
        await sleep(60);
        const menuItems = await page.$$eval(".mxt-menu [role='menuitem']", els => els.map(e => e.querySelector(".mxt-menu__label").textContent));
        check("right-click opens the item menu", menuItems.includes("Bring to front") && menuItems.includes("Rotate left"), JSON.stringify(menuItems));
        const focused = await page.evaluate(() => document.activeElement?.getAttribute("role"));
        check("the first menu item has focus", focused === "menuitem");
        const menuBox = await box(".mxt-menu");
        const itemBox = await box(".mxt-menu [role='menuitem']");
        check("menu items are at least 24 px tall", itemBox.height >= 24, String(itemBox.height));
        const colors = await page.$eval(".mxt-menu", el => {
            const s = getComputedStyle(el);
            const item = el.querySelector("[role='menuitem']:not(:focus)") ?? el.querySelector("[role='menuitem']");
            return { fg: getComputedStyle(item).color, bg: s.backgroundColor, focusFg: getComputedStyle(el.querySelector(":focus")).color, focusBg: getComputedStyle(el.querySelector(":focus")).backgroundColor };
        });
        check("menu text contrast is at least 4.5:1 (normal and focused)", contrast(colors.fg, colors.bg) >= 4.5 && contrast(colors.focusFg, colors.focusBg) >= 4.5, JSON.stringify(colors));
        await page.keyboard.press("Enter");
        await sleep(60);
        check("Enter runs the focused entry (bring to front)", (await store()).a.zIndexAttribute === 2);
        check("focus returns to the item after the menu closes", await page.evaluate(() => document.activeElement?.classList.contains("item-a")));
        check("the menu fits in the viewport", menuBox.x >= 0 && menuBox.y >= 0 && menuBox.x + menuBox.width <= 1100);
    }

    // 9 - drop previews
    {
        await open({
            items: [free("a", { dropPreview: true, returnIfNotDropped: true, dropTargetSelector: ".drop-zone" }, { expr: { dragType: "task" }, actions: ["onDrop"] })],
            zones: [{ id: "invoices", accept: "invoice" }, { id: "tasks", accept: "task" }]
        });
        const a = await box(".item-a");
        await page.mouse.move(a.x + 20, a.y + 20);
        await page.mouse.down();
        await page.mouse.move(a.x + 220, a.y + 60, { steps: 8 });
        const ghost = await box(".mxt-drop-ghost--valid");
        check("a ghost shows the real landing spot (back at the start)", ghost && Math.abs(ghost.x - a.x) < 2 && Math.abs(ghost.y - a.y) < 2, JSON.stringify({ ghost, a }));
        const refuse = await box(".zone-invoices");
        await page.mouse.move(refuse.x + 40, refuse.y + 40, { steps: 8 });
        await sleep(40);
        check("a rejecting zone under the item is marked invalid", (await classes(".zone-invoices")).includes("mxt-drop-zone--invalid"));
        check("the ghost turns invalid over a rejecting zone", !!(await page.$(".mxt-drop-ghost--invalid")));
        const take = await box(".zone-tasks");
        await page.mouse.move(take.x + 40, take.y + 40, { steps: 8 });
        await sleep(40);
        check("over an accepting zone there is no warning", !(await page.$(".mxt-drop-ghost--invalid")) && !(await page.$(".mxt-drop-zone--invalid")));
        await page.mouse.up();
        await sleep(80);
        check("preview classes and ghosts are cleaned up", !(await page.$(".mxt-drop-ghost")) && !(await page.$(".mxt-drop-zone--invalid")));
        // collision preview
        await open({ items: [free("a", { dropPreview: true, collision: "nudge", bounds: "parent" }), free("b", { dropPreview: true, collision: "nudge", bounds: "parent", defaultX: 200 })] });
        const pa = await box(".item-a");
        const pb = await box(".item-b");
        await page.mouse.move(pa.x + 20, pa.y + 20);
        await page.mouse.down();
        await page.mouse.move(pa.x + 20 + (pb.x - pa.x) + 20, pa.y + 30, { steps: 8 });
        await sleep(40);
        const nudgeGhost = await box(".mxt-drop-ghost--valid");
        await page.mouse.up();
        await sleep(80);
        const landed = await box(".item-a");
        check("with Nudge the ghost shows the free spot the item will move to", nudgeGhost && Math.abs(nudgeGhost.x - landed.x) < 2 && Math.abs(nudgeGhost.y - landed.y) < 2, JSON.stringify({ nudgeGhost, landed }));
    }

    // 10 - touch long-press
    {
        await open({ tall: true, items: [free("a", { touchDelay: 300, defaultY: 20 }), free("b", { defaultX: 200, defaultY: 20 })] }, 420, 700, { hasTouch: true, isMobile: true });
        check("long-press items let the browser pan (touch-action)", (await page.$eval(".item-a", el => getComputedStyle(el).touchAction)) === "manipulation");
        const a = await box(".item-a");
        await page.touchscreen.touchStart(a.x + 20, a.y + 20);
        await page.touchscreen.touchMove(a.x + 20, a.y - 40);
        await page.touchscreen.touchMove(a.x + 20, a.y - 120);
        await page.touchscreen.touchEnd();
        await sleep(400);
        check("a quick swipe over the item does not drag it (no scroll hijacking)", (await transformOf(".item-a")) === "translate(0px,20px)", await transformOf(".item-a"));
        check("the swipe scrolls the page instead", (await page.evaluate(() => window.scrollY)) > 0, String(await page.evaluate(() => window.scrollY)));
        // A fresh page for the long-press (the fling above moves the visual viewport).
        await open({ tall: true, items: [free("a", { touchDelay: 300, defaultY: 20 }), free("b", { defaultX: 200, defaultY: 20 })] }, 420, 700, { hasTouch: true, isMobile: true });
        const a2 = await box(".item-a");
        await page.touchscreen.touchStart(a2.x + 20, a2.y + 20);
        await sleep(450);
        const armed = (await classes(".item-a")).includes("mxt-draggable--armed");
        await page.touchscreen.touchMove(a2.x + 60, a2.y + 50);
        await page.touchscreen.touchMove(a2.x + 100, a2.y + 80);
        await page.touchscreen.touchEnd();
        await sleep(150);
        check("a long-press arms the drag", armed);
        check("after the long-press the finger drags the item", (await transformOf(".item-a")) === "translate(80px,80px)", await transformOf(".item-a"));
        check("the long-press vibrates where supported", (await page.evaluate(() => window.__vibrations.length)) >= 1);
        const b = await box(".item-b");
        await page.touchscreen.touchStart(b.x + 20, b.y + 20);
        await page.touchscreen.touchMove(b.x + 50, b.y + 40);
        await page.touchscreen.touchEnd();
        await sleep(120);
        check("items without a delay still drag immediately on touch (2.1 behaviour)", (await transformOf(".item-b")) === "translate(230px,40px)", await transformOf(".item-b"));
    }

    // 11 - layout snapshots with undo
    {
        const p = { snapshotsEnabled: true, contextMenu: true, undoEnabled: true, groupName: "board", resetEnabled: true };
        await open({
            items: [
                free("a", p, { attrs: { snapshotAttribute: "" }, expr: { itemKey: "a" }, actions: ["onSnapshot"] }),
                free("b", { ...p, defaultX: 200 }, { expr: { itemKey: "b" } })
            ]
        });
        const a = await box(".item-a");
        await page.mouse.click(a.x + 10, a.y + 10, { button: "right" });
        await sleep(50);
        await page.click(".mxt-menu [data-id='snapshot-save']");
        await sleep(50);
        const json = JSON.parse((await store()).a.snapshotAttribute || "{}");
        check("the menu saves a snapshot into the snapshot attribute", !!json.snapshots?.["Snapshot 1"]?.items?.b, JSON.stringify(json));
        await drag(".item-a", 50, 40);
        await drag(".item-b", 30, 60);
        const a2 = await box(".item-a");
        await page.mouse.click(a2.x + 10, a2.y + 10, { button: "right" });
        await sleep(50);
        await page.click(".mxt-menu [data-id='snapshot-restore-Snapshot 1']");
        await sleep(100);
        check("restoring puts every item of the group back", (await transformOf(".item-a")) === "translate(0px,0px)" && (await transformOf(".item-b")) === "translate(200px,0px)");
        check("On snapshot runs with the operation and name", (await events("onSnapshot", "a")).some(e => e.args.operation === "restore" && e.args.name === "Snapshot 1"));
        await page.focus(".item-b");
        await page.keyboard.down("Control");
        await page.keyboard.press("z");
        await page.keyboard.up("Control");
        await sleep(80);
        check("one Ctrl+Z undoes the restore for the whole group", (await transformOf(".item-a")) === "translate(50px,40px)" && (await transformOf(".item-b")) === "translate(230px,60px)");
    }

    // 12 - reliability: read-only attributes, busy state
    {
        await open({ items: [free("a", {}, { attrs: { xAttribute: 0, yAttribute: 0 }, readOnly: ["xAttribute", "yAttribute"] })] });
        await drag(".item-a", 80, 30);
        check("a move that cannot be saved is rolled back", (await transformOf(".item-a")) === "translate(0px,0px)");
        const alertText = await page.$eval(".item-a [role='alert']", el => el.textContent);
        check("and explained with Retry and Dismiss buttons", alertText.includes("could not be saved") && alertText.includes("Retry") && alertText.includes("Dismiss"), alertText);
        await page.click(".item-a .mxt-draggable__notice-button--quiet");
        await sleep(40);
        check("Dismiss closes the message and returns focus", !(await page.$(".item-a [role='alert']")) && (await page.evaluate(() => document.activeElement?.classList.contains("item-a"))));
        await open({ items: [free("a", {}, { actions: ["onDragStop"], busy: ["onDragStop"] })] });
        await sleep(500);
        check("a running action shows a busy state", (await page.$eval(".item-a", el => el.getAttribute("aria-busy"))) === "true" && (await page.$eval(".item-a .mxt-draggable__saving", el => getComputedStyle(el).opacity)) === "1");
    }

    // 13 - WCAG: RTL, 200% zoom, focus order
    {
        const listProps = { sortMode: "horizontal", sortContainerSelector: ".sort-list", animate: false };
        await open({ dir: "rtl", lists: [{ id: "row", className: "row" }], items: ["a", "b", "c"].map(id => ({ id, in: "row", props: listProps })) });
        await page.focus(".item-a");
        await page.keyboard.press("Space");
        await page.keyboard.press("ArrowLeft");
        await sleep(40);
        check("in right-to-left pages ArrowLeft moves forward in a horizontal list", (await liveText(".item-a")) === "Position 2 of 3.", await liveText(".item-a"));
        await page.keyboard.press("Escape");
        // 200% zoom = half the CSS viewport width
        await open({ items: [free("a", { contextMenu: true, zOrder: true, rotatable: true, multiSelect: true, snapshotsEnabled: true, undoEnabled: true, resetEnabled: true }), free("b", { defaultX: 140 })] }, 640, 400, { deviceScaleFactor: 2 });
        const a = await box(".item-a");
        await page.mouse.click(a.x + 10, a.y + 10, { button: "right" });
        await sleep(60);
        const mb = await box(".mxt-menu");
        const scrollable = await page.$eval(".mxt-menu", el => el.scrollHeight > el.clientHeight);
        check("at 200% zoom the menu stays inside the viewport (scrolls if needed)", mb.x >= 0 && mb.x + mb.width <= 640 && mb.y >= 0 && mb.y + mb.height <= 400, JSON.stringify({ mb, scrollable }));
        await page.keyboard.press("Escape");
        check("no horizontal scroll at 200% zoom", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
        await open({ items: [free("a"), free("b", { defaultX: 140 })] }, 640, 400, { deviceScaleFactor: 2 });
        await page.keyboard.press("Tab");
        const first = await page.evaluate(() => document.activeElement?.className);
        await page.keyboard.press("Tab");
        const second = await page.evaluate(() => document.activeElement?.className);
        check("focus order follows the page order", first.includes("item-a") && second.includes("item-b"), `${first} -> ${second}`);
    }

    // 14 - memory: mount/unmount loop
    {
        const p = { multiSelect: true, lasso: true, lassoSelector: ".area", zOrder: true, snapshotsEnabled: true, rotatable: true, contextMenu: true, touchDelay: 200 };
        await open({
            items: [free("a", p), free("b", { ...p, defaultX: 150 }), free("c", { ...p, defaultX: 300 }), ...["x", "y", "z"].map(id => ({ id, in: "l", props: { sortMode: "list", sortContainerSelector: ".sort-list" } }))],
            lists: [{ id: "l" }]
        });
        await page.evaluate(() => window.harness.remount(20));
        await page.evaluate(() => window.gc && window.gc());
        const before = await page.evaluate(() => performance.memory.usedJSHeapSize);
        await page.evaluate(() => window.harness.remount(200));
        await sleep(200);
        await page.evaluate(() => {
            window.gc && window.gc();
            window.gc && window.gc();
        });
        const after = await page.evaluate(() => performance.memory.usedJSHeapSize);
        const counts = await page.evaluate(() => window.harness.counts());
        const growthMb = (after - before) / 1048576;
        notes.push(`heap ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB after 200 remounts (${growthMb.toFixed(2)} MB)`);
        check("200 mount/unmount cycles keep the registry at the mounted count", counts.registry === 6 && counts.held === 0 && counts.lasso === 1, JSON.stringify(counts));
        check("heap stays stable over 200 remounts (< 2 MB growth)", growthMb < 2, `${growthMb.toFixed(2)} MB`);
        check("no stray portals or bands on <body>", !(await page.$(".mxt-lasso, .mxt-drop-ghost, .mxt-menu, .mxt-snap-guides")));
    }

    // 15 - security: texts are rendered as text, never as HTML
    {
        await open({ items: [free("a", { contextMenu: true, zOrder: true, menuFrontText: { status: "available", value: "<img src=x onerror=window.__xss=1>Front" } })] });
        const a = await box(".item-a");
        await page.mouse.click(a.x + 10, a.y + 10, { button: "right" });
        await sleep(60);
        check("translatable texts are not parsed as HTML", !(await page.$(".mxt-menu img")) && !(await page.evaluate(() => window.__xss)));
        await page.keyboard.press("Escape");
    }

    check("no console errors", errors.length === 0, errors.join(" | "));
} catch (error) {
    failed++;
    console.log(`FAIL harness crashed - ${error.stack}`);
} finally {
    await browser.close();
}
notes.forEach(note => console.log(`NOTE ${note}`));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
