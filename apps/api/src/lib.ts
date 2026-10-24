import type { NextFunction, Request, Response } from "express";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const asyncRoute = (
  handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>,
) => (request: Request, response: Response, next: NextFunction) => {
  void handler(request, response, next).catch(next);
};

export const asNumber = (value: { toString(): string } | number) => Number(value.toString());

export const makeReference = (prefix: string) =>
  `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
