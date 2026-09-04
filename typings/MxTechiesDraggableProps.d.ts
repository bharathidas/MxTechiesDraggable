/**
 * This file was generated from MxTechiesDraggable.xml
 * WARNING: All changes made to this file will be overwritten
 * @author Mendix Widgets Framework Team
 */
import { ActionValue, DynamicValue, EditableValue } from "mendix";
import { ComponentType, CSSProperties, ReactNode } from "react";
import { Big } from "big.js";

export type AxisEnum = "both" | "x" | "y" | "none";

export type BoundsEnum = "none" | "parent" | "body" | "selector" | "offset";

export type DisplayEnum = "inline" | "block";

export interface MxTechiesDraggableContainerProps {
    name: string;
    class: string;
    style?: CSSProperties;
    tabIndex?: number;
    content?: ReactNode;
    axis: AxisEnum;
    handle: string;
    cancel: string;
    disabled?: DynamicValue<boolean>;
    bounds: BoundsEnum;
    boundsSelector: string;
    boundsLeft: number;
    boundsTop: number;
    boundsRight: number;
    boundsBottom: number;
    gridX: number;
    gridY: number;
    xAttribute?: EditableValue<Big>;
    yAttribute?: EditableValue<Big>;
    defaultX: number;
    defaultY: number;
    display: DisplayEnum;
    showPosition: boolean;
    liftWhileDragging: boolean;
    onDragStart?: ActionValue;
    onDragStop?: ActionValue;
}

export interface MxTechiesDraggablePreviewProps {
    /**
     * @deprecated Deprecated since version 9.18.0. Please use class property instead.
     */
    className: string;
    class: string;
    style: string;
    styleObject?: CSSProperties;
    readOnly: boolean;
    renderMode: "design" | "xray" | "structure";
    translate: (text: string) => string;
    content: { widgetCount: number; renderer: ComponentType<{ children: ReactNode; caption?: string }> };
    axis: AxisEnum;
    handle: string;
    cancel: string;
    disabled: string;
    bounds: BoundsEnum;
    boundsSelector: string;
    boundsLeft: number | null;
    boundsTop: number | null;
    boundsRight: number | null;
    boundsBottom: number | null;
    gridX: number | null;
    gridY: number | null;
    xAttribute: string;
    yAttribute: string;
    defaultX: number | null;
    defaultY: number | null;
    display: DisplayEnum;
    showPosition: boolean;
    liftWhileDragging: boolean;
    onDragStart: {} | null;
    onDragStop: {} | null;
}
