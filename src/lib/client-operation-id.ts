export type ClientOperationIdErrorCode = "SECURE_RANDOM_UNAVAILABLE";

export class ClientOperationIdError extends Error {
  readonly code: ClientOperationIdErrorCode;
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ClientOperationIdError";
    this.code = "SECURE_RANDOM_UNAVAILABLE";
    this.cause = cause;
  }
}

function uuidFromRandomBytes(bytes: Uint8Array) {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export function createClientOperationId() {
  const cryptoApi = globalThis.crypto;
  let randomUuidError: unknown;

  if (typeof cryptoApi?.randomUUID === "function") {
    try {
      return cryptoApi.randomUUID();
    } catch (error) {
      randomUuidError = error;
    }
  }

  if (typeof cryptoApi?.getRandomValues === "function") {
    try {
      return uuidFromRandomBytes(cryptoApi.getRandomValues(new Uint8Array(16)));
    } catch (error) {
      throw new ClientOperationIdError(
        "El navegador no permitió generar un identificador criptográficamente seguro.",
        error,
      );
    }
  }

  throw new ClientOperationIdError(
    "El navegador no ofrece una fuente criptográficamente segura para generar identificadores.",
    randomUuidError,
  );
}
