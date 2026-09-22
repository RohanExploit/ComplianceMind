import { Suspense } from "react";
import WorkspacePage from "./page-client";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <WorkspacePage />
    </Suspense>
  );
}
