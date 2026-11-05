import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./ui/App";
import "@fontsource-variable/archivo/wdth.css";
import "./styles.css";

registerSW({ immediate: true });

const root = document.getElementById("root");
if (!root) throw new Error("#root fehlt in index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
