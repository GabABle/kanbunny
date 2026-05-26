import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import IndexPage from "@/pages/index";
import LoginPage from "@/pages/login";
import SignupPage from "@/pages/signup";
import InvitePage from "@/pages/invite";
import AuthLayout from "@/pages/AuthLayout";
import BoardsListPage from "@/pages/boards/index";
import BoardDetailPage from "@/pages/boards/detail";

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">Page not found</p>
        <a href="/" className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Go home</a>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<IndexPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route element={<RequireAuth><AuthLayout /></RequireAuth>}>
        <Route path="/boards" element={<BoardsListPage />} />
        <Route path="/boards/:boardId" element={<BoardDetailPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
