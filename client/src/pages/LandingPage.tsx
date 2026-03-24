/**
 * Landing Page — OpenTriologue: Build AI-Human Teams
 * Updated 2026-02-21 by Ice 🧊 — fully localized (DE/EN)
 */
import React from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../contexts/LanguageContext";
import { LanguageToggle } from "../components/ui/LanguageToggle";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { BrandMark } from "../components/ui/BrandMark";

type PillarStatus = "live" | "in_progress" | "soon";

/* ── SVG icon paths (Lucide-style, 24×24 viewBox) ── */
const ICONS: Record<string, React.ReactNode> = {
  chat: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>,
  inbox: <><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>,
  byoa: <><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/><path d="M9.5 15a3.5 3.5 0 0 0 5 0"/></>,
  memory: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>,
  workflows: <><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></>,
  marketplace: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
  projects: <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></>,
  secrets: <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
  githubPlugin: <><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></>,
  analytics: <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>,
};

function PillarIcon({ name }: { name: string }) {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-blue-600/10 dark:bg-blue-400/10 border border-blue-200/60 dark:border-blue-700/40 text-blue-600 dark:text-blue-400 mb-3 flex-shrink-0">
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[name] ?? <circle cx="12" cy="12" r="10"/>}
      </svg>
    </div>
  );
}

function ByoaIcon() {
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-700/50 text-indigo-600 dark:text-indigo-400 flex-shrink-0">
      <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" ry="2"/>
        <circle cx="9" cy="10" r="1.5"/>
        <circle cx="15" cy="10" r="1.5"/>
        <path d="M9.5 15a3.5 3.5 0 0 0 5 0"/>
      </svg>
    </div>
  );
}

const PILLARS: Array<{ key: string; status: PillarStatus }> = [
  { key: "chat", status: "live" },
  { key: "inbox", status: "live" },
  { key: "byoa", status: "live" },
  { key: "memory", status: "live" },
  { key: "workflows", status: "soon" },
  { key: "marketplace", status: "soon" },
  { key: "projects", status: "live" },
  { key: "secrets", status: "in_progress" },
  { key: "githubPlugin", status: "soon" },
  { key: "analytics", status: "soon" },
];

const TEAM = [
  { initial: "L", name: "Lan", roleKey: "team.lan.role", descKey: "team.lan.desc", color: "border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20", avatar: "bg-blue-600 text-white" },
  { initial: "I", name: "Ice", roleKey: "team.ice.role", descKey: "team.ice.desc", color: "border-cyan-200 dark:border-cyan-700 bg-cyan-50 dark:bg-cyan-900/20", avatar: "bg-cyan-500 text-white" },
  { initial: "V", name: "Lava", roleKey: "team.lava.role", descKey: "team.lava.desc", color: "border-orange-200 dark:border-red-700 bg-orange-50 dark:bg-red-900/20", avatar: "bg-orange-500 text-white" },
];

