import { Type, type Static, type TSchema } from "typebox";

export const strict = { additionalProperties: false } as const;
export const identifier = Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" });
export const text = (maxLength: number) => Type.String({ maxLength });
export const revision = Type.Integer({ minimum: 0 });
export const timestamp = Type.Number({ minimum: 0 });

export const PROTOCOL_VERSION = 1 as const;
export const BUILD_IDENTIFIER = "0.1.0" as const;
export const STORAGE_PROTOCOL_NAME = "scribe.storage" as const;
export const AGENT_PROTOCOL_NAME = "scribe.agent" as const;
export const DEFAULT_EVENT_STREAM_ID = "document:default-document" as const;
export const ProtocolVersionSchema = Type.Literal(PROTOCOL_VERSION);
export const IdentifierSchema = identifier;
export const RevisionSchema = revision;
export const TimestampSchema = timestamp;

export const JsonValueRuntimeSchema = Type.Cyclic(
  {
    JsonValue: Type.Union([
      Type.Null(),
      Type.Boolean(),
      Type.Number(),
      Type.String(),
      Type.Array(Type.Ref("JsonValue")),
      Type.Record(Type.String(), Type.Ref("JsonValue")),
    ]),
  },
  "JsonValue",
);
export const JsonValueSchema = Type.Unsafe<unknown>(JsonValueRuntimeSchema);

export const ContractErrorSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 100, pattern: "^[A-Z][A-Z0-9_]*$" }),
    message: Type.String({ minLength: 1, maxLength: 500 }),
    retryable: Type.Boolean(),
    details: Type.Optional(
      Type.Record(
        Type.String({ minLength: 1, maxLength: 100 }),
        Type.Union([Type.String({ maxLength: 200 }), Type.Number(), Type.Boolean()]),
      ),
    ),
  },
  strict,
);
export type ContractError = Static<typeof ContractErrorSchema>;

export function operation<Params extends TSchema, Result extends TSchema>(params: Params, result: Result) {
  return { params, result, error: ContractErrorSchema } as const;
}

export type OperationRegistry = Record<string, { params: TSchema; result: TSchema; error: TSchema }>;
export type OperationName<Registry extends OperationRegistry> = Extract<keyof Registry, string>;
export type OperationParams<Registry extends OperationRegistry, Name extends OperationName<Registry>> = Static<Registry[Name]["params"]>;
export type OperationResult<Registry extends OperationRegistry, Name extends OperationName<Registry>> = Static<Registry[Name]["result"]>;
export type OperationArgs<Registry extends OperationRegistry, Name extends OperationName<Registry>> =
  undefined extends OperationParams<Registry, Name>
    ? [params?: OperationParams<Registry, Name>]
    : [params: OperationParams<Registry, Name>];
export interface OperationCaller<Registry extends OperationRegistry> {
  call<Name extends OperationName<Registry>>(
    operationName: Name,
    ...args: OperationArgs<Registry, Name>
  ): Promise<OperationResult<Registry, Name>>;
}
