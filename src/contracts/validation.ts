import type { Static, TSchema } from "typebox";
import { Check, Errors } from "typebox/schema";

import { ContractErrorSchema, type ContractError } from "./base";

export class ContractValidationError extends Error {
  constructor(readonly contract: ContractError) {
    super(contract.message);
    this.name = "ContractValidationError";
  }
}

const clean = (value: string, max = 160) => value.replace(/[\r\n\t]+/g, " ").slice(0, max);

export function parseOrContractError<Schema extends TSchema>(
  schema: Schema,
  value: unknown,
  boundary: string,
): Static<Schema> {
  if (Check(schema, value)) return value as Static<Schema>;
  const [, errors] = Errors(schema, value);
  const details: Record<string, string> = { boundary: clean(boundary, 100) };
  errors.slice(0, 5).forEach((issue, index) => {
    details[`issue${index + 1}`] = clean(`${issue.instancePath || "/"}: ${issue.message}`);
  });
  throw new ContractValidationError({
    code: "CONTRACT_VALIDATION_FAILED",
    message: `Invalid data at ${clean(boundary, 100)}`,
    retryable: false,
    details,
  });
}

function durableCompatibilityContractError(error: unknown): ContractError | undefined {
  if (!(error instanceof Error) || error.name !== "DurableCompatibilityError") return undefined;
  if (!("format" in error) || typeof error.format !== "string") return undefined;
  if (!("recordIdentity" in error) || typeof error.recordIdentity !== "string") return undefined;
  return {
    code: "UNSUPPORTED_DURABLE_FORMAT",
    message: error.message,
    retryable: false,
    details: {
      feature: error.format,
      preservedDataAt: `workspace database quarantine:${error.recordIdentity}`,
    },
  };
}

export function toContractError(error: unknown): ContractError {
  if (error instanceof ContractValidationError) return error.contract;
  if (typeof error === "object" && error !== null && "contract" in error && Check(ContractErrorSchema, error.contract)) {
    return error.contract as ContractError;
  }
  if (error instanceof Error && error.message === "DOCUMENT_REVISION_CONFLICT") {
    return { code: "DOCUMENT_REVISION_CONFLICT", message: "The document changed before it could be saved", retryable: true };
  }
  if (error instanceof Error && error.message === "STALE_SUGGESTION_REVISION") {
    return { code: "STALE_SUGGESTION_REVISION", message: "The suggestion targets an older document revision", retryable: true };
  }
  const compatibilityError = durableCompatibilityContractError(error);
  if (compatibilityError) return compatibilityError;
  return { code: "INTERNAL_ERROR", message: "The operation could not be completed", retryable: false };
}

export class RemoteContractError extends Error {
  constructor(readonly contract: ContractError) {
    super(contract.message);
    this.name = "RemoteContractError";
  }
}
