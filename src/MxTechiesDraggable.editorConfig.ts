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
    // Studio Pro resets hidden properties to their defaults, so only hide options that are meaningless
    // without their switch (and say so in the switch's description).
    if (!values.dropTargetSelector?.trim()) {
        hidePropertyIn(defaultProperties, values, "dropIdClassPrefix");
        hidePropertyIn(defaultProperties, values, "onDrop");
    }
    if (!values.snapToSiblings) {
        hidePropertyIn(defaultProperties, values, "snapThreshold");
    }
    if (!values.animate) {
        hidePropertyIn(defaultProperties, values, "momentum");
    }
    if (!values.keyboardEnabled) {
        hidePropertyIn(defaultProperties, values, "keyboardStep");
        hidePropertyIn(defaultProperties, values, "keyboardInstructions");
        hidePropertyIn(defaultProperties, values, "undoEnabled");
    }
    // 2.1
    if (!values.resizable) {
        (
            [
                "widthAttribute",
                "heightAttribute",
                "minWidth",
                "minHeight",
                "maxWidth",
                "maxHeight",
                "keepAspectRatio",
                "onResize",
                "resizedText"
            ] as const
        ).forEach(key => hidePropertyIn(defaultProperties, values, key));
    }
    if (!values.animate) {
        hidePropertyIn(defaultProperties, values, "motion");
    }
    if (!values.dropTargetSelector?.trim()) {
        hidePropertyIn(defaultProperties, values, "dragType");
        hidePropertyIn(defaultProperties, values, "pickUpZonesText");
        hidePropertyIn(defaultProperties, values, "overZoneText");
        hidePropertyIn(defaultProperties, values, "droppedOnText");
        hidePropertyIn(defaultProperties, values, "rejectedText");
    }
    if (values.collision === "none") {
        hidePropertyIn(defaultProperties, values, "nudgedText");
        hidePropertyIn(defaultProperties, values, "revertedText");
    }
    if (!values.undoEnabled) {
        hidePropertyIn(defaultProperties, values, "undoneText");
    }
    if (!values.resetEnabled) {
        hidePropertyIn(defaultProperties, values, "resetText");
    }
    // 2.2
    const hide = (keys: ReadonlyArray<keyof MxTechiesDraggablePreviewProps>): void =>
        keys.forEach(key => hidePropertyIn(defaultProperties, values, key));
    if ((values.touchDelay ?? 0) <= 0) {
        hide(["hapticFeedback"]);
    }
    if (!values.rotatable) {
        hide([
            "rotationAttribute",
            "rotationStep",
            "onRotate",
            "rotatedText",
            "menuRotateLeftText",
            "menuRotateRightText",
            "menuResetRotationText"
        ]);
    }
    if (!values.zOrder) {
        hide([
            "zIndexAttribute",
            "onZOrderChange",
            "layerText",
            "menuFrontText",
            "menuForwardText",
            "menuBackwardText",
            "menuBackText"
        ]);
    }
    if (!values.snapToSiblings) {
        hide(["equalSpacing"]);
    }
    if (!values.multiSelect) {
        hide([
            "lasso",
            "lassoSelector",
            "selectedAttribute",
            "onSelectionChange",
            "selectedCountText",
            "selectionClearedText",
            "selectedStateText",
            "groupMovedText",
            "menuSelectAllText",
            "menuClearSelectionText"
        ]);
    } else if (!values.lasso) {
        hide(["lassoSelector"]);
    }
    if (!values.multiSelect && !values.zOrder && !values.snapshotsEnabled) {
        hide(["groupName"]);
    }
    if (!values.sortMode || values.sortMode === "off") {
        hide([
            "sortContainerSelector",
            "sortCrossContainer",
            "orderAttribute",
            "orderOffset",
            "sortTimeout",
            "onReorder",
            "liftedText",
            "sortMovedText",
            "sortListText",
            "sortDroppedText",
            "sortCancelledText",
            "sortInstructionsText",
            "reorderFailedText",
            "menuMoveUpText",
            "menuMoveDownText",
            "menuMoveFirstText",
            "menuMoveLastText"
        ]);
    }
    if (!values.snapshotsEnabled) {
        hide([
            "itemKey",
            "snapshotAttribute",
            "layoutCommand",
            "resetSnapshot",
            "onSnapshot",
            "snapshotSavedText",
            "snapshotRestoredText",
            "snapshotMissingText",
            "menuSaveSnapshotText",
            "menuRestoreSnapshotText"
        ]);
    }
    if (!values.contextMenu) {
        hide(["menuLabelText", "menuUndoText", "menuResetText"]);
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

    if (values.snapToSiblings && (values.snapThreshold ?? 0) <= 0) {
        problems.push({
            property: "snapThreshold",
            severity: "error",
            message: "Snap distance must be greater than 0 when 'Snap to siblings' is on."
        });
    }

    if (values.keyboardEnabled && (values.keyboardStep ?? 0) < 1) {
        problems.push({
            property: "keyboardStep",
            severity: "error",
            message: "Keyboard step must be at least 1 pixel."
        });
    }

    if (values.dropTargetSelector?.includes("{") || values.dropTargetSelector?.includes("}")) {
        problems.push({
            property: "dropTargetSelector",
            severity: "error",
            message: "The drop zone selector must be a CSS selector such as '.drop-zone', not a style rule."
        });
    }

    if (values.momentum && values.returnIfNotDropped) {
        problems.push({
            property: "momentum",
            severity: "warning",
            message:
                "'Return if not dropped' wins over Momentum: content released outside a drop zone returns instead of being thrown."
        });
    }

    if (values.dropTargetSelector?.trim() && values.axis === "none") {
        problems.push({
            property: "dropTargetSelector",
            severity: "warning",
            message: "Axis is 'None', so the content cannot be moved onto a drop zone."
        });
    }

    if (values.resizable) {
        const minW = values.minWidth ?? 0;
        const minH = values.minHeight ?? 0;
        if ((values.maxWidth ?? 0) > 0 && (values.maxWidth ?? 0) < minW) {
            problems.push({
                property: "maxWidth",
                severity: "error",
                message: "Maximum width is smaller than the minimum width."
            });
        }
        if ((values.maxHeight ?? 0) > 0 && (values.maxHeight ?? 0) < minH) {
            problems.push({
                property: "maxHeight",
                severity: "error",
                message: "Maximum height is smaller than the minimum height."
            });
        }
        if (Boolean(values.widthAttribute) !== Boolean(values.heightAttribute)) {
            problems.push({
                property: values.widthAttribute ? "heightAttribute" : "widthAttribute",
                severity: "warning",
                message: "Only one of the width and height attributes is set; the size is only restored when both are."
            });
        }
    }
    // 2.2
    const sorting = !!values.sortMode && values.sortMode !== "off";
    if ((values.touchDelay ?? 0) < 0) {
        problems.push({
            property: "touchDelay",
            severity: "error",
            message: "Touch long-press cannot be negative. Use 0 to start dragging immediately."
        });
    }
    if ((values.touchDelay ?? 0) > 2000) {
        problems.push({
            property: "touchDelay",
            severity: "warning",
            message: "A long-press over 2 seconds feels broken; 250 to 400 ms is usual."
        });
    }
    if (values.rotatable && ((values.rotationStep ?? 0) < 1 || (values.rotationStep ?? 0) > 180)) {
        problems.push({
            property: "rotationStep",
            severity: "error",
            message: "Rotation step must be between 1 and 180 degrees."
        });
    }
    if (values.lasso && !values.multiSelect) {
        problems.push({ property: "lasso", severity: "warning", message: "Lasso selection needs Multi-select." });
    }
    if (values.equalSpacing && !values.snapToSiblings) {
        problems.push({
            property: "equalSpacing",
            severity: "warning",
            message: "Equal spacing hints need Snap to siblings."
        });
    }
    if (sorting && values.sortCrossContainer && !values.sortContainerSelector?.trim()) {
        problems.push({
            property: "sortContainerSelector",
            severity: "error",
            message: "'Move between lists' needs a list selector that matches every list, e.g. '.task-list'."
        });
    }
    if (sorting && (values.xAttribute || values.yAttribute)) {
        problems.push({
            property: "sortMode",
            severity: "warning",
            message:
                "Sortable items are not positioned freely, so the X and Y attributes are not used. Use the order attribute or On reorder."
        });
    }
    if (sorting && (values.multiSelect || values.resizable || values.rotatable)) {
        problems.push({
            property: "sortMode",
            severity: "warning",
            message:
                "Multi-select group moves, resizing and rotation are meant for free positioning; in a sortable list only one item is moved at a time."
        });
    }
    if (sorting && (values.sortTimeout ?? 0) > 0 && (values.sortTimeout ?? 0) < 1000) {
        problems.push({
            property: "sortTimeout",
            severity: "warning",
            message: "Less than a second rarely gives the list time to refresh; the new order would be rolled back."
        });
    }
    if (sorting && !values.orderAttribute && !values.onReorder) {
        problems.push({
            property: "onReorder",
            severity: "warning",
            message: "Without an order attribute or On reorder the new order is only shown, not saved."
        });
    }
    if (values.snapshotsEnabled && values.layoutCommand && values.layoutCommand === values.snapshotAttribute) {
        problems.push({
            property: "layoutCommand",
            severity: "error",
            message: "The layout command attribute must not be the snapshot attribute."
        });
    }
    if (values.resetSnapshot?.trim() && !values.snapshotsEnabled) {
        problems.push({
            property: "resetSnapshot",
            severity: "warning",
            message: "Reset to snapshot needs Layout snapshots."
        });
    }
    if (
        (values.zOrder || values.rotatable || sorting || values.snapshotsEnabled) &&
        !values.keyboardEnabled &&
        !values.contextMenu
    ) {
        problems.push({
            property: "contextMenu",
            severity: "warning",
            message:
                "Turn on Keyboard dragging or the Item menu so keyboard and single-click users can reach z-order, rotation, sorting and snapshots."
        });
    }
    if (values.undoEnabled && !values.keyboardEnabled) {
        problems.push({
            property: "undoEnabled",
            severity: "warning",
            message: "Undo needs Keyboard dragging (the widget must take focus)."
        });
    }
    return problems;
}
