import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// After a new version goes live, old page files disappear; reload once to fetch the current ones.
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    const key = "jornada-chunk-reload";
    const last = Number(window.sessionStorage.getItem(key) ?? "0");
    if (Date.now() - last < 10_000) return;
    window.sessionStorage.setItem(key, String(Date.now()));
    event.preventDefault();
    window.location.reload();
  });
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
