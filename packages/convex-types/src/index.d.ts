export type ConvexStubNamespace = {
  [key: string]: ConvexStubNamespace | string;
  toString(): string;
  valueOf(): string;
  [Symbol.toPrimitive](hint: string): string | number;
};

export interface GeneratedConvexApi {
  api: ConvexStubNamespace;
  internal: ConvexStubNamespace;
  __isFallback?: boolean;
}

export declare const api: ConvexStubNamespace;
export declare const internal: ConvexStubNamespace;
export declare const isFallback: boolean;
export declare function loadGeneratedApi(): GeneratedConvexApi;
