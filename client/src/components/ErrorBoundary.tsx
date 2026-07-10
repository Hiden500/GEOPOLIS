import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  children: ReactNode;
  onReset: () => void;
}

interface State {
  error: Error | null;
}

// ErrorBoundary — классовый компонент, хуки (useTranslation) в нём напрямую
// недоступны, поэтому рендер сообщения об ошибке вынесен в функциональный
// дочерний компонент.
function ErrorFallback({ message, onReset }: { message: string; onReset: () => void }) {
  const { t } = useTranslation("errorBoundary");

  return (
    <div className="loading">
      {t("crashMessage", { message })}
      <button className="back-button" onClick={onReset}>
        {t("backToMenu")}
      </button>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("GameView crashed:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
    this.props.onReset();
  };

  render() {
    if (this.state.error) {
      return (
        <ErrorFallback message={this.state.error.message} onReset={this.handleReset} />
      );
    }

    return this.props.children;
  }
}
