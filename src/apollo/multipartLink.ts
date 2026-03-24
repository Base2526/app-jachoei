import { ApolloLink, Observable } from "@apollo/client";
import type { FetchResult, Operation } from "@apollo/client";
import { print } from "graphql";

export type ReactNativeUpload = {
  uri: string;
  name?: string;
  type?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isReactNativeUpload(value: unknown): value is ReactNativeUpload {
  if (!isPlainObject(value)) return false;

  const uri = value.uri;
  if (typeof uri !== "string" || uri.length === 0) return false;

  // Guard against server-side FileUpload-like objects being accidentally passed around.
  const maybeCreateReadStream = (value as any).createReadStream;
  if (typeof maybeCreateReadStream === "function") return false;

  return true;
}

function hasUploadDeep(value: unknown): boolean {
  if (isReactNativeUpload(value)) return true;
  if (Array.isArray(value)) return value.some(hasUploadDeep);
  if (isPlainObject(value)) return Object.values(value).some(hasUploadDeep);
  return false;
}

export function operationHasReactNativeUpload(operation: Operation): boolean {
  return hasUploadDeep(operation.variables);
}

type ExtractResult = {
  variables: any;
  fileMap: Record<string, string[]>;
  files: ReactNativeUpload[];
};

function extractUploads(value: unknown, path: string, acc: ExtractResult): any {
  if (isReactNativeUpload(value)) {
    const idx = String(acc.files.length);
    acc.files.push(value);
    acc.fileMap[idx] = [path];
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((v, i) => extractUploads(v, `${path}.${i}`, acc));
  }

  if (isPlainObject(value)) {
    const next: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      next[k] = extractUploads(v, `${path}.${k}`, acc);
    }
    return next;
  }

  return value;
}

function buildMultipartBody(operation: Operation): { formData: FormData; files: ReactNativeUpload[] } {
  const acc: ExtractResult = { variables: undefined, fileMap: {}, files: [] };
  const variablesWithNulls = extractUploads(operation.variables ?? {}, "variables", acc);

  const operationsPayload = {
    query: print(operation.query),
    variables: variablesWithNulls,
    operationName: operation.operationName || null,
  };

  const formData = new FormData();
  formData.append("operations", JSON.stringify(operationsPayload));
  formData.append("map", JSON.stringify(acc.fileMap));

  acc.files.forEach((f, i) => {
    const key = String(i);
    const name = f.name || `upload-${Date.now()}-${i}`;
    const type = f.type || "application/octet-stream";

    formData.append(
      key,
      {
        uri: f.uri,
        name,
        type,
      } as any
    );
  });

  return { formData, files: acc.files };
}

export function createGraphQLMultipartLink(opts: { uri: string; fetchImpl?: typeof fetch }) {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return new ApolloLink((operation) => {
    return new Observable<FetchResult>((observer) => {
      (async () => {
        try {
          const { headers, fetchOptions } = operation.getContext();
          const { formData } = buildMultipartBody(operation);

          const mergedHeaders: Record<string, string> = {
            Accept: "application/json",
            ...((headers as any) || {}),
          };

          // Ensure we don't accidentally force JSON content-type for multipart.
          for (const k of Object.keys(mergedHeaders)) {
            if (k.toLowerCase() === "content-type") delete mergedHeaders[k];
          }

          const res = await fetchImpl(opts.uri, {
            method: "POST",
            // IMPORTANT: do NOT set Content-Type for multipart; RN will add boundary.
            headers: mergedHeaders,
            body: formData,
            ...(fetchOptions || {}),
          } as any);

          const json = await res.json();

          // GraphQL servers often return 200 with { errors }.
          observer.next(json);
          observer.complete();
        } catch (e) {
          observer.error(e);
        }
      })();
    });
  });
}
