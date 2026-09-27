import type { AxiosError } from 'axios';

/**
 * Shape shared by API failures surfaced by the dashboard backend.
 *
 * Axios exposes an unknown response body by default. Keeping the small error
 * envelope explicit lets UI code preserve server-provided messages without
 * weakening unrelated values to `any`.
 */
declare global {
  type ApiError = AxiosError<{ message?: string; [key: string]: unknown }> & {
    errorFields?: unknown;
  };

  type JsonRecord = Record<string, unknown>;
}

export {};
