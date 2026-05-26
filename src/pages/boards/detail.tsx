import { useParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

// TODO: port the full kanban board UI from the original boards.$boardId.tsx
// (drag-and-drop lists, cards, members, CardDialog wiring) using the
// plain-async functions exported from @/lib/kanban.functions.
export default function BoardDetailPage() {
  const { boardId } = useParams();
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div className="max-w-md">
        <h1 className="text-xl font-semibold">Board {boardId}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page still needs to be ported from TanStack Router to React Router v7.
          The data layer (lib/kanban.functions.ts) is already migrated.
        </p>
        <Button asChild variant="outline" className="mt-4"><Link to="/boards">Back to boards</Link></Button>
      </div>
    </div>
  );
}
