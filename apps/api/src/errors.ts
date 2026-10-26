export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const forbidden = (message = 'You do not have permission to do that') => new HttpError(403, message);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
