import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import "./index.css";

// Theme: dark is product default; light is optional preference (vera-theme=light).
// Apply before first paint to avoid flash.
const storedTheme = localStorage.getItem("vera-theme");
if (storedTheme !== "light") {
  document.documentElement.classList.add("dark");
}

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined;

const root = PUBLISHABLE_KEY ? (
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <RouterProvider router={router} />
    </ClerkProvider>
  </React.StrictMode>
) : (
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);

ReactDOM.createRoot(document.getElementById("root")!).render(root);
