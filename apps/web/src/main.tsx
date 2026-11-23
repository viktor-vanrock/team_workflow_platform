import React from "react";
import { createRoot } from "react-dom/client";

import { WorkspaceTheme } from "@awp/platform-ui";

import { App } from "./App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root mount point");
createRoot(root).render(
  <React.StrictMode>
    <WorkspaceTheme>
      <App />
    </WorkspaceTheme>
  </React.StrictMode>,
);
