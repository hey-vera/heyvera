import React from "react";
import { useNavigate } from "react-router-dom";
import { LeftNav } from "./LeftNav";
import { RightRail } from "./RightRail";
import { BottomBar } from "./BottomBar";
import { TopBar } from "./TopBar";

interface AppShellProps {
  children: React.ReactNode;
  activeRoute: string;
}

export function AppShell({ children, activeRoute }: AppShellProps) {
  const navigate = useNavigate();
  const [composeOpen, setComposeOpen] = React.useState(false);

  const handleNavigate = (route: string) => {
    navigate(route);
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--bg-primary)" }}>
      <LeftNav
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
        onCompose={() => setComposeOpen(true)}
      />

      <TopBar title="HeyVera" />

      <div className="flex justify-center" style={{ paddingLeft: "0px" }}>
        <div
          className="w-full lg:pl-[88px] xl:pl-[275px] flex justify-center xl:justify-start"
          style={{ maxWidth: "1265px" }}
        >
          <main
            className="w-full sm:max-w-[600px] lg:max-w-[600px] flex-1"
            style={{
              borderLeft: "1px solid var(--border-primary)",
              borderRight: "1px solid var(--border-primary)",
              minHeight: "100vh",
            }}
          >
            {children}
          </main>

          <div className="hidden lg:block lg:w-[290px] xl:w-[350px] flex-shrink-0">
            <RightRail />
          </div>
        </div>
      </div>

      <BottomBar
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
        onCompose={() => setComposeOpen(true)}
      />

      {composeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
          onClick={() => setComposeOpen(false)}
        >
          <div
            className="w-full max-w-[600px] mx-4 rounded-2xl p-6"
            style={{ backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-primary)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setComposeOpen(false)}
                className="text-sm font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                ✕
              </button>
              <button
                className="px-4 py-1.5 rounded-full text-sm font-bold"
                style={{ backgroundColor: "var(--accent)", color: "#000" }}
              >
                Post
              </button>
            </div>
            <textarea
              placeholder="What's happening?"
              autoFocus
              className="w-full bg-transparent border-none outline-none resize-none text-lg"
              style={{ color: "var(--text-primary)", minHeight: "120px" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
