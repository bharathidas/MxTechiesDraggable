// Browser harness: renders real MxTechiesDraggable instances with mocked Mendix props.
// ?cfg=<json>: { items: [{ id, props, attrs: { xAttribute: 0, ... }, readOnly: [], expr: { dragType: "task" },
//                actions: [], in: "<list id>" }],
//                zones: [{ id, accept }], tall: boolean,
//                lists: [{ id, className, style }]   (2.2: items with "in" render inside these containers),
//                autoReorder: boolean                 (2.2: On reorder re-renders the lists in the new order),
//                dir: "rtl", width: number }
import Big from "big.js";
import { createRoot, Root } from "react-dom/client";
import { MxTechiesDraggable } from "../src/MxTechiesDraggable";
import { registrySize } from "../src/utils/registry";
import { heldCount } from "../src/utils/sortController";
import { lassoControllerCount } from "../src/utils/lasso";
import config from "./dist/defaults.json";

type AnyProps = Record<string, any>;
type AttrValue = number | string | boolean | null;
interface Item {
    id: string;
    props?: AnyProps;
    attrs?: Record<string, AttrValue>;
    readOnly?: string[];
    expr?: Record<string, unknown>;
    actions?: string[];
    busy?: string[];
    in?: string;
}
interface List {
    id: string;
    className?: string;
    itemClassName?: string;
    style?: Record<string, string | number>;
}
interface Scenario {
    items?: Item[];
    zones?: Array<{ id: string; accept?: string }>;
    lists?: List[];
    tall?: boolean;
    autoReorder?: boolean;
    dir?: "rtl" | "ltr";
}

const scenario: Scenario = JSON.parse(new URLSearchParams(location.search).get("cfg") ?? "{}");
if (scenario.dir) {
    document.documentElement.dir = scenario.dir;
}
let items: Item[] = scenario.items ?? [{ id: "a" }];
const events: Array<{ item: string; name: string; args?: unknown }> = [];
const store: Record<string, Record<string, AttrValue | undefined>> = {};
items.forEach(item => {
    store[item.id] = {};
    for (const [key, value] of Object.entries(item.attrs ?? {})) {
        store[item.id][key] = value ?? undefined;
    }
});

const dv = (value: unknown): any => ({ status: "available", value });
const plain = (args: any): any => {
    if (!args) {
        return args;
    }
    const out: AnyProps = {};
    for (const [k, v] of Object.entries(args)) {
        out[k] = v instanceof Big ? Number(v.toString()) : v;
    }
    return out;
};

/** Simulates the data source refreshing after On reorder: the item moves to its new place in the lists. */
function applyReorder(itemId: string, args: { newIndex: number; containerId: string }): void {
    const moving = items.find(i => i.id === itemId);
    if (!moving) {
        return;
    }
    const rest = items.filter(i => i.id !== itemId);
    const target = args.containerId || moving.in;
    const inTarget = rest.filter(i => i.in === target);
    const before = inTarget[args.newIndex];
    const updated = { ...moving, in: target };
    const at = before ? rest.indexOf(before) : rest.indexOf(inTarget[inTarget.length - 1]) + 1;
    rest.splice(at < 0 ? rest.length : at, 0, updated);
    items = rest;
    render();
}

function propsFor(item: Item): AnyProps {
    const props: AnyProps = { name: item.id, class: `item-${item.id}`, ...config.defaults };
    for (const [key, text] of Object.entries(config.texts)) {
        props[key] = dv(text);
    }
    props.content = (
        <div className="card" data-card={item.id}>
            Card {item.id}
        </div>
    );
    Object.assign(props, item.props ?? {});
    for (const key of Object.keys(store[item.id])) {
        const value = store[item.id][key];
        props[key] = {
            status: "available",
            readOnly: (item.readOnly ?? []).includes(key),
            value: typeof value === "number" ? new Big(value) : value === null ? undefined : value,
            setValue: (next: unknown) => {
                store[item.id][key] =
                    next instanceof Big ? Number(next.toString()) : (next as AttrValue | undefined) ?? undefined;
                events.push({ item: item.id, name: `set:${key}`, args: store[item.id][key] });
                render();
            }
        };
    }
    for (const [key, value] of Object.entries(item.expr ?? {})) {
        props[key] = dv(value);
    }
    for (const name of item.actions ?? []) {
        props[name] = {
            canExecute: true,
            isExecuting: (item.busy ?? []).includes(name),
            execute: (args?: unknown) => {
                const values = plain(args);
                events.push({ item: item.id, name, args: values });
                if (name === "onReorder" && scenario.autoReorder) {
                    window.setTimeout(() => applyReorder(item.id, values), 150);
                }
            }
        };
    }
    return props;
}

const host = document.getElementById("root")!;
let root: Root = createRoot(host);
let mounted = true;

function render(): void {
    if (!mounted) {
        return;
    }
    const free = items.filter(item => !item.in);
    root.render(
        <div className={scenario.tall ? "tall" : undefined}>
            <div className="area">
                {free.map(item => (
                    <MxTechiesDraggable key={item.id} {...(propsFor(item) as any)} />
                ))}
            </div>
            {scenario.lists && (
                <div className="lists">
                    {scenario.lists.map(list => (
                        <div
                            key={list.id}
                            className={`sort-list ${list.className ?? ""}`}
                            data-sort-id={list.id}
                            style={list.style}
                        >
                            {items
                                .filter(item => item.in === list.id)
                                .map(item => (
                                    <div key={item.id} className={list.itemClassName ?? "list-item"}>
                                        <MxTechiesDraggable {...(propsFor(item) as any)} />
                                    </div>
                                ))}
                        </div>
                    ))}
                </div>
            )}
            {scenario.zones && (
                <div className="zones">
                    {scenario.zones.map(zone => (
                        <div key={zone.id} className={`drop-zone zone-${zone.id}`} data-accept={zone.accept} />
                    ))}
                </div>
            )}
        </div>
    );
}

/** Memory check: unmount and mount the whole page `times` times. */
async function remount(times: number): Promise<void> {
    for (let i = 0; i < times; i++) {
        root.unmount();
        mounted = false;
        await new Promise(resolve => setTimeout(resolve, 0));
        root = createRoot(host);
        mounted = true;
        render();
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

(window as any).harness = {
    events,
    store,
    remount,
    order: (listId: string) => items.filter(i => i.in === listId).map(i => i.id),
    counts: () => ({
        registry: registrySize(),
        held: heldCount(),
        lasso: lassoControllerCount(),
        nodes: document.getElementsByTagName("*").length
    })
};
render();
