import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import AnalysisPage from "./pages/AnalysisPage";
import DashboardPage from "./pages/DashboardPage";
import HoldingsPage from "./pages/HoldingsPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import EventsPage from "./pages/EventsPage";
import VolPage from "./pages/VolPage";
import TransactionsPage from "./pages/TransactionsPage";
import ChartPage from "./pages/ChartPage";
import RiskPage from "./pages/RiskPage";
import FactorsPage from "./pages/FactorsPage";
import ResearchPage from "./pages/ResearchPage";
import DataPage from "./pages/DataPage";
import AgentsPage from "./pages/AgentsPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/analysis" element={<AnalysisPage />} />
          <Route path="/risk" element={<RiskPage />} />
          <Route path="/factors" element={<FactorsPage />} />
          <Route path="/research" element={<ResearchPage />} />
          <Route path="/chart" element={<ChartPage />} />
          <Route path="/holdings" element={<HoldingsPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/vol" element={<VolPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/agents" element={<AgentsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}