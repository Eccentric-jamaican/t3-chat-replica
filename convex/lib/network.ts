type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  retryOnStatuses?: number[];
  retryOnNetworkError?: boolean;
};

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  retries: 2,
  baseDelayMs: 250,
  maxDelayMs: 2000,
  timeoutMs: 10_000,
  retryOnStatuses: [408, 409, 425, 429, 500, 502, 503, 504],
  retryOnNetworkError: true,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withJitter = (value: number) => {
  const jitter = Math.floor(Math.random() * 120);
  return value + jitter;
};

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: RetryOptions,
): Promise<Response> {
  const config = {
    ...DEFAULT_RETRY_OPTIONS,
    ...(options ?? {}),
  };

  let attempt = 0;
  while (true) {
    try {
      const response = await fetchWithTimeout(
        input,
        init,
        config.timeoutMs,
      );
      if (
        response.ok ||
        !config.retryOnStatuses.includes(response.status) ||
        attempt >= config.retries
      ) {
        return response;
      }
    } catch (error) {
      if (!config.retryOnNetworkError || attempt >= config.retries) {
        throw error;
      }
    }

    attempt += 1;
    const delay = Math.min(
      config.baseDelayMs * Math.pow(2, attempt - 1),
      config.maxDelayMs,
    );
    await sleep(withJitter(delay));
  }
}

