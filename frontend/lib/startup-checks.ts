import { sendAlert } from "./alerts";
import { checkDatabaseHealth } from "./db";
import { GEMINI_MODEL } from "./gemini";
import { logEvent } from "./logger";

type ApiHealth = {
  configured: boolean;
  reachable: boolean;
  detail: string;
};

const startupState = globalThis as typeof globalThis & {
  __siliconGazetteStartupChecksRan?: boolean;
};

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function checkGroqHealth(): Promise<ApiHealth> {
  if (!process.env.GROQ_API_KEY) {
    return {
      configured: false,
      reachable: false,
      detail: "GROQ_API_KEY is not set."
    };
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`
      },
      signal: timeoutSignal(12000)
    });

    if (response.ok) {
      return {
        configured: true,
        reachable: true,
        detail: "Groq API reachable."
      };
    }

    return {
      configured: true,
      reachable: false,
      detail: `Groq API returned HTTP ${response.status}.`
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      configured: true,
      reachable: false,
      detail: `Groq API check failed: ${detail}`
    };
  }
}

async function checkTavilyHealth(): Promise<ApiHealth> {
  if (!process.env.TAVILY_API_KEY) {
    return {
      configured: false,
      reachable: false,
      detail: "TAVILY_API_KEY is not set."
    };
  }

  try {
    const response = await fetch("https://api.tavily.com", {
      method: "GET",
      signal: timeoutSignal(12000)
    });

    // Any HTTP response means network-level connectivity is working.
    return {
      configured: true,
      reachable: true,
      detail: `Tavily host reachable (HTTP ${response.status}).`
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      configured: true,
      reachable: false,
      detail: `Tavily API check failed: ${detail}`
    };
  }
}

async function checkGeminiHealth(): Promise<ApiHealth> {
  if (!process.env.GEMINI_API_KEY) {
    return {
      configured: false,
      reachable: false,
      detail: "GEMINI_API_KEY is not set (optional fallback)."
    };
  }

  try {
    // Check the same model the fallback actually calls, with the key in a header.
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}`,
      {
        method: "GET",
        headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
        signal: timeoutSignal(12000)
      }
    );

    if (response.ok) {
      return {
        configured: true,
        reachable: true,
        detail: `Gemini model ${GEMINI_MODEL} reachable (fallback ready).`
      };
    }

    return {
      configured: true,
      reachable: false,
      detail: `Gemini model ${GEMINI_MODEL} returned HTTP ${response.status}.`
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      configured: true,
      reachable: false,
      detail: `Gemini API check failed: ${detail}`
    };
  }
}

function logStatus(label: string, healthy: boolean, detail: string): void {
  logEvent(healthy ? "info" : "warn", "startup.check", { service: label, healthy, detail });
}

export async function runStartupChecks(): Promise<void> {
  if (startupState.__siliconGazetteStartupChecksRan) {
    return;
  }
  startupState.__siliconGazetteStartupChecksRan = true;

  const [db, groq, tavily, gemini] = await Promise.all([
    checkDatabaseHealth(),
    checkGroqHealth(),
    checkTavilyHealth(),
    checkGeminiHealth()
  ]);

  const dbHealthy = db.configured ? db.connected && db.editionsTableExists : true;
  logStatus("Database", dbHealthy, db.detail);
  logStatus("Groq", groq.configured && groq.reachable, groq.detail);
  logStatus("Tavily", tavily.configured && tavily.reachable, tavily.detail);
  logStatus("Gemini", gemini.configured && gemini.reachable, gemini.detail);

  // Only required services alert; Gemini is an optional fallback.
  const down = [
    !dbHealthy && `Database: ${db.detail}`,
    !(groq.configured && groq.reachable) && `Groq: ${groq.detail}`,
    !(tavily.configured && tavily.reachable) && `Tavily: ${tavily.detail}`
  ].filter(Boolean);
  if (down.length > 0) {
    await sendAlert("startup-degraded", "A required service failed its startup check.", { services: down });
  }
}