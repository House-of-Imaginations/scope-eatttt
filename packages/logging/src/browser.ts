type BrowserLogMethod = "debug" | "error" | "info" | "warn";

const APP_CATEGORY = "scope-eatttt";
const FRONTEND_CATEGORY = "frontend";

let enabled = false;

export interface BrowserLogger {
  readonly category: readonly string[];
  debug(message: string, properties?: Record<string, unknown>): void;
  error(message: string, properties?: Record<string, unknown>): void;
  info(message: string, properties?: Record<string, unknown>): void;
  warn(message: string, properties?: Record<string, unknown>): void;
}

export function configureFrontendLogging(options: { enabled: boolean }): void {
  enabled = options.enabled;
}

export function getAppLogger(category: string | readonly string[]): BrowserLogger {
  const parts = Array.isArray(category) ? category : [category];
  const fullCategory = [APP_CATEGORY, FRONTEND_CATEGORY, ...parts];

  return {
    category: fullCategory,
    debug: (message, properties) => write("debug", fullCategory, message, properties),
    error: (message, properties) => write("error", fullCategory, message, properties),
    info: (message, properties) => write("info", fullCategory, message, properties),
    warn: (message, properties) => write("warn", fullCategory, message, properties),
  };
}

function write(
  method: BrowserLogMethod,
  category: readonly string[],
  message: string,
  properties?: Record<string, unknown>,
): void {
  if (!enabled) return;

  const text = `[${category.join(":")}] ${message}`;
  if (properties === undefined) {
    console[method](text);
    return;
  }
  console[method](text, properties);
}
