const DEFAULT_HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; TFTGOLDENCHANCHAN/0.2; +https://github.com/klmepptiantong-cyber/TFTGOLDENCHANCHAN)",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.7"
};

export async function fetchText(url, options = {}) {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 15000;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { ...DEFAULT_HEADERS, ...(options.headers ?? {}) },
        signal: controller.signal,
        redirect: "follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

export function compactError(error) {
  return error instanceof Error ? error.message : String(error);
}
