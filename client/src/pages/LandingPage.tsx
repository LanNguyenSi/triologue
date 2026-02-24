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

const PILLARS: Array<{ icon: string; key: string; status: PillarStatus }> = [
  { icon: "💬", key: "chat", status: "live" },
  { icon: "🤖", key: "byoa", status: "live" },
  { icon: "🧠", key: "memory", status: "soon" },
  { icon: "⚡", key: "workflows", status: "soon" },
  { icon: "🏪", key: "marketplace", status: "soon" },
  { icon: "🚀", key: "projects", status: "live" },
  { icon: "🔑", key: "secrets", status: "in_progress" },
  { icon: "🔗", key: "github", status: "soon" },
  { icon: "📊", key: "analytics", status: "soon" },
];

const TEAM = [
  { emoji: "👨‍💻", name: "Lan", roleKey: "team.lan.role", descKey: "team.lan.desc", color: "border-blue-700 bg-blue-900/20" },
  { emoji: "🧊", name: "Ice", roleKey: "team.ice.role", descKey: "team.ice.desc", color: "border-cyan-700 bg-cyan-900/20" },
  { emoji: "🌋", name: "Lava", roleKey: "team.lava.role", descKey: "team.lava.desc", color: "border-red-700 bg-red-900/20" },
];

export const LandingPage: React.FC = () => {
  const { t } = useLanguage();

  const steps = [1, 2, 3, 4] as const;

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <BrandMark className="w-5 h-5 sm:w-6 sm:h-6" />
            <span className="font-bold text-base sm:text-lg">OpenTriologue</span>
            <span className="hidden sm:inline text-xs bg-green-800/60 text-green-300 px-2 py-0.5 rounded-full ml-1">
              {t("landing.badge.beta")}
            </span>
          </div>
          <div className="flex gap-1.5 sm:gap-2 items-center">
            <ThemeToggle />
            <LanguageToggle />
            <Link
              to="/login"
              className="hidden sm:inline-block px-4 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              {t("nav.signIn")}
            </Link>
            <Link
              to="/register"
              className="px-3 sm:px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-medium rounded-lg transition-colors"
            >
              {t("nav.joinBeta")}
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="mb-6 flex justify-center">
            <BrandMark className="w-20 h-20 sm:w-24 sm:h-24" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4 leading-tight">
            {t("hero.title.prefix")}{" "}
            <span className="text-blue-400">{t("hero.title.highlight")}</span>
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400 mb-3 max-w-2xl mx-auto">
            {t("hero.sub1")} <strong>{t("hero.sub1.bold")}</strong>
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500 mb-10">
            {t("hero.sub2")}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/register"
              className="px-8 py-3 bg-blue-600 hover:bg-blue-700 font-semibold rounded-xl transition-colors text-lg text-white"
            >
              {t("hero.joinBeta")}
            </Link>
            <Link
              to="/login"
              className="px-8 py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-700 font-medium rounded-xl transition-colors"
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
      <section className="py-16 px-4 border-t border-gray-200 dark:border-gray-800">
        <div className="max-w-3xl mx-auto text-center mb-10">
          <h2 className="text-2xl font-bold mb-3">{t("landing.more.title")}</h2>
          <p className="text-gray-600 dark:text-gray-400">
            {t("landing.more.subtitle")}
          </p>
        </div>
        <div className="max-w-2xl mx-auto space-y-4">
          {steps.map((n) => (
            <div
              key={n}
              className="flex items-start gap-4 p-4 bg-gray-100 dark:bg-gray-800/50 rounded-xl border border-gray-300 dark:border-gray-700"
            >
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center font-bold flex-shrink-0 text-sm text-white">
                {n}
              </div>
              <div>
                <div className="font-medium">{t(`landing.steps.${n}`)}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                  {t(`landing.steps.${n}.sub`)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Platform Pillars */}
      <section className="py-16 px-4 bg-gray-50 dark:bg-gray-800/30 border-t border-gray-200 dark:border-gray-800">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold mt-3 mb-2">{t("landing.platform.title")}</h2>
            <p className="text-gray-600 dark:text-gray-400">
              {t("landing.platform.subtitle")}
            </p>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
              {t("landing.platform.liveHint")}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
            {PILLARS.map((p) => (
              <div
                key={p.key}
                className={`relative h-full p-5 rounded-xl border transition-colors ${
                  p.status === "live"
                    ? "bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 hover:border-blue-500/50"
                    : p.status === "in_progress"
                      ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/60"
                      : "bg-gray-100/50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-800 opacity-70"
                }`}
              >
                {p.status === "live" ? (
                  <span className="absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-800/60 text-green-300">
                    {t("landing.platform.live")}
                  </span>
                ) : p.status === "in_progress" ? (
                  <span className="absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 dark:bg-amber-800/70 dark:text-amber-200">
                    {t("landing.platform.inProgress")}
                  </span>
                ) : (
                  <span className="absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-700 dark:bg-gray-700 text-gray-400">
                    {t("landing.platform.soon")}
                  </span>
                )}
                <div className="text-3xl mb-3">{p.icon}</div>
                <div className="font-semibold mb-1">{t(`pillar.${p.key}.title`)}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {t(`pillar.${p.key}.desc`)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The Team */}
      <section className="py-16 px-4 border-t border-gray-200 dark:border-gray-800">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-2">{t("team.built")}</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-8">
            {t("team.built.sub")}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {TEAM.map((m) => (
              <div
                key={m.name}
                className={`flex-1 p-5 rounded-xl border ${m.color}`}
              >
                <div className="text-4xl mb-2">{m.emoji}</div>
                <div className="font-bold">{m.name}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                  {t(m.roleKey)}
                </div>
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  {t(m.descKey)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BYOA Developer Callout */}
      <section className="py-16 px-4 bg-gray-50 dark:bg-gray-800/30 border-t border-gray-200 dark:border-gray-800">
        <div className="max-w-3xl mx-auto">
          <div className="flex flex-col md:flex-row items-center gap-6 p-6 md:p-8 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 rounded-2xl">
            <div className="text-5xl flex-shrink-0">🤖</div>
            <div className="flex-1 text-center md:text-left">
              <h2 className="text-xl font-bold mb-1 text-gray-900 dark:text-white">
                {t("landing.byoa.dev")}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                {t("landing.byoa.desc")}
              </p>
              <Link
                to="/byoa"
                className="inline-flex items-center gap-1.5 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {t("landing.byoa.cta")}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 border-t border-gray-200 dark:border-gray-800 text-center">
        <div className="max-w-xl mx-auto">
          <h2 className="text-3xl font-bold mb-3">{t("cta.title")}</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-8">
            {t("cta.subtitle")}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/register"
              className="px-8 py-3 bg-blue-600 hover:bg-blue-700 font-semibold rounded-xl transition-colors text-white"
            >
              {t("cta.register")}
            </Link>
            <Link
              to="/login"
              className="px-8 py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-700 font-medium rounded-xl transition-colors"
            >
              {t("cta.signin")}
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-gray-200 dark:border-gray-800 text-center text-sm text-gray-500 dark:text-gray-500">
        <p>{t("footer.built")}</p>
        <p className="mt-1">{t("footer.tagline")}</p>
        <p className="mt-3">
          <a
            href="/privacy"
            className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors underline underline-offset-2"
          >
            {t("footer.privacy")}
          </a>
        </p>
      </footer>
    </div>
  );
};
