import { StrictMode, Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

class DemoErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  public state = { hasError: false };

  public static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  public componentDidCatch(_error: Error, _info: ErrorInfo): void {
    void _error;
    void _info;
    // Keep the demo recoverable without leaking internal implementation details.
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="fatal-error">
          <p className="eyebrow">StoryVerse</p>
          <h1>The story lost its thread.</h1>
          <p>Reload the page to restore the saved universe.</p>
          <button type="button" onClick={() => window.location.reload()}>Reload StoryVerse</button>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DemoErrorBoundary><App /></DemoErrorBoundary>
  </StrictMode>,
);
