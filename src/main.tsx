import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./globals.css";

/**
 * What a visitor sees instead of a blank page when the app throws while it
 * renders, for example when saving fills the browser's storage. React only
 * logs an error a boundary catches, so it is reported again as uncaught:
 * that is how the checks and the browser that tries the site count page
 * errors.
 */
class CrashScreen extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("The page could not be shown.", error, info.componentStack);
    window.reportError?.(error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // The attribute is how the preview tells this screen from the app while
    // the app is still being built, and covers it with a calmer note.
    return (
      <main
        data-thatcode-crash
        className="flex min-h-svh items-center justify-center bg-background px-6 text-foreground"
      >
        <div role="alert" className="w-full max-w-md text-center">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            This page hit an error and could not be shown. Reloading usually
            fixes it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
          >
            Reload the page
          </button>
          <details className="mt-6 text-left text-xs text-muted-foreground">
            <summary className="cursor-pointer text-center">
              What went wrong
            </summary>
            <p className="mt-2 break-words font-mono">
              {error.message.slice(0, 300)}
            </p>
          </details>
        </div>
      </main>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <CrashScreen>
    <App />
  </CrashScreen>,
);
