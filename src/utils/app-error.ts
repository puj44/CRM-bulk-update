export interface ErrorDetail {
  field: string | null;
  message: string;
}

// errors we expect and want to show to the client as-is
export default class AppError extends Error {
  readonly statusCode: number;
  readonly details?: ErrorDetail[];

  constructor(statusCode: number, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
  }
}