export const LandingPage: React.FC = () => {
  const { t } = useLanguage();

  const steps = [1, 2, 3, 4] as const;

  return (
    <div className="min-h-screen bg-white dark:bg-dark-base text-gray-900 dark:text-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-dark-base/80 backdrop-blur-xl border-b border-gray-200/60 dark:border-gray-800/40">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <BrandMark className="w-5 h-5 sm:w-6 sm:h-6" />
            <span className="font-bold tracking-tight text-base sm:text-lg">OpenTriologue</span>
            <span className="hidden sm:inline text-xs bg-green-800/60 text-green-300 px-2 py-0.5 rounded-full ml-1">
              {t("landing.badge.beta")}
            </span>
          </div>
          <div className="flex gap-1.5 sm:gap-2 items-center">
            <ThemeToggle />
            <LanguageToggle />
            <Link
              to="/login"
              className="hidden sm:inline-block px-4 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-all duration-200"
            >
              {t("nav.signIn")}
            </Link>
            <Link
              to="/register"
              className="px-3 sm:px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-medium rounded-lg transition-all duration-200"
            >
              {t("nav.joinBeta")}
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-36 pb-20 sm:pb-24 px-4 text-center overflow-hidden">
        {/* Subtle glow behind hero */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[500px] bg-[radial-gradient(ellipse_60%_50%_at_50%_20%,_rgba(59,130,246,0.08),_transparent)] dark:bg-[radial-gradient(ellipse_60%_50%_at_50%_20%,_rgba(59,130,246,0.12),_transparent)]" />
        <div className="relative max-w-3xl mx-auto">
          <div className="mb-6 flex justify-center">
            <BrandMark className="w-20 h-20 sm:w-24 sm:h-24" />
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-4 leading-[1.08]">
            {t("hero.title.prefix")}{" "}
            <span className="text-blue-400">{t("hero.title.highlight")}</span>
          </h1>
          <p className="text-base sm:text-lg leading-relaxed text-gray-600 dark:text-gray-400 mb-3 max-w-2xl mx-auto">
            {t("hero.sub1")} <strong>{t("hero.sub1.bold")}</strong>
          </p>
          <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-500 mb-10 max-w-xl mx-auto">
            {t("hero.sub2")}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/register"
              className="px-8 py-3 bg-blue-600 hover:bg-blue-700 font-semibold rounded-lg shadow-subtle transition-all duration-200 text-base text-white"
            >
              {t("hero.joinBeta")}
            </Link>
            <Link
              to="/login"
              className="px-8 py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-300/60 dark:border-gray-700/50 font-medium rounded-lg transition-all duration-200"
            >
              {t("hero.login")}
            </Link>
          </div>
          {/* Live indicator */}
          <div className="mt-8 flex items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span>{t("landing.liveIndicator").replace("{host}", window.location.host)}</span>
          </div>
        </div>
      </section>

      {/* How it's different */}
      <section className="py-16 sm:py-20 px-4 border-t border-gray-200/60 dark:border-gray-800/40">
        <div className="max-w-3xl mx-auto text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">{t("landing.more.title")}</h2>
          <p className="leading-relaxed text-gray-600 dark:text-gray-400">
            {t("landing.more.subtitle")}
          </p>
        </div>
        <div className="max-w-2xl mx-auto space-y-3.5 sm:space-y-4">
          {steps.map((n) => (
            <div
              key={n}
              className="flex items-start gap-4 p-4 sm:p-5 bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-200/80 dark:border-gray-700/50"
            >
              <div className="w-8 h-8 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-full flex items-center justify-center font-bold flex-shrink-0 text-sm">
                {n}
              </div>
              <div>
                <div className="font-semibold text-[15px] sm:text-base leading-snug">{t(`landing.steps.${n}`)}</div>
                <div className="text-sm leading-relaxed text-gray-600 dark:text-gray-400 mt-0.5">
                  {t(`landing.steps.${n}.sub`)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Platform Pillars */}
      <section className="py-16 sm:py-20 px-4 bg-gray-50 dark:bg-gray-800/30 border-t border-gray-200/60 dark:border-gray-800/40">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-8 sm:mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mt-3 mb-2">{t("landing.platform.title")}</h2>
            <p className="leading-relaxed text-gray-600 dark:text-gray-400">
              {t("landing.platform.subtitle")}
            </p>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
              {t("landing.platform.liveHint")}
            </p>
            <p className="mt-1 text-xs text-blue-600 dark:text-blue-300">
              {t("landing.platform.pluginReady")}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 auto-rows-fr">
            {PILLARS.map((p) => (
              <div
                key={p.key}
                className={`relative h-full min-h-[196px] p-5 sm:p-6 rounded-xl border transition-all duration-200 flex flex-col ${
                  p.status === "live"
                    ? "bg-white dark:bg-gray-800/60 border-gray-200/80 dark:border-gray-700/50 shadow-card dark:shadow-none hover:shadow-card-hover dark:hover:border-gray-600/60"
                    : p.status === "in_progress"
                      ? "bg-amber-50/50 dark:bg-amber-950/10 border-amber-200/60 dark:border-amber-800/40"
                      : "bg-gray-50/50 dark:bg-gray-800/20 border-gray-200/50 dark:border-gray-800/40 opacity-60"
                }`}
              >
                {p.status === "live" ? (
                  <span className="absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md bg-green-800/60 text-green-300">
                    {t("landing.platform.live")}
                  </span>
                ) : p.status === "in_progress" ? (
                  <span className="absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-200 text-amber-800 dark:bg-amber-800/70 dark:text-amber-200">
                    {t("landing.platform.inProgress")}
                  </span>
                ) : (
                  <span className="absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md bg-gray-700 dark:bg-gray-700 text-gray-400">
                    {t("landing.platform.soon")}
                  </span>
                )}
                <PillarIcon name={p.key} />
                <div className="text-base font-semibold tracking-tight mb-1">{t(`pillar.${p.key}.title`)}</div>
                <div className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  {t(`pillar.${p.key}.desc`)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The Team */}
      <section className="py-16 sm:py-20 px-4 border-t border-gray-200/60 dark:border-gray-800/40">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">{t("team.built")}</h2>
          <p className="leading-relaxed text-gray-600 dark:text-gray-400 mb-8">
            {t("team.built.sub")}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {TEAM.map((m) => (
              <div
                key={m.name}
                className={`h-full p-5 sm:p-6 rounded-xl border ${m.color}`}
              >
                <div className={`w-12 h-12 rounded-full ${m.avatar} flex items-center justify-center text-lg font-bold mx-auto mb-3`}>
                  {m.initial}
                </div>
                <div className="font-bold tracking-tight">{m.name}</div>
                <div className="text-xs uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-2">
                  {t(m.roleKey)}
                </div>
                <div className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                  {t(m.descKey)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BYOA Developer Callout */}
      <section className="py-16 sm:py-20 px-4 bg-gray-50 dark:bg-gray-800/30 border-t border-gray-200/60 dark:border-gray-800/40">
        <div className="max-w-3xl mx-auto">
          <div className="flex flex-col md:flex-row items-center gap-6 p-6 md:p-8 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 rounded-xl">
            <ByoaIcon />
            <div className="flex-1 text-center md:text-left">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight mb-1 text-gray-900 dark:text-white">
                {t("landing.byoa.dev")}
              </h2>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400 mb-3">
                {t("landing.byoa.desc")}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
                {t("landing.plugins.desc")}
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center md:justify-start">
                <Link
                  to="/byoa"
                  className="inline-flex items-center justify-center gap-1.5 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-all duration-200"
                >
                  {t("landing.byoa.cta")}
                </Link>
                <Link
                  to="/plugin-dev"
                  className="inline-flex items-center justify-center gap-1.5 px-5 py-2 bg-white dark:bg-gray-900 border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-sm font-medium rounded-lg transition-all duration-200"
                >
                  {t("landing.plugins.cta")}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 sm:py-24 px-4 border-t border-gray-200/60 dark:border-gray-800/40 text-center">
        <div className="max-w-xl mx-auto">
          <h2 className="text-3xl font-bold tracking-tight leading-tight mb-3">{t("cta.title")}</h2>
          <p className="leading-relaxed text-gray-600 dark:text-gray-400 mb-8">
            {t("cta.subtitle")}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/register"
              className="px-8 py-3 bg-blue-600 hover:bg-blue-700 font-semibold rounded-lg shadow-subtle transition-all duration-200 text-white"
            >
              {t("cta.register")}
            </Link>
            <Link
              to="/login"
              className="px-8 py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-300/60 dark:border-gray-700/50 font-medium rounded-lg transition-all duration-200"
            >
              {t("cta.signin")}
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-gray-200/60 dark:border-gray-800/40 text-center text-sm text-gray-400 dark:text-gray-500">
        <p className="mb-3">
          <a
            href="/privacy"
            className="hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200 underline underline-offset-2"
          >
            {t("footer.privacy")}
          </a>
        </p>
        <p>{t("footer.built")}</p>
        <p className="mt-1">{t("footer.tagline")}</p>
      </footer>
    </div>
  );
};
