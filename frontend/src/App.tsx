import { AppRoutes } from "./router";
import { useAuthBootstrap } from "./hooks/useAuthBootstrap";

function App() {
  const isReady = useAuthBootstrap();

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--color-text-muted)]">Loading...</p>
      </div>
    );
  }

  return <AppRoutes />;
}

export default App;