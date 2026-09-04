import { ReactElement } from "react";
import { MxTechiesDraggablePreviewProps } from "../typings/MxTechiesDraggableProps";

const AXIS_HINT: Record<MxTechiesDraggablePreviewProps["axis"], string> = {
    both: "Draggable (any direction)",
    x: "Draggable (horizontal)",
    y: "Draggable (vertical)",
    none: "Draggable (events only)"
};

export function preview(props: MxTechiesDraggablePreviewProps): ReactElement {
    const Content = props.content.renderer;

    return (
        <div
            className={`mxt-draggable mxt-draggable--${props.display} ${props.className ?? ""}`}
            style={{
                display: props.display === "inline" ? "inline-block" : "block",
                minWidth: 120,
                border: "1px dashed #8a8f99",
                borderRadius: 4,
                ...props.styleObject
            }}
        >
            <Content caption={AXIS_HINT[props.axis]}>
                <div />
            </Content>
        </div>
    );
}

export function getPreviewCss(): string {
    return require("./ui/MxTechiesDraggable.css");
}
