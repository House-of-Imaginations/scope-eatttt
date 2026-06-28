import {
  type LogLevel,
  configureSync,
  getConfig,
  getConsoleSink,
  getLogger,
  isLogLevel,
  resetSync,
} from "@logtape/logtape";

export type { LogLevel };

const APP_CATEGORY = "scope-eatttt";

let categoryPrefix: readonly string[] = [APP_CATEGORY];

export function getAppLogger(category: string | readonly string[]) {
  const parts = Array.isArray(category) ? category : [category];
  return getLogger([...categoryPrefix, ...parts]);
}

export function configureBackendLogging(options: {
  service: string;
  level?: LogLevel;
}): void {
  categoryPrefix = [APP_CATEGORY, options.service];
  configureConsoleLogging(resolveLogLevel(options.level));
}

export function configureFrontendLogging(options: { enabled: boolean }): void {
  categoryPrefix = [APP_CATEGORY, "frontend"];
  if (!options.enabled) {
    resetSync();
    return;
  }
  configureConsoleLogging("debug");
}

function configureConsoleLogging(level: LogLevel): void {
  if (getConfig()) return;

  configureSync({
    sinks: { console: getConsoleSink() },
    loggers: [
      {
        category: APP_CATEGORY,
        sinks: ["console"],
        lowestLevel: level,
      },
      {
        category: "logtape",
        sinks: ["console"],
        lowestLevel: "warning",
      },
    ],
  });
}

function resolveLogLevel(level: LogLevel | undefined): LogLevel {
  if (level) return level;
  const envLevel = typeof process !== "undefined" ? process.env.LOG_LEVEL : undefined;
  return envLevel && isLogLevel(envLevel) ? envLevel : "info";
}
