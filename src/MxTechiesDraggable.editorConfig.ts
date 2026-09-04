import { Problem, Properties, hidePropertyIn } from "@mendix/pluggable-widgets-tools";
import { MxTechiesDraggablePreviewProps } from "../typings/MxTechiesDraggableProps";

export function getProperties(values: MxTechiesDraggablePreviewProps, defaultProperties: Properties): Properties {
    if (values.bounds !== "selector") {
        hidePropertyIn(defaultProperties, values, "boundsSelector");
    }
    if (values.bounds !== "offset") {
        hidePropertyIn(defaultProperties, values, "boundsLeft");
        hidePropertyIn(defaultProperties, values, "boundsTop");
        hidePropertyIn(defaultProperties, values, "boundsRight");
        hidePropertyIn(defaultProperties, values, "boundsBottom");
    }
    return defaultProperties;
}

export function check(values: MxTechiesDraggablePreviewProps): Problem[] {
    const problems: Problem[] = [];
    const gridX = values.gridX ?? 0;
    const gridY = values.gridY ?? 0;

    if (values.bounds === "selector" && !values.boundsSelector?.trim()) {
        problems.push({
            property: "boundsSelector",
            severity: "error",
            message: "Bounds is set to 'Custom selector' but no selector is given."
        });
    }

    if (gridX < 0 || gridY < 0) {
        problems.push({
            property: gridX < 0 ? "gridX" : "gridY",
            severity: "error",
            message: "Grid steps cannot be negative. Use 0 to disable snapping."
        });
    }

    if (gridX > 0 !== gridY > 0) {
        problems.push({
            property: gridX > 0 ? "gridY" : "gridX",
            severity: "warning",
            message: "Grid snapping only applies when both the grid width and grid height are greater than 0."
        });
    }

    if (Boolean(values.xAttribute) !== Boolean(values.yAttribute)) {
        problems.push({
            property: values.xAttribute ? "yAttribute" : "xAttribute",
            severity: "warning",
            message: "Only one of the X and Y attributes is set. The other coordinate will not be saved."
        });
    }

    if (values.axis === "none" && !values.onDragStart && !values.onDragStop) {
        problems.push({
            property: "axis",
            severity: "warning",
            message: "Axis is 'None' and no drag events are configured, so this widget does nothing."
        });
    }

    return problems;
}
