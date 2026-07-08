import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error caught by ErrorBoundary:", error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0d1b2a] text-slate-100 flex items-center justify-center p-6 font-sans">
          <div className="w-full max-w-2xl bg-[#152538] border border-slate-700 rounded-none p-8 shadow-2xl">
            <div className="flex items-center space-x-3 text-red-500 mb-6">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-8 h-8"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
              <h1 className="text-2xl font-bold tracking-tight text-white uppercase">
                Application Interrupted
              </h1>
            </div>

            <p className="text-slate-300 mb-6 leading-relaxed">
              An unexpected error occurred in the user interface. Don't panic — live capture status and projections are safely maintained. You can reload the interface to restore the state.
            </p>

            <div className="mb-6">
              <span className="text-xs uppercase font-mono tracking-widest text-slate-400">
                Error Message
              </span>
              <div className="mt-2 bg-[#0d1b2a] border border-slate-800 p-4 font-mono text-sm text-red-400 overflow-x-auto whitespace-pre-wrap select-text">
                {this.state.error?.toString()}
              </div>
            </div>

            {this.state.errorInfo && (
              <div className="mb-8">
                <span className="text-xs uppercase font-mono tracking-widest text-slate-400">
                  Stack Trace
                </span>
                <div className="mt-2 bg-[#0d1b2a] border border-slate-800 p-4 font-mono text-xs text-slate-400 h-48 overflow-y-auto whitespace-pre-wrap select-text">
                  {this.state.errorInfo.componentStack}
                </div>
              </div>
            )}

            <div className="flex justify-end space-x-4">
              <button
                onClick={this.handleReload}
                className="px-6 py-2 bg-transparent border border-slate-500 text-slate-200 hover:border-slate-100 hover:text-white transition duration-200 uppercase font-mono tracking-wider text-sm rounded-none"
              >
                Reload UI
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
