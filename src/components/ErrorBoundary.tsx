import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
    children: ReactNode;
    message: string;
    retryLabel: string;
}

interface State {
    error: Error | undefined;
    attempt: number;
}

/** Remounts the children after a retry (new key). */
function ErrorKey({ children }: { children: ReactNode }): ReactNode {
    return children;
}

/**
 * 2.2: keeps one broken draggable (for example a content widget that throws) from taking the whole page down.
 * Shows a short message with a Try again button that remounts the widget.
 */
export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: undefined, attempt: 0 };

    componentDidCatch(error: Error, info: ErrorInfo): void {
        // Visible in the browser console for support; the page keeps working.
        console.error("MxTechies Draggable failed to render", error, info.componentStack);
    }

    render(): ReactNode {
        if (this.state.error) {
            return (
                <div className="mxt-draggable-error" role="alert">
                    <span className="mxt-draggable-error__text">{this.props.message}</span>
                    <button type="button" className="mxt-draggable-error__retry" onClick={this.retry}>
                        {this.props.retryLabel}
                    </button>
                </div>
            );
        }
        return <ErrorKey key={this.state.attempt}>{this.props.children}</ErrorKey>;
    }

    private retry = (): void => {
        this.setState(state => ({ error: undefined, attempt: state.attempt + 1 }));
    };

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { error };
    }
}
