import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "./design";
import "./i18n";
import "./app.css";
import App from "./App.tsx";
import { queryClient } from "./queryClient";

// Offline use (wave U9): queries try the network once even when the browser says it is offline, so the service
// worker can answer from what it saved (TanStack's default "online" mode would pause them instead).
queryClient.setDefaultOptions({
  ...queryClient.getDefaultOptions(),
  queries: { ...queryClient.getDefaultOptions().queries, networkMode: "offlineFirst" },
  mutations: { ...queryClient.getDefaultOptions().mutations, networkMode: "offlineFirst" },
});

// The service worker (public/sw.js) runs in production builds only; the dev server never registers one, and drops any
// left over from a production preview on the same address so hot reload keeps working.
if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline use is optional */
      });
    });
  } else {
    void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister()));
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
