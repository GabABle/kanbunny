import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import logo from "@/assets/logo.png";

export default function AuthLayout() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4">
          <Link to="/boards" className="flex items-center gap-2">
            <img src={logo} alt="Flowjoe" className="h-6 w-6 rounded-md" />
            <span className="text-sm font-semibold tracking-tight">Flowjoe</span>
          </Link>
          <nav className="flex items-center gap-1">
            <Button asChild variant={location.pathname === "/boards" ? "secondary" : "ghost"} size="sm">
              <Link to="/boards">Boards</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={async () => { await signOut(); navigate("/"); }}>
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </Button>
          </nav>
        </div>
      </header>
      <div className="flex-1"><Outlet /></div>
    </div>
  );
}
