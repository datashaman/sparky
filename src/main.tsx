import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { getDisplayMode, applyDisplayMode } from "./components/UserSettings";

// Apply saved display mode before first render to avoid flash
applyDisplayMode(getDisplayMode());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
