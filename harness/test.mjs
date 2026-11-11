// Drives the harness in headless Chrome and prints PASS/FAIL per check: node harness/test.mjs
import puppeteer from "puppeteer-core";
import { fileURLToPath, pathToFileURL } from "node:url";

// Any Chromium-based browser works; set CHROME_PATH to use an open-source Chromium build.
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const pageUrl = pathToFileURL(fileURLToPath(new URL("index.html", import.meta.url))).href;

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
    if (ok) {
        passed++;
        console.log(`PASS ${name}`);
    } else {
        failed++;
        console.log(`FAIL ${name}${detail ? ` - ${detail}` : ""}`);
    }
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => {
    if (message.type() === "error") {
        errors.push(message.text());
    }
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function open(cfg, width = 900, height = 800) {
    await page.setViewport({ width, height });
    await page.goto(`${pageUrl}?cfg=${encodeURIComponent(JSON.stringify(cfg))}`);
    await page.waitForSelector(".mxt-draggable");
    await sleep(100);
}
const box = async selector => (await page.$(selector)).boundingBox();
const events = (name, item) =>
    page.evaluate((n, i) => window.harness.events.filter(e => e.name === n && (!i || e.item === i)), name, item);
const store = () => page.evaluate(() => JSON.parse(JSON.stringify(window.harness.store)));
const transformOf = selector => page.$eval(selector, el => el.style.transform.replace(/\s+/g, ""));
const overlap = (a, b) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

async function drag(selector, dx, dy, { steps = 12, hold = 0 } = {}) {
    const b = await box(selector);
    const x = b.x + 20;
    const y = b.y + 20;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps });
    if (hold) {
        await sleep(hold);
    }
    await page.mouse.up();
    await sleep(80);
}

