export class ForgeError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "ForgeError";
    this.code = code;
    this.status = status;
  }
}

export const badRequest = (code) => new ForgeError(code, 400);
export const unauthorized = () => new ForgeError("UNAUTHORIZED", 401);
export const notFound = (code = "PROJECT_NOT_FOUND") => new ForgeError(code, 404);
export const conflict = (code) => new ForgeError(code, 409);

