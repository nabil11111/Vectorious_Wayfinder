// Throw one of these from a route and the error handler turns it into the shared ApiError shape.
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