try {
    // 1 - pointer drag, attributes, On position change
    await open({ items: [{ id: "a", attrs: { xAttribute: 0, yAttribute: 0 }, actions: ["onPositionChange", "onDragStop"], props: { animate: false } }] });
    await drag(".item-a", 100, 50);
    let s = await store();
    check("pointer drag writes X and Y", s.a.xAttribute === 100 && s.a.yAttribute === 50, JSON.stringify(s.a));
    const moved = await events("onPositionChange", "a");
    check("On position change receives x and y", moved.length === 1 && moved[0].args.x === 100 && moved[0].args.y === 50, JSON.stringify(moved));

    // 2 - undo with Ctrl+Z and reset with double-click / Home
    await open({ items: [{ id: "a", props: { animate: false, undoEnabled: true, resetEnabled: true, defaultX: 10, defaultY: 10 } }] });
    await drag(".item-a", 80, 0);
    await drag(".item-a", 0, 60);
    check("two drags land at 90, 70", (await transformOf(".item-a")) === "translate(90px,70px)", await transformOf(".item-a"));
    await page.focus(".item-a");
    await page.keyboard.down("Control");
    await page.keyboard.press("z");
    await page.keyboard.up("Control");
    await sleep(60);
    check("Ctrl+Z goes back one move", (await transformOf(".item-a")) === "translate(90px,10px)", await transformOf(".item-a"));
    const b = await box(".item-a");
    await page.mouse.click(b.x + 10, b.y + 10, { clickCount: 2 });
    await sleep(60);
    check("double-click resets to the default position", (await transformOf(".item-a")) === "translate(10px,10px)", await transformOf(".item-a"));
    await page.focus(".item-a");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Home");
    await sleep(60);
    check("Home resets too", (await transformOf(".item-a")) === "translate(10px,10px)");

    // 3 - resizing with the mouse and the keyboard
    await open({
        items: [
            {
                id: "a",
                props: { resizable: true, minWidth: 80, minHeight: 40, maxWidth: 300, bounds: "parent", showPosition: true },
                attrs: { widthAttribute: null, heightAttribute: null },
                actions: ["onResize"]
            }
        ]
    });
    check("three resize handles are rendered", (await page.$$(".item-a .mxt-draggable__resize")).length === 3);
    const before = await box(".item-a");
    const grip = await box(".item-a .mxt-draggable__resize--se");
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + 80, grip.y + 40, { steps: 8 });
    check("a size badge shows while resizing", !!(await page.$(".mxt-draggable__badge--size")));
    await page.mouse.up();
    await sleep(80);
    const after = await box(".item-a");
    check("dragging the corner grows the box", Math.round(after.width - before.width) >= 70 && Math.round(after.height - before.height) >= 30, `${before.width}x${before.height} -> ${after.width}x${after.height}`);
    check("resizing does not move the box", Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1);
    s = await store();
    const resized = await events("onResize", "a");
    check("size attributes and On resize receive the new size", s.a.widthAttribute === Math.round(after.width) && resized.at(-1)?.args.height === Math.round(after.height), JSON.stringify({ s: s.a, resized }));
    const ebox = await box(".item-a .mxt-draggable__resize--e");
    await page.mouse.move(ebox.x + 3, ebox.y + 10);
    await page.mouse.down();
    await page.mouse.move(ebox.x + 900, ebox.y + 10, { steps: 6 });
    await page.mouse.up();
    await sleep(60);
    check("maximum width is respected", Math.round((await box(".item-a")).width) === 300, String((await box(".item-a")).width));
    await page.focus(".item-a");
    await page.keyboard.down("Alt");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.up("Alt");
    await sleep(40);
    check("Alt + ArrowUp shrinks the height", Math.round((await box(".item-a")).height) === Math.round(after.height) - 10);
    check("resize handles do not start a drag", (await transformOf(".item-a")) === "translate(0px,0px)");

    // 4 - collision: revert and nudge
    for (const mode of ["revert", "nudge"]) {
        await open({
            items: [
                { id: "a", props: { collision: mode, bounds: "parent", animate: false } },
                { id: "b", props: { collision: mode, bounds: "parent", animate: false } }
            ]
        });
        const bb = await box(".item-b");
        const ab = await box(".item-a");
        await drag(".item-a", bb.x - ab.x + 30, 20);
        const finalA = await box(".item-a");
        if (mode === "revert") {
            check("collision revert sends an overlapping drop back", Math.abs(finalA.x - ab.x) < 1 && Math.abs(finalA.y - ab.y) < 1);
        } else {
            check("collision nudge lands next to the other box without overlap", !overlap(finalA, bb) && Math.abs(finalA.x - ab.x) > 20, JSON.stringify(finalA));
        }
    }

    // 5 - drop zones with accept rules
    await open({
        items: [{ id: "a", props: { dropTargetSelector: ".drop-zone", animate: false, returnIfNotDropped: true }, expr: { dragType: "task" }, actions: ["onDrop"] }],
        zones: [
            { id: "invoices", accept: "invoice" },
            { id: "tasks", accept: "task bug" }
        ]
    });
    const card = await box(".item-a");
    const refuse = await box(".zone-invoices");
    const take = await box(".zone-tasks");
    await page.mouse.move(card.x + 20, card.y + 20);
    await page.mouse.down();
    await page.mouse.move(refuse.x + 40, refuse.y + 40, { steps: 10 });
    const classes = await page.$eval(".zone-invoices", el => el.className);
    check("a zone that does not accept the type is marked rejected while dragging", classes.includes("mxt-drop-zone--rejected") && !classes.includes("mxt-drop-zone--over"), classes);
    await page.mouse.up();
    await sleep(80);
    check("dropping on a rejecting zone does not run On drop", (await events("onDrop")).length === 0);
    check("rejected classes are cleared after the drag", !(await page.$(".mxt-drop-zone--rejected")));
    await drag(".item-a", take.x - card.x + 30, take.y - card.y + 30);
    const drops = await events("onDrop");
    check("dropping on an accepting zone runs On drop with its id", drops.length === 1 && drops[0].args.targetId === "tasks", JSON.stringify(drops));

    // 6 - auto-scroll
    await open({ tall: true, items: [{ id: "a", props: { autoScroll: true, animate: false } }] }, 900, 600);
    const start = await box(".item-a");
    await page.mouse.move(start.x + 20, start.y + 20);
    await page.mouse.down();
    await page.mouse.move(start.x + 20, 595, { steps: 10 });
    await sleep(400);
    const scrolled = await page.evaluate(() => window.scrollY);
    await page.mouse.up();
    check("holding near the bottom edge scrolls the page", scrolled > 50, String(scrolled));
    await open({ tall: true, items: [{ id: "a", props: { autoScroll: false, animate: false } }] }, 900, 600);
    const start2 = await box(".item-a");
    await page.mouse.move(start2.x + 20, start2.y + 20);
    await page.mouse.down();
    await page.mouse.move(start2.x + 20, 595, { steps: 10 });
    await sleep(300);
    const still = await page.evaluate(() => window.scrollY);
    await page.mouse.up();
    check("without Auto-scroll the page stays put (2.0 behaviour)", still === 0, String(still));

    // 7 - motion levels
    await open({ items: [{ id: "a", props: { motion: "subtle", liftWhileDragging: true } }] });
    const subtle = await box(".item-a");
    await page.mouse.move(subtle.x + 20, subtle.y + 20);
    await page.mouse.down();
    await page.mouse.move(subtle.x + 220, subtle.y + 20, { steps: 4 });
    const rotate = await page.$eval(".item-a", el => el.style.rotate);
    await page.mouse.up();
    check("Motion subtle never tilts", !rotate, rotate);
    await open({ items: [{ id: "a", props: { motion: "off" } }] });
    check("Motion off drops the animated class", !(await page.$(".mxt-draggable--animated")) && !!(await page.$(".mxt-draggable--motion-off")));

    // 8 - small screens and errors
    await open({ items: [{ id: "a", props: { resizable: true } }, { id: "b" }] }, 360, 700);
    check("no horizontal scroll at 360 px", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
    check("no console errors", errors.length === 0, errors.join(" | "));
} catch (error) {
    failed++;
    console.log(`FAIL harness crashed - ${error.stack}`);
} finally {
    await browser.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
