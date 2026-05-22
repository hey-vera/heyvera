
interface LeftNavProps {
  activeRoute: string;
  onNavigate: (route: string) => void;
  onCompose: () => void;
}

const navItems = [
  { label: "Home", icon: "🏠", route: "/home" },
  { label: "Explore", icon: "🔍", route: "/explore" },
  { label: "Notifications", icon: "🔔", route: "/notifications" },
  { label: "Messages", icon: "✉️", route: "/messages" },
  { label: "Bookmarks", icon: "🔖", route: "/bookmarks" },
  { label: "Communities", icon: "👥", route: "/communities" },
  { label: "Premium", icon: "⭐", route: "/premium" },
  { label: "Profile", icon: "👤", route: "/profile" },
  { label: "More", icon: "•••", route: "" },
] as const;

function HeyVeraLogo() {
  return (
    <div
      className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-black select-none"
      style={{ backgroundColor: "var(--accent)", color: "#000" }}
      aria-label="HeyVera home"
    >
      HV
    </div>
  );
}

export function LeftNav({ activeRoute, onNavigate, onCompose }: LeftNavProps) {
  return (
    <nav
      className="hidden lg:flex fixed top-0 left-0 h-full flex-col z-40 overflow-y-auto"
      style={{
        width: "var(--sidebar-width)",
        paddingLeft: "12px",
        paddingRight: "12px",
        backgroundColor: "var(--bg-primary)",
      }}
    >
      {/* Inner container: icon-only at xl- range (1024-1279), full labels at xl+ */}
      <div className="flex flex-col h-full xl:items-start items-center pt-2 pb-4">

        {/* Logo */}
        <button
          onClick={() => onNavigate("/")}
          className="p-3 rounded-full transition-colors hover:bg-white/10 mb-1"
          aria-label="HeyVera"
        >
          <HeyVeraLogo />
        </button>

        {/* Nav items */}
        <div className="flex flex-col w-full gap-0.5 mt-1">
          {navItems.map((item) => {
            const isActive = item.route !== "" && activeRoute === item.route;
            return (
              <button
                key={item.label}
                onClick={() => {
                  if (item.route) onNavigate(item.route);
                }}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                className="flex items-center gap-4 px-3 py-3 rounded-full transition-colors hover:bg-white/10 w-full xl:w-auto"
                style={{
                  color: "var(--text-primary)",
                  fontWeight: isActive ? 700 : 400,
                }}
              >
                {/* Icon */}
                <span className="text-2xl w-6 flex-shrink-0 leading-none text-center" aria-hidden="true">
                  {item.icon}
                </span>

                {/* Label: hidden below xl breakpoint */}
                <span className="hidden xl:block text-xl leading-tight">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Post button */}
        <div className="mt-4 w-full flex xl:block justify-center">
          {/* Full-width pill at xl+ */}
          <button
            onClick={onCompose}
            className="hidden xl:flex w-full items-center justify-center rounded-full py-3 px-6 text-base font-bold transition-colors"
            style={{
              backgroundColor: "var(--accent)",
              color: "#000",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "var(--accent-hover)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "var(--accent)")
            }
          >
            Post
          </button>

          {/* Circular icon button at lg (1024-1279px) */}
          <button
            onClick={onCompose}
            aria-label="Compose post"
            className="xl:hidden w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold transition-colors"
            style={{
              backgroundColor: "var(--accent)",
              color: "#000",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "var(--accent-hover)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "var(--accent)")
            }
          >
            +
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Account switcher */}
        <button
          className="flex items-center gap-3 px-3 py-3 rounded-full hover:bg-white/10 transition-colors w-full xl:w-auto mb-4"
          aria-label="Account menu"
        >
          {/* Avatar */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
            style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-secondary)" }}
          >
            U
          </div>

          {/* Name + handle */}
          <div className="hidden xl:flex flex-col items-start flex-1 min-w-0">
            <span
              className="text-sm font-bold leading-tight truncate w-full"
              style={{ color: "var(--text-primary)" }}
            >
              User Name
            </span>
            <span
              className="text-sm leading-tight truncate w-full"
              style={{ color: "var(--text-secondary)" }}
            >
              @username
            </span>
          </div>

          {/* More icon */}
          <span
            className="hidden xl:block text-sm flex-shrink-0"
            style={{ color: "var(--text-secondary)" }}
            aria-hidden="true"
          >
            •••
          </span>
        </button>
      </div>
    </nav>
  );
}
