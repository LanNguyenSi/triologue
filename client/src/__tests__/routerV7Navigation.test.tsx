// @vitest-environment jsdom
/**
 * Functional evidence for the react-router 6 -> 7 upgrade (agent-tasks
 * 00eaf28c, GHSA-337j-9hxr-rhxg / GHSA-wrjc-x8rr-h8h6 / GHSA-jjmj-jmhj-qwj2).
 *
 * The upgrade itself changed no application code (App.tsx's route table is
 * unchanged), so this does not re-test app behaviour: it pins that the two
 * router mechanisms App.tsx actually relies on still work under
 * react-router-dom 7.18.3, using the same shapes App.tsx uses (an inline
 * `user ? <Page/> : <Navigate to="/login"/>` element per route, and a
 * `<Link>`/`useNavigate` pair for in-app navigation), rather than importing
 * the full App component (which needs the real stores/sockets/i18n wired
 * up).
 *
 * Deep link + useParams rendering under v7 is already covered without a new
 * test: SecretDetailPage.test.tsx mounts a MemoryRouter with
 * initialEntries=["/secrets/s1"] against a `path="/secrets/:secretId"`
 * route, and both its tests pass unchanged on 7.18.3 (counts live in the
 * commit body and the run files, not here).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  MemoryRouter,
  Routes,
  Route,
  Link,
  Navigate,
  useNavigate,
} from "react-router-dom";
import { safeNavTarget } from "../lib/safeNavTarget";

afterEach(() => {
  cleanup();
});

describe("react-router 7.18.3: Link navigation reaches the target route", () => {
  it("clicking a <Link> renders the routed page it points to", () => {
    function Home() {
      return <Link to="/target">go</Link>;
    }
    function Target() {
      return <p>you arrived</p>;
    }

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/target" element={<Target />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText("you arrived")).toBeNull();
    fireEvent.click(screen.getByText("go"));
    expect(screen.getByText("you arrived")).toBeTruthy();
  });
});

describe("react-router 7.18.3: useNavigate reaches the target route", () => {
  it("calling navigate() from a click handler renders the routed page it points to", () => {
    function Home() {
      const navigate = useNavigate();
      return <button onClick={() => navigate("/target")}>go</button>;
    }
    function Target() {
      return <p>you arrived via navigate</p>;
    }

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/target" element={<Target />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("go"));
    expect(screen.getByText("you arrived via navigate")).toBeTruthy();
  });
});

describe("react-router 7.18.3: the App.tsx protected-route shape still redirects", () => {
  // App.tsx guards every authenticated route inline, e.g.:
  //   element={user ? <SettingsPage /> : <Navigate to="/login" />}
  // This reproduces that exact conditional-element shape (not a separate
  // ProtectedRoute/RequireAuth wrapper component: App.tsx has none) with
  // user=null, and asserts the unauthenticated visitor lands on the login
  // route instead of the protected one.
  it("renders the login route instead of the protected route when user is null", () => {
    const user: { id: string } | null = null;
    function Protected() {
      return <p>secret settings</p>;
    }
    function Login() {
      return <p>please log in</p>;
    }

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/settings"
            element={user ? <Protected /> : <Navigate to="/login" />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("please log in")).toBeTruthy();
    expect(screen.queryByText("secret settings")).toBeNull();
  });
});

describe("react-router 7.18.3: a hostile backslash target stays same-origin through safeNavTarget", () => {
  // GHSA-wrjc-x8rr-h8h6 is an open redirect through the rendered <a href> of
  // a backslash target. The router version does not decide this for us (see
  // safeNavTarget.ts for the measurement); the call-site guard does. This
  // pins that under 7.18.3 a <Link> fed through the guard renders a
  // same-origin href, and that an unguarded one would not (the control).
  it.each(["\\/evil.example.com", "//evil.example.com", "/\\evil.example.com"])(
    "renders a same-origin href for %s",
    (hostile) => {
      render(
        <MemoryRouter initialEntries={["/"]}>
          <Link to={safeNavTarget(hostile, "/inbox")}>guarded</Link>
        </MemoryRouter>,
      );
      const href = screen.getByText("guarded").getAttribute("href");
      expect(href).toBe("/inbox");
    },
  );

  it("control: the unguarded hostile href still escapes, so the guard is load-bearing", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Link to="//evil.example.com">unguarded</Link>
      </MemoryRouter>,
    );
    const href = screen.getByText("unguarded").getAttribute("href");
    expect(href).not.toBe("/inbox");
    expect(href ?? "").toMatch(/evil\.example\.com/);
  });
});
