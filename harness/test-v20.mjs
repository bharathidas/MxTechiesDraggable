// 2.0 browser suite: free dragging inside a list view (List View -> item -> MxTechies Draggable).
// Every item keeps its own X / Y, and the dragged row is lifted above the rows below it (Raise list rows).
// Run after build.mjs: node harness/test-v20.mjs
import puppeteer from "puppeteer-core";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const pageUrl = pathToFileURL(fileURLToPath(new URL("index.html", import.meta.url))).href;
let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
    ok ? passed++ : failed++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? ` - ${detail}` : ""}`);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => message.type() === "error" && errors.push(message.text()));

const LIST_CSS = "padding:8px;width:700px";
const item = (id, props = {}) => ({
    id,
    in: "notes",
    props: { animate: false, liftWhileDragging: false, ...props },
    attrs: { xAttribute: 0, yAttribute: 0 }
});
async function open(items) {
    const cfg = {
        items,
        lists: [{ id: "notes", className: "mx-listview", itemClassName: "mx-listview-item", style: { padding: "8px" } }]
    };
    await page.setViewport({ width: 1000, height: 900 });
    await page.goto(`${pageUrl}?cfg=${encodeURIComponent(JSON.stringify(cfg))}`);
    await page.waitForSelector(".mxt-draggable");
    // Mendix-like rows: each row paints a background, so an item behind a later row is hidden
    await page.addStyleTag({
        content: `.mx-listview-item{background:#fff;border-bottom:1px solid #ddd;padding:6px 0;overflow:hidden;transition:transform .1s}.mx-listview-item:hover{transform:translateY(-1px)}.mx-listview{${LIST_CSS}}`
    });
    await sleep(150);
}
const rowOf = id => `.mx-listview-item:has([data-card="${id}"])`;
const box = async selector => (await page.$(selector)).boundingBox();
const store = () => page.evaluate(() => JSON.parse(JSON.stringify(window.harness.store)));
const rowStyle = id =>
    page.$eval(rowOf(id), row => ({
        z: row.querySelector(".mxt-draggable").style.zIndex,
        pos: row.style.position,
        overflow: row.style.overflow,
        cls: row.className
    }));
const topAt = (x, y) =>
    page.evaluate(
        (x, y) => document.elementFromPoint(x, y)?.closest("[data-card]")?.getAttribute("data-card") ?? null,
        x,
        y
    );

try {
    // 1 - drag the first item down over the rows below it
    {
        await open([item("a"), item("b"), item("c"), item("d")]);
        const a = await box('[data-card="a"]');
        const c = await box('[data-card="c"]');
        const x = a.x + 15;
        const y = a.y + 10;
        const dy = Math.round(c.y - a.y);
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 60, y + dy, { steps: 12 });
        await sleep(60);
        const during = await rowStyle("a");
        check(
            "while dragging, the item and its row are lifted above the other rows",
            during.z === "1000" && during.pos === "relative",
            JSON.stringify(during)
        );
        check("while dragging, the row does not clip the item", during.overflow === "visible", during.overflow);
        check(
            "the dragged item is drawn on top of the row it is over",
            (await topAt(x + 60, y + dy)) === "a",
            await topAt(x + 60, y + dy)
        );
        await page.mouse.up();
        await sleep(150);
        const after = await rowStyle("a");
        check(
            "after the drop the row stays raised (resting)",
            after.z === "2" && after.cls.includes("mxt-list-item--raised"),
            JSON.stringify(after)
        );
        check(
            "after the drop the item is still on top of the row below",
            (await topAt(x + 60, y + dy)) === "a",
            await topAt(x + 60, y + dy)
        );
        const s = await store();
        check("the item's own X / Y were written", s.a.xAttribute === 60 && s.a.yAttribute === dy, JSON.stringify(s.a));
        check(
            "the other items keep their own positions",
            s.b.xAttribute === 0 && s.c.yAttribute === 0 && s.d.xAttribute === 0,
            JSON.stringify(s)
        );
        const other = await rowStyle("b");
        check(
            "rows of items that did not move are untouched",
            other.z === "" && other.pos === "" && !other.cls.includes("raised"),
            JSON.stringify(other)
        );
    }
    // 2 - two items moved independently; dragging one back home lowers its row again
    {
        await open([item("a"), item("b"), item("c")]);
        const a = await box('[data-card="a"]');
        await page.mouse.move(a.x + 15, a.y + 10);
        await page.mouse.down();
        await page.mouse.move(a.x + 215, a.y + 10, { steps: 10 });
        await page.mouse.up();
        await sleep(120);
        const b = await box('[data-card="b"]');
        await page.mouse.move(b.x + 15, b.y + 10);
        await page.mouse.down();
        await page.mouse.move(b.x + 115, b.y + 40, { steps: 10 });
        await page.mouse.up();
        await sleep(120);
        const s = await store();
        check(
            "two items each keep their own position",
            s.a.xAttribute === 200 && s.a.yAttribute === 0 && s.b.xAttribute === 100 && s.b.yAttribute === 30,
            JSON.stringify(s)
        );
        // move a back to 0,0 through the attributes (as a Reset microflow would)
        const a2 = await box('[data-card="a"]');
        await page.mouse.move(a2.x + a2.width - 8, a2.y + 6);
        await page.mouse.down();
        await page.mouse.move(a2.x + a2.width - 208, a2.y + 6, { steps: 10 });
        await page.mouse.up();
        await sleep(150);
        const back = await store();
        const row = await rowStyle("a");
        check(
            "an item dropped back in its place lowers its row and restores its styles",
            back.a.xAttribute === 0 && row.z === "" && row.overflow === "" && !row.cls.includes("raised"),
            JSON.stringify({ a: back.a, row })
        );
    }
    // 3 - Raise list rows off: rows are never touched
    {
        await open([item("a", { raiseListRows: false }), item("b", { raiseListRows: false })]);
        const a = await box('[data-card="a"]');
        await page.mouse.move(a.x + 15, a.y + 10);
        await page.mouse.down();
        await page.mouse.move(a.x + 45, a.y + 60, { steps: 8 });
        const row = await rowStyle("a");
        await page.mouse.up();
        await sleep(100);
        check("with Raise list rows off the row is left alone", row.z === "" && row.pos === "", JSON.stringify(row));
    }
    // 4 - unmounting a raised item restores its row
    {
        await open([item("a"), item("b")]);
        const a = await box('[data-card="a"]');
        await page.mouse.move(a.x + 15, a.y + 10);
        await page.mouse.down();
        await page.mouse.move(a.x + 40, a.y + 50, { steps: 8 });
        await page.mouse.up();
        await sleep(100);
        const left = await page.evaluate(async () => {
            const row = document.querySelector(".mx-listview-item");
            await window.harness.remount(1);
            return row.isConnected;
        });
        check("remounting leaves no stale lifted rows", left === false || (await rowStyle("a")).z !== "1000");
    }
    check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
    await browser.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
