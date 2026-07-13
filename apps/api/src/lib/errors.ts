/**
 * Typed operational errors. Services throw these; the global error handler
 * maps them to HTTP responses. Anything else is treated as a 500.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, message, details);
  }
  static unauthorized(message = "Authentication required") {
    return new ApiError(401, message);
  }
  static forbidden(message = "You do not have permission to perform this action") {
    return new ApiError(403, message);
  }
  static notFound(entity = "Resource") {
    return new ApiError(404, `${entity} not found`);
  }
  static conflict(message: string) {
    return new ApiError(409, message);
  }
}
