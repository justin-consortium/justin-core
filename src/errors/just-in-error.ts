/**
 * Standard error class for the just-in package.
 *
 * Extends `Error` with a machine-readable `code` for programmatic branching,
 * an `isLogged` flag to ensure each error is logged exactly once at its origin,
 * and a `data` record for structured context that accumulates as the error
 * propagates up through layers.
 */
export class JustInError extends Error {
  code: string;
  isLogged: boolean;
  data: Record<string, any>;

  constructor(
    message: string,
    code: string,
    {
      name = 'JustInError',
      isLogged = false,
      data = {},
    }: {
      name?: string;
      isLogged?: boolean;
      data?: Record<string, any>;
    } = {},
  ) {
    super(message);
    this.name = name;
    this.code = code;
    this.isLogged = isLogged;
    this.data = data;
  }
}
