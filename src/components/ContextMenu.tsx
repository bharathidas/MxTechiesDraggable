import { KeyboardEvent as ReactKeyboardEvent, ReactElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function stop(event: { stopPropagation: () => void }): void {
    event.stopPropagation();
}

export interface MenuItem {
    id: string;
    label: string;
    onSelect: () => void;
    disabled?: boolean;
    /** Draws a separator above the item. */
    separator?: boolean;
    /** Keyboard shortcut hint shown on the right (visual only). */
    hint?: string;
}

interface Props {
    items: MenuItem[];
    /** Viewport point the menu opens at. */
    at: { x: number; y: number };
    label: string;
    rtl: boolean;
    onClose: (restoreFocus: boolean) => void;
}

/**
 * 2.2 item actions menu (z-order, rotation, sorting, snapshots, selection). WAI-ARIA menu pattern: arrow keys,
 * Home/End, type-ahead, Enter/Space to run, Escape or Tab to close; focus returns to the widget.
 */
export function ContextMenu({ items, at, label, rtl, onClose }: Props): ReactElement {
    const menuRef = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState(() =>
        Math.max(
            0,
            items.findIndex(item => !item.disabled)
        )
    );
    const [place, setPlace] = useState(at);

    // Keep the menu inside the viewport (also at 200% zoom and in right-to-left pages).
    useLayoutEffect(() => {
        const menu = menuRef.current;
        if (!menu) {
            return;
        }
        const rect = menu.getBoundingClientRect();
        const width = window.innerWidth;
        const height = window.innerHeight;
        let x = rtl ? at.x - rect.width : at.x;
        let y = at.y;
        x = Math.max(4, Math.min(x, width - rect.width - 4));
        y = Math.max(4, Math.min(y, height - rect.height - 4));
        setPlace({ x, y });
    }, [at, rtl]);

    useEffect(() => {
        const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']");
        buttons?.[active]?.focus();
    }, [active]);

    useEffect(() => {
        const onDown = (event: PointerEvent): void => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose(false);
            }
        };
        const onScroll = (): void => onClose(false);
        document.addEventListener("pointerdown", onDown, true);
        window.addEventListener("resize", onScroll);
        return () => {
            document.removeEventListener("pointerdown", onDown, true);
            window.removeEventListener("resize", onScroll);
        };
    }, [onClose]);

    const enabled = items.map((item, index) => (item.disabled ? -1 : index)).filter(index => index >= 0);
    const step = (direction: 1 | -1): void => {
        if (enabled.length === 0) {
            return;
        }
        const at = enabled.indexOf(active);
        const next = enabled[(at + direction + enabled.length) % enabled.length];
        setActive(next);
    };

    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                step(1);
                break;
            case "ArrowUp":
                event.preventDefault();
                step(-1);
                break;
            case "Home":
                event.preventDefault();
                setActive(enabled[0] ?? 0);
                break;
            case "End":
                event.preventDefault();
                setActive(enabled[enabled.length - 1] ?? 0);
                break;
            case "Escape":
                event.preventDefault();
                event.stopPropagation();
                onClose(true);
                break;
            case "Tab":
                event.preventDefault();
                onClose(true);
                break;
            default:
                if (event.key.length === 1 && /\S/.test(event.key)) {
                    const lower = event.key.toLowerCase();
                    const match = enabled.find(
                        index => index > active && items[index].label.toLowerCase().startsWith(lower)
                    );
                    const wrap = enabled.find(index => items[index].label.toLowerCase().startsWith(lower));
                    const next = match ?? wrap;
                    if (next !== undefined) {
                        setActive(next);
                    }
                }
        }
        // Keys inside the menu never reach the draggable.
        event.stopPropagation();
    };

    return createPortal(
        <div
            ref={menuRef}
            className="mxt-menu"
            role="menu"
            aria-label={label}
            dir={rtl ? "rtl" : undefined}
            style={{ left: place.x, top: place.y }}
            onKeyDown={onKeyDown}
            onContextMenu={event => {
                event.preventDefault();
                event.stopPropagation();
            }}
            // The menu is a portal, but React events still bubble to the draggable: a press in the menu
            // must never start a drag, a selection or a double-click reset.
            onMouseDown={stop}
            onPointerDown={stop}
            onTouchStart={stop}
            onClick={stop}
            onDoubleClick={stop}
        >
            {items.map((item, index) => (
                <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    data-id={item.id}
                    className={item.separator ? "mxt-menu__item mxt-menu__item--separated" : "mxt-menu__item"}
                    tabIndex={index === active ? 0 : -1}
                    disabled={item.disabled}
                    aria-disabled={item.disabled || undefined}
                    onMouseEnter={() => !item.disabled && setActive(index)}
                    onClick={() => {
                        onClose(true);
                        item.onSelect();
                    }}
                >
                    <span className="mxt-menu__label">{item.label}</span>
                    {item.hint && (
                        <span className="mxt-menu__hint" aria-hidden="true">
                            {item.hint}
                        </span>
                    )}
                </button>
            ))}
        </div>,
        document.body
    );
}
